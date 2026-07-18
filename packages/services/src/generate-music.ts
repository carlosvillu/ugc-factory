// Servicio de generación de BED MUSICAL IA (T4.9, §7.2 N7e): genera UN bed de música por MOOD y
// DURACIÓN con ace-step (`fal-ai/ace-step`, text-to-music). Es un audio-family de UNA sola llamada:
// no hay texto/voz/ASR (a diferencia de N7b) y la duración es un INPUT (se pide 30s), NO derivada del
// output.
//
// POR QUÉ UN SERVICIO HERMANO (`runGenerateMusic`) Y NO REUSAR `runGenerateAudio` (T4.5). El finalizer
// de N7b está FUSIONADO con la maquinaria de TTS+ASR: sella `word_timestamps` sobre el asset, exige
// COBERTURA 100% (throw si falta), factura DOS unidades de coste (TTS `1k_chars` + ASR `minute`) y
// deriva la duración del último `end` del ASR. La música NO tiene NADA de eso: un solo asset
// (`music_bed`), una sola unidad de coste (por SEGUNDO), sin timestamps, y la duración es el número que
// ENVIAMOS. Parametrizar `runGenerateAudio` por `kind` obligaría a RAMIFICAR toda esa maquinaria de
// voz — se arrancaría más de lo que se reusaría. Estructuralmente el molde MÁS cercano es
// `runGenerateBroll` (T4.8): UNA llamada fal, duración = INPUT (no output), UNA unidad de coste por
// segundo, payload por BYPASS. Se cambia video-family por audio-family (`extractAudioOutput`,
// `{audio:{url}}`, .mp3/.wav) y se queda idéntico. Decisión de altitud anotada en el informe de T4.9.
//
// DEUDA DE FINALIZER (conocida, NO se agrava aquí): el finalizer de VÍDEO bajo lock está TRIPLICADO
// entre `runGenerateAvatar`/`runGenerateBroll` y su extracción a un helper por `assetKind` es deuda
// T4.11 (l.640). Música es el PRIMER audio-family de UNA sola llamada: el finalizer de audio de N7b NO
// es reutilizable (está fusionado con el ASR), así que no hay NADA que extraer todavía — este es un
// nuevo molde de finalizer audio-single-call. Cuando nazca un SEGUNDO audio-single-call se podrá
// extraer un helper de liquidación de audio parametrizado por `assetKind` (como el de vídeo de T4.11);
// hasta entonces, se DUPLICA conscientemente el scaffold bajo lock (con su catch anti-entierro-de-causa-
// raíz, lección T1.8) igual que broll/avatar, sin copy-drift a ciegas.
//
// ⚠ T4.9 NO CABLEA ESTO AL WORKER/SWEEPER (eso es T4.11, como N7a/N7b/N7c/N7d). El sweeper de T4.3
// reconcilia CUALQUIER generación y encola `output.download`→`finalizeGeneration` (solo-imagen); una
// generación de AUDIO recogida por esa vía explotaría. Deuda T4.11 (compartida con N7b: output-
// download.ts + reconcile.ts kind-aware). Este servicio se invoca DIRECTO desde el smoke stepless y,
// en T4.11, desde el executor N7e.
import {
  computeContentHash,
  makeFalClient,
  extractAudioOutput,
  FalResponseError,
  type FalClientDeps,
  type GenerationInputs,
} from '@ugc/core/generation';
import { newUlid } from '@ugc/core/contracts';
import { isMusicModelKind } from '@ugc/core/gallery';
import type { Logger, StorageAdapter } from '@ugc/core';
import {
  createAsset,
  getAssetByGenerationKind,
  getGenerationForUpdate,
  getModelProfile,
  recordCost,
  updateGeneration,
  type DbClient,
  type Generation,
} from '@ugc/db';

import { falMusicCostOf } from './fal-pricing';
import { resolveProductionDedup } from './generation-dedup';
import { NOOP_LOGGER } from './noop-logger';

/** Un bed musical es INSTRUMENTAL: la voz la pone N7b (el bed suena DEBAJO del voiceover). ace-step usa
 *  `lyrics:"[inst]"` para "sin voces" (verificado 2026-07-17 vs fal openapi: `lyrics` default `""`,
 *  `"[inst]"` = instrumental). Si el caller no pide letra, se fuerza instrumental — nunca un bed cantado
 *  que compita con la narración. */
const INSTRUMENTAL_LYRICS = '[inst]';

export interface GenerateMusicDeps {
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

export interface GenerateMusicInput {
  /** El `model_profile` de música (ace-step), resuelto por el caller desde el recipe. Su
   *  `falEndpoint`/`cost`/`kind` se leen de BD. `kind` DEBE ser 'music'. */
  musicModelProfileId: string;
  /** El MOOD del bed como tags separadas por coma (ace-step `tags`, REQUERIDO por ace-step `min(1)`): el
   *  estilo/género del bed (`"upbeat, energetic, lofi"`). Es lo que la Verificación juzga ("el mood
   *  pedido"). REQUERIDO: ace-step no genera sin tags, y todos los callers (executor N7e vía
   *  `N7eConfigSchema.mood`, smoke vía `requireEnv('MOOD')`) siempre lo aportan. */
  mood: string;
  /** La DURACIÓN del bed EN SEGUNDOS (ace-step `duration`, rango 5–240s, default 60). Es un INPUT (se
   *  pide 30s), NO derivada del output. Gobierna el payload, el coste POR SEGUNDO y `asset.duration_s`. */
  durationSeconds: number;
  /** Letra opcional (ace-step `lyrics`). OMITIDA → `"[inst]"` (bed instrumental bajo la voz). Un caller
   *  que quiera un jingle cantado la pasa explícita; N7e de producción no lo hace (§14: el bed va bajo
   *  el voiceover). */
  lyrics?: string;
  /** El step que originó el gasto (T4.11): atribuye el `cost_entry`. OPCIONAL (stepless → NULL). */
  stepRunId?: string;
}

export interface GenerateMusicResult {
  /** La fila `generation` del bed (completed). */
  generation: Generation;
  /** El asset del bed (kind='music_bed') con `duration_s`. */
  assetId: string;
  /** El coste del bed en céntimos (por segundo). 0 en un acierto de dedup. */
  costCents: number;
  /** Duración del bed en segundos (= el input enviado; ace-step genera exactamente lo pedido). */
  durationSeconds: number;
  /** `true` si el bed se REUTILIZÓ de una generación `completed` idéntica (dedup §9.6): 0 llamadas a
   *  fal, 0 `cost_entry`. `false` si esta llamada lo generó. */
  reused: boolean;
  /** Warnings observables (coste incalculable…). */
  warnings: string[];
}

/**
 * Ejecuta una generación de BED MUSICAL contra fal (ace-step) end-to-end y persiste su rastro. Devuelve
 * la fila `generation` (completed), el asset del bed (`music_bed`) y el coste. LANZA
 * (FalProviderError/FalResponseError) si algún eslabón falla — el caller (executor T4.11) mapea a
 * `generation.status='failed'`; la fila queda con el estado real, nunca un `completed` mentiroso.
 */
export async function runGenerateMusic(
  deps: GenerateMusicDeps,
  input: GenerateMusicInput,
): Promise<GenerateMusicResult> {
  const { db, storage } = deps;
  const log = deps.logger ?? NOOP_LOGGER;
  const warnings: string[] = [];

  // 1) Resolver el model_profile de música: sin modelo no hay generación.
  const profile = await getModelProfile(db, input.musicModelProfileId);
  if (profile === undefined) {
    throw new FalResponseError(
      `runGenerateMusic: model_profile ${input.musicModelProfileId} no existe`,
    );
  }
  if (!isMusicModelKind(profile.kind)) {
    throw new FalResponseError(
      `runGenerateMusic: el model_profile ${profile.falEndpoint} es kind '${profile.kind}', no un modelo de música (music)`,
    );
  }

  // 2) Construir el payload DIRECTO (BYPASS, como N7a-N7d). ace-step toma `{tags, duration, lyrics}`
  //    (schema verificado 2026-07-17 vs fal openapi): `tags` = el MOOD (comma-separated genre), `duration`
  //    = los SEGUNDOS pedidos (5–240), `lyrics` = `"[inst]"` (instrumental, la voz la pone N7b). No hay
  //    adapter de música — el mood viaja tal cual. El `tags` es también el `resolved_prompt` (la entrada
  //    semántica del bed, base del content_hash).
  const mood = input.mood;
  const lyrics = input.lyrics ?? INSTRUMENTAL_LYRICS;
  const submitInputs: GenerationInputs = {
    tags: mood,
    duration: input.durationSeconds,
    lyrics,
  };

  // 3) content_hash de dedupe (§9.6): mood + duración + lyrics + modelo lo determinan.
  const contentHash = computeContentHash({
    resolvedPrompt: mood,
    modelProfileId: input.musicModelProfileId,
    inputs: submitInputs,
  });

  // 3b–4) DEDUP (§9.6) + persistir la INTENCIÓN en `submitting` ANTES del submit: un bed `completed` idéntico
  //     (mismo mood+duración+modelo) se REUTILIZA sin fal ni `cost_entry` (0 coste, visible en /spend); si no,
  //     `resolveProductionDedup` inserta la fila viva (dedup atómico vía índice único parcial) o —tras perder
  //     la carrera— re-lee o lanza para reintentar. Así dos beds idénticos concurrentes NO submitean ambos.
  const dedup = await resolveProductionDedup(db, {
    contentHash,
    assetKind: 'music_bed',
    serviceLabel: 'runGenerateMusic',
    assetLabel: 'un bed',
    insertValues: {
      modelProfileId: input.musicModelProfileId,
      stepRunId: input.stepRunId,
      resolvedPrompt: mood,
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
    // 5) SUBMIT → `submitted` (URLs PERSISTIDAS tal cual) → POLL hasta completed.
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

    // 6) Validar el output de AUDIO (`{audio:{url}}`, espeja N7b — ace-step devuelve `{audio:{url}, seed,
    //    tags, lyrics}`, verificado vs fal openapi). Un output sin `audio` es `FalResponseError` (se pagó
    //    pero el contrato no se cumplió — barrera anti-finalizer-de-imagen).
    const audioOut = extractAudioOutput(polled.output);
    if (audioOut === null) {
      throw new FalResponseError(
        `runGenerateMusic: el output del bed ${generation.id} no trae audio: ${JSON.stringify(polled.output)}`,
      );
    }

    // 7) DURACIÓN = el input enviado (ace-step genera EXACTAMENTE los segundos pedidos; su output
    //    `{audio:{url}}` no re-cuantiza). Insumo de `asset.duration_s` y del coste POR SEGUNDO. Es el
    //    MISMO número que fue al payload — facturar/persistir otro desincronizaría el ledger.
    const durationSeconds = input.durationSeconds;

    // 8) DESCARGAR el audio a NUESTRO storage (fuera de la tx: I/O de red). ace-step emite .mp3 o .wav.
    const outRes = await fal.download(audioOut.audio.url);
    if (outRes.body === null) {
      throw new FalResponseError(
        `runGenerateMusic: el output ${audioOut.audio.url} no trae cuerpo descargable`,
      );
    }
    const mime = audioOut.audio.content_type ?? 'audio/mpeg';
    const ext = mime.includes('wav') ? 'wav' : 'mp3';
    const storageKey = `generations/${generation.id}/${newUlid()}.${ext}`;
    const put = await storage.put(storageKey, outRes.body, { mime });

    // 9) COSTE del bed (por SEGUNDO). Una sola unidad de gasto (una llamada fal).
    const cost = falMusicCostOf({ cost: profile.cost, durationSeconds });
    if (cost.warning !== null) warnings.push(cost.warning);

    // 10) LIQUIDACIÓN en UNA tx BAJO EL LOCK DE FILA (misma barrera anti-doble-cobro que
    //     `finalizeGeneration`/`runGenerateBroll`): re-chequear `completed` bajo el lock antes de crear
    //     asset/coste/completed. Se mantiene la forma (y su GRACIA) para que T4.11 la cablee al worker
    //     (webhook+poll+sweeper) sin reintroducir doble-cobro ni corromper una fila terminal.
    const completedAt = new Date();
    const settled = await db.transaction(async (tx) => {
      const locked = await getGenerationForUpdate(tx, generation.id);
      if (locked?.status === 'completed') {
        // NO-OP GRACIOSO (como `finalizeGeneration`/`runGenerateBroll`): otra ruta ya finalizó bajo el
        // lock. NO se re-crea asset ni se re-cobra y —crítico— NO se lanza (un throw caería en el catch y
        // VOLTEARÍA a `failed` una fila legítimamente `completed`). El audio descargado queda huérfano en
        // storage (deuda menor conocida, igual que en `finalizeGeneration`).
        const existing = await getAssetByGenerationKind(tx, generation.id, 'music_bed');
        return { asset: existing ?? null, updated: locked, alreadyFinalized: true } as const;
      }
      const asset = await createAsset(tx, {
        kind: 'music_bed',
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
        // `quantity` es INTEGER en el ledger → segundos ENTEROS; `amount_cents` YA se computó desde la
        // duración por segundo (`falMusicCostOf`). La duración pedida ES entera (el caller la cuantiza),
        // así que el round es idempotente.
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
      // La rama `alreadyFinalized` no encontró el asset de audio de la ruta ganadora: invariante roto
      // (una generación `completed` de música DEBE tener su `music_bed`). Surface honesto — pero NO se
      // marca `failed` (la fila está legítimamente `completed`): se re-lanza y el catch de abajo NO la
      // degradará (su UPDATE es condicional a `!= completed`).
      throw new FalResponseError(
        `runGenerateMusic: la generación ${generation.id} está completed pero sin asset music_bed (invariante roto)`,
      );
    }

    log.info(
      {
        event: 'fal_music_generation_finalized',
        generationId: generation.id,
        assetId,
        mood,
        costCents: cost.cents,
        durationSeconds,
        alreadyFinalized: settled.alreadyFinalized,
      },
      'bed musical generado: audio descargado, coste por segundo registrado, completed',
    );

    return {
      generation: settled.updated,
      assetId,
      costCents: cost.cents,
      durationSeconds,
      reused: false,
      warnings,
    };
  } catch (err) {
    // Degradar a `failed` SOLO si la fila NO es ya terminal (`completed`): una ruta concurrente (T4.11)
    // pudo haberla completado. Mismo criterio de gracia que la rama `alreadyFinalized`.
    //
    // EL CATCH NO PUEDE ENTERRAR LA CAUSA RAÍZ (lección T1.8). Si la tx de degradación LANZA (conexión
    // caída/timeout justo en el fallo), ese error secundario NO debe propagarse en lugar de `err`: el
    // operador vería "connection terminated" en vez del fallo REAL de fal ("output sin audio"). Se
    // envuelve en su propio try/catch: el fallo del UPDATE se LOGUEA (observabilidad del daño colateral)
    // y SIEMPRE se re-lanza `err` (la causa raíz), nunca el error de la degradación.
    try {
      await db.transaction(async (tx) => {
        const locked = await getGenerationForUpdate(tx, generation.id);
        if (locked !== undefined && locked.status !== 'completed') {
          await updateGeneration(tx, generation.id, { status: 'failed', completedAt: new Date() });
        }
      });
    } catch (degradeErr) {
      log.error(
        {
          event: 'fal_music_degrade_failed',
          generationId: generation.id,
          degradeError: degradeErr instanceof Error ? degradeErr.message : String(degradeErr),
          originalError: err instanceof Error ? err.message : String(err),
        },
        'no se pudo marcar la generación de música como failed tras un fallo de fal: la fila puede quedar en un estado no terminal (reconciliable por el sweeper)',
      );
    }
    throw err;
  }
}
