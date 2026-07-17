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
  type FalClient,
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
  getVoicePreviewGenerationByContentHash,
  insertVoicePreviewGenerationIfAbsent,
  recordCost,
  setAssetWordTimestamps,
  updateGeneration,
  type DbClient,
  type Generation,
  type ModelProfile,
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

// ── Scaffold TTS compartido (T4.6) ──────────────────────────────────────────────
// El submit→poll→validate audio→download del TTS es IDÉNTICO en `runGenerateAudio` (T4.5, que luego
// encadena el ASR) y en `runTtsOnly` (T4.6, preview sin ASR). En T4.5 ese scaffold era una duplicación
// consciente del de `runGenerate` (imagen); T4.6 lo COLAPSA en esta función compartida en vez de crear
// una TERCERA copia. Deliberadamente PARA ANTES de createAsset/cost/completed: los DOS finalizadores
// difieren (preview → asset+coste TTS+completed en UNA tx; N7b → coste TTS record-first, luego ASR,
// luego liquidación bajo lock) y meter createAsset aquí cambiaría la forma del fallo de ASR (asset
// huérfano en una fila `failed`) y el contrato de concurrencia que T4.11 usa — justo lo que protegen
// los controles negativos de dinero de T4.5. Así `runGenerateAudio` reusa el scaffold SIN que su
// lógica de coste/asset/completed (pasos 8–14) se toque.

/** Los hechos del audio TTS ya descargado a NUESTRO storage: lo que el finalizador (preview o N7b)
 *  necesita para crear el asset y liquidar. */
interface TtsAudioFacts {
  /** La fila `generation` avanzada a `submitted` (con request_id/urls estampados). */
  generation: Generation;
  /** La URL PÚBLICA del audio que fal emitió (la que el ASR de N7b consume — fal no lee nuestro
   *  storage). */
  falAudioUrl: string;
  /** La clave del blob en NUESTRO StorageAdapter. */
  storageKey: string;
  /** El mime del audio (`audio/wav`|`audio/mpeg`). */
  mime: string;
  /** Bytes del blob descargado. */
  bytes: number;
  /** Checksum sha256 del blob (del StorageAdapter). */
  checksum: string;
  /** El payload de status de fal en COMPLETED (evidencia reconciliable). */
  statusPayload: unknown;
}

/**
 * SUBMIT del TTS → `submitted` → POLL hasta completed → validar `{audio:{url}}` → DESCARGAR a NUESTRO
 * storage. La fila `generation` DEBE existir ya (creada por el caller: `createGeneration` en N7b, la
 * inserción de caché en el preview). NO crea asset, NO registra coste, NO marca `completed` — eso lo
 * hace cada finalizador. Lanza `FalResponseError`/`FalProviderError` si algún eslabón falla (el caller
 * degrada la fila a `failed`).
 */
async function submitPollDownloadTts(
  deps: { db: DbClient; storage: StorageAdapter },
  args: {
    fal: FalClient;
    generation: Generation;
    ttsEndpoint: string;
    ttsSubmitInputs: GenerationInputs;
  },
): Promise<TtsAudioFacts> {
  const { db, storage } = deps;
  const { fal } = args;

  // SUBMIT del TTS. Las URLs devueltas se PERSISTEN (`submitted`) tal cual — nunca reconstruidas.
  const submitted = await fal.submit(args.ttsEndpoint, args.ttsSubmitInputs);
  const generation = await updateGeneration(db, args.generation.id, {
    status: 'submitted',
    falRequestId: submitted.requestId,
    statusUrl: submitted.statusUrl,
    responseUrl: submitted.responseUrl,
    falStatusPayload: submitted.raw,
  });

  // POLL del TTS hasta COMPLETED.
  const polled = await fal.poll({
    statusUrl: submitted.statusUrl,
    responseUrl: submitted.responseUrl,
  });

  // Validar el output de AUDIO (rama de validación §9.6: fal facturó, el contrato debe cumplirse).
  // `{audio:{url}}` — NO `images[]`. Un output sin `audio` es `FalResponseError`.
  const audioOut = extractAudioOutput(polled.output);
  if (audioOut === null) {
    throw new FalResponseError(
      `submitPollDownloadTts: el output del TTS ${generation.id} no trae audio: ${JSON.stringify(polled.output)}`,
    );
  }

  // DESCARGAR el .wav a NUESTRO storage (fuera de la tx: I/O de red).
  const outRes = await fal.download(audioOut.audio.url);
  if (outRes.body === null) {
    throw new FalResponseError(
      `submitPollDownloadTts: el output ${audioOut.audio.url} no trae cuerpo descargable`,
    );
  }
  const mime = audioOut.audio.content_type ?? 'audio/wav';
  const ext = mime.includes('mpeg') || mime.includes('mp3') ? 'mp3' : 'wav';
  const storageKey = `generations/${generation.id}/${newUlid()}.${ext}`;
  const put = await storage.put(storageKey, outRes.body, { mime });

  return {
    generation,
    falAudioUrl: audioOut.audio.url,
    storageKey,
    mime,
    bytes: put.bytes,
    checksum: put.checksum,
    statusPayload: polled.statusPayload,
  };
}

// ── Preview de voz (T4.6, §8.3): TTS-only cacheado, SIN ASR ─────────────────────

/** El texto de MUESTRA fijo por idioma que el preview sintetiza (§8.3: una frase corta gratis para
 *  escuchar la voz antes de gastar render). Es parte de la CLAVE DE CACHÉ (junto a voz+modelo): dos
 *  previews de la misma voz+idioma comparten hash y por tanto muestra. Frases neutras, no promocionales
 *  (la muestra ilustra timbre/idioma, no un guion). */
const VOICE_SAMPLE_TEXT: Readonly<Record<string, string>> = {
  es: 'Hola, así suena esta voz para tus anuncios.',
  en: 'Hi there, this is how this voice sounds for your ads.',
};

/** El texto de muestra para un idioma; cae al inglés si el idioma no tiene frase propia (el preview
 *  nunca debe quedarse sin texto que sintetizar — eso quemaría dinero leyendo vacío). */
export function voiceSampleText(language: string): string {
  return VOICE_SAMPLE_TEXT[language] ?? VOICE_SAMPLE_TEXT.en ?? '';
}

export interface VoicePreviewDeps {
  db: DbClient;
  storage: StorageAdapter;
  /** La API key de fal, resuelta PEREZOSAMENTE: solo se llama en el CACHE-MISS, justo antes de
   *  `makeFalClient` — así una reproducción cacheada (la ruta caliente «N plays, 0 coste») no paga la
   *  lectura+descifrado del secreto, y un fallo de key solo aflora cuando de verdad se va a gastar. */
  falKey: () => Promise<string>;
  logger?: Logger;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  falOptions?: Pick<
    FalClientDeps,
    'concurrency' | 'timeoutMs' | 'maxRetries' | 'pollIntervalMs' | 'maxPollAttempts'
  >;
}

export interface VoicePreviewInput {
  /** El `model_profile` del TTS a invocar (resuelto por el caller desde el provider del voice_map:
   *  elevenlabs→turbo, kokoro→kokoro). Su `falEndpoint`/`cost` se leen aquí. */
  ttsProfile: ModelProfile;
  /** Los inputs del TTS (voice, speed) YA resueltos y validados (`resolveVoiceStep`). El texto de
   *  muestra se añade aquí (campo derivado del proveedor). */
  ttsInputs: GenerationInputs;
  /** El idioma de la variante (§8.3: la muestra se reproduce en el idioma de la variante). Elige el
   *  texto de muestra y entra en la clave de caché. */
  language: string;
}

export interface VoicePreviewResult {
  /** El asset de audio (`kind='tts_audio'`) a reproducir: el `<audio src>` apunta a
   *  `/api/assets/${assetId}/download`. */
  assetId: string;
  /** `true` si la muestra se REUTILIZÓ de la caché (0 coste, 0 llamadas a fal): lo observable de la
   *  garantía "N reproducciones, 0 coste". `false` si esta llamada la generó. */
  cached: boolean;
  /** El coste del TTS en céntimos (0 en un cache-hit). */
  costCents: number;
}

/**
 * CACHE-HIT (sin lock): una muestra `voice_preview` previa `completed` con ese `content_hash` y su
 * asset `tts_audio` → el resultado reutilizable (0 coste). `undefined` si no hay caché usable (no hay
 * fila, no está `completed`, o —invariante roto— está `completed` sin asset). El caller decide qué
 * hacer con `undefined` (el fast path continúa a generar; el re-read tras conflicto lanza). NO usa
 * `FOR UPDATE`: es el lookup optimista de la ruta caliente; el re-check anti-doble-liquidación bajo
 * lock es OTRO camino (en la tx de liquidación).
 */
async function lookupCachedPreview(
  db: DbClient,
  contentHash: string,
): Promise<VoicePreviewResult | undefined> {
  const cachedGen = await getVoicePreviewGenerationByContentHash(db, contentHash);
  if (cachedGen?.status !== 'completed') return undefined;
  const asset = await getAssetByGenerationKind(db, cachedGen.id, 'tts_audio');
  if (asset === undefined) return undefined;
  return { assetId: asset.id, cached: true, costCents: 0 };
}

/**
 * Genera (o reutiliza de caché) una MUESTRA DE VOZ para el botón ▶ de CP2/CP3 (§8.3): TTS-only, SIN
 * ASR (un preview no necesita timestamps, y encadenar el ASR pagaría una 2ª llamada y arriesgaría el
 * throw de cobertura de `runGenerateAudio` por cero beneficio).
 *
 * CACHÉ SCOPED (patrón `url_analysis`): el `content_hash` = voz+modelo+texto de muestra fijo. Si ya
 * existe una generación `voice_preview=true` `completed` con ese hash, se devuelve su asset SIN tocar
 * fal ni el ledger. Si no, se INSERTA la intención con `ON CONFLICT DO NOTHING` (dos clicks
 * concurrentes → una sola generación), se sintetiza, y se liquida (asset + cost_entry + completed) en
 * una tx. Así reproducir la muestra N veces NO añade coste (comprobado en `/spend`).
 */
export async function runTtsOnly(
  deps: VoicePreviewDeps,
  input: VoicePreviewInput,
): Promise<VoicePreviewResult> {
  const { db, storage } = deps;
  const log = deps.logger ?? NOOP_LOGGER;
  const { ttsProfile } = input;

  // La muestra va en el campo de texto del TTS, cuyo NOMBRE depende del proveedor (kokoro:`prompt`,
  // elevenlabs:`text`). Los inputs de voz/velocidad viajan aparte (ya resueltos por el caller).
  const sampleText = voiceSampleText(input.language);
  const textField = ttsTextField(ttsProfile.falEndpoint);
  const ttsSubmitInputs = { ...input.ttsInputs, [textField]: sampleText };

  // content_hash de la caché: voz+modelo+texto de muestra. Mismo cálculo que la generación real, así
  // que la clave es determinista y comparable. `resolvedPrompt` es el texto de muestra.
  const contentHash = computeContentHash({
    resolvedPrompt: sampleText,
    modelProfileId: ttsProfile.id,
    inputs: ttsSubmitInputs,
  });

  // 1) CACHE-HIT rápido: una muestra `completed` previa con ese hash → su asset, sin fal ni coste.
  //    Un `completed` sin asset (invariante roto) devuelve `undefined` y cae al insert de abajo: el
  //    hash colisiona → no-op → re-lee; si la fila sigue rota, el segundo intento la re-observa (no se
  //    rompe la UX del ▶ por una fila corrupta).
  const fastHit = await lookupCachedPreview(db, contentHash);
  if (fastHit !== undefined) {
    log.info(
      { event: 'voice_preview_cache_hit', assetId: fastHit.assetId },
      'preview de voz reutilizado de caché (0 coste)',
    );
    return fastHit;
  }

  // 2) CACHE-MISS: insertar la INTENCIÓN con ON CONFLICT DO NOTHING (carrera de clicks concurrentes →
  //    una sola generación). Si otra tx ganó, `created===undefined` → re-leer y usar su asset.
  const startedAt = new Date();
  const created = await insertVoicePreviewGenerationIfAbsent(db, {
    modelProfileId: ttsProfile.id,
    resolvedPrompt: sampleText,
    inputs: ttsSubmitInputs,
    contentHash,
    status: 'submitting',
    startedAt,
  });
  if (created === undefined) {
    // Otra request concurrente ya insertó (y probablemente está generando o ya generó) esta muestra.
    // Re-leer: si ya está `completed` con asset, devolver su resultado; si aún no, esta llamada NO
    // re-genera (el ganador de la carrera lo hará) — se lanza para que el cliente reintente.
    const winnerHit = await lookupCachedPreview(db, contentHash);
    if (winnerHit !== undefined) return winnerHit;
    throw new FalResponseError(
      'runTtsOnly: la muestra de voz se está generando en otra petición concurrente; reintenta',
    );
  }

  // CACHE-MISS confirmado: recién ahora se resuelve la key (perezosa) — una reproducción cacheada no
  // llega aquí, así que no paga el descifrado. La key se resuelve ANTES de cualquier `fal.submit`
  // (invariante «key antes de gastar»).
  const fal = makeFalClient({
    credentials: await deps.falKey(),
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    ...deps.falOptions,
  });

  try {
    // 3) Scaffold compartido: submit→poll→validate→download.
    const facts = await submitPollDownloadTts(
      { db, storage },
      { fal, generation: created, ttsEndpoint: ttsProfile.falEndpoint, ttsSubmitInputs },
    );

    // 4) COSTE del TTS (una sola unidad de gasto: no hay ASR). §13.1 `1k_chars`.
    const ttsCost = falTtsCostOf({ cost: ttsProfile.cost, chars: sampleText.length });

    // 5) LIQUIDACIÓN en UNA tx bajo el lock de fila (misma barrera anti-doble-cobro que
    //    `finalizeGeneration`/`runGenerateAudio`): re-chequear `completed` bajo el lock antes de crear
    //    asset/coste/completed. Bajo carrera de clicks el índice único parcial ya evitó dos
    //    generaciones; este lock protege además contra una doble liquidación de la MISMA fila.
    const completedAt = new Date();
    const settled = await db.transaction(async (tx) => {
      const locked = await getGenerationForUpdate(tx, created.id);
      if (locked?.status === 'completed') {
        // NO-OP gracioso: otra ruta ya liquidó. Devolver su asset, no re-cobrar, no lanzar.
        const existing = await getAssetByGenerationKind(tx, created.id, 'tts_audio');
        return { assetId: existing?.id ?? null, cached: true } as const;
      }
      const asset = await createAsset(tx, {
        kind: 'tts_audio',
        storageKey: facts.storageKey,
        mime: facts.mime,
        bytes: facts.bytes,
        checksum: facts.checksum,
        generationId: created.id,
      });
      await recordCost(tx, {
        provider: 'fal',
        amountCents: ttsCost.cents,
        quantity: ttsCost.chars,
        unit: 'chars',
        generationId: created.id,
      });
      await updateGeneration(tx, created.id, {
        status: 'completed',
        costActual: ttsCost.cents,
        falStatusPayload: facts.statusPayload,
        completedAt,
      });
      return { assetId: asset.id, cached: false } as const;
    });

    if (settled.assetId === null) {
      throw new FalResponseError(
        `runTtsOnly: la muestra ${created.id} está completed pero sin asset tts_audio (invariante roto)`,
      );
    }

    log.info(
      {
        event: 'voice_preview_generated',
        generationId: created.id,
        assetId: settled.assetId,
        ttsCostCents: settled.cached ? 0 : ttsCost.cents,
      },
      'preview de voz generado (TTS-only, sin ASR)',
    );

    return {
      assetId: settled.assetId,
      cached: settled.cached,
      costCents: settled.cached ? 0 : ttsCost.cents,
    };
  } catch (err) {
    // Degradar a `failed` SOLO si la fila NO es ya terminal (mismo criterio de gracia que
    // `runGenerateAudio`): una ruta concurrente pudo haberla completado legítimamente.
    await db.transaction(async (tx) => {
      const locked = await getGenerationForUpdate(tx, created.id);
      if (locked !== undefined && locked.status !== 'completed') {
        await updateGeneration(tx, created.id, { status: 'failed', completedAt: new Date() });
      }
    });
    throw err;
  }
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
    // 4–7) SCAFFOLD TTS COMPARTIDO (T4.6): submit→`submitted`→poll→validar audio→descargar a nuestro
    //       storage. Extraído de T4.5 y compartido con `runTtsOnly` (preview) — colapsa la duplicación
    //       en vez de una 3ª copia. La fila avanzada, la URL pública del audio (para el ASR) y los
    //       hechos del blob descargado vuelven en `facts`. Los pasos 8–14 (coste TTS record-first, ASR,
    //       liquidación bajo lock) NO se tocan — su lógica de dinero es la que protegen los controles
    //       negativos de T4.5.
    const facts = await submitPollDownloadTts(
      { db, storage },
      { fal, generation, ttsEndpoint: ttsProfile.falEndpoint, ttsSubmitInputs },
    );
    generation = facts.generation;
    const storageKey = facts.storageKey;
    const mime = facts.mime;
    const put = { bytes: facts.bytes, checksum: facts.checksum };

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
      audio_url: facts.falAudioUrl,
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
        falStatusPayload: facts.statusPayload,
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
