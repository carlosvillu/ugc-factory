// Executor del nodo N8 · COMPOSICIÓN (T5.5d, §9.7 N8). La mitad de CABLEADO del render: por variante,
//   1. ENSAMBLA el `CompositionSpec` desde los outputs de sus deps N7 (`assembleCompositionSpec`, servicio
//      — el gemelo INVERSO de `buildVariantGenerationPlan`). El spec apunta a los clips CRUDOS de N7.
//   2. Encadena la cadena de render (§9.7 l.288), en este orden EXACTO:
//        concat INTRA-ESCENA (T5.8c: si §7.5 troceó la escena, sus clips se unen ANTES del fitter para que
//          Σ(clips) ≥ narración — sin esto un único clip topado a `maxDuration` disparaba `FitError`)
//        → fitter (T5.5b, por-clip: cuadra cada clip a la duración MEDIDA de SU voz — `N7bClipRef.durationSeconds`)
//        → normalize-once (T5.2, perfil canónico + caché)
//        → concat+mix + pase final + C2PA + QA (T5.5 `composeVariant`, que internamente hace `composeMaster`)
//        → persistencia (`finalizeVariantMaster` @ugc/db: filas final_video + thumbnail + update de ad_variant).
//   3. Emite el `N8Output` (ref al máster + qa_report).
//
// $0 RUNTIME (sin fal): N8 NO paga generación — solo compone lo que N7 ya generó. Su coste es CPU de ffmpeg
// local (no un `cost_entry`). Por eso NO reusa `GenerationExecutorDeps` (que trae la fal-key): estrena su
// propio grupo `ComposeVariantExecutorDeps`.
//
// PORTS DE CAPTIONS (frontera de paquete): `@ugc/services` NO puede importar de `apps/worker` (composition
// roots hermanos), así que el generador ASS de la variante + el check de safe zone viven en el worker
// (`src/captions`) y se INYECTAN a `composeVariant` como ports (patrón firme de T5.5). Aquí el executor los
// IMPORTA directo (son funciones PURAS de string, sin subproceso ni red) — no hace falta pasarlos por el
// factory: el registro de N8 se queda en `{db,storage}` (literal de la tarea), sin acoplar boss.ts a captions.
//
// C2PA/LOUDNESS: subprocesos reales (c2patool / ffmpeg-ebur128), OPCIONALES en las deps (default: los
// wrappers de subproceso de abajo). El test de integración los stubea → corre $0 sin binarios. Los runners
// de ffmpeg/ffprobe también son opcionales (default: subproceso real de composeVariant/fitter/normalizer).
//
// FRONTERA N7→N8: N8 lee los refs de asset de sus deps N7 (por SCHEMA, no por node_key — el ensamblador usa
// `findDepBySchema`, que lanza si 2+ deps validan el mismo schema). El aislamiento por variante lo garantiza
// el grafo (`dependsOn` cablea N8 a los N7 de SU variante).
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { PermanentStepError } from '@ugc/core/orchestrator';
import type { StepExecutor } from '@ugc/core/orchestrator';
import type { Logger, StorageAdapter } from '@ugc/core';
import {
  N7bOutputSchema,
  type CompositionSpec,
  type N7bOutput,
  type N8Output,
} from '@ugc/core/contracts';
import { findDepBySchema } from '@ugc/core/generation';
import {
  createAsset,
  getAsset,
  getAssetByNormalizedCacheKey,
  getVariant,
  finalizeVariantMaster,
  type DbClient,
} from '@ugc/db';
import {
  assembleCompositionSpec,
  composeVariant,
  concatSceneClipsFile,
  createNormalizer,
  fitSegmentFile,
  materializeToBytes,
  type C2paSigner,
  type FfmpegRunner,
  type FfprobeRunner,
  type LoudnessMeter,
  type NormalizedAsset,
  type NormalizeSourceAsset,
} from '@ugc/services';

import { checkAssSafeZone } from '../captions/safe-zone';
import { generateVariantAss } from '../captions/variant-ass';
import { requireOutputContext } from './_shared';

const run = promisify(execFile);

/** Deps del executor N8 · COMPOSICIÓN. N8 NO paga fal ($0 runtime): solo BD + storage. Los runners de
 *  ffmpeg/ffprobe/c2patool/loudness son OPCIONALES (default: subproceso real); el test de integración los
 *  inyecta como fakes para correr $0 sin binarios. Los certs C2PA salen de env con fallback a las fixtures
 *  de test autofirmadas (deuda: provisión de certs C2PA de PRODUCCIÓN — hoy self-signed de test). */
export interface ComposeVariantExecutorDeps {
  db: DbClient;
  storage: StorageAdapter;
  /** Runner de ffmpeg (default: subproceso real de composeVariant/fitter/normalizer). */
  runner?: FfmpegRunner;
  /** Runner de ffprobe (default: subproceso real). */
  ffprobe?: FfprobeRunner;
  /** Firma C2PA (default: c2patool de subproceso). */
  c2paSigner?: C2paSigner;
  /** Medidor de loudness (default: ffmpeg ebur128 de subproceso). */
  loudnessMeter?: LoudnessMeter;
  /** Paths de la clave + cert de firma C2PA (default: las fixtures de test autofirmadas del repo). */
  c2pa?: { privateKeyPath: string; signCertPath: string; claimGenerator?: string };
  logger?: Logger;
}

/** Path a las fixtures C2PA de TEST autofirmadas (NO secretos de producción — deuda: certs C2PA reales). */
const C2PA_FIXTURES_DIR = join(
  new URL('.', import.meta.url).pathname,
  '../../../../packages/services/test/fixtures/c2pa',
);
const DEFAULT_C2PA = {
  privateKeyPath: process.env.C2PA_PRIVATE_KEY_PATH ?? join(C2PA_FIXTURES_DIR, 'es256_private.key'),
  signCertPath: process.env.C2PA_SIGN_CERT_PATH ?? join(C2PA_FIXTURES_DIR, 'es256_certs.pem'),
  claimGenerator: 'UGC Factory',
};

/** c2patool de subproceso (default de `c2paSigner`): firma el MP4 con el manifest C2PA. */
const defaultC2paSigner: C2paSigner = async (args) => {
  try {
    const { stderr } = await run('c2patool', args, { maxBuffer: 1024 * 1024 * 64 });
    return { code: 0, stderr };
  } catch (err) {
    const e = err as { code?: number; stderr?: string; message?: string };
    return { code: e.code ?? 1, stderr: e.stderr ?? e.message ?? '' };
  }
};

/** ffmpeg ebur128 de subproceso (default de `loudnessMeter`): mide el loudness integrado (LUFS) del máster. */
const defaultLoudnessMeter: LoudnessMeter = async (file) => {
  const { stderr } = await run(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'],
    { maxBuffer: 1024 * 1024 * 64 },
  ).catch((err: unknown) => ({ stderr: (err as { stderr?: string }).stderr ?? '' }));
  // ebur128 escribe su resumen a stderr; el `I:` del bloque `Integrated loudness` es el LUFS integrado.
  const matches = [...stderr.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
  const last = matches.at(-1);
  if (last === undefined) throw new Error(`N8: ebur128 no reportó loudness integrado para ${file}`);
  return Number.parseFloat(last[1] ?? 'NaN');
};

/**
 * N8 · COMPOSICIÓN (T5.5d, §9.7). Ensambla el spec, fittea+normaliza cada clip a la duración de su voz,
 * compone el máster (concat+mix+pase final+C2PA+QA) y lo persiste. $0 runtime (sin fal).
 */
export function makeN8Executor(deps: ComposeVariantExecutorDeps): StepExecutor {
  return async (ctx) => {
    const { collectOutput } = requireOutputContext(ctx, 'N8');
    const log = deps.logger;

    const variantId = ctx.variantId;
    if (variantId == null || variantId === '') {
      throw new PermanentStepError(
        'N8: el ExecutorContext no trae variantId — la composición es POR VARIANTE (bug de cableado)',
      );
    }

    const variant = await getVariant(deps.db, variantId);
    if (variant === undefined) {
      throw new PermanentStepError(`N8: la variante ${variantId} no existe`);
    }

    const resolvedDeps = ctx.deps ?? [];

    // 1. ENSAMBLAR el spec desde los outputs de las deps N7 (por schema). El spec apunta a los clips CRUDOS.
    //    El bed PROPIO (T6.2b, `own_license`) se lee de la fila `ad_variant` (verdad ACTUAL, no de un snapshot
    //    del plan que se quedaría rancio si el bed se ató/cambió tras crear el run) — misma vía que
    //    `variantMaxDurationS`. Presente ⇒ sustituye al bed IA de N7e en `music.asset`; ausente ⇒ null (N7e).
    const rawSpec = await assembleCompositionSpec(
      { db: deps.db },
      {
        variantId,
        deps: resolvedDeps,
        variantMaxDurationS: variant.durationTarget,
        ownMusicBedAssetId: variant.ownMusicBedAssetId,
      },
    );

    // La dep N7b (voiceover) trae la duración MEDIDA de cada voz (`N7bClipRef.durationSeconds`), que es la
    // `narrationDurationS` autoritativa que el fitter consume por-clip (constraint 3). Se localiza por
    // `sceneIndex` — pero el spec ya no lleva el `sceneIndex`; se resuelve por el `voAudio` (assetId de la
    // voz) que SÍ está en el spec, mapeándolo al clip N7b de ese assetId.
    const n7b = findDepBySchema<N7bOutput>(resolvedDeps, N7bOutputSchema, 'N7b (voiceover)');
    if (n7b === undefined) {
      throw new PermanentStepError(
        `N8: la variante ${variantId} no tiene dep N7b — sin voces no hay narración`,
      );
    }
    const narrationByVoAsset = new Map<string, number>(
      n7b.clips.map((c) => [c.assetId, c.durationSeconds]),
    );

    const runner = deps.runner;
    const ffprobe = deps.ffprobe;

    // Normalizador con la caché de la BD cableada (T5.2). `findByCacheKey`/`createNormalizedAsset` van a la
    // BD; en el test se inyectan runners stub, así que la caché opera sobre filas reales sin ffmpeg real.
    const normalizer = createNormalizer({
      storage: deps.storage,
      findByCacheKey: (key) => getAssetByNormalizedCacheKey(deps.db, key),
      createNormalizedAsset: (v) => createAsset(deps.db, v),
      ...(runner !== undefined ? { runner } : {}),
      ...(log !== undefined ? { logger: log } : {}),
    });

    // 2. Por SEGMENTO: fittear el clip crudo a la duración de su voz → subir el fitteado como asset →
    //    normalizar (vídeo) + normalizar la voz (audio). Un temp dir por variante, limpiado en `finally`.
    const dir = await mkdtemp(join(tmpdir(), 'ugc-n8-'));
    // Se acumulan `CompositionSegment` DIRECTOS (apuntando ya a los assets NORMALIZADOS): el spec final es
    // `{ segments: rendered, ... }` sin re-mapear. El spread condicional de `voWords` respeta
    // exactOptionalPropertyTypes (una variante sin captions no lleva la clave).
    const rendered: CompositionSpec['segments'][number][] = [];
    try {
      for (const [i, segment] of rawSpec.segments.entries()) {
        const narrationDurationS = narrationByVoAsset.get(segment.voAudio);
        if (narrationDurationS === undefined) {
          throw new PermanentStepError(
            `N8: el segmento ${String(i)} (${segment.type}) referencia la voz ${segment.voAudio} que no está en la dep N7b`,
          );
        }

        // El PRIMER clip de la escena se desestructura ANTES de tocar storage: es el que define el `kind`
        // del asset fitteado (todos los clips de una escena salen del mismo endpoint) y, si la escena no se
        // troceó, es el único. Falla RÁPIDO (antes de materializar nada) si el contrato `.min(1)` se
        // violara. Leer un array de N y quedarse con `[0]` es justo la forma que `requireSingleVideoAsset`
        // proscribe aguas abajo — aquí el `[0]` es LEGÍTIMO porque solo se usa para el `kind`, no para
        // elegir qué clip se compone (se componen TODOS, ver el `Promise.all` de abajo).
        const [firstVideoAssetId] = segment.videoAssets;
        if (firstVideoAssetId === undefined) {
          // Imposible por contrato (`videoAssets` es `.min(1)`), pero el tipo no lo sabe.
          throw new PermanentStepError(
            `N8: el segmento ${String(i)} (${segment.type}) no tiene ningún clip de vídeo`,
          );
        }
        const firstAsset = await getAsset(deps.db, firstVideoAssetId);
        if (firstAsset === undefined) {
          throw new PermanentStepError(
            `N8: el clip de vídeo ${firstVideoAssetId} (clip 0) del segmento ${String(i)} no existe`,
          );
        }
        const firstKind: NormalizeSourceAsset['normalizedKind'] = firstAsset.kind;

        // Materializar los clips CRUDOS de N7 de ESTA escena a temp. Casi siempre uno; si §7.5 troceó la
        // escena (narración > maxDuration del modelo) son VARIOS, ya ordenados por `clipIndex` por el
        // ensamblador. Se materializan TODOS (ninguno pagado queda sin usar — T5.8c cierra esa fuga). El
        // I/O (BD + storage) va en PARALELO —son descargas independientes, mismo criterio que el
        // `Promise.all` de normalize+voz de abajo—; las ETAPAS DE FFMPEG siguen siendo secuenciales (cada
        // una consume el output de la anterior).
        const materialize = async (
          videoAssetId: string,
          c: number,
          known?: Awaited<ReturnType<typeof getAsset>>,
        ): Promise<string> => {
          const rawVideoAsset = known ?? (await getAsset(deps.db, videoAssetId));
          if (rawVideoAsset === undefined) {
            throw new PermanentStepError(
              `N8: el clip de vídeo ${videoAssetId} (clip ${String(c)}) del segmento ${String(i)} no existe`,
            );
          }
          const rawPath = join(dir, `raw-${String(i)}-${String(c)}.mp4`);
          await writeFile(
            rawPath,
            await materializeToBytes(deps.storage, rawVideoAsset.storageKey),
          );
          return rawPath;
        };
        const [firstRawPath, ...restRawPaths] = await Promise.all([
          materialize(firstVideoAssetId, 0, firstAsset),
          ...segment.videoAssets.slice(1).map((id, k) => materialize(id, k + 1)),
        ]);
        const rawPaths = [firstRawPath, ...restRawPaths];

        // CONCAT INTRA-ESCENA (T5.8c) ANTES del fitter: si la escena se troceó, sus clips se unen en UN
        // vídeo de escena para que Σ(clips) ≥ narración y el fitter RECORTE (rama `trim`) en vez de lanzar
        // `FitError`. Un segmento de UN solo clip NO pasa por el concat: su camino queda byte-idéntico al
        // anterior a T5.8c (importa para el clip de avatar de N7c, que lleva la voz EMBEBIDA).
        let fitInputPath = firstRawPath;
        if (rawPaths.length > 1) {
          const concatPath = join(dir, `scene-${String(i)}.mp4`);
          await concatSceneClipsFile(
            {
              ...(runner !== undefined ? { runner } : {}),
              ...(log !== undefined ? { logger: log } : {}),
            },
            { inPaths: rawPaths, outPath: concatPath },
          );
          fitInputPath = concatPath;
        }

        // FITTEAR a la duración de su voz (T5.5b). El umbral de 0,5 s NO se relaja: si Σ(clips) sigue sin
        // cubrir la narración, `FitError` sigue mordiendo (anti-T1.8).
        const fittedPath = join(dir, `fitted-${String(i)}.mp4`);
        await fitSegmentFile(
          {
            ...(runner !== undefined ? { runner } : {}),
            ...(ffprobe !== undefined ? { ffprobe } : {}),
            ...(log !== undefined ? { logger: log } : {}),
          },
          { inPath: fitInputPath, outPath: fittedPath, narrationDurationS },
        );

        // Subir el clip fitteado como asset (para que el normalizador lo lea de storage por su checksum).
        const fittedBytes = new Uint8Array(await readFile(fittedPath));
        const fittedKey = `fitted/${variantId}/${String(i)}.mp4`;
        const fittedPut = await deps.storage.put(fittedKey, fittedBytes, { mime: 'video/mp4' });
        const fittedAsset = await createAsset(deps.db, {
          kind: firstKind,
          storageKey: fittedKey,
          mime: 'video/mp4',
          bytes: fittedPut.bytes,
          checksum: fittedPut.checksum,
          // LINAJE §12 (y la PRUEBA de que la fuga está cerrada, T5.8c): el fitteado deriva de TODOS los
          // clips de la escena, no solo del `clipIndex 0`. Ningún clip pagado queda fuera del linaje.
          parentAssetIds: [...segment.videoAssets],
        });

        // NORMALIZE-ONCE (T5.2): vídeo → perfil canónico; voz → audio canónico. Independientes.
        const [normVideo, normVoice] = await Promise.all([
          normalizer.normalize(
            sourceOf(fittedAsset.id, fittedKey, fittedPut.checksum, firstKind, 'video'),
          ),
          normalizeVoice(normalizer, deps.db, segment.voAudio),
        ]);

        // El spec FINAL tiene SIEMPRE exactamente UN vídeo por segmento: el multi-clip vive solo en el spec
        // CRUDO; aquí ya está concatenado+fitteado+normalizado en un único asset (invariante que los
        // consumidores del spec final aseveran, ver `compose-master`/`measureSegmentVideoDurations`).
        rendered.push({
          type: segment.type,
          videoAssets: [normVideo.id],
          voAudio: normVoice.id,
          ...(segment.voWords !== undefined ? { voWords: segment.voWords } : {}),
        });
      }

      // 3. Construir el spec FINAL (los segmentos YA apuntan a los assets NORMALIZADOS) + captions si hay voWords.
      const hasCaptions = rendered.some((r) => r.voWords !== undefined);
      const finalSpec: CompositionSpec = {
        segments: rendered,
        music: rawSpec.music,
        output: rawSpec.output,
        ...(hasCaptions
          ? {
              captions: {
                style: 'karaoke' as const,
                maxWordsPerPage: 3,
                platform: 'universal' as const,
                position: 'safe_zone' as const,
              },
            }
          : {}),
      };

      // 4. PASE FINAL: concat+mix (composeMaster interno) + burn-in + C2PA + QA. Bytes-in/bytes-out.
      const result = await composeVariant(
        {
          storage: deps.storage,
          resolveAssetKey: async (id) => {
            const a = await getAsset(deps.db, id);
            if (a === undefined)
              throw new PermanentStepError(`N8: asset ${id} del spec no existe al componer`);
            return a.storageKey;
          },
          ...(runner !== undefined ? { runner } : {}),
          ...(ffprobe !== undefined ? { ffprobe } : {}),
          // Ports de captions: funciones PURAS de string importadas del worker (frontera de paquete).
          captionGenerator: generateVariantAss,
          safeZoneChecker: (ass) => checkAssSafeZone(ass).length,
          // C2PA/loudness: subproceso real por default; el test los inyecta como fakes ($0).
          c2paSigner: deps.c2paSigner ?? defaultC2paSigner,
          loudnessMeter: deps.loudnessMeter ?? defaultLoudnessMeter,
          c2pa: deps.c2pa ?? DEFAULT_C2PA,
          ...(log !== undefined ? { logger: log } : {}),
        },
        finalSpec,
      );

      // 5. PERSISTIR: filas final_video + thumbnail + update de ad_variant (todo en una tx).
      const masterKey = `masters/${variantId}/master.mp4`;
      const thumbKey = `masters/${variantId}/thumbnail.jpg`;
      const masterPut = await deps.storage.put(masterKey, result.masterBytes, {
        mime: result.masterMime,
      });
      const thumbPut = await deps.storage.put(thumbKey, result.thumbnailBytes, {
        mime: result.thumbnailMime,
      });

      const persisted = await finalizeVariantMaster(deps.db, {
        variantId,
        master: {
          storageKey: masterKey,
          mime: result.masterMime,
          bytes: masterPut.bytes,
          checksum: masterPut.checksum,
          durationS: finalSpec.output.maxDurationS,
          width: finalSpec.output.width,
          height: finalSpec.output.height,
        },
        thumbnail: {
          storageKey: thumbKey,
          mime: result.thumbnailMime,
          bytes: thumbPut.bytes,
          checksum: thumbPut.checksum,
          width: finalSpec.output.width,
          height: finalSpec.output.height,
        },
        parentAssetIds: result.parentAssetIds,
        qaReport: result.qaReport,
      });

      collectOutput({
        variantId,
        masterAssetId: persisted.master.id,
        thumbnailAssetId: persisted.thumbnail.id,
        qaReport: result.qaReport,
      } satisfies N8Output);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}

/** El `NormalizeSourceAsset` de un clip de vídeo fitteado (kind conservado del origen). */
function sourceOf(
  id: string,
  storageKey: string,
  checksum: string,
  kind: NormalizeSourceAsset['normalizedKind'],
  normalizeAs: NormalizeSourceAsset['normalizeAs'],
): NormalizeSourceAsset {
  return { id, storageKey, checksum, normalizeAs, normalizedKind: kind };
}

/** Normaliza la voz de un segmento a audio canónico (T5.2). Lee el asset de la voz para su storageKey +
 *  checksum (insumos de la cache key). El normalizado es `tts_audio`. */
async function normalizeVoice(
  normalizer: ReturnType<typeof createNormalizer>,
  db: DbClient,
  voAudioId: string,
): Promise<NormalizedAsset> {
  const voice = await getAsset(db, voAudioId);
  if (voice === undefined) {
    throw new PermanentStepError(`N8: el asset de voz ${voAudioId} no existe`);
  }
  return normalizer.normalize({
    id: voice.id,
    storageKey: voice.storageKey,
    checksum: voice.checksum,
    normalizeAs: 'audio',
    normalizedKind: 'tts_audio',
  });
}
