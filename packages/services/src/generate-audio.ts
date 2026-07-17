// Servicio de generación de AUDIO (T4.5, §7.2 N7b + §13.1): ejecuta la CADENA DE 2 LLAMADAS fal que
// produce un voiceover con word timestamps end-to-end y persiste su rastro.
//
//   TTS (kokoro / elevenlabs-turbo / eleven-v3, por tier)  →  audio .wav en NUESTRO storage
//   ASR (fal-ai/elevenlabs/speech-to-text)                 →  word timestamps SELLADOS en ESE asset
//
// POR QUÉ UN SERVICIO NUEVO Y NO `runGenerate`. El tail de `runGenerate` ES `finalizeGeneration`, que
// es SOLO-IMAGEN (`extractImageOutput` + `createAsset kind:'keyframe'`). Reusar `runGenerate` para
// audio haría que `extractImageOutput` reventara con el output `{audio:{url}}` de un TTS. Y
// `finalizeGeneration` es el liquidador COMPARTIDO por 4 callers concurrentes (webhook + poll +
// sweeper + redelivery) con `SELECT … FOR UPDATE` — su blast radius es enorme. Así que aquí se
// DUPLICA el scaffold submit+poll de `runGenerate` (~15 líneas: crear intención `submitting` →
// submit → `submitted` → poll hasta completed) y se llama a un finalizer de AUDIO distinto. El
// scaffold es corto y estable; duplicarlo mantiene `finalizeGeneration` intacto, que es la invariante
// que de verdad importa (decisión de altitud anotada en el informe de T4.5).
//
// DOS UNIDADES DE GASTO INDEPENDIENTES, DOS MOMENTOS DE REGISTRO (record-first): la cadena factura el
// TTS (`1k_chars`) y el ASR (`minute`) en llamadas fal SEPARADAS. Cada `cost_entry` se persiste tras SU
// llamada, NO atado al éxito de la cadena entera: el del TTS en cuanto fal lo completa y su audio está
// descargado (paso 8), el del ASR en la liquidación (paso 14). Así un fallo del ASR (2ª llamada de red
// REAL) nunca borra el registro del gasto YA hecho del TTS. El ASR devuelve JSON (no un fichero) → NO
// es un asset propio: sus timestamps se SELLAN sobre el MISMO asset del audio TTS.
//
// `completed` ⟺ DELIVERABLE COMPLETO (audio + timestamps sellados). La generación NO se marca
// `completed` tras el TTS: un voiceover sin timestamps no es usable (N8/F5 lee las generaciones
// `completed` esperando timestamps para el subtitulado). Un fallo del ASR deja la fila `failed` con el
// `cost_entry` del TTS visible — gasto honesto, estado honesto, nunca un `completed` mentiroso.
//
// ⚠ T4.5 NO CABLEA ESTO AL WORKER/SWEEPER (eso es T4.11). El sweeper de T4.3 reconcilia CUALQUIER
// generación reconciliable y encola `output.download` → `finalizeGeneration` (solo-imagen); una
// generación de AUDIO recogida por esa vía explotaría. Marcado como deuda T4.11 en dos sitios
// (output-download.ts + reconcile.ts). Este servicio se invoca DIRECTO desde el smoke stepless y,
// en T4.11, desde el executor N7b tras hacer la vía del sweeper kind-aware.
import {
  computeContentHash,
  makeFalClient,
  extractAudioOutput,
  extractWordTimestamps,
  computeWordCoverage,
  deriveDurationSeconds,
  FalResponseError,
  type FalClientDeps,
  type GenerationInputs,
} from '@ugc/core/generation';
import { newUlid } from '@ugc/core/contracts';
import type { Logger, StorageAdapter } from '@ugc/core';
import {
  createAsset,
  createGeneration,
  getAssetByGenerationKind,
  getGenerationForUpdate,
  getModelProfile,
  recordCost,
  setAssetWordTimestamps,
  updateGeneration,
  type DbClient,
  type Generation,
} from '@ugc/db';

import { falTtsCostOf, falAsrCostOf } from './fal-pricing';

/** El nombre del campo DE TEXTO en el submit del TTS: NO es el mismo entre proveedores (verificado en
 *  vivo 2026-07-16 contra los openapi de fal): kokoro lo llama `prompt`, elevenlabs lo llama `text`.
 *  Mandar `prompt` a elevenlabs (o al revés) sintetiza el DEFAULT del modelo (voz "Rachel" leyendo un
 *  texto vacío) y quema dinero sin la narración — un bug silencioso. Se deriva del endpoint del perfil,
 *  la clave natural del catálogo. */
function ttsTextField(falEndpoint: string): 'prompt' | 'text' {
  return falEndpoint.startsWith('fal-ai/elevenlabs/') ? 'text' : 'prompt';
}

/** Logger no-op (mismo patrón que `generate.ts`). */
const noop = (): void => {
  /* noop */
};
const NOOP_LOGGER: Logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  child: () => NOOP_LOGGER,
};

export interface GenerateAudioDeps {
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

export interface GenerateAudioInput {
  /** El `model_profile` del TTS a invocar (kokoro/turbo/eleven-v3), resuelto por el caller desde el
   *  recipe + voice_map. NOT NULL en `generation`. Su `falEndpoint`/`cost` se leen de BD. */
  ttsModelProfileId: string;
  /** El `model_profile` del ASR (`fal-ai/elevenlabs/speech-to-text`), resuelto por el caller (para su
   *  `cost` por minuto). */
  asrModelProfileId: string;
  /** El texto A SINTETIZAR: `scene.narration` de la fila `ad_script` REAL (path de producción, no un
   *  texto de config). Es el `prompt` que va al TTS y el insumo del coste por `1k_chars`. */
  narration: string;
  /** Los inputs del TTS (voice, speed, …). Provienen de la resolución voice_map+tier del caller. Van
   *  DIRECTO al submit (no hay adapter de TTS) y entran en `content_hash`. */
  ttsInputs: GenerationInputs;
  /** El código de idioma del guion (`ad_script.language`), mapeado a `language_code` del ASR (`eng`,
   *  `spa`, …) por el caller. OPCIONAL: si se omite, el ASR autodetecta. */
  asrLanguageCode?: string;
  /** El step que originó el gasto (T4.11): atribuye ambos `cost_entry`. OPCIONAL (stepless → NULL). */
  stepRunId?: string;
}

export interface GenerateAudioResult {
  /** La fila `generation` del TTS (completed). */
  generation: Generation;
  /** El asset del audio (kind='tts_audio') con `word_timestamps` sellados. */
  assetId: string;
  /** El coste del TTS en céntimos (cost_entry #1). */
  ttsCostCents: number;
  /** El coste del ASR en céntimos (cost_entry #2). */
  asrCostCents: number;
  /** Duración del voiceover en segundos (derivada del último `end` del ASR). */
  durationSeconds: number;
  /** Nº de palabras (`type:'word'`) del ASR con tiempos válidos (== total → cobertura 100%). */
  wordCount: number;
  /** Warnings observables (coste incalculable, cobertura parcial…). */
  warnings: string[];
}

/**
 * Ejecuta la cadena TTS→ASR de N7b end-to-end para UNA escena y persiste su rastro. Devuelve la fila
 * `generation` del TTS, el asset del audio con timestamps sellados, y los DOS costes. LANZA
 * (FalProviderError/FalResponseError) si cualquier eslabón falla — el caller (executor T4.11) mapea a
 * `generation.status='failed'`.
 */
export async function runGenerateAudio(
  deps: GenerateAudioDeps,
  input: GenerateAudioInput,
): Promise<GenerateAudioResult> {
  const { db, storage } = deps;
  const log = deps.logger ?? NOOP_LOGGER;
  const warnings: string[] = [];

  // 1) Resolver los DOS model_profiles (TTS + ASR): sin modelo no hay generación. Los IDs se conocen
  //    de antemano y no dependen entre sí → en PARALELO (esto corre 1×/escena en el bucle de N7b).
  const [ttsProfile, asrProfile] = await Promise.all([
    getModelProfile(db, input.ttsModelProfileId),
    getModelProfile(db, input.asrModelProfileId),
  ]);
  if (ttsProfile === undefined) {
    throw new FalResponseError(
      `runGenerateAudio: model_profile TTS ${input.ttsModelProfileId} no existe`,
    );
  }
  if (asrProfile === undefined) {
    throw new FalResponseError(
      `runGenerateAudio: model_profile ASR ${input.asrModelProfileId} no existe`,
    );
  }

  // La narración va en el campo de texto del TTS, cuyo NOMBRE depende del proveedor (kokoro:`prompt`,
  // elevenlabs:`text` — verificado en vivo). Los inputs de voz/velocidad viajan aparte.
  const textField = ttsTextField(ttsProfile.falEndpoint);
  const ttsSubmitInputs = { ...input.ttsInputs, [textField]: input.narration };

  // 2) content_hash de dedupe (§9.6): mismo cálculo que la imagen. La narración + voz + modelo lo
  //    determinan. Base de la dedup futura (F5).
  const contentHash = computeContentHash({
    resolvedPrompt: input.narration,
    modelProfileId: input.ttsModelProfileId,
    inputs: ttsSubmitInputs,
  });

  // 3) Persistir la INTENCIÓN en `submitting` ANTES del submit (§9.6). El `resolved_prompt` es la
  //    narración; `inputs` guarda voz/velocidad + prompt (evidencia reconciliable).
  const startedAt = new Date();
  let generation = await createGeneration(db, {
    modelProfileId: input.ttsModelProfileId,
    stepRunId: input.stepRunId,
    resolvedPrompt: input.narration,
    inputs: ttsSubmitInputs,
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
    // 4) SUBMIT del TTS. Las URLs devueltas se PERSISTEN (`submitted`) tal cual — nunca reconstruidas.
    const submitted = await fal.submit(ttsProfile.falEndpoint, ttsSubmitInputs);
    generation = await updateGeneration(db, generation.id, {
      status: 'submitted',
      falRequestId: submitted.requestId,
      statusUrl: submitted.statusUrl,
      responseUrl: submitted.responseUrl,
      falStatusPayload: submitted.raw,
    });

    // 5) POLL del TTS hasta COMPLETED.
    const polled = await fal.poll({
      statusUrl: submitted.statusUrl,
      responseUrl: submitted.responseUrl,
    });

    // 6) Validar el output de AUDIO (rama de validación §9.6: fal facturó, el contrato debe cumplirse).
    //    `{audio:{url}}` — NO `images[]`. Un output sin `audio` es `FalResponseError`.
    const audioOut = extractAudioOutput(polled.output);
    if (audioOut === null) {
      throw new FalResponseError(
        `runGenerateAudio: el output del TTS ${generation.id} no trae audio: ${JSON.stringify(polled.output)}`,
      );
    }

    // 7) DESCARGAR el .wav a NUESTRO storage (fuera de la tx: I/O de red).
    const outRes = await fal.download(audioOut.audio.url);
    if (outRes.body === null) {
      throw new FalResponseError(
        `runGenerateAudio: el output ${audioOut.audio.url} no trae cuerpo descargable`,
      );
    }
    const mime = audioOut.audio.content_type ?? 'audio/wav';
    const ext = mime.includes('mpeg') || mime.includes('mp3') ? 'mp3' : 'wav';
    const storageKey = `generations/${generation.id}/${newUlid()}.${ext}`;
    const put = await storage.put(storageKey, outRes.body, { mime });

    // 8) COSTE DEL TTS — RECORD-FIRST, ANTES DE ARRIESGAR LA 2ª LLAMADA (ASR). El TTS es una unidad de
    //    gasto CERRADA: fal ya lo facturó y su audio está en NUESTRO storage. Si lo dejáramos atado al
    //    éxito de la cadena entera, un fallo del ASR (2ª llamada de red REAL) borraría el registro de un
    //    gasto YA hecho → gasto huérfano invisible en /spend (viola record-first: "perder el importe con
    //    warning es malo, perder la FILA es peor"). Por eso su `cost_entry` se persiste AQUÍ, como su
    //    propio write atómico, con la generación aún NO terminal (`submitted`). NO se marca `completed`
    //    todavía: `completed` ⟺ deliverable COMPLETO (audio + timestamps sellados); un voiceover sin
    //    timestamps NO es un deliverable usable (es la premisa del guard de cobertura de abajo, y N8/F5
    //    leerá las generaciones `completed` esperando timestamps). Idempotencia: esta generación
    //    recién creada tiene UN solo camino de liquidación en T4.5 (sin webhook/sweeper), así que el
    //    `cost_entry` del TTS se escribe una vez; T4.11, al cablearla al worker, debe garantizar que el
    //    tramo del TTS no re-entre (o cablear su propia barrera) — hoy no hay caller concurrente.
    const ttsCost = falTtsCostOf({ cost: ttsProfile.cost, chars: input.narration.length });
    if (ttsCost.warning !== null) warnings.push(ttsCost.warning);
    await recordCost(db, {
      provider: 'fal',
      amountCents: ttsCost.cents,
      quantity: ttsCost.chars,
      unit: 'chars',
      ...(generation.stepRunId !== null ? { stepRunId: generation.stepRunId } : {}),
      generationId: generation.id,
    });

    // 9) ASR ENCADENADO (§13.1 ruta por defecto). SEGUNDA llamada fal, sobre la URL PÚBLICA del audio
    //    que fal acaba de emitir (no la nuestra: fal no puede leer nuestro storage). Submit AL ENDPOINT
    //    DEL PERFIL ASR resuelto (NO a un literal): se factura contra `asrProfile.cost`, así que se debe
    //    llamar a `asrProfile.falEndpoint` — si el perfil se re-siembra a otro endpoint, coste y llamada
    //    siguen coherentes (la rama TTS ya lo hace así). `diarize:false`/`tag_audio_events:false`: un
    //    voiceover es un solo hablante y los eventos de audio no aportan al subtitulado. Si algo de aquí
    //    en adelante falla, el catch marca `failed` (condicional) y el `cost_entry` del TTS YA persistido
    //    NO se toca — gasto visible, estado honesto (nunca un `completed` sin timestamps).
    const asrSubmitted = await fal.submit(asrProfile.falEndpoint, {
      audio_url: audioOut.audio.url,
      diarize: false,
      tag_audio_events: false,
      ...(input.asrLanguageCode !== undefined ? { language_code: input.asrLanguageCode } : {}),
    });
    const asrPolled = await fal.poll({
      statusUrl: asrSubmitted.statusUrl,
      responseUrl: asrSubmitted.responseUrl,
    });

    // 10) Validar los word timestamps del ASR contra el shape REAL. Un output que no encaje es
    //     `FalResponseError` (se pagó el ASR pero el contrato no se cumplió).
    const wordTimestamps = extractWordTimestamps(asrPolled.output);
    if (wordTimestamps === null) {
      throw new FalResponseError(
        `runGenerateAudio: el output del ASR de ${generation.id} no encaja WordTimestampsSchema: ${JSON.stringify(asrPolled.output)}`,
      );
    }

    // 11) COBERTURA 100% (Entrega): cada palabra que el ASR emite lleva start+end válidos. Medida
    //     contra la segmentación del ASR, NO contra los tokens de la narración (drift ASR-vs-narración
    //     — el ASR re-segmenta/re-escribe). Sin cobertura total, el subtitulador de F5 no puede colocar
    //     esas palabras: es un fallo del contrato del ASR sobre este audio, no un warning silencioso.
    //     El throw ocurre ANTES de la liquidación → la generación NUNCA queda `completed` sin cobertura.
    const coverage = computeWordCoverage(wordTimestamps);
    if (!coverage.fullyCovered) {
      throw new FalResponseError(
        `runGenerateAudio: cobertura de word timestamps incompleta en ${generation.id}: ` +
          `${String(coverage.timedWordCount)}/${String(coverage.wordCount)} palabras con tiempos ` +
          `(sin tiempo: ${coverage.untimedWords.join(', ')})`,
      );
    }

    // 12) Duración del voiceover: derivada del ASR (kokoro no la emite). Insumo del `asset.duration_s`
    //     y del coste del ASR (por minuto).
    const durationSeconds = deriveDurationSeconds(wordTimestamps);

    // 13) COSTE DEL ASR (la 2ª unidad de gasto, independiente del TTS).
    const asrCost = falAsrCostOf({ cost: asrProfile.cost, durationSeconds });
    if (asrCost.warning !== null) warnings.push(asrCost.warning);

    // 14) LIQUIDACIÓN del deliverable en UNA transacción, BAJO EL LOCK DE FILA (§9.0) — misma barrera
    //     anti-doble-cobro que `finalizeGeneration`: re-chequear `completed` bajo el lock antes de
    //     escribir asset/coste-ASR/completed. En T4.5 no hay callers concurrentes, pero se mantiene la
    //     forma (y su GRACIA) para que T4.11 la cablee al worker (webhook+poll+sweeper) sin reintroducir
    //     el doble-cobro ni corromper una fila ya finalizada. Solo el coste del ASR va aquí (el del TTS
    //     ya se persistió record-first en el paso 8). `completed` se estampa SOLO aquí: audio + timestamps.
    const completedAt = new Date();
    const settled = await db.transaction(async (tx) => {
      const locked = await getGenerationForUpdate(tx, generation.id);
      if (locked?.status === 'completed') {
        // NO-OP GRACIOSO (como `finalizeGeneration`): otra ruta ya finalizó esta generación bajo el
        // lock. NO se re-crea asset ni se re-cobra el ASR, y —crítico— NO se lanza (un throw caería en
        // el catch y VOLTEARÍA a `failed` una fila legítimamente `completed`). Se devuelve el asset de
        // audio que ESA ruta creó. El blob que ESTA llamada descargó queda huérfano en storage (deuda
        // menor conocida, igual que en `finalizeGeneration`).
        const existing = await getAssetByGenerationKind(tx, generation.id, 'tts_audio');
        return { asset: existing ?? null, updated: locked, alreadyFinalized: true } as const;
      }
      const asset = await createAsset(tx, {
        kind: 'tts_audio',
        storageKey,
        mime,
        bytes: put.bytes,
        checksum: put.checksum,
        durationS: durationSeconds,
        generationId: generation.id,
      });
      // SELLAR los word timestamps del ASR sobre ESTE asset (el ASR no es un asset propio).
      await setAssetWordTimestamps(tx, asset.id, wordTimestamps);
      // cost_entry #2: ASR. MISMA `generation_id` (el ASR es un eslabón de esta generación), unidad
      // distinta al TTS → dos filas de coste distinguibles por `unit`. `quantity` es INTEGER en el
      // ledger, así que la VERDAD granular se guarda en SEGUNDOS ENTEROS (redondeados) —no en minutos
      // fraccionarios, que no caben— con `unit='seconds'`; el `amount_cents` YA se computó desde la
      // duración EXACTA por minuto (`falAsrCostOf`), el `quantity` es solo el rastro granular recuperable.
      await recordCost(tx, {
        provider: 'fal',
        amountCents: asrCost.cents,
        quantity: Math.round(durationSeconds),
        unit: 'seconds',
        ...(generation.stepRunId !== null ? { stepRunId: generation.stepRunId } : {}),
        generationId: generation.id,
      });
      const updated = await updateGeneration(tx, generation.id, {
        status: 'completed',
        // El TOTAL del deliverable (TTS + ASR): el cost_entry del TTS ya está en el ledger; `costActual`
        // refleja el gasto completo de la generación.
        costActual: ttsCost.cents + asrCost.cents,
        falStatusPayload: polled.statusPayload,
        durationS: durationSeconds,
        completedAt,
      });
      return { asset, updated, alreadyFinalized: false } as const;
    });

    const assetId = settled.asset?.id ?? null;
    if (assetId === null) {
      // La rama `alreadyFinalized` no encontró el asset de audio de la ruta ganadora: invariante roto
      // (una generación `completed` de voiceover DEBE tener su `tts_audio`). Surface honesto — pero NO
      // se marca `failed` (la fila está legítimamente `completed`): se re-lanza para que el caller lo
      // vea, y el catch de abajo NO la degradará porque su UPDATE es condicional a `!= completed`.
      throw new FalResponseError(
        `runGenerateAudio: la generación ${generation.id} está completed pero sin asset tts_audio (invariante roto)`,
      );
    }

    log.info(
      {
        event: 'fal_audio_generation_finalized',
        generationId: generation.id,
        assetId,
        ttsCostCents: ttsCost.cents,
        asrCostCents: asrCost.cents,
        durationSeconds,
        wordCount: coverage.wordCount,
        alreadyFinalized: settled.alreadyFinalized,
      },
      'voiceover generado: TTS descargado, ASR sellado, cobertura 100%, completed',
    );

    return {
      generation: settled.updated,
      assetId,
      ttsCostCents: ttsCost.cents,
      asrCostCents: asrCost.cents,
      durationSeconds,
      wordCount: coverage.wordCount,
      warnings,
    };
  } catch (err) {
    // Degradar a `failed` SOLO si la fila NO es ya terminal (`completed`). Bajo el lock: una ruta
    // concurrente (T4.11) pudo haberla llevado a `completed` legítimamente mientras esta corría — un
    // `failed` incondicional pisaría ese estado válido (su asset + sus 2 cost_entries). Mismo criterio
    // de gracia que la rama `alreadyFinalized`. En T4.5 (sin concurrencia) la fila siempre está
    // `submitted`/`in_progress` aquí, así que el UPDATE muerde; en T4.11 protege el `completed` ajeno.
    await db.transaction(async (tx) => {
      const locked = await getGenerationForUpdate(tx, generation.id);
      if (locked !== undefined && locked.status !== 'completed') {
        await updateGeneration(tx, generation.id, { status: 'failed', completedAt: new Date() });
      }
    });
    throw err;
  }
}
