# Testing de media y composición (worker FFmpeg — F5)

Cómo se testea `apps/worker` en su parte de render: normalización canónica y su caché (T5.2), concat + mezcla de audio (T5.3), subtítulos ASS karaoke (T5.4), pase final + QA + C2PA (T5.5) y el healthcheck de la imagen Docker (T5.1). Estos tests ejecutan FFmpeg de verdad: son la única forma honesta de verificar filtergraphs, perfiles de encode y loudness. Lo que NO hacen es juzgar calidad visual subjetiva — eso queda para la revisión humana y el gate CUA de cierre de tarea.

Contenido: [Entorno](#entorno-dónde-corren-estos-tests) · [Assets sintéticos](#principio-rector-assets-sintéticos-generados-en-el-propio-test) · [ffprobe/assertVideoProfile](#asserts-de-perfil-assertvideoprofile-sobre-ffprobe) · [Normalización y caché](#normalización-canónica-y-caché-t52) · [Loudness y ducking](#loudness-y-ducking-t53) · [ASS karaoke](#subtítulos-ass-t54) · [QA + C2PA](#pase-final-qa-y-c2pa-t55) · [Healthcheck](#healthcheck-de-la-imagen-t51) · [Golden files](#golden-files)

## Entorno: dónde corren estos tests

Estos tests requieren `ffmpeg` (con libass), `ffprobe`, `c2patool` y las fuentes OFL — es decir, **la imagen Docker del worker** (T5.1). No asumas que la máquina de dev los tiene.

- Ubicación: `apps/worker/test/media/**/*.test.ts`. Corren con `pnpm test:media` (proyecto Vitest transversal `worker:media`, con `testTimeout` alto, p. ej. 120 s — un encode x264 de 3 s tarda, y en CI compartido más). **No forman parte de `pnpm test`**: la suite estándar debe seguir siendo rápida y ejecutable en cualquier máquina.
- Ejecución canónica: `docker compose -f docker-compose.dev.yml run --rm worker pnpm test:media`. En CI, un job dedicado que usa la imagen del worker como contenedor del job — así el test verifica *la misma imagen* que irá al VPS, que es el punto.
- En una máquina sin las herramientas, la suite se salta con **skip explícito y ruidoso, nunca silencioso**. El porqué: un skip silencioso convierte "todo verde" en mentira; el agente que ve el output debe saber que la capa media NO se ha verificado y cómo ejecutarla.

```ts
// apps/worker/test/media/setup.ts — importado por cada suite media
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

async function available(bin: string, args = ['-version']) {
  try { await run(bin, args); return true; } catch { return false; }
}

export const mediaToolsAvailable =
  (await available('ffmpeg')) && (await available('ffprobe')) && (await available('c2patool'));

if (!mediaToolsAvailable) {
  // En CI el skip es un error: el job media DEBE tener las herramientas.
  if (process.env.CI || process.env.REQUIRE_MEDIA) {
    throw new Error('test:media requiere ffmpeg/ffprobe/c2patool — este job debe correr en la imagen del worker');
  }
  console.warn(
    '\n[test:media] SKIP — faltan ffmpeg/ffprobe/c2patool en esta máquina.\n' +
    'Ejecuta: docker compose -f docker-compose.dev.yml run --rm worker pnpm test:media\n',
  );
}
```

```ts
// patrón en cada suite: el skip queda visible en el reporter como "skipped", no desaparece
import { describe } from 'vitest';
import { mediaToolsAvailable } from '../setup';

describe.skipIf(!mediaToolsAvailable)('normalización canónica', () => { /* … */ });
```

Los ficheros generados van a un directorio temporal por suite (`fs.mkdtemp` sobre `os.tmpdir()`), limpiado en `afterAll`. Nunca escribas outputs de test dentro del repo ni en `/data/assets`.

## Principio rector: assets sintéticos generados en el propio test

**Prohibido comitear fixtures binarios de vídeo/audio.** Cada test genera sus inputs con las fuentes `lavfi` de FFmpeg (2–3 s bastan). El porqué: son deterministas (mismo comando → mismo contenido), se generan en <1 s, no pesan en git, y documentan en el propio test qué propiedades tiene el input (resolución, fps, duración, contenido). Un `.mp4` comiteado es opaco, engorda el repo para siempre y nadie sabe qué garantiza.

```ts
// packages/test-utils/src/media/synthetic.ts (exportado como @ugc/test-utils/media)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

/** Clip de vídeo sintético. `color` produce un frame sólido (útil para muestrear píxeles);
 *  sin `color` usa testsrc2 (color bars con movimiento, útil para ver cortes/glitches). */
export async function makeTestVideo(opts: {
  out: string; width?: number; height?: number; fps?: number; seconds?: number; color?: string;
}): Promise<string> {
  const { out, width = 1080, height = 1920, fps = 30, seconds = 2, color } = opts;
  const src = color
    ? `color=c=${color}:size=${width}x${height}:rate=${fps}`
    : `testsrc2=size=${width}x${height}:rate=${fps}`;
  await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', src, '-t', String(seconds),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', out]);
  return out;
}

/** Tono puro; `delaySeconds` antepone silencio — clave para tests de ducking y sincronía,
 *  porque el onset del audio queda en un instante EXACTO y conocido. */
export async function makeTestAudio(opts: {
  out: string; seconds?: number; freq?: number; delaySeconds?: number;
}): Promise<string> {
  const { out, seconds = 2, freq = 440, delaySeconds = 0 } = opts;
  const filters = delaySeconds > 0
    ? ['-af', `adelay=${Math.round(delaySeconds * 1000)}:all=1`] : [];
  await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}`,
    ...filters, '-c:a', 'aac', '-ar', '48000', out]);
  return out;
}
```

Con estos dos helpers se construye cualquier escenario de F5: un "clip de avatar" es un `makeTestVideo` + `makeTestAudio` muxeados; un "bed musical" es un tono largo a −20 dB; una "voz" es un tono con onsets conocidos.

## Asserts de perfil: `assertVideoProfile()` sobre ffprobe

Toda salida de vídeo se valida con `ffprobe -print_format json` — nunca "el fichero existe y pesa >0". El porqué: el contrato del master (Apéndice C del PRD) es exacto y TikTok/Meta rechazan desviaciones: 1080×1920, 30 fps, H.264, `yuv420p`, SAR 1:1, AAC 48 kHz.

```ts
// packages/test-utils/src/media/ffprobe.ts
export async function ffprobeJson(file: string) {
  const { stdout } = await run('ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]);
  return JSON.parse(stdout);
}

export async function assertVideoProfile(file: string, expected: {
  width?: number; height?: number; fps?: number; codec?: string; pixFmt?: string;
  sar?: string; durationS?: number; durationToleranceS?: number;
} = {}) {
  const { width = 1080, height = 1920, fps = 30, codec = 'h264', pixFmt = 'yuv420p',
    sar = '1:1', durationS, durationToleranceS = 0.2 } = expected;
  const probe = await ffprobeJson(file);
  const v = probe.streams.find((s: any) => s.codec_type === 'video');
  const fail = (msg: string) => { throw new Error(`assertVideoProfile(${file}): ${msg}`); };
  if (!v) fail('sin stream de vídeo');
  if (v.width !== width || v.height !== height) fail(`resolución ${v.width}x${v.height}, esperada ${width}x${height}`);
  if (v.r_frame_rate !== `${fps}/1`) fail(`fps ${v.r_frame_rate}, esperado ${fps}/1`);
  if (v.codec_name !== codec) fail(`códec ${v.codec_name}, esperado ${codec}`);
  if (v.pix_fmt !== pixFmt) fail(`pix_fmt ${v.pix_fmt}, esperado ${pixFmt}`);
  if (v.sample_aspect_ratio && v.sample_aspect_ratio !== sar) fail(`SAR ${v.sample_aspect_ratio}, esperado ${sar}`);
  if (durationS !== undefined) {
    const d = Number(probe.format.duration);
    if (Math.abs(d - durationS) > durationToleranceS) fail(`duración ${d}s, esperada ${durationS}±${durationToleranceS}s`);
  }
}
```

La duración lleva **tolerancia** (±0,2 s por defecto): el encode alinea a GOP y el AAC añade priming samples — exigir igualdad exacta produce flakes sin valor. Todo lo demás es exacto y sin tolerancia.

## Normalización canónica y caché (T5.2)

Dos propiedades separadas, dos tests separados:

**1. El perfil de salida es el canónico.** Genera inputs deliberadamente "malos" (720p, 25 fps, 16:9) y pasa cada salida por `assertVideoProfile()`. Incluye la pista de audio canónica (AAC 48 kHz estéreo) y la extracción de voz de clips con audio embebido (caso VEED).

**2. La caché funciona: segunda ejecución = 0 trabajos ffmpeg.** No lo verifiques "a ojo por logs": diseña el normalizador para recibir el runner de comandos por inyección y cuéntalo. El porqué: la caché de normalizados es la base económica de la regeneración parcial (CU4, T5.8) — si se rompe en silencio, cada re-render paga encodes completos y nadie lo nota hasta la factura de tiempo.

```ts
import { describe, expect, test } from 'vitest';
import { createNormalizer } from '../../src/composition/normalizer';

test('segunda pasada sobre los mismos assets no lanza ningún ffmpeg', async () => {
  let ffmpegCalls = 0;
  const countingRunner = async (args: string[]) => { ffmpegCalls++; return realFfmpegRunner(args); };
  const normalizer = createNormalizer({ runner: countingRunner, cacheDir });

  await normalizer.normalizeAll(assets);
  const firstPass = ffmpegCalls;
  expect(firstPass).toBeGreaterThan(0);

  await normalizer.normalizeAll(assets);       // mismos checksums, mismos params
  expect(ffmpegCalls).toBe(firstPass);          // 0 trabajos nuevos: 100 % cache hits
});
```

Añade un assert de que `normalized_cache_key` cambia si cambian los parámetros (otra resolución, otra versión de receta) — es lo que permitirá los presets por plataforma de T8.3 sin envenenar la caché.

**3. Crop-to-fill sin letterbox.** Un clip 16:9 debe salir 1080×1920 recortado, jamás con bandas. `ffprobe` no distingue letterbox (la resolución es correcta igualmente), así que se muestrean píxeles de un frame extraído. Truco: input de color sólido — si hay banda, los bordes son negros.

```ts
test('un clip 16:9 queda crop-to-fill, sin bandas', async () => {
  const src = await makeTestVideo({ out: p('wide.mp4'), width: 1920, height: 1080, color: 'red' });
  const out = await normalizer.normalize(src);
  await assertVideoProfile(out);

  const raw = p('frame.rgb');
  await run('ffmpeg', ['-y', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
  const buf = await readFile(raw);
  const px = (x: number, y: number) => buf.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3);
  for (const y of [4, 960, 1915]) {            // borde superior, centro, borde inferior
    const [r, g, b] = px(540, y);
    expect(r).toBeGreaterThan(180);             // rojo (con margen por yuv420p)
    expect(g).toBeLessThan(80); expect(b).toBeLessThan(80); // ni negro ni gris de banda
  }
});
```

## Loudness y ducking (T5.3)

**Loudness integrado −14 LUFS ±1.** Se mide con el propio FFmpeg: `-af ebur128` escribe el resumen a stderr. Parsear el último `I: … LUFS` (el bloque Summary).

```ts
export async function measureIntegratedLufs(file: string): Promise<number> {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', file, '-af', 'ebur128', '-f', 'null', '-']);
  const matches = [...stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/g)];
  if (matches.length === 0) throw new Error(`ebur128 sin summary para ${file}`);
  return Number(matches.at(-1)![1]);
}

test('el master mezcla a -14 LUFS', async () => {
  const master = await composeAudioMix(spec);   // módulo real bajo test
  expect(await measureIntegratedLufs(master)).toBeGreaterThanOrEqual(-15);
  expect(await measureIntegratedLufs(master)).toBeLessThanOrEqual(-13);
});
```

La tolerancia ±1 LU es deliberada: `loudnorm` en single-pass no clava el target con contenido corto; ±1 LU es inaudible y estable entre versiones de FFmpeg.

**Ducking audible = el RMS del bed cae durante la voz.** El problema: en el mix final la voz se suma al bed y el RMS total *sube* — no sirve medir el mix. La solución: testear el filtergraph de ducking **renderizando solo la rama del bed ducked** (la salida de `sidechaincompress` antes del `amix`), con una voz sintética cuyo onset controlas exactamente.

```ts
test('sidechaincompress hunde el bed cuando entra la voz', async () => {
  const bed = await makeTestAudio({ out: p('bed.m4a'), seconds: 4, freq: 220 });
  const voice = await makeTestAudio({ out: p('voice.m4a'), seconds: 2, freq: 880, delaySeconds: 2 });

  // buildDuckingGraph() es el MISMO builder que usa producción — es lo que se está testeando
  const graph = buildDuckingGraph();  // p. ej. '[0:a][1:a]sidechaincompress=…[ducked]'
  const ducked = p('ducked.m4a');
  await run('ffmpeg', ['-y', '-i', bed, '-i', voice,
    '-filter_complex', graph, '-map', '[ducked]', ducked]);

  const rmsBefore = await measureRmsDb(ducked, 0.5, 1.5);  // ventana sin voz
  const rmsDuring = await measureRmsDb(ducked, 2.5, 3.5);  // ventana con voz
  expect(rmsBefore - rmsDuring).toBeGreaterThanOrEqual(6); // el bed cae ≥6 dB
});
```

`measureRmsDb(file, from, to)` es otro helper de `@ugc/test-utils/media`: recorta con `-ss/-to`, pasa `-af astats -f null -` y parsea `RMS level dB` de la sección Overall del stderr. El umbral de 6 dB es el mínimo perceptible como ducking; el valor de producción será mayor.

Sobre el concat (T5.3): con inputs `testsrc2` de duraciones conocidas, assert de que la duración del concatenado = suma de segmentos (±tolerancia) y de que el perfil no cambió (el concat demuxer con `-c copy` no debe re-encodear — verifícalo comparando el `codec_time_base`/bitrate o, mejor, midiendo que el concat de 3 clips tarda milisegundos, no segundos).

## Subtítulos ASS (T5.4)

El `.ass` es **texto**: se testea parseándolo, no renderizándolo. El parser (`parseAssDialogues`) es **código de producción** en `apps/worker/src/captions/ass-parser.ts` (secciones `[V4+ Styles]` y `[Events]`, líneas `Dialogue:`, tags `\pos(x,y)`, `\an`, `\k`): el check captions-in-safe-zone del QA (N9) y el script de verificación de T8.3 lo reutilizan, y los tests — unit y media — lo importan de ahí. No existe ningún parser ASS en `@ugc/test-utils`. Los asserts:

1. **Formato de eventos**: cada `Dialogue` tiene start < end, estilo existente en `[V4+ Styles]`, y en preset karaoke 1–4 palabras por página.
2. **Karaoke `\k` coherente**: la suma de duraciones `\k` (centisegundos) de una página ≈ duración del evento; ninguna palabra sin tag.
3. **Safe zone**: ningún evento posiciona texto fuera del área útil universal — sobre 1080×1920: `x ∈ [65, 940]`, `y ∈ [270, 1248]` (~875×978; top 270 / bottom 672 / left 65 / right 140, Apéndice C del PRD). El check opera sobre la **posición declarada** (`\pos`/márgenes/`Alignment` + estimación del bounding box por tamaño de fuente y longitud del texto), no sobre píxeles rasterizados: es un test de la lógica de layout del generador. La confirmación visual (fuente real, contorno) la cubre la revisión humana de T5.4 y el gate CUA.
4. **Sincronía word-timestamps ↔ audio ±100 ms**: alimenta el generador con timestamps sintéticos de onsets exactos y assert de que el inicio karaoke de cada palabra cae a ≤100 ms del timestamp. 100 ms es el umbral del PRD (T4.5): por debajo, el highlight se percibe sincronizado.

```ts
// co-locado con el generador: apps/worker/src/captions/ass-generator.test.ts
import { makeWordTimestamps } from '@ugc/test-utils';
import { generateAss } from './ass-generator';
import { parseAssDialogues } from './ass-parser';

test('ningún evento sale de la safe zone universal', () => {
  const ass = generateAss(makeWordTimestamps({ words: 40 }), { preset: 'karaoke', platform: 'universal' });
  const events = parseAssDialogues(ass);
  expect(events.length).toBeGreaterThan(0);
  for (const ev of events) {
    expect(ev.anchor.x).toBeGreaterThanOrEqual(65);
    expect(ev.anchor.x).toBeLessThanOrEqual(940);
    expect(ev.anchor.y).toBeGreaterThanOrEqual(270);
    expect(ev.anchor.y).toBeLessThanOrEqual(1248);
  }
});
```

El generador de `.ass` es **lógica pura** (timestamps → texto): sus tests unitarios (agrupación en páginas, presets karaoke/subtitle, fallback de fuente por script) van co-locados en `src/**/*.test.ts` y corren en la suite normal sin FFmpeg. Solo el burn-in (libass dentro de ffmpeg) pertenece a `test/media/`.

## Pase final, QA y C2PA (T5.5)

Test de integración media que compone una variante completa con assets 100 % sintéticos (3 segmentos hook/body/cta + voz con onsets conocidos + bed) vía la `CompositionSpec` real, y verifica el output y el `qa_report`:

```ts
test('compose end-to-end produce master válido y qa_report todo en pass', async () => {
  const spec = makeCompositionSpec({ segments: syntheticSegments, music: syntheticBed });
  const { masterPath, qaReport } = await composeVariant(spec);

  await assertVideoProfile(masterPath, { durationS: spec.expectedDurationS });
  expect(qaReport.checks).toMatchObject({
    resolution: 'pass', fps: 'pass', codec: 'pass', duration: 'pass',
    loudness: 'pass', av_duration_diff: 'pass', captions_safe_zone: 'pass', filesize: 'pass',
  });

  // C2PA: el manifest existe y declara media generada por IA (EU AI Act / TikTok)
  const { stdout } = await run('c2patool', [masterPath, '--info']);
  expect(stdout).toContain('trainedAlgorithmicMedia');
});
```

Reglas de criterio:

- El QA validator se testea también **en negativo**: dale un master defectuoso a propósito (p. ej. 25 fps, o LUFS −20) y assert de que el check correspondiente sale `fail`. Un QA que nunca falla no verifica nada.
- `c2patool` va **pineado por versión en la imagen del worker** (T5.1); assert por substring del output (`trainedAlgorithmicMedia`), no por igualdad de JSON completo — el formato de salida del CLI puede variar entre versiones, el claim no. Si la firma requiere clave, el test usa una clave de test autofirmada horneada en la imagen o en fixtures de texto; nunca la clave de producción.
- El check de `-c:a copy` cuando el audio no cambió (regeneración parcial) se verifica igual que la caché: contando invocaciones/argumentos del runner inyectado — assert de que el comando del pase final contiene `-c:a copy`.

## Healthcheck de la imagen (T5.1)

Primera suite de `test/media/` y preflight de todas las demás: si la imagen no tiene las capacidades, mejor un fallo claro aquí que veinte fallos crípticos después.

```ts
describe.skipIf(!mediaToolsAvailable)('capacidades de la imagen del worker', () => {
  test('ffmpeg tiene sidechaincompress y libass', async () => {
    const { stdout } = await run('ffmpeg', ['-filters']);
    expect(stdout).toContain('sidechaincompress');
    const { stdout: version } = await run('ffmpeg', ['-version']);
    expect(version).toContain('--enable-libass');
  });
  test('las fuentes OFL están instaladas', async () => {
    const { stdout } = await run('fc-list', []);
    expect(stdout).toContain('TikTok Sans');
    expect(stdout).toContain('Noto');       // fallback para scripts no latinos
  });
  test('c2patool responde', async () => {
    await expect(run('c2patool', ['--version'])).resolves.toBeDefined();
  });
});
```

Estos mismos checks son el `HEALTHCHECK` del Dockerfile del worker: test e imagen comparten el contrato de capacidades.

## Golden files

Para outputs de texto deterministas (el `.ass` generado, el JSON de un `qa_report`, el filtergraph compilado): golden files en `test/golden/` junto a la suite, regenerados con `UPDATE_GOLDEN=1 pnpm test:media`. Normaliza antes de comparar (paths temporales, timestamps de generación) para que el diff solo muestre cambios reales. Nunca golden de binarios (mp4/png): para binarios, asserts de propiedades (ffprobe, píxeles muestreados) — un golden binario se invalida con cada versión de FFmpeg y no explica qué cambió.

## Qué NO cubre esta capa

- **Calidad subjetiva** (lipsync, estética, legibilidad real de captions): revisión humana de la tarea + gate CUA con evidencia en `docs/verifications/<TASK-ID>/`.
- **Assets reales de fal.ai**: los tests media usan sintéticos; el pipeline con media generada de verdad se verifica en las verificaciones de tarea de F5 (T5.2–T5.5 exigen "una variante real") y en el tier live — ver el reference de APIs de pago.
- **Orquestación del job de render** (pg-boss, transiciones de `step_run`): eso es integración con Postgres — ver db-integration.md.
