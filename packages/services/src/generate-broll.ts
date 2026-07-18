// Servicio de generación de CLIP DE B-ROLL (T4.8, §7.2 N7d): genera UN clip de vídeo por escena del
// BODY (§7.5), animando un KEYFRAME (i2v) o regenerando el producto EN escena desde referencias (R2V)
// con Veo 3.1. A diferencia del avatar (N7c), el b-roll es SILENCIOSO (la voz la pone N7b) y su
// duración es un INPUT (el enum del clip planificado), no la del audio.
//
// DOS RUTAS (la elige el `kind` del model_profile, resuelto por el executor desde el recipe):
//   - i2v (`fal-ai/veo3.1/image-to-video`): `{prompt, image_url}` — el keyframe (packshot de N7a) es
//     el FRAME INICIAL que el modelo anima.
//   - r2v (`fal-ai/veo3.1/reference-to-video`): `{prompt, image_urls[]}` — las referencias del
//     producto guían la FIDELIDAD del sujeto regenerado en escena (§7.5 «cuando el producto deba
//     regenerarse en escena»). `duration` es FIJO 8s en R2V.
//
// POR QUÉ UN SERVICIO PROPIO Y NO REUSAR `runGenerateAvatar`. Ambos son vídeo y comparten el
// finalizer (`{video:{url}}` + coste por segundo), PERO divergen en lo esencial: el avatar toma
// image+AUDIO y su duración = la del audio (derivada del output/entrada); el b-roll toma image(s)+
// prompt SIN audio y su duración es un INPUT cuantizado al enum del modelo (`quantizeDurationToEnum`,
// core) que el executor pasa. Fundirlos exigiría ramas por todos lados; un servicio hermano es más
// honesto (mismo criterio que separó `runGenerateAvatar` de `runGenerate` en T4.7). Se REUSA lo puro:
// `extractVideoOutput` + `falVideoCostOf` (por segundo).
//
// DURACIÓN = EL ENUM ENVIADO (no el output). Los endpoints i2v/R2V de Veo devuelven `{video:{url}}`
// SIN `duration` (verificado 2026-07-17 vs fal openapi). Así que la ÚNICA verdad de la duración del
// clip es el valor del enum que ESTE servicio manda a fal (`durationSeconds` del input): gobierna el
// payload (`duration:"Ns"`), el coste POR SEGUNDO y `asset.duration_s`. Facturar/persistir otro número
// desincronizaría el ledger de lo que fal generó.
//
// ⚠ T4.8 NO CABLEA ESTO AL WORKER/SWEEPER (eso es T4.11, como N7a/N7b/N7c). El sweeper de T4.3
// reconcilia CUALQUIER generación y encola `output.download`→`finalizeGeneration` (solo-imagen); una
// generación de VÍDEO recogida por esa vía explotaría. Deuda T4.11 (output-download.ts + reconcile.ts).
// Este servicio se invoca DIRECTO desde el smoke stepless y, en T4.11, desde el executor N7d.
import {
  computeContentHash,
  makeFalClient,
  extractVideoOutput,
  FalResponseError,
  type FalClientDeps,
  type GenerationInputs,
} from '@ugc/core/generation';
import { newUlid } from '@ugc/core/contracts';
import { isBrollModelKind } from '@ugc/core/gallery';
import type { Logger, StorageAdapter } from '@ugc/core';
import {
  getAsset,
  getModelProfile,
  updateGeneration,
  type DbClient,
  type Generation,
} from '@ugc/db';

import { falVideoCostOf } from './fal-pricing';
import {
  degradeGenerationOnError,
  finalizeSingleCallPerSecondGeneration,
} from './finalize-single-call-per-second';
import { uploadInputCached } from './generate';
import { resolveProductionDedup } from './generation-dedup';
import { NOOP_LOGGER } from './noop-logger';

/** Prompt por defecto si el caller no suministra uno (ambos endpoints lo requieren `min(1)`). En
 *  producción SIEMPRE llega el prompt canónico de N6; este default es solo un guard del smoke. */
const DEFAULT_BROLL_PROMPT = 'A cinematic product b-roll shot.';

export interface GenerateBrollDeps {
  db: DbClient;
  storage: StorageAdapter;
  /** La API key de fal EN CLARO. */
  falKey: string;
  logger?: Logger;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  falOptions?: Pick<
    FalClientDeps,
    | 'concurrency'
    | 'timeoutMs'
    | 'maxRetries'
    | 'pollIntervalMs'
    | 'maxPollAttempts'
    | 'baseUrlOverride'
  >;
}

export interface GenerateBrollInput {
  /** El `model_profile` del b-roll (Veo i2v o R2V), resuelto por el caller desde el recipe. Su
   *  `falEndpoint`/`cost`/`kind` se leen de BD. `kind` decide la ruta (`i2v` → image_url; `r2v` →
   *  image_urls[]). */
  brollModelProfileId: string;
  /** El prompt canónico de N6 (la escena a materializar). OPCIONAL: default en el servicio. */
  prompt?: string;
  /** Los `asset` de IMAGEN de entrada (kind `keyframe`/`reference_image`/`product_image`): se suben a
   *  fal → `image_url` (i2v: se usa el PRIMERO) / `image_urls[]` (r2v: hasta `capabilities.refImages`).
   *  El caller ya recortó a la capacidad del modelo. Puede ir vacío en i2v puro-t2v (no es el caso de
   *  N7d, que anima un keyframe). */
  imageAssetIds: string[];
  /** La duración del clip EN SEGUNDOS, YA cuantizada al enum del modelo por el caller
   *  (`quantizeDurationToEnum`). Gobierna el payload (`duration:"Ns"`), el coste y `asset.duration_s`. */
  durationSeconds: number;
  /** El aspect_ratio EXACTO del enum del modelo (`"9:16"`), del `capabilities.aspects`. */
  aspectRatio: string;
  /** El preset de resolución (`"720p"|"1080p"|"4k"`), del `capabilities.resolutions`. OPCIONAL. */
  resolution?: string;
  /** El step que originó el gasto (T4.11): atribuye el `cost_entry`. OPCIONAL (stepless → NULL). */
  stepRunId?: string;
  /** SALT DE DEDUP (T4.10): un discriminador que entra SOLO en el `content_hash` (NO en el payload de
   *  fal). Existe para el TROCEO §7.5: dos clips de la MISMA escena larga tienen keyframe+prompt+duración
   *  IDÉNTICOS → mismo hash → el dedup los colapsaría en uno (y el vídeo repetiría el clip). El executor
   *  N7d pasa aquí el índice del clip dentro de su escena (`escena:clip`), que hace el hash único por
   *  posición SIN filtrar a Veo. OMITIDO → sin salt → dos b-rolls con los mismos inputs SÍ deduplican
   *  (lo deseado entre variantes que comparten body/CTA). NO va nunca en `submitInputs`. */
  dedupSalt?: string;
}

export interface GenerateBrollResult {
  /** La fila `generation` del clip (completed). */
  generation: Generation;
  /** El asset del clip (kind='broll_clip') con `duration_s`. */
  assetId: string;
  /** El coste del clip en céntimos (por segundo). 0 en un acierto de dedup. */
  costCents: number;
  /** Duración del clip en segundos (= el enum enviado; el output de Veo no la emite). */
  durationSeconds: number;
  /** `true` si el clip se REUTILIZÓ de una generación `completed` idéntica (dedup §9.6): 0 llamadas a
   *  fal, 0 `cost_entry`. `false` si esta llamada lo generó. */
  reused: boolean;
  /** Warnings observables (coste incalculable…). */
  warnings: string[];
}

/**
 * Ejecuta una generación de CLIP DE B-ROLL contra fal end-to-end y persiste su rastro. Devuelve la
 * fila `generation` (completed), el asset del clip (`broll_clip`) y el coste. LANZA
 * (FalProviderError/FalResponseError) si algún eslabón falla — el caller (executor T4.11) mapea a
 * `generation.status='failed'`; la fila queda con el estado real, nunca un `completed` mentiroso.
 */
export async function runGenerateBroll(
  deps: GenerateBrollDeps,
  input: GenerateBrollInput,
): Promise<GenerateBrollResult> {
  const { db, storage } = deps;
  const log = deps.logger ?? NOOP_LOGGER;
  const warnings: string[] = [];

  // 1) Resolver el model_profile del b-roll + leer los assets de imagen de entrada. Independientes →
  //    en PARALELO (patrón N7a/N7c).
  const [profile, ...maybeImages] = await Promise.all([
    getModelProfile(db, input.brollModelProfileId),
    ...input.imageAssetIds.map((id) => getAsset(db, id)),
  ]);
  if (profile === undefined) {
    throw new FalResponseError(
      `runGenerateBroll: model_profile ${input.brollModelProfileId} no existe`,
    );
  }
  if (!isBrollModelKind(profile.kind)) {
    throw new FalResponseError(
      `runGenerateBroll: el model_profile ${profile.falEndpoint} es kind '${profile.kind}', no un modelo de vídeo de b-roll (i2v/r2v/t2v)`,
    );
  }
  const images = maybeImages.map((asset, idx) => {
    if (asset === undefined) {
      throw new FalResponseError(
        `runGenerateBroll: el asset de imagen ${String(input.imageAssetIds[idx])} no existe`,
      );
    }
    return asset;
  });
  // R2V/i2v de N7d NECESITAN al menos una imagen (keyframe o referencias): sin ella no hay ni frame
  // inicial ni fidelidad de producto. Un fallo honesto ANTES de gastar.
  if ((profile.kind === 'i2v' || profile.kind === 'r2v') && images.length === 0) {
    throw new FalResponseError(
      `runGenerateBroll: ${profile.falEndpoint} (kind '${profile.kind}') exige al menos una imagen de entrada, no se pasó ninguna`,
    );
  }

  // 2) Subir las imágenes a fal storage (caché §9.6: reutiliza `asset.fal_url` si ya se subió).
  const uploadDeps = {
    db,
    storage,
    falKey: deps.falKey,
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
    // baseUrlOverride (E2E, T4.11): el upload de keyframes sale por `rest.fal.ai`; sin él 401ea contra
    // fal real en el stack. Se propaga desde `falOptions` del caller.
    ...(deps.falOptions?.baseUrlOverride !== undefined
      ? { baseUrlOverride: deps.falOptions.baseUrlOverride }
      : {}),
  };
  const uploads = await Promise.all(
    images.map((asset) =>
      uploadInputCached(uploadDeps, {
        assetId: asset.id,
        storageKey: asset.storageKey,
        falUrl: asset.falUrl,
        mime: asset.mime,
      }),
    ),
  );
  const imageUrls = uploads.map((u) => u.falUrl);

  // 3) Construir el payload DIRECTO por RUTA (BYPASS del adapter `i2v`, como N7a/N7b/N7c). El adapter
  //    emite `duration_seconds`(número)/`enable_audio` que Veo NO acepta: Veo quiere `duration:"Ns"`
  //    (enum string) + `image_url`(i2v) / `image_urls[]`(r2v). B-ROLL SILENCIOSO: `generate_audio:
  //    false` — la voz es de N7b y, además, con audio Veo cuesta $0,40/s vs $0,20/s (deuda T4.11:
  //    PARTIR/REESCRIBIR el adapter i2v con este dialecto).
  const prompt = input.prompt ?? DEFAULT_BROLL_PROMPT;
  // La imagen entra distinta por ruta: r2v manda un ARRAY de referencias (`image_urls`); i2v un único
  // frame inicial (`image_url`). `t2v` puro no lleva imagen (N7d no lo usa; el guard de la l.152 ya
  // exige imagen para i2v/r2v, así que la rama vacía solo cubre t2v).
  const imageInput: GenerationInputs =
    profile.kind === 'r2v'
      ? { image_urls: imageUrls }
      : imageUrls.length > 0
        ? { image_url: imageUrls[0] }
        : {};
  const submitInputs: GenerationInputs = {
    prompt,
    aspect_ratio: input.aspectRatio,
    duration: `${String(input.durationSeconds)}s`,
    generate_audio: false,
    ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
    ...imageInput,
  };

  // 4) content_hash de dedupe (§9.6): imágenes + prompt + duración + modelo lo determinan. El SALT (T4.10)
  //    entra SOLO en el material del hash (bajo una clave reservada `__dedup_salt` que NO existe en
  //    `submitInputs` → jamás llega a fal): distingue dos clips troceados de la misma escena sin partir la
  //    dedup entre variantes (que no pasan salt, o pasan el mismo `escena:clip`). Sin salt, el hash es
  //    idéntico al de T4.8 (retrocompatible: los golden y smokes sin salt no cambian).
  const contentHash = computeContentHash({
    resolvedPrompt: prompt,
    modelProfileId: input.brollModelProfileId,
    inputs:
      input.dedupSalt !== undefined
        ? { ...submitInputs, __dedup_salt: input.dedupSalt }
        : submitInputs,
  });

  // 4b–5) DEDUP (§9.6) + persistir la INTENCIÓN en `submitting` ANTES del submit: un b-roll `completed`
  //     idéntico se REUTILIZA sin fal ni `cost_entry` (0 coste, visible en /spend; el upload de imágenes ya
  //     está cacheado, un hit no gasta render); si no, `resolveProductionDedup` inserta la fila viva (dedup
  //     atómico vía índice único parcial) o —tras perder la carrera— re-lee o lanza para reintentar.
  const dedup = await resolveProductionDedup(db, {
    contentHash,
    assetKind: 'broll_clip',
    serviceLabel: 'runGenerateBroll',
    assetLabel: 'un b-roll',
    insertValues: {
      modelProfileId: input.brollModelProfileId,
      stepRunId: input.stepRunId,
      resolvedPrompt: prompt,
      inputs: submitInputs,
      contentHash,
      status: 'submitting',
      startedAt: new Date(),
    },
    logger: log,
  });
  if ('reused' in dedup) {
    return {
      generation: dedup.reused.generation,
      assetId: dedup.reused.assetId,
      costCents: 0,
      durationSeconds: dedup.reused.asset.durationS ?? input.durationSeconds,
      reused: true,
      warnings,
    };
  }
  let generation: Generation = dedup.generation;

  const fal = makeFalClient({
    credentials: deps.falKey,
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    ...deps.falOptions,
  });

  try {
    // 6) SUBMIT → `submitted` (URLs PERSISTIDAS tal cual) → POLL hasta completed.
    const submitted = await fal.submit(profile.falEndpoint, submitInputs);
    generation = await updateGeneration(db, generation.id, {
      status: 'submitted',
      falRequestId: submitted.requestId,
      statusUrl: submitted.statusUrl,
      responseUrl: submitted.responseUrl,
      falStatusPayload: submitted.raw,
    });
    const polled = await fal.poll({
      statusUrl: submitted.statusUrl,
      responseUrl: submitted.responseUrl,
    });

    // 7) Validar el output de VÍDEO (`{video:{url}}`). Un output sin `video` es `FalResponseError`
    //    (se pagó pero el contrato no se cumplió — barrera anti-finalizer-de-imagen).
    const videoOut = extractVideoOutput(polled.output);
    if (videoOut === null) {
      throw new FalResponseError(
        `runGenerateBroll: el output del b-roll ${generation.id} no trae vídeo: ${JSON.stringify(polled.output)}`,
      );
    }

    // 8) DURACIÓN = el enum enviado (Veo i2v/R2V NO emite `duration` en el output). Insumo de
    //    `asset.duration_s` y del coste POR SEGUNDO. Es el MISMO número que fue al payload.
    const durationSeconds = input.durationSeconds;

    // 9) DESCARGAR el .mp4 a NUESTRO storage (fuera de la tx: I/O de red).
    const outRes = await fal.download(videoOut.video.url);
    if (outRes.body === null) {
      throw new FalResponseError(
        `runGenerateBroll: el output ${videoOut.video.url} no trae cuerpo descargable`,
      );
    }
    const mime = videoOut.video.content_type ?? 'video/mp4';
    const storageKey = `generations/${generation.id}/${newUlid()}.mp4`;
    const put = await storage.put(storageKey, outRes.body, { mime });

    // 10) COSTE del clip (por SEGUNDO). Una sola unidad de gasto (una llamada fal).
    const cost = falVideoCostOf({ cost: profile.cost, durationSeconds });
    if (cost.warning !== null) warnings.push(cost.warning);

    // 11) LIQUIDACIÓN en UNA tx BAJO EL LOCK DE FILA vía el finalizer de vídeo COMPARTIDO (T4.11): la
    //     misma barrera anti-doble-cobro que `runGenerateAvatar` (kind parametrizado). `durationSeconds`
    //     es el enum enviado (INPUT, no output de Veo) — se deriva en ESTE servicio; el helper persiste.
    const settled = await finalizeSingleCallPerSecondGeneration(
      { db, logger: log },
      {
        generation,
        assetKind: 'broll_clip',
        durationSeconds,
        costCents: cost.cents,
        put,
        storageKey,
        mime,
        statusPayload: polled.statusPayload,
      },
    );

    return {
      generation: settled.generation,
      assetId: settled.assetId,
      costCents: cost.cents,
      durationSeconds,
      reused: false,
      warnings,
    };
  } catch (err) {
    // Degradar a `failed` (anti-T1.8: el error de fal — causa raíz — SIEMPRE sobrevive, el fallo de la
    // degradación se LOGUEA pero nunca se propaga). Helper compartido con `runGenerateAvatar`.
    await degradeGenerationOnError(
      { db, logger: log },
      { generationId: generation.id, originalError: err, event: 'fal_broll_degrade_failed' },
    );
    throw err;
  }
}
