// Servicio de generación del CLIP DE AVATAR tier TEST · VEED (T4.7b, §7.2 N7c / §7.5).
//
// VEED (`veed/avatars/text-to-video`) es una DISCONTINUIDAD del tier barato: es TEXT-TO-VIDEO con AVATAR
// DE LIBRERÍA PROPIO de VEED — NO anima la imagen de la Persona ni usa el TTS de N7b (§7.5). Su input es
// `{text, avatar_id}` (el hook a hablar + qué avatar de librería usar; NO acepta `prompt` — probado vs fal
// real, T4.7b: da 422). El `avatar_id` es un dialecto del modelo, vive en `capabilities.avatarId` del
// catálogo. Devuelve un clip del avatar hablando, con la voz EMBEBIDA. Factura por MINUTO (35¢/min, con
// mínimo de 1 min), a diferencia de Kling/OmniHuman (por segundo).
//
// LA CADENA (por qué en este orden):
//   1. SUBMIT text-to-video (`{text, avatar_id}`) → POLL → clip de vídeo (`{video:{url}}` — VEED NO emite
//      `duration`, se MIDE con ffprobe en el paso 1b), liquidado como `avatar_clip` por el finalizer de
//      vídeo COMPARTIDO (misma barrera anti-doble-cobro que Std/Premium).
//   1b. MEDIR la duración con ffprobe sobre el clip descargado (VEED no la da; hace falta para facturar
//      por minuto). ANTES del cost/finalize → un fallo del probe no deja dinero en juego.
//   2. EXTRAER la pista de audio del clip con ffmpeg (`extractAudioTrack`) → WAV. El ASR da 422 sobre un
//      contenedor de vídeo (probado contra fal real, T4.7b): hay que sacar el audio primero. ffmpeg vive
//      en la imagen del worker desde T5.1.
//   3. El WAV se persiste como asset `tts_audio` (el kind que porta `word_timestamps`; el subtitulador de
//      F5/T5.4 lo lee de ahí, venga de N7b o de VEED) y se sube a fal storage (`uploadInputCached`).
//   4. ASR (`fal-ai/elevenlabs/speech-to-text`) sobre la fal-url del audio → `word_timestamps`, cobertura
//      100% (Entrega), `deriveDurationSeconds`. Reusa la maquinaria de T4.5.
//
// TAXONOMÍA DE ERROR (anti-T1.8): tres capas DISTINTAS, tres tipos DISTINTOS —
//   · `AudioExtractionError` (ffmpeg no pudo extraer el audio: subproceso local),
//   · `FalResponseError` (fal devolvió un output que no cumple el contrato: clip sin vídeo, ASR sin
//     timestamps, cobertura incompleta),
//   · el error de red del `FalClient` (proveedor caído/timeout).
// NUNCA se colapsan: cada uno es un diagnóstico opuesto.
import {
  computeContentHash,
  computeWordCoverage,
  deriveDurationSeconds,
  extractVideoOutput,
  extractWordTimestamps,
  makeFalClient,
  FalResponseError,
  type FalClientDeps,
  type GenerationInputs,
} from '@ugc/core/generation';
import type { Logger, StorageAdapter } from '@ugc/core';
import { newUlid } from '@ugc/core/contracts';
import { ModelCapabilitiesSchema } from '@ugc/core/gallery';
import {
  createAsset,
  getAssetByGenerationKind,
  getModelProfile,
  recordCost,
  setAssetWordTimestamps,
  updateGeneration,
  type DbClient,
  type Generation,
} from '@ugc/db';

import {
  extractAudioTrack,
  extractedAudioStorageKey,
  probeVideoDurationSeconds,
  type FfmpegRunner,
  type FfprobeRunner,
} from './extract-audio-track';
import { falAsrCostOf, falVideoCostOf } from './fal-pricing';
import {
  degradeGenerationOnError,
  finalizeSingleCallPerSecondGeneration,
} from './finalize-single-call-per-second';
import { uploadInputCached } from './generate';
import { resolveProductionDedup } from './generation-dedup';
import { NOOP_LOGGER } from './noop-logger';

export interface GenerateVeedAvatarDeps {
  db: DbClient;
  storage: StorageAdapter;
  /** La API key de fal EN CLARO. */
  falKey: string;
  /** El runner de ffmpeg para la extracción de audio, inyectable en tests (default: subproceso real). */
  ffmpeg?: FfmpegRunner;
  /** El runner de ffprobe para medir la duración del clip (VEED no la emite), inyectable en tests. */
  ffprobe?: FfprobeRunner;
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

export interface GenerateVeedAvatarInput {
  /** El `model_profile` de VEED (`veed/avatars/text-to-video`), resuelto por el caller. */
  veedModelProfileId: string;
  /** El `model_profile` del ASR (`fal-ai/elevenlabs/speech-to-text`), resuelto por el caller (para su
   *  `cost` por minuto). El audio EXTRAÍDO del clip pasa por él para los word timestamps. */
  asrModelProfileId: string;
  /** El TEXTO del hook que VEED habla (la voz es de librería de VEED, no de la Persona). Es el campo
   *  `text` del submit (NO `prompt`) y el insumo del `content_hash`. El `avatar_id` lo aporta el perfil
   *  (`capabilities.avatarId`), no este input. */
  text: string;
  /** El código de idioma para el ASR (`eng`, `spa`, …). OPCIONAL: si se omite, el ASR autodetecta. */
  asrLanguageCode?: string;
  /** El step que originó el gasto (T4.11): atribuye ambos `cost_entry` (clip + ASR). OPCIONAL (stepless). */
  stepRunId?: string;
}

export interface GenerateVeedAvatarResult {
  /** La fila `generation` del clip VEED (completed). */
  generation: Generation;
  /** El asset del clip de vídeo (kind='avatar_clip'). */
  assetId: string;
  /** El asset del audio EXTRAÍDO (kind='tts_audio') con `word_timestamps` sellados. */
  audioAssetId: string;
  /** El coste del clip VEED en céntimos (por minuto). 0 en un acierto de dedup. */
  clipCostCents: number;
  /** El coste del ASR en céntimos (por minuto). 0 en un acierto de dedup. */
  asrCostCents: number;
  /** Duración del clip en segundos (del output de fal). */
  durationSeconds: number;
  /** Nº de palabras del ASR con tiempos válidos (== total → cobertura 100%). */
  wordCount: number;
  /** `true` si el clip se REUTILIZÓ de una generación `completed` idéntica (dedup §9.6). */
  reused: boolean;
  /** Warnings observables (coste incalculable, etc.). */
  warnings: string[];
}

/**
 * Ejecuta la ruta VEED de N7c end-to-end: text-to-video → clip → extracción de audio con ffmpeg → ASR →
 * word timestamps. Devuelve la fila `generation` del clip, el asset del vídeo, el asset del audio
 * extraído (con timestamps), y ambos costes. LANZA con TIPO DISTINTO según la capa que falle (ver la
 * cabecera). El caller mapea a `failed`.
 */
export async function runGenerateVeedAvatar(
  deps: GenerateVeedAvatarDeps,
  input: GenerateVeedAvatarInput,
): Promise<GenerateVeedAvatarResult> {
  const { db, storage } = deps;
  const log = deps.logger ?? NOOP_LOGGER;
  const warnings: string[] = [];

  const [veedProfile, asrProfile] = await Promise.all([
    getModelProfile(db, input.veedModelProfileId),
    getModelProfile(db, input.asrModelProfileId),
  ]);
  if (veedProfile === undefined) {
    throw new FalResponseError(
      `runGenerateVeedAvatar: model_profile VEED ${input.veedModelProfileId} no existe`,
    );
  }
  if (asrProfile === undefined) {
    throw new FalResponseError(
      `runGenerateVeedAvatar: model_profile ASR ${input.asrModelProfileId} no existe`,
    );
  }

  // VEED es text-to-video con AVATAR DE LIBRERÍA: su input schema exige `text` (el hook a hablar) +
  // `avatar_id` (qué avatar de librería usar) — NO acepta `prompt` (probado contra fal real, T4.7b: un
  // submit con `prompt` da 422 «avatar_id/text required»). El `avatar_id` es un dialecto del modelo: vive
  // en `capabilities.avatarId` del catálogo (como `aspectValues`), no en código. Su ausencia es un bug de
  // datos (un perfil VEED sin `avatar_id` sembrado) → loud, no coerción silenciosa.
  // `capabilities` es jsonb OPACO al salir de la BD → se VALIDA en la frontera (patrón del executor N7c /
  // los adapters, principio 4 de backend). Un jsonb corrupto es `FalResponseError` (contrato de datos).
  const capsParsed = ModelCapabilitiesSchema.safeParse(veedProfile.capabilities);
  if (!capsParsed.success) {
    throw new FalResponseError(
      `runGenerateVeedAvatar: capabilities inválidas en el model_profile VEED ${input.veedModelProfileId}: ${capsParsed.error.message}`,
    );
  }
  const avatarId = capsParsed.data.avatarId;
  if (avatarId === undefined) {
    throw new FalResponseError(
      `runGenerateVeedAvatar: el model_profile VEED ${input.veedModelProfileId} no declara capabilities.avatarId ` +
        `(el endpoint text-to-video lo EXIGE — ¿galería sin sembrar el avatar de librería?)`,
    );
  }
  const submitInputs: GenerationInputs = { text: input.text, avatar_id: avatarId };
  const contentHash = computeContentHash({
    resolvedPrompt: input.text,
    modelProfileId: input.veedModelProfileId,
    inputs: submitInputs,
  });

  // DEDUP (§9.6) + persistir la INTENCIÓN en `submitting` ANTES del submit. Un clip VEED `completed`
  // idéntico se REUTILIZA sin fal ni cost_entry. El dedup indexa el `avatar_clip` (el kind facturado que
  // sella `completed`); el audio EXTRAÍDO con sus timestamps vive en un asset `tts_audio` HERMANO de la
  // MISMA generación — la rama de reúso lo resuelve aparte (ver abajo), NO devuelve el asset del clip.
  const dedup = await resolveProductionDedup(db, {
    contentHash,
    assetKind: 'avatar_clip',
    serviceLabel: 'runGenerateVeedAvatar',
    assetLabel: 'un clip de avatar VEED',
    insertValues: {
      modelProfileId: input.veedModelProfileId,
      stepRunId: input.stepRunId,
      resolvedPrompt: input.text,
      inputs: submitInputs,
      contentHash,
      status: 'submitting',
      startedAt: new Date(),
    },
    logger: log,
  });
  if ('reused' in dedup) {
    // REÚSO §9.6: la generación clip está `completed`, pero `completed` de VEED vale por el CLIP (facturado,
    // sella la fila) — NO garantiza que la cadena de audio (extracción→ASR→timestamps) llegara a sellarse:
    // un fallo de ffmpeg/ASR DESPUÉS de liquidar el clip deja la fila `completed` (guard de degradación) sin
    // `tts_audio` o con sus `word_timestamps` en null. Por eso la rama de reúso resuelve el asset `tts_audio`
    // HERMANO y EXIGE timestamps sellados; si faltan, LANZA (no devuelve `wordCount:0` como falso éxito —
    // eso sería el anti-patrón "arnés más cómodo que la realidad" en el money-path). El deliverable de audio
    // no es re-derivable por esta vía barata: el clip ya está `completed` y re-generarlo doble-cobraría.
    const reusedGen = dedup.reused.generation;
    const audioAsset = await getAssetByGenerationKind(db, reusedGen.id, 'tts_audio');
    const sealed =
      audioAsset === undefined ? null : extractWordTimestamps(audioAsset.wordTimestamps);
    if (audioAsset === undefined || sealed === null) {
      throw new FalResponseError(
        `runGenerateVeedAvatar: la generación VEED ${reusedGen.id} está completed (clip facturado) pero su ` +
          `cadena de audio no llegó a sellar word_timestamps (asset tts_audio ` +
          `${audioAsset === undefined ? 'ausente' : 'sin timestamps'}); no es reutilizable como voiceover`,
      );
    }
    logDedupReuse(log, reusedGen.id, dedup.reused.assetId, audioAsset.id);
    return {
      generation: reusedGen,
      assetId: dedup.reused.assetId,
      audioAssetId: audioAsset.id,
      clipCostCents: 0,
      asrCostCents: 0,
      durationSeconds: dedup.reused.asset.durationS ?? 0,
      wordCount: computeWordCoverage(sealed).wordCount,
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
    // 1) SUBMIT text-to-video → POLL hasta completed.
    const submitted = await fal.submit(veedProfile.falEndpoint, submitInputs);
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

    const videoOut = extractVideoOutput(polled.output);
    if (videoOut === null) {
      throw new FalResponseError(
        `runGenerateVeedAvatar: el output de VEED ${generation.id} no trae vídeo: ${JSON.stringify(polled.output)}`,
      );
    }

    // 2) DESCARGAR el .mp4 a NUESTRO storage (fuera de la tx: I/O de red). El mime se FUERZA a video/mp4:
    //    VEED devuelve `content_type: "application/octet-stream"` en algunos outputs (visto vs fal), que no
    //    es un mime de vídeo utilizable aguas abajo (el `?? 'video/mp4'` no dispara sobre un valor presente
    //    pero equivocado). Es un .mp4 real (ffmpeg/ffprobe eligen el demuxer por contenido, no por mime).
    const outRes = await fal.download(videoOut.video.url);
    if (outRes.body === null) {
      throw new FalResponseError(
        `runGenerateVeedAvatar: el output ${videoOut.video.url} no trae cuerpo descargable`,
      );
    }
    const mime = 'video/mp4';
    const clipStorageKey = `generations/${generation.id}/${newUlid()}.mp4`;
    const put = await storage.put(clipStorageKey, outRes.body, { mime });

    // 3) MEDIR la duración con ffprobe (VEED NO emite `duration` en su output — confirmado vs la doc de
    //    fal, T4.7b). El clip se factura POR MINUTO, así que la duración hace falta ANTES de liquidar. Se
    //    mide sobre el clip ya descargado; un fallo del probe ocurre ANTES del cost/finalize → sin dinero
    //    en juego (el clip queda descargado pero sin cost_entry). `VideoProbeError` (capa propia, anti-T1.8).
    const durationSeconds = await probeVideoDurationSeconds(
      { storage, ...(deps.ffprobe !== undefined ? { ffprobe: deps.ffprobe } : {}), logger: log },
      { storageKey: clipStorageKey },
    );

    // 4) COSTE del clip VEED (por MINUTO — `falVideoCostOf` rutea por unit). Una unidad de gasto (el clip).
    const clipCost = falVideoCostOf({ cost: veedProfile.cost, durationSeconds });
    if (clipCost.warning !== null) warnings.push(clipCost.warning);

    // 4) LIQUIDAR el clip como `avatar_clip` bajo el lock (misma barrera anti-doble-cobro que Std/Premium).
    const settled = await finalizeSingleCallPerSecondGeneration(
      { db, logger: log },
      {
        generation,
        assetKind: 'avatar_clip',
        durationSeconds,
        costCents: clipCost.cents,
        put,
        storageKey: clipStorageKey,
        mime,
        statusPayload: polled.statusPayload,
      },
    );
    generation = settled.generation;

    // 5) EXTRAER la pista de audio del clip con ffmpeg (T4.7b). Un fallo aquí es `AudioExtractionError`
    //    (subproceso local), NO un fallo de fal — el catch de abajo lo degrada pero preserva su tipo.
    const extracted = await extractAudioTrack(
      { storage, ...(deps.ffmpeg !== undefined ? { ffmpeg: deps.ffmpeg } : {}), logger: log },
      { storageKey: clipStorageKey },
    );

    // 6) Persistir el audio extraído como asset `tts_audio` (el kind que porta word_timestamps; T5.4 lo
    //    lee de ahí). Se ata a la MISMA generación del clip (su procedencia es el clip VEED).
    const audioStorageKey = extractedAudioStorageKey(generation.id);
    const audioPut = await storage.put(audioStorageKey, extracted.bytes, { mime: extracted.mime });
    const audioAsset = await createAsset(db, {
      kind: 'tts_audio',
      storageKey: audioStorageKey,
      mime: extracted.mime,
      bytes: audioPut.bytes,
      checksum: audioPut.checksum,
      generationId: generation.id,
    });

    // 7) Subir el audio a fal storage (el ASR no lee nuestro storage) + ASR sobre esa fal-url.
    const { falUrl: audioFalUrl } = await uploadInputCached(
      {
        db,
        storage,
        falKey: deps.falKey,
        ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
        ...(deps.falOptions?.baseUrlOverride !== undefined
          ? { baseUrlOverride: deps.falOptions.baseUrlOverride }
          : {}),
      },
      {
        assetId: audioAsset.id,
        storageKey: audioStorageKey,
        falUrl: audioAsset.falUrl,
        mime: extracted.mime,
      },
    );

    const asrSubmitted = await fal.submit(asrProfile.falEndpoint, {
      audio_url: audioFalUrl,
      diarize: false,
      tag_audio_events: false,
      ...(input.asrLanguageCode !== undefined ? { language_code: input.asrLanguageCode } : {}),
    });
    const asrPolled = await fal.poll({
      statusUrl: asrSubmitted.statusUrl,
      responseUrl: asrSubmitted.responseUrl,
    });

    // 8) Validar los word timestamps + cobertura 100% (Entrega). Un output que no encaja o una cobertura
    //    parcial es `FalResponseError` (se pagó el ASR pero el contrato no se cumplió).
    const wordTimestamps = extractWordTimestamps(asrPolled.output);
    if (wordTimestamps === null) {
      throw new FalResponseError(
        `runGenerateVeedAvatar: el output del ASR de ${generation.id} no encaja WordTimestampsSchema: ${JSON.stringify(asrPolled.output)}`,
      );
    }
    const coverage = computeWordCoverage(wordTimestamps);
    if (!coverage.fullyCovered) {
      throw new FalResponseError(
        `runGenerateVeedAvatar: cobertura de word timestamps incompleta en ${generation.id}: ` +
          `${String(coverage.timedWordCount)}/${String(coverage.wordCount)} palabras con tiempos ` +
          `(sin tiempo: ${coverage.untimedWords.join(', ')})`,
      );
    }
    const asrDurationSeconds = deriveDurationSeconds(wordTimestamps);

    // 9) COSTE del ASR (2ª unidad de gasto, por minuto) + sellar los timestamps en el asset de audio.
    const asrCost = falAsrCostOf({ cost: asrProfile.cost, durationSeconds: asrDurationSeconds });
    if (asrCost.warning !== null) warnings.push(asrCost.warning);
    await recordCost(db, {
      provider: 'fal',
      amountCents: asrCost.cents,
      quantity: Math.round(asrDurationSeconds),
      unit: 'seconds',
      ...(generation.stepRunId !== null ? { stepRunId: generation.stepRunId } : {}),
      generationId: generation.id,
    });
    await setAssetWordTimestamps(db, audioAsset.id, wordTimestamps);

    log.info(
      {
        event: 'veed_avatar_completed',
        generationId: generation.id,
        clipAssetId: settled.assetId,
        audioAssetId: audioAsset.id,
        wordCount: coverage.wordCount,
      },
      'clip VEED generado, audio extraído y word timestamps sellados',
    );

    return {
      generation,
      assetId: settled.assetId,
      audioAssetId: audioAsset.id,
      clipCostCents: clipCost.cents,
      asrCostCents: asrCost.cents,
      durationSeconds,
      wordCount: coverage.wordCount,
      reused: false,
      warnings,
    };
  } catch (err) {
    // Degradar a `failed` preservando el TIPO del error original (anti-T1.8): la causa raíz
    // (AudioExtractionError / FalResponseError / error de red) SIEMPRE sobrevive; el fallo de la
    // degradación se loguea pero nunca se propaga.
    await degradeGenerationOnError(
      { db, logger: log },
      { generationId: generation.id, originalError: err, event: 'fal_veed_avatar_degrade_failed' },
    );
    throw err;
  }
}

/** Loguea un acierto de dedup de VEED en el ÚNICO punto que lo resuelve: el clip reutilizado + su asset
 *  `tts_audio` hermano con timestamps sellados (el que esta ruta devuelve como `audioAssetId`). */
function logDedupReuse(
  log: Logger,
  generationId: string,
  clipAssetId: string,
  audioAssetId: string,
): void {
  log.info(
    { event: 'veed_avatar_reused', generationId, clipAssetId, audioAssetId },
    'clip VEED reutilizado de una generación completed idéntica (0 coste); audio+timestamps del asset hermano',
  );
}
