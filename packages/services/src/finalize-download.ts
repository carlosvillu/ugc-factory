// DISPATCH KIND-AWARE del consumer `output.download` (T4.11, MONEY POINT deuda T4.11 l.591). El
// sweeper de T4.3 reconcilia CUALQUIER generación reconciliable colgada, persiste el output en forma
// webhook-compatible y encola `output.download`; su consumer liquida descargando el output y creando
// asset+coste+completed. HASTA T4.11 ese consumer llamaba SIEMPRE a `finalizeGeneration` (SOLO-IMAGEN,
// `extractImageOutput` + `kind:'keyframe'`): una generación de AUDIO (`{audio:{url}}`) o VÍDEO
// (`{video:{url}}`) recogida por esa vía reventaría (o —peor— crearía un asset `keyframe` corrupto).
//
// Este módulo RUTA por el `kind` REAL de la generación (resuelto desde `model_profile.kind`) al
// finalizer correcto, SIN fundir semánticas (cada kind tiene su unidad de coste):
//   · image/utility               → `finalizeGeneration` (imagen, `keyframe`, coste por `images`).
//   · avatar/lipsync/t2v/i2v/r2v  → finalizer de VÍDEO (`avatar_clip`/`broll_clip`, coste por segundo)
//                                    vía el helper compartido `finalizeSingleCallPerSecondGeneration`.
//   · music                       → finalizer de MÚSICA (`music_bed`, coste por segundo).
//   · tts                         → NO se puede liquidar por esta vía: un voiceover necesita la CADENA
//                                    TTS→ASR (2ª llamada fal) para sellar `word_timestamps` — el
//                                    consumer de descarga NO tiene ASR. Se lanza `PermanentStepError`
//                                    (loud, no corrupción): reintentar por descarga nunca completará un
//                                    voiceover. (La reconciliación honesta de un TTS colgado es una vía
//                                    aparte; ver deuda en el informe de T4.11.)
//
// DERIVACIÓN DE DURACIÓN desde el payload/inputs GUARDADOS (el consumer no tiene el input original en
// memoria como el servicio): vídeo Veo (broll) NO emite `duration` en el output → se recupera del
// `inputs.duration` PERSISTIDO (`"Ns"`); avatar SÍ la emite (`videoOut.duration`) con caída a
// `generation.durationS`; música usa `inputs.duration` (número). Es la MISMA verdad que el servicio
// mandó a fal (facturar/persistir otro número desincronizaría el ledger).
import { newUlid } from '@ugc/core/contracts';
import { extractAudioOutput, extractVideoOutput } from '@ugc/core/generation';
import { videoAssetKindForModelKind } from '@ugc/core/gallery';
import { PermanentStepError } from '@ugc/core/orchestrator';
import type { Logger, StorageAdapter } from '@ugc/core';
import { getModelProfile, type DbClient, type Generation, type ModelProfile } from '@ugc/db';

import { falMusicCostOf, falVideoCostOf } from './fal-pricing';
import {
  finalizeSingleCallPerSecondGeneration,
  type FinalizeSingleCallPerSecondResult,
} from './finalize-single-call-per-second';
import {
  finalizeGeneration,
  type FinalizeResult,
  type OutputDownloader,
} from './finalize-generation';

export interface FinalizeDownloadDeps {
  db: DbClient;
  storage: StorageAdapter;
  /** El descargador del output (pública, firmada). En el consumer es un `FalClient` con el mismo
   *  timeout duro; su `download` basta. */
  downloader: OutputDownloader;
  logger: Logger;
}

/** El resultado del dispatch: el asset creado (o null si otra ruta ya finalizó) + su coste. Unifica los
 *  tres shapes de resultado (imagen/vídeo/música) en lo que el consumer necesita loggear. */
export interface FinalizeDownloadResult {
  assetId: string | null;
  costCents: number;
}

/**
 * Liquida una generación desde el OUTPUT de fal GUARDADO, RUTANDO por su `kind` real al finalizer
 * correcto (imagen/vídeo/música). Un `tts` no es liquidable por esta vía (necesita ASR) → lanza
 * `PermanentStepError`. Un `kind` sin finalizer conocido → `PermanentStepError` (seam explícito, no un
 * fallthrough al finalizer de imagen que corrompería). El coste/duración se derivan del payload+inputs
 * PERSISTIDOS. Todas las escrituras (asset+cost+completed) van bajo el lock de fila de cada finalizer
 * (misma barrera anti-doble-cobro): re-entrada segura bajo redelivery de pg-boss.
 */
export async function finalizeGenerationByKind(
  deps: FinalizeDownloadDeps,
  args: { generation: Generation; output: unknown; statusPayload: unknown },
): Promise<FinalizeDownloadResult> {
  const { db, logger } = deps;
  const { generation } = args;

  // El `kind` VIVE en el `model_profile` (la tabla `generation` no tiene columna `kind` propia — igual
  // que el sweeper deriva su deadline por tipo). Sin perfil no se puede rutar con seguridad: se lanza
  // (permanente: un perfil inexistente no se arregla reintentando la descarga).
  const profile = await getModelProfile(db, generation.modelProfileId);
  if (profile === undefined) {
    throw new PermanentStepError(
      `finalizeGenerationByKind: la generación ${generation.id} referencia un model_profile inexistente ${generation.modelProfileId}; no se puede rutar la descarga`,
    );
  }
  const kind = profile.kind;

  if (kind === 'image' || kind === 'utility') {
    const res: FinalizeResult = await finalizeGeneration(
      { db, storage: deps.storage, downloader: deps.downloader, logger },
      { generation, output: args.output, statusPayload: args.statusPayload },
    );
    return { assetId: res.assetId, costCents: res.costCents };
  }

  // avatar/lipsync → `avatar_clip`; t2v/i2v/r2v → `broll_clip`. La derivación vive en el clasificador
  // compartido `videoAssetKindForModelKind` (@ugc/core/gallery): un solo punto de verdad con el sweeper.
  const videoAssetKind = videoAssetKindForModelKind(kind);
  if (videoAssetKind !== null) {
    const res = await finalizeVideoDownload(deps, { ...args, profile, assetKind: videoAssetKind });
    return { assetId: res.assetId, costCents: res.generation.costActual ?? 0 };
  }

  if (kind === 'music') {
    const res = await finalizeMusicDownload(deps, { ...args, profile });
    return { assetId: res.assetId, costCents: res.generation.costActual ?? 0 };
  }

  if (kind === 'tts') {
    // Un voiceover NO es liquidable por descarga: su deliverable son los `word_timestamps`, que exigen
    // la 2ª llamada fal (ASR) que este consumer no tiene. Rutarlo al finalizer de imagen/audio dejaría
    // un `tts_audio` SIN timestamps marcado `completed` — un `completed` mentiroso (N8/F5 lee las
    // generaciones `completed` esperando timestamps). Loud, no corrupción.
    throw new PermanentStepError(
      `finalizeGenerationByKind: la generación TTS ${generation.id} no puede liquidarse por output.download (necesita la cadena ASR para sellar word_timestamps); reconciliación de un TTS colgado es una vía aparte`,
    );
  }

  throw new PermanentStepError(
    `finalizeGenerationByKind: kind '${kind}' de la generación ${generation.id} sin finalizer de descarga conocido`,
  );
}

/** Recupera la duración de un clip de VÍDEO desde el output/inputs PERSISTIDOS: avatar emite `duration`
 *  en el output; broll (Veo) NO → se lee del `inputs.duration` (`"8s"`) que el servicio persistió. Cae a
 *  `generation.durationS` si ya se estampó. Devuelve `undefined` si ninguna fuente la tiene (fallo
 *  honesto: no facturar por segundo sin segundos). */
function recoverVideoDurationSeconds(
  output: ReturnType<typeof extractVideoOutput>,
  generation: Generation,
): number | undefined {
  if (output?.duration !== undefined) return output.duration;
  const fromInputs = parseInputsDurationSeconds(generation.inputs);
  if (fromInputs !== undefined) return fromInputs;
  return generation.durationS ?? undefined;
}

/** Parsea `inputs.duration` a segundos: acepta `number` (música: `30`) o el string de Veo (`"8s"`).
 *  Devuelve `undefined` si no es interpretable (el caller decide el fallo). */
function parseInputsDurationSeconds(inputs: unknown): number | undefined {
  if (inputs === null || typeof inputs !== 'object') return undefined;
  const dur = (inputs as Record<string, unknown>).duration;
  if (typeof dur === 'number' && Number.isFinite(dur)) return dur;
  if (typeof dur === 'string') {
    const n = Number.parseFloat(dur); // "8s" → 8
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Descarga el output de fal ya validado y lo persiste en nuestro storage (vídeo y música comparten esta
 *  secuencia; solo cambian la URL, el mime por defecto y la extensión). Un output sin cuerpo descargable es
 *  contract-violation determinista → `PermanentStepError` (misma razón que los callers: corre en el consumer
 *  del sweeper, fuera de `runGenerationStep`). Deja FUERA coste/kind/extractor (los deriva cada caller). */
async function downloadOutputToStorage(
  deps: FinalizeDownloadDeps,
  args: {
    generationId: string;
    url: string;
    mimeDefault: string;
    ext: string;
    contentType?: string;
  },
): Promise<{ put: Awaited<ReturnType<StorageAdapter['put']>>; storageKey: string; mime: string }> {
  const outRes = await deps.downloader.download(args.url);
  if (outRes.body === null) {
    throw new PermanentStepError(
      `downloadOutputToStorage: el output ${args.url} de la generación ${args.generationId} no trae cuerpo descargable`,
    );
  }
  const mime = args.contentType ?? args.mimeDefault;
  const storageKey = `generations/${args.generationId}/${newUlid()}.${args.ext}`;
  const put = await deps.storage.put(storageKey, outRes.body, { mime });
  return { put, storageKey, mime };
}

async function finalizeVideoDownload(
  deps: FinalizeDownloadDeps,
  args: {
    generation: Generation;
    profile: ModelProfile;
    assetKind: 'avatar_clip' | 'broll_clip';
    output: unknown;
    statusPayload: unknown;
  },
): Promise<FinalizeSingleCallPerSecondResult> {
  const { generation, profile, assetKind } = args;
  // CONTRACT-VIOLATIONS = `PermanentStepError` DIRECTO (no `FalResponseError`). Esta vía corre en el
  // CONSUMER del sweeper (`output.download`), NO en un executor N7: aquí NO hay `runGenerationStep` que
  // mapee `FalResponseError` → Permanent. Un output ya persistido sin `video`, sin duración recuperable o
  // sin cuerpo descargable es DETERMINISTA: reintentar la descarga sobre el MISMO payload malformado
  // fallaría idéntico las 5 veces de pg-boss hasta dead-letter. Lanzar Permanent directo hace que el
  // consumer lo absorba por su rama ya existente (no-op loggeado, sin reintentar) — el criterio correcto.
  const videoOut = extractVideoOutput(args.output);
  if (videoOut === null) {
    throw new PermanentStepError(
      `finalizeVideoDownload: el output de la generación ${generation.id} no trae video: ${JSON.stringify(args.output)}`,
    );
  }
  const durationSeconds = recoverVideoDurationSeconds(videoOut, generation);
  if (durationSeconds === undefined) {
    throw new PermanentStepError(
      `finalizeVideoDownload: no hay duración para ${generation.id} (ni output, ni inputs.duration, ni generation.duration_s) — no se puede facturar por segundo`,
    );
  }
  const { put, storageKey, mime } = await downloadOutputToStorage(deps, {
    generationId: generation.id,
    url: videoOut.video.url,
    mimeDefault: 'video/mp4',
    ext: 'mp4',
    ...(videoOut.video.content_type !== undefined
      ? { contentType: videoOut.video.content_type }
      : {}),
  });
  const cost = falVideoCostOf({ cost: profile.cost, durationSeconds });

  return finalizeSingleCallPerSecondGeneration(
    { db: deps.db, logger: deps.logger },
    {
      generation,
      assetKind,
      durationSeconds,
      costCents: cost.cents,
      put,
      storageKey,
      mime,
      statusPayload: args.statusPayload,
    },
  );
}

async function finalizeMusicDownload(
  deps: FinalizeDownloadDeps,
  args: {
    generation: Generation;
    profile: ModelProfile;
    output: unknown;
    statusPayload: unknown;
  },
): Promise<FinalizeSingleCallPerSecondResult> {
  const { generation, profile } = args;
  // CONTRACT-VIOLATIONS = `PermanentStepError` DIRECTO (misma razón que `finalizeVideoDownload`): esta
  // vía corre en el consumer del sweeper, fuera de `runGenerationStep`, así que NADIE mapearía un
  // `FalResponseError`. Un output persistido sin `audio`, sin duración o sin cuerpo descargable es
  // determinista → reintentar la descarga fallaría igual hasta dead-letter. Permanent directo ⇒ el
  // consumer lo absorbe (no-op loggeado, sin reintentar).
  const audioOut = extractAudioOutput(args.output);
  if (audioOut === null) {
    throw new PermanentStepError(
      `finalizeMusicDownload: el output de la generación ${generation.id} no trae audio: ${JSON.stringify(args.output)}`,
    );
  }
  // La duración de un bed es el INPUT enviado (ace-step genera exactamente lo pedido). Se recupera del
  // `inputs.duration` PERSISTIDO (número), con caída a `generation.durationS`.
  // `?? generation.durationS` da `number | null` (nunca undefined tras el `??`): un `null` es "sin
  // duración por ninguna vía" → contract-violation determinista (no facturar por segundo sin segundos).
  const durationSeconds = parseInputsDurationSeconds(generation.inputs) ?? generation.durationS;
  if (durationSeconds === null) {
    throw new PermanentStepError(
      `finalizeMusicDownload: no hay duración para ${generation.id} (ni inputs.duration ni generation.duration_s) — no se puede facturar por segundo`,
    );
  }
  // El `ext` de música depende del mime RESUELTO (`.wav`/`.mp3`), así que se resuelve aquí y se pasa al
  // helper (que lo reusa como `contentType` para no re-derivarlo).
  const resolvedMime = audioOut.audio.content_type ?? 'audio/mpeg';
  const { put, storageKey, mime } = await downloadOutputToStorage(deps, {
    generationId: generation.id,
    url: audioOut.audio.url,
    mimeDefault: 'audio/mpeg',
    ext: resolvedMime.includes('wav') ? 'wav' : 'mp3',
    contentType: resolvedMime,
  });
  const cost = falMusicCostOf({ cost: profile.cost, durationSeconds });

  // Se reusa el finalizer per-second-single-call compartido con `assetKind:'music_bed'` (mismo tail
  // bajo lock: 1 llamada → coste `seconds` → 1 asset → completed). NO se duplica el tail para música.
  return finalizeSingleCallPerSecondGeneration(
    { db: deps.db, logger: deps.logger },
    {
      generation,
      assetKind: 'music_bed',
      durationSeconds,
      costCents: cost.cents,
      put,
      storageKey,
      mime,
      statusPayload: args.statusPayload,
    },
  );
}
