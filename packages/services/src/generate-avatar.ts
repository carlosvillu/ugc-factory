// Servicio de generación de CLIP DE AVATAR (T4.7, §7.2 N7c): anima una IMAGEN de la Persona con el
// AUDIO del hook (voiceover de N7b) para producir un clip del avatar hablando con lipsync. Dos tiers
// image+audio: Kling AI Avatar v2 Std y OmniHuman v1.5. Ambos toman `{image_url, audio_url, prompt}`;
// la duración del clip = la del audio automáticamente.
//
// POR QUÉ UN FINALIZER PROPIO Y NO `finalizeGeneration`. `finalizeGeneration` (T4.1/T4.2) es el
// liquidador SOLO-IMAGEN (`extractImageOutput` + `createAsset kind:'keyframe'`) COMPARTIDO por 4
// callers concurrentes (webhook + poll + sweeper + redelivery) con `SELECT … FOR UPDATE`. Reusarlo
// para vídeo haría que `extractImageOutput` reventara con el output `{video:{url}}` de un avatar, y su
// blast radius (money logic de imagen) es enorme. Así que aquí se DUPLICA el scaffold submit→poll→
// download (~20 líneas) y se liquida con un finalizer de VÍDEO distinto (`kind:'avatar_clip'`), molde
// `runGenerateAudio` de T4.5. Mantener `finalizeGeneration` intacto es la invariante que importa.
//
// UNA LLAMADA DE PAGO = UN COST_ENTRY. A diferencia de la cadena TTS→ASR de `runGenerateAudio` (dos
// llamadas fal facturadas por separado, con record-first del TTS antes de arriesgar el ASR), un clip
// de avatar es UNA sola llamada facturada. Por eso la liquidación es más simple: asset + cost + completed
// en UNA tx bajo el lock, sin el baile de dos fases. El coste es por SEGUNDO del clip (Kling 5,62¢/s,
// OmniHuman 16¢/s) — NUNCA sub-céntimo (un OmniHuman de 4 s son 64¢), así que la duración DEBE ser real
// (del output de fal, o del audio de entrada en su defecto), nunca un 0 degradado.
//
// ⚠ T4.7 NO CABLEA ESTO AL WORKER/SWEEPER (eso es T4.11). El sweeper de T4.3 reconcilia CUALQUIER
// generación reconciliable y encola `output.download` → `finalizeGeneration` (solo-imagen); una
// generación de VÍDEO recogida por esa vía explotaría. Marcado como deuda T4.11 (output-download.ts +
// reconcile.ts). Este servicio se invoca DIRECTO desde el smoke stepless y, en T4.11, desde el executor
// N7c tras hacer la vía del sweeper kind-aware.
import {
  computeContentHash,
  makeFalClient,
  extractVideoOutput,
  FalResponseError,
  type FalClientDeps,
  type GenerationInputs,
} from '@ugc/core/generation';
import { newUlid } from '@ugc/core/contracts';
import type { Logger, StorageAdapter } from '@ugc/core';
import {
  createAsset,
  createGeneration,
  getAsset,
  getAssetByGenerationKind,
  getGenerationForUpdate,
  getModelProfile,
  recordCost,
  updateGeneration,
  type DbClient,
  type Generation,
} from '@ugc/db';

import { falVideoCostOf } from './fal-pricing';
import { uploadInputCached } from './generate';
import { NOOP_LOGGER } from './noop-logger';

/** El prompt por defecto de fal para los avatares (Kling declara default `"."`); se usa si el caller no
 *  suministra uno. Ambos modelos aceptan `prompt` opcional. */
const DEFAULT_AVATAR_PROMPT = '.';

export interface GenerateAvatarDeps {
  db: DbClient;
  storage: StorageAdapter;
  /** La API key de fal EN CLARO. */
  falKey: string;
  logger?: Logger;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  falOptions?: Pick<
    FalClientDeps,
    'concurrency' | 'timeoutMs' | 'maxRetries' | 'pollIntervalMs' | 'maxPollAttempts'
  >;
}

export interface GenerateAvatarInput {
  /** El `model_profile` del avatar a invocar (Kling Std / OmniHuman Premium), resuelto por el caller
   *  desde el recipe del tier. Su `falEndpoint`/`cost`/`capabilities` se leen de BD. */
  avatarModelProfileId: string;
  /** El `asset` de la IMAGEN de la Persona (kind `reference_image`): se sube a fal → `image_url`. */
  imageAssetId: string;
  /** El `asset` del AUDIO del hook (kind `tts_audio`, de N7b): se sube a fal → `audio_url`. La duración
   *  del clip = la de este audio automáticamente. Su `duration_s` es el fallback de coste/duración. */
  audioAssetId: string;
  /** Prompt del avatar (guía de la actuación). OPCIONAL: default `"."`. */
  prompt?: string;
  /** Resolución de OmniHuman (`720p|1080p`). OPCIONAL: solo se añade al payload si el modelo la usa. */
  resolution?: '720p' | '1080p';
  /** El step que originó el gasto (T4.11): atribuye el `cost_entry`. OPCIONAL (stepless → NULL). */
  stepRunId?: string;
}

export interface GenerateAvatarResult {
  /** La fila `generation` del clip (completed). */
  generation: Generation;
  /** El asset del clip (kind='avatar_clip') con `duration_s`. */
  assetId: string;
  /** El coste del clip en céntimos (por segundo). */
  costCents: number;
  /** Duración del clip en segundos (del output de fal, o del audio de entrada en su defecto). */
  durationSeconds: number;
  /** Warnings observables (coste incalculable, duración ausente en el output…). */
  warnings: string[];
}

/**
 * Ejecuta una generación de CLIP DE AVATAR image+audio contra fal end-to-end y persiste su rastro.
 * Devuelve la fila `generation` (completed), el asset del clip (`avatar_clip`) y el coste. LANZA
 * (FalProviderError/FalResponseError/PermanentStepError-shape via caller) si algún eslabón falla — el
 * caller (executor T4.11) mapea a `generation.status='failed'`; la fila queda con el estado real.
 *
 * VALIDACIÓN ≤maxDuration ANTES DE GASTAR: OmniHuman @1080p exige audio ≤30 s (`capabilities.maxDuration`
 * del perfil). El caller (executor) valida la duración del audio del hook ANTES de llamar aquí (no
 * gastar en una request que fal rechazará). Este servicio NO revalida el límite (es el executor quien
 * conoce el tier y decide no gastar); aquí se asume que el caller ya cribó.
 */
export async function runGenerateAvatar(
  deps: GenerateAvatarDeps,
  input: GenerateAvatarInput,
): Promise<GenerateAvatarResult> {
  const { db, storage } = deps;
  const log = deps.logger ?? NOOP_LOGGER;
  const warnings: string[] = [];

  // 1) Resolver el model_profile del avatar + leer los dos assets de entrada (imagen + audio). Todo
  //    independiente → en PARALELO (patrón N7a/N7b).
  const [profile, imageAsset, audioAsset] = await Promise.all([
    getModelProfile(db, input.avatarModelProfileId),
    getAsset(db, input.imageAssetId),
    getAsset(db, input.audioAssetId),
  ]);
  if (profile === undefined) {
    throw new FalResponseError(
      `runGenerateAvatar: model_profile ${input.avatarModelProfileId} no existe`,
    );
  }
  if (imageAsset === undefined) {
    throw new FalResponseError(
      `runGenerateAvatar: asset de imagen ${input.imageAssetId} no existe`,
    );
  }
  if (audioAsset === undefined) {
    throw new FalResponseError(`runGenerateAvatar: asset de audio ${input.audioAssetId} no existe`);
  }

  // 2) Subir imagen + audio a fal storage (caché §9.6: `(asset_id, checksum)` en `asset.fal_url`). Un
  //    segundo clip de la MISMA Persona/hook reutiliza las fal-URLs sin re-subir (`fal_uploaded_at` no
  //    cambia). fal NO lee nuestro storage: necesita URLs públicas suyas.
  const uploadDeps = {
    db,
    storage,
    falKey: deps.falKey,
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
  };
  const [imageUpload, audioUpload] = await Promise.all([
    uploadInputCached(uploadDeps, {
      assetId: imageAsset.id,
      storageKey: imageAsset.storageKey,
      falUrl: imageAsset.falUrl,
      mime: imageAsset.mime,
    }),
    uploadInputCached(uploadDeps, {
      assetId: audioAsset.id,
      storageKey: audioAsset.storageKey,
      falUrl: audioAsset.falUrl,
      mime: audioAsset.mime,
    }),
  ]);

  // La duración del audio de entrada: fallback de duración/coste si el output de fal no la trae
  // (`duración = audio automáticamente`). Un `tts_audio` de N7b SIEMPRE la tiene, pero se guarda contra
  // el caso de que falte (nunca facturar sobre una duración desconocida sin dejar rastro).
  const audioDurationS = audioAsset.durationS ?? undefined;

  // 3) Construir el payload DIRECTO por modelo (BYPASS del adapter `avatar`). El `avatarAdapter` de
  //    T3.6 emite `{aspect_ratio, duration_seconds, enable_audio}` que Kling/OmniHuman NO aceptan; su
  //    núcleo real es `{image_url, audio_url, prompt}` + el `resolution` de OmniHuman. La divergencia
  //    entre tiers es ese único campo → un bypass explícito (como N7a/N7b) es más honesto que arreglar
  //    el adapter para un solo consumidor. NO es "adoptar el adapter" en T4.11: el fix del seed de T4.7
  //    (refImages/refAudios) hace que el adapter emita image_url/audio_url, pero SIGUE emitiendo los 3
  //    campos que fal rechaza — el dialecto avatar-image+audio es DISTINTO del de i2v/seedance. La deuda
  //    T4.11 es PARTIR/REESCRIBIR el adapter avatar para que emita solo `{image_url,audio_url,prompt,
  //    resolution?}`; los golden actuales snapshotean el payload aún-inválido y NO lo cazarán.
  const submitInputs: GenerationInputs = {
    image_url: imageUpload.falUrl,
    audio_url: audioUpload.falUrl,
    prompt: input.prompt ?? DEFAULT_AVATAR_PROMPT,
    // `resolution` SOLO cuando el caller la pasa (OmniHuman). Kling la ignora si llegara, pero el
    // executor solo la suministra para OmniHuman.
    ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
  };

  // 4) content_hash de dedupe (§9.6): imagen + audio + prompt + modelo lo determinan.
  const contentHash = computeContentHash({
    resolvedPrompt: submitInputs.prompt as string,
    modelProfileId: input.avatarModelProfileId,
    inputs: submitInputs,
  });

  // 5) Persistir la INTENCIÓN en `submitting` ANTES del submit (§9.6): un crash deja rastro reconciliable.
  const startedAt = new Date();
  let generation = await createGeneration(db, {
    modelProfileId: input.avatarModelProfileId,
    stepRunId: input.stepRunId,
    resolvedPrompt: submitInputs.prompt as string,
    inputs: submitInputs,
    contentHash,
    status: 'submitting',
    startedAt,
  });

  const fal = makeFalClient({
    credentials: deps.falKey,
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    ...deps.falOptions,
  });

  try {
    // 6) SUBMIT → `submitted` (URLs PERSISTIDAS tal cual, nunca reconstruidas) → POLL hasta completed.
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

    // 7) Validar el output de VÍDEO (`{video:{url}, duration}`). Un output sin `video` es
    //    `FalResponseError` (se pagó pero el contrato no se cumplió — barrera anti-finalizer-de-imagen).
    const videoOut = extractVideoOutput(polled.output);
    if (videoOut === null) {
      throw new FalResponseError(
        `runGenerateAvatar: el output del avatar ${generation.id} no trae vídeo: ${JSON.stringify(polled.output)}`,
      );
    }

    // 8) DURACIÓN del clip: primero la del output de fal; si no la emite, la del audio de entrada
    //    (`duración = audio automáticamente`). Insumo de `asset.duration_s` y del coste POR SEGUNDO.
    //    Si NINGUNA está disponible es un fallo honesto (no facturar por segundo sin segundos).
    const durationSeconds = videoOut.duration ?? audioDurationS;
    if (durationSeconds === undefined) {
      throw new FalResponseError(
        `runGenerateAvatar: no hay duración para ${generation.id} (ni output de fal ni audio de entrada) — no se puede facturar por segundo`,
      );
    }

    // 9) DESCARGAR el .mp4 a NUESTRO storage (fuera de la tx: I/O de red).
    const outRes = await fal.download(videoOut.video.url);
    if (outRes.body === null) {
      throw new FalResponseError(
        `runGenerateAvatar: el output ${videoOut.video.url} no trae cuerpo descargable`,
      );
    }
    const mime = videoOut.video.content_type ?? 'video/mp4';
    const storageKey = `generations/${generation.id}/${newUlid()}.mp4`;
    const put = await storage.put(storageKey, outRes.body, { mime });

    // 10) COSTE del clip (por SEGUNDO). Una sola unidad de gasto (una llamada fal).
    const cost = falVideoCostOf({ cost: profile.cost, durationSeconds });
    if (cost.warning !== null) warnings.push(cost.warning);

    // 11) LIQUIDACIÓN en UNA tx BAJO EL LOCK DE FILA (misma barrera anti-doble-cobro que
    //     `finalizeGeneration`/`runGenerateAudio`): re-chequear `completed` bajo el lock antes de crear
    //     asset/coste/completed. En T4.7 no hay callers concurrentes, pero se mantiene la forma (y su
    //     GRACIA) para que T4.11 la cablee al worker (webhook+poll+sweeper) sin reintroducir el
    //     doble-cobro ni corromper una fila ya finalizada.
    const completedAt = new Date();
    const settled = await db.transaction(async (tx) => {
      const locked = await getGenerationForUpdate(tx, generation.id);
      if (locked?.status === 'completed') {
        // NO-OP GRACIOSO (como `finalizeGeneration`): otra ruta ya finalizó bajo el lock. NO se re-crea
        // asset ni se re-cobra, y —crítico— NO se lanza (un throw caería en el catch y VOLTEARÍA a
        // `failed` una fila legítimamente `completed`). El .mp4 que ESTA llamada descargó queda huérfano
        // en storage (deuda menor conocida, igual que en `finalizeGeneration`).
        const existing = await getAssetByGenerationKind(tx, generation.id, 'avatar_clip');
        return { asset: existing ?? null, updated: locked, alreadyFinalized: true } as const;
      }
      const asset = await createAsset(tx, {
        kind: 'avatar_clip',
        storageKey,
        mime,
        bytes: put.bytes,
        checksum: put.checksum,
        durationS: durationSeconds,
        generationId: generation.id,
      });
      await recordCost(tx, {
        provider: 'fal',
        amountCents: cost.cents,
        // `quantity` es INTEGER en el ledger → segundos ENTEROS (redondeados); el `amount_cents` YA se
        // computó desde la duración EXACTA por segundo (`falVideoCostOf`), este es el rastro granular.
        quantity: Math.round(durationSeconds),
        unit: 'seconds',
        ...(generation.stepRunId !== null ? { stepRunId: generation.stepRunId } : {}),
        generationId: generation.id,
      });
      const updated = await updateGeneration(tx, generation.id, {
        status: 'completed',
        costActual: cost.cents,
        falStatusPayload: polled.statusPayload,
        durationS: durationSeconds,
        completedAt,
      });
      return { asset, updated, alreadyFinalized: false } as const;
    });

    const assetId = settled.asset?.id ?? null;
    if (assetId === null) {
      // La rama `alreadyFinalized` no encontró el asset de vídeo de la ruta ganadora: invariante roto
      // (una generación `completed` de avatar DEBE tener su `avatar_clip`). Surface honesto — pero NO se
      // marca `failed` (la fila está legítimamente `completed`): se re-lanza y el catch de abajo NO la
      // degradará (su UPDATE es condicional a `!= completed`).
      throw new FalResponseError(
        `runGenerateAvatar: la generación ${generation.id} está completed pero sin asset avatar_clip (invariante roto)`,
      );
    }

    log.info(
      {
        event: 'fal_avatar_generation_finalized',
        generationId: generation.id,
        assetId,
        costCents: cost.cents,
        durationSeconds,
        alreadyFinalized: settled.alreadyFinalized,
      },
      'clip de avatar generado: vídeo descargado, coste por segundo registrado, completed',
    );

    return {
      generation: settled.updated,
      assetId,
      costCents: cost.cents,
      durationSeconds,
      warnings,
    };
  } catch (err) {
    // Degradar a `failed` SOLO si la fila NO es ya terminal (`completed`): una ruta concurrente (T4.11)
    // pudo haberla completado legítimamente. Mismo criterio de gracia que la rama `alreadyFinalized`.
    await db.transaction(async (tx) => {
      const locked = await getGenerationForUpdate(tx, generation.id);
      if (locked !== undefined && locked.status !== 'completed') {
        await updateGeneration(tx, generation.id, { status: 'failed', completedAt: new Date() });
      }
    });
    throw err;
  }
}
