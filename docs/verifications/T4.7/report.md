# Verificación T4.7 — N7c: clip de avatar (tiers image+audio: Std/Premium)

- **Tarea**: T4.7 · N7c: clip de avatar (tiers image+audio: Std/Premium) (`planning.md`)
- **Fecha**: 2026-07-17
- **Ejecutor**: verifier (contexto fresco) · smoke stepless (`runGenerateAvatar` directo) + curl/psql/ffprobe · sesión `t4.7`
- **Sistema**: código de T4.7 sin commitear en el árbol sobre commit `4c96ec9` (T4.6) · docker compose dev (ugc-postgres-dev up) + `pnpm dev` (web en :3001 — :3000 lo ocupa otra app ajena; worker ready; migraciones aplicadas en boot) + seeds personas/gallery ya presentes

## Verificación esperada (literal de planning.md)
> **Verificación**: clip real de la Persona hablando el hook con lipsync aceptable a juicio humano (es y en) en Std y Premium; duración = audio ±0,3 s (medida con ffprobe verifier-side, darwin); `synthetic_product`/`avatar_clip` persistido. El ASR de timestamps del clip es de T4.7b (VEED), no de esta tarea.

## Veredicto

**PASS** — los 4 clips reales (Kling Std + OmniHuman Premium × es + en) se generaron end-to-end contra fal, `avatar_clip` persistido, duración = audio ±0,3s (medida correctamente ffprobe(clip) vs ffprobe(fichero de audio)), descargable por `GET /api/assets/[id]/download` con checksum íntegro. Coste real $1,52 (vs estimado $1,72).

**Juicio humano de lipsync (2026-07-17): OK del usuario** — el usuario revisó los 4 .mp4 y confirmó "me parece OK": la boca sincroniza con el audio y el idioma es el correcto por tier (es en los `-es`, en en los `-en`), en Std (Kling) y Premium (OmniHuman). La identidad de la cara NO se juzga (stand-in sintética de flux-2; identidad real = T4.12). Con este OK el veredicto objetivo+humano es **PASS completo** → T4.7 cerrable.

## Nota de método: la premisa "no hay cara producible" se PROBÓ, no se asumió

Primer intento con la `reference_image` sembrada de una Persona (Marcus/Lucía "(placeholder)") → **fal 422** *"No recognizable elements were found in the image"* (`blocked-assumption-fal-422-response.json`). Las imágenes de Persona sembradas son placeholders abstractos por diseño (`makeSyntheticReferenceImage`; el usuario sube caras reales por el CRUD /personas; face-gen IA es F4) — ver `01/02-*-PLACEHOLDER.png`. Esto NO bloquea T4.7: se generó una CARA SINTÉTICA como fixture con `fal-ai/flux-2` (text-to-image, el mecanismo de T4.12 usado UNA vez como fixture, 1¢) — retrato frontal fotorrealista (`03-portrait-fixture-flux2.png`, asset `01KXR8SQQ2MWKTMD4AYJ46YX8M`, 576×1024). AMBOS modelos de avatar la ACEPTARON. La identidad de la cara es de T4.12; aquí el juicio es solo el lipsync.

## Los 4 clips (crudo, de psql/ffprobe, no del código bajo prueba)

| clip | tier | idioma | generation | avatar_clip asset | dur_s (BD) | ffprobe clip | coste |
|---|---|---|---|---|---|---|---|
| clip-kling-es.mp4 | Kling Std | es | 01KXR8VP5X1FC4WPHCJNH7R60H completed | 01KXR93SCK6JH8TBY3MDYHWCTS | 3,466 | 3,467 | 19¢ |
| clip-kling-en.mp4 | Kling Std | en | 01KXR96GYKP83TFNVW520ZTCA0 completed | 01KXR9DTXAYWHD9139T0DBZX4S | 3,733 | 3,734 | 21¢ |
| clip-omnihuman-es.mp4 | OmniHuman Prem @720p | es | 01KXR9EFAT8KRGHRW500MEWMZK completed | 01KXR9J1QB1J7YCW0A6N0J1NN8 | 3,370 | 3,400 | 54¢ |
| clip-omnihuman-en.mp4 | OmniHuman Prem @720p | en | 01KXR9JCBCXW9YM4EBM659VMB2 completed | 01KXR9NQXP5S2M94MTNBMZX35V | 3,575 | 3,575 | 57¢ |

Todos: `kind='avatar_clip'`, `mime=video/mp4`, streams h264+aac reales, 720×1280 (9:16), `generation.status='completed'`, `cost_actual` = coste, **un `cost_entry` provider='fal' unit='seconds' por clip**. Frame extraído de cada uno (`clip-*-frame.png`): la cara sintética habla (boca abierta mid-speech).

## Cláusula 2 (±0,3s) — medida como pide la Verificación (ffprobe verifier-side)

**CLAVE**: se mide `ffprobe(clip)` vs `ffprobe(EL FICHERO de audio)`, NO vs `asset.durationS` (ese campo, escrito por T4.5, diverge ~0,3-0,5s del fichero real — deuda de T4.5). Audio-ficheros ffprobe: es=3,370s, en=3,575s.

| clip | ffprobe clip | ffprobe audio-file | Δ | ±0,3s |
|---|---|---|---|---|
| kling-es | 3,467 | 3,370 | 0,097 | OK ✓ |
| kling-en | 3,734 | 3,575 | 0,159 | OK ✓ |
| omnihuman-es | 3,400 | 3,370 | 0,030 | OK ✓ |
| omnihuman-en | 3,575 | 3,575 | 0,000 | OK ✓ |

⚠ El smoke imprime "FUERA DE TOLERANCIA" en los 4 porque compara contra el `durationS` de BD (stale, T4.5). Es un FALSO fail del mensaje del smoke, NO del clip: medido contra el fichero real de audio (como manda la Verificación) los 4 pasan. fal emite su propia `duration` en el output y la usa como longitud del clip (OmniHuman = duración exacta del fichero; Kling +0,1-0,16s por padding del modelo).

## Cláusula 3 — descargable por GET /api/assets/[id]/download (HTTP real)

- Sin auth → **401** (endpoint protegido). Con sesión (`POST /api/login` → cookie) → **200**, `content-type: video/mp4`, `size=1532805`, mp4 reproducible (ffprobe dur 3,467s).
- **Checksum de los bytes descargados = checksum del fichero en storage** (`b9792238…`) → descarga íntegra, no un stub. Verificado sobre `01KXR93SCK6JH8TBY3MDYHWCTS` (kling-es); los 4 assets comparten la misma ruta de servicio.

## Coste real
**$1,52** total T4.7 (avatar_clip 19+21+54+57 = **151¢** + fixture flux-2 **1¢**; el intento Kling con placeholder costó **$0**, fal rechaza en input antes de facturar). vs estimado **$1,72** (−12%, sin recalibración). Cap $6 no rozado. Total acumulado fal en BD: 160¢ (8¢ previos + 152¢ de T4.7). Sin `/spend` UI verificada (esta tarea es stepless/backend; el `cost_entry` es la fuente).

## Notas / Rarezas
- **`synthetic_product` en el avatar_clip**: `generation.synthetic_product='f'` en los 4 clips. Ese flag es de la GENERACIÓN de packshot IA (T4.4), no del avatar_clip; el texto de la Verificación lo cita con "/" pero el foco (confirmado por el brief) es `avatar_clip`, que sí se persiste correctamente. Sin hallazgo.
- **Deuda T4.5 (no de T4.7)**: `asset.durationS` del tts_audio diverge del ffprobe real del fichero (~0,3-0,5s). No afecta a T4.7 en la práctica porque fal emite su propia `duration` y el fallback a `durationS` no se ejercita en el happy path; pero SI algún día fal no emitiera `duration`, el coste/duración del avatar caería sobre un `durationS` sesgado. A vigilar.
- **Guard ≤maxDuration**: NO ejercido en vivo (todos los audios ~3,4-3,6s ≪ 30s). El del smoke es código del smoke; el de producción vive en el executor `makeN7cExecutor` (el servicio delega y no revalida) y está cubierto por integración con mocks.
- **Error path**: verificado de rebote — el intento con placeholder dejó la generación `failed`, `cost_actual` NULL, 0 cost_entry, 0 asset huérfano (el finalizer degrada bien).
- **Fixture script**: `gen-portrait-fixture.ts` (verifier-side) queda como evidencia del mecanismo; se ejecutó desde una copia temporal en `apps/web/scripts/` (para resolver los workspace deps @ugc/*) que se borró tras correr. No se modificó código de producto.
