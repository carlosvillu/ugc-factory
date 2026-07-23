// EXPORT DUAL con/sin bed (T5.7, §14). Cuando un lote declara destino «ambos» (orgánico + paid), el
// export necesita DOS versiones de audio del MISMO máster:
//   · CON bed  = el máster FINAL persistido tal cual (`ad_variant.master_asset_id` → el H.264 export +
//                burn-in + C2PA que CP4 aprobó). NO se toca: ya es la versión con bed que produjo T5.5.
//   · SIN bed  = la MISMA imagen de vídeo, pero con la voz SOLA (sin música). Es lo que exige un Spark Ad /
//                ad pagado (§14: «solo Commercial Music Library o licencia propia» → sin el bed IA).
//
// LA TRAMPA CENTRAL (y la razón de ser de esta tarea): la versión sin bed se produce por RE-MUX DE AUDIO,
// NO re-renderizando el vídeo. §14: «sin re-render del vídeo (solo re-mux de audio: segundos de CPU)». El
// stream de VÍDEO de la versión sin bed es BYTE-IDÉNTICO al del máster (mismo `-c:v copy`); solo cambia la
// pista de audio (voz sola, sin el bed). La Verificación lo confirma con timestamps/hash del stream de vídeo.
//
// CÓMO SE RECONSTRUYE LA VOZ SIN BED (sin re-materializar el máster desde cero): el máster persistido YA es
// el vídeo final. Se le COPIA el vídeo (`-c:v copy`) y se le sustituye el audio por la VOZ concatenada de los
// segmentos (`composition_spec.segments[].voAudio`) normalizada a −14 LUFS SIN bed — que es EXACTAMENTE la
// rama `hasBed:false` de `buildAudioMixGraph` (voz sola → `loudnorm I=-14`), la misma que T5.3 ya usa y prueba.
//
// REUSO OBLIGADO DE LOS BUILDERS DE T5.3 (restricción dura de T5.7): la voz se concatena con
// `buildAudioConcatArgs`, el filtergraph sale de `buildAudioMixGraph({hasBed:false})`, y el mux del vídeo
// copiado + voz sale de `buildMuxArgs({bedPath:null})`. NO se escribe una invocación fresca de ffmpeg. El
// concat de VÍDEO (`buildConcatArgs`) NO se usa: el vídeo YA está compuesto en el máster (no se re-concatena).
//
// C2PA EN LA VERSIÓN SIN BED (decisión T5.7, surfaced): el re-mux reescribe el contenedor MP4 → invalida la
// firma C2PA del máster. §15.3 exige C2PA en TODO export (y la versión sin bed es justo el camino paid). Por
// eso la versión sin bed se RE-FIRMA con el `c2paSigner` inyectado (reescritura de contenedor, NO re-encode
// de vídeo → sigue siendo «segundos de CPU»). El manifest es el mismo `trainedAlgorithmicMedia`.
//
// CLASE DE ERROR PROPIA (`ExportRemuxError`, anti-T1.8): «el re-mux de audio falló» es una capa DISTINTA de
// ComposeError (el intermedio) / ComposeVariantError (el pase final) / storage / caption inválido. Lleva la
// fase (`voice`/`mux`/`sign`) y el stderr.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CompositionSpec } from '@ugc/core/contracts';
import type { Logger, StorageAdapter } from '@ugc/core';

import {
  buildAudioConcatArgs,
  buildAudioMixGraph,
  buildConcatListFile,
  buildMuxArgs,
  type ResolveAssetKey,
} from './compose-master';
import type { C2paSigner } from './compose-variant';
import { buildC2paManifest } from './compose-variant';
import {
  defaultFfmpegRunner,
  defaultFfprobeRunner,
  materializeToBytes,
  tailStderr,
  type FfmpegRunner,
  type FfprobeRunner,
} from './extract-audio-track';
import { NOOP_LOGGER } from './noop-logger';

/**
 * El re-mux de audio del export sin bed falló. Clase PROPIA (anti-T1.8): distinta de `ComposeError`,
 * `ComposeVariantError` y los errores de storage. `phase` nombra el paso (`voice`/`mux`/`sign`) para el
 * diagnóstico; lleva `exitCode`+`stderr` del proceso que falló.
 */
export class ExportRemuxError extends Error {
  readonly phase: 'voice' | 'mux' | 'sign';
  readonly exitCode: number | null;
  readonly stderr: string;
  constructor(
    message: string,
    opts: { phase: ExportRemuxError['phase']; exitCode: number | null; stderr: string },
  ) {
    super(message);
    this.name = 'ExportRemuxError';
    this.phase = opts.phase;
    this.exitCode = opts.exitCode;
    this.stderr = opts.stderr;
  }
}

/**
 * La KEY de storage donde vive (o vivirá) la versión SIN BED de una variante — el CONTRATO de ubicación
 * entre el PRODUCTOR (`exportNoBedVersion`, cuando F6 cablee el executor N10) y el CONSUMIDOR (la ruta del
 * bundle que la sirve). Vive aquí, junto al productor, para que web y el executor no tengan copias del
 * literal que puedan divergir. `masters/<variantId>/master-no-bed.mp4`.
 */
export function noBedStorageKey(variantId: string): string {
  return `masters/${variantId}/master-no-bed.mp4`;
}

export interface ExportNoBedDeps {
  storage: StorageAdapter;
  /** `assetId → storageKey` (los `voAudio` de los segmentos + el máster). Inyectable (el test usa un Map). */
  resolveAssetKey: ResolveAssetKey;
  /** Firma C2PA (c2patool real, inyectado). Re-firma la versión sin bed (§15.3). */
  c2paSigner: C2paSigner;
  /** Paths de la clave + cert de firma C2PA (fixtures de TEST autofirmadas; JAMÁS la de producción). */
  c2pa: { privateKeyPath: string; signCertPath: string; claimGenerator?: string };
  /** Runner de ffmpeg INYECTABLE (default: subproceso real). */
  runner?: FfmpegRunner;
  /** Runner de ffprobe INYECTABLE (default: subproceso real). Mide la duración del máster para el mux. */
  ffprobe?: FfprobeRunner;
  logger?: Logger;
}

export interface ExportNoBedInput {
  /** El `storageKey` del máster FINAL persistido (`ad_variant.master_asset_id` → asset final_video). Su
   *  vídeo se COPIA (`-c:v copy`) — es el mismo vídeo aprobado en CP4. */
  masterStorageKey: string;
  /** El `composition_spec` de la variante (voz por segmento para reconstruir la pista sin bed). */
  spec: CompositionSpec;
}

export interface ExportNoBedResult {
  /** Los bytes de la versión SIN bed (vídeo del máster copiado + voz sola −14 LUFS, re-firmada C2PA). */
  bytes: Uint8Array;
  mime: string;
}

/**
 * Produce la versión SIN BED del export de una variante por RE-MUX DE AUDIO (§14): copia el stream de vídeo
 * del máster persistido (`-c:v copy` — byte-idéntico, sin re-encode) y le sustituye el audio por la VOZ SOLA
 * concatenada de los segmentos, normalizada a −14 LUFS (`buildAudioMixGraph({hasBed:false})`). Re-firma C2PA.
 * bytes-in/bytes-out: NO escribe en la BD. LANZA `ExportRemuxError` si ffmpeg/c2patool falla. Limpia temps
 * SIEMPRE en `finally`.
 *
 * La versión CON bed NO pasa por aquí: es el máster persistido tal cual (el caller lo sirve directo).
 */
export async function exportNoBedVersion(
  deps: ExportNoBedDeps,
  input: ExportNoBedInput,
): Promise<ExportNoBedResult> {
  const log = deps.logger ?? NOOP_LOGGER;
  const runner = deps.runner ?? defaultFfmpegRunner;
  const ffprobe = deps.ffprobe ?? defaultFfprobeRunner;

  const dir = await mkdtemp(join(tmpdir(), 'ugc-export-nobed-'));
  try {
    // 1+2) Materializar EN PARALELO el máster final y la voz de CADA segmento: son descargas INDEPENDIENTES
    //   (el máster se copiará sin re-encode; cada voz se concatenará después). El `.map` con índice preserva
    //   el ORDEN de los segmentos en la pista concatenada — NO se depende del orden en que resuelvan las
    //   promesas. Los pasos ffmpeg posteriores (concat → probe → mux → sign) SÍ son secuencialmente
    //   dependientes y quedan en serie.
    const masterPath = join(dir, 'master.mp4');
    const [, voicePaths] = await Promise.all([
      materializeToBytes(deps.storage, input.masterStorageKey).then((b) =>
        writeFile(masterPath, b),
      ),
      Promise.all(
        input.spec.segments.map(async (segment, i) => {
          const voiceKey = await deps.resolveAssetKey(segment.voAudio);
          const voicePath = join(dir, `seg-${String(i)}.m4a`);
          await writeFile(voicePath, await materializeToBytes(deps.storage, voiceKey));
          return voicePath;
        }),
      ),
    ]);

    // CONCATENAR la voz de los segmentos (misma pieza que T5.3: `buildAudioConcatArgs`), en orden de array.
    const voiceListPath = join(dir, 'voice-list.txt');
    await writeFile(voiceListPath, buildConcatListFile(voicePaths));
    const concatVoicePath = join(dir, 'concat-voice.m4a');
    await runFfmpeg(runner, 'voice', buildAudioConcatArgs(voiceListPath, concatVoicePath));

    // 3) La duración del máster fija el `-t` del mux (mismo criterio que T5.3: el vídeo es autoritativo).
    const masterDurationS = await probeDurationSeconds(ffprobe, masterPath);

    // 4) MUX: vídeo del máster COPIADO (`-c:v copy`, byte-idéntico) + voz sola −14 LUFS (rama sin bed del
    //    filtergraph de T5.3). `bedPath:null` → `buildMuxArgs` no añade el 3.er input y `buildAudioMixGraph`
    //    toma la rama `hasBed:false` (`[1:a]loudnorm=I=-14[mix]`). En el mux el vídeo es input 0, la voz input 1.
    const filterComplex = buildAudioMixGraph({
      hasBed: false,
      voiceInput: '1:a',
      bedInput: '2:a', // ignorado sin bed (la rama hasBed:false no lo referencia).
      volume: 0,
      ducking: false,
      fadeOutS: 0,
      fadeStartS: 0,
    });
    const remuxedPath = join(dir, 'nobed-unsigned.mp4');
    await runFfmpeg(
      runner,
      'mux',
      buildMuxArgs({
        videoPath: masterPath,
        voicePath: concatVoicePath,
        bedPath: null,
        filterComplex,
        durationS: masterDurationS,
        outPath: remuxedPath,
      }),
    );

    // 5) RE-FIRMA C2PA: el re-mux reescribió el contenedor → la firma del máster se invalidó. §15.3 exige
    //    C2PA en todo export (y sin bed es el camino paid). Reescritura de contenedor, NO re-encode de vídeo.
    const manifestPath = join(dir, 'manifest.json');
    await writeFile(
      manifestPath,
      buildC2paManifest({
        privateKeyPath: deps.c2pa.privateKeyPath,
        signCertPath: deps.c2pa.signCertPath,
        ...(deps.c2pa.claimGenerator !== undefined
          ? { claimGenerator: deps.c2pa.claimGenerator }
          : {}),
      }),
    );
    const signedPath = join(dir, 'nobed-signed.mp4');
    const signResult = await deps.c2paSigner([
      remuxedPath,
      '-m',
      manifestPath,
      '-o',
      signedPath,
      '-f',
    ]);
    if (signResult.code !== 0) {
      throw new ExportRemuxError(
        `exportNoBedVersion: c2patool falló firmando la versión sin bed (código ${String(signResult.code)})`,
        { phase: 'sign', exitCode: signResult.code, stderr: tailStderr(signResult.stderr) },
      );
    }

    const bytes = new Uint8Array(await readFile(signedPath));
    if (bytes.byteLength === 0) {
      throw new ExportRemuxError('exportNoBedVersion: el re-mux produjo un fichero de 0 bytes', {
        phase: 'mux',
        exitCode: 0,
        stderr: '',
      });
    }

    log.info(
      {
        event: 'export_nobed_remuxed',
        segments: input.spec.segments.length,
        bytes: bytes.byteLength,
      },
      'export sin bed: vídeo copiado + voz sola −14 LUFS + re-firma C2PA (§14, re-mux de audio)',
    );
    return { bytes, mime: 'video/mp4' };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // best-effort: un fallo de limpieza no debe enmascarar el error real del re-mux.
    });
  }
}

/** Corre el runner de ffmpeg y LANZA `ExportRemuxError` si el exit ≠ 0. `phase` nombra el paso. */
async function runFfmpeg(
  runner: FfmpegRunner,
  phase: ExportRemuxError['phase'],
  args: string[],
): Promise<void> {
  const result = await runner(args);
  if (result.code !== 0) {
    throw new ExportRemuxError(
      `exportNoBedVersion: ffmpeg falló en «${phase}» (código ${String(result.code)})`,
      { phase, exitCode: result.code, stderr: tailStderr(result.stderr) },
    );
  }
}

/** Mide la duración (s) de un fichero LOCAL con ffprobe. LANZA `ExportRemuxError` si falla o no es finita. */
async function probeDurationSeconds(ffprobe: FfprobeRunner, path: string): Promise<number> {
  const result = await ffprobe([
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    path,
  ]);
  if (result.code !== 0) {
    throw new ExportRemuxError(
      `exportNoBedVersion: ffprobe falló midiendo la duración de ${path} (código ${String(result.code)})`,
      { phase: 'mux', exitCode: result.code, stderr: tailStderr(result.stderr) },
    );
  }
  const seconds = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new ExportRemuxError(
      `exportNoBedVersion: duración inválida para ${path} (${JSON.stringify(result.stdout.trim())})`,
      { phase: 'mux', exitCode: 0, stderr: '' },
    );
  }
  return seconds;
}
