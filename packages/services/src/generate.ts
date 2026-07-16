// Servicio de generación (T4.1, §9.6): la superficie INVOCABLE que ejecuta UNA generación de
// imagen contra fal end-to-end y persiste su rastro. Orquesta core (`makeFalClient` — solo red:
// submit/poll/upload; `extractImageOutput`, `computeContentHash` — CPU pura) + la capa db/storage
// (fila `generation`, caché de upload en `asset.fal_url`, descarga del PNG a nuestro storage,
// `cost_entry`). Vive en `@ugc/services`: cablea, no contiene lógica de negocio.
//
// FRONTERAS DE T4.1 (no over-build): submit + polling INLINE hasta completion — lo justo para la
// Verificación. El poller lazy + sweeper + reconciliación idempotente es T4.3; el webhook es T4.2
// (aquí `webhookUrl` es null: polling-only). La descarga del output SÍ está en alcance (la
// Verificación exige "PNG en storage propio").
//
// ORDEN DE PERSISTENCIA (§9.6, base de idempotencia de T4.3): la fila `generation` se crea en
// `submitting` ANTES del submit; tras el submit se estampa `request_id`/`status_url`/`response_url`
// (`submitted`). Un crash entre medias deja una fila reconciliable, no un job fantasma en fal.
import {
  computeContentHash,
  makeFalClient,
  FalResponseError,
  type FalClientDeps,
  type GenerationInputs,
} from '@ugc/core/generation';
import type { Logger, StorageAdapter } from '@ugc/core';
import {
  createGeneration,
  getModelProfile,
  setAssetFalUpload,
  updateGeneration,
  type DbClient,
  type Generation,
} from '@ugc/db';

import { finalizeGeneration } from './finalize-generation';

/** Logger no-op: el default cuando el caller no inyecta uno (tests que no afirman sobre logs). En
 *  producción (worker/web) se inyecta el pino estructurado con correlación. */
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

export interface GenerateDeps {
  db: DbClient;
  storage: StorageAdapter;
  /** La API key de fal EN CLARO (el caller la lee de env/secretos). */
  falKey: string;
  /** Logger estructurado (observability.md). El cache-hit/upload de fal storage se loggea aquí para
   *  que la Verificación distinga "un solo upload" leyendo logs. Default no-op. */
  logger?: Logger;
  /** `fetch` inyectable (msw en tests); default global en producción. Lo usan el SDK y el polling. */
  fetch?: typeof globalThis.fetch;
  /** Espera inyectable (tests deterministas). Se pasa al FalClient. */
  sleep?: (ms: number) => Promise<void>;
  /** Overrides del FalClient (concurrencia, timeouts, intervalos de polling). */
  falOptions?: Pick<
    FalClientDeps,
    'concurrency' | 'timeoutMs' | 'maxRetries' | 'pollIntervalMs' | 'maxPollAttempts'
  >;
}

export interface GenerateInput {
  /** El `model_profile` a invocar (NOT NULL en `generation`). Su `falEndpoint`/`cost` se leen de BD. */
  modelProfileId: string;
  /** El prompt YA resuelto (text-to-image: es el `prompt` que va a fal). */
  resolvedPrompt: string;
  /** Los inputs del modelo (image_size, num_images, refs…). Entran en `content_hash` y en el submit. */
  inputs?: GenerationInputs;
  /** El step que originó el gasto (T1.10b): atribuye `cost_entry.step_run_id`. OPCIONAL (fuera de run → NULL). */
  stepRunId?: string;
  /** La variante del lote, si aplica (T4.11). OPCIONAL. */
  variantId?: string;
  /** PROCEDENCIA del output (T4.4, N7a): marca la generación como PACKSHOT SINTÉTICO — el output
   *  es un shot del producto GENERADO por IA (ruta `ai_packshot`), no una foto real. Se persiste
   *  como columna de primera clase en `generation` (NO entra en `content_hash`: es procedencia, no
   *  dimensión de dedupe). Default `false` (la mayoría de generaciones no son packshots sintéticos). */
  syntheticProduct?: boolean;
}

export interface GenerateResult {
  generation: Generation;
  /** El asset del PNG descargado a nuestro storage (descargable por GET /api/assets/:id/download). */
  assetId: string;
  /** La URL del output en fal (efímera). */
  falOutputUrl: string;
  /** El coste en céntimos registrado en `cost_entry` (provider='fal'). */
  costCents: number;
  /** Warnings observables (precio incalculable, dimensiones ausentes…). */
  warnings: string[];
}

/** Sube un input a fal storage CON CACHÉ `(asset_id, checksum)` (§9.6). Si el asset ya tiene
 *  `fal_url` poblada, es un CACHE-HIT: se reutiliza y NO se re-sube (log estructurado 'cache-hit',
 *  `fal_uploaded_at` NO cambia — la señal observable de la Verificación). Si no, se sube, se estampa
 *  `fal_url`/`fal_uploaded_at` y se loggea 'upload'. Devuelve la fal_url y si fue upload o hit.
 *
 * NO se usa en el camino text-to-image de FLUX.2 (que no lleva refs), pero es la base del §9.6 que
 * los modelos con imagen de referencia (avatares, image-edit) consumirán — la Verificación #2 la
 * ejerce subiendo el mismo input dos veces. */
export async function uploadInputCached(
  deps: {
    db: DbClient;
    storage: StorageAdapter;
    falKey: string;
    fetch?: typeof globalThis.fetch;
    logger?: Logger;
  },
  args: { assetId: string; storageKey: string; falUrl: string | null; mime: string },
): Promise<{ falUrl: string; cacheHit: boolean }> {
  const log = deps.logger ?? NOOP_LOGGER;
  if (args.falUrl !== null && args.falUrl !== '') {
    // CACHE-HIT: el asset ya se subió a fal storage. No se re-sube; `fal_uploaded_at` no cambia.
    log.info(
      { event: 'fal_input_cache_hit', assetId: args.assetId, falUrl: args.falUrl },
      'fal storage cache-hit: input reutilizado sin re-subir',
    );
    return { falUrl: args.falUrl, cacheHit: true };
  }
  const fal = makeFalClient({
    credentials: deps.falKey,
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
  });
  const stream = await deps.storage.get(args.storageKey);
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const url = await fal.uploadInput(bytes, { mime: args.mime });
  await setAssetFalUpload(deps.db, args.assetId, url, new Date());
  log.info(
    { event: 'fal_input_upload', assetId: args.assetId, falUrl: url, bytes: bytes.byteLength },
    'fal storage upload: input subido por primera vez',
  );
  return { falUrl: url, cacheHit: false };
}

/**
 * Ejecuta una generación de IMAGEN end-to-end (§9.6) y persiste su rastro. Devuelve la fila
 * `generation` completa, el asset del PNG y el coste. LANZA (FalProviderError/FalResponseError) si
 * fal falla — el caller (executor T4.11) lo mapea a `generation.status='failed'`; la fila queda con
 * el estado real, nunca un `completed` mentiroso.
 */
export async function runGenerate(
  deps: GenerateDeps,
  input: GenerateInput,
): Promise<GenerateResult> {
  const { db, storage } = deps;
  const warnings: string[] = [];
  const inputs = input.inputs ?? {};

  // 1) Resolver el model_profile: sin modelo no hay generación (model_profile_id es NOT NULL).
  const profile = await getModelProfile(db, input.modelProfileId);
  if (profile === undefined) {
    throw new FalResponseError(`runGenerate: model_profile ${input.modelProfileId} no existe`);
  }

  // 2) content_hash de dedupe (§9.6). Base para la deuda de dedup completa (F4/F5).
  const contentHash = computeContentHash({
    resolvedPrompt: input.resolvedPrompt,
    modelProfileId: input.modelProfileId,
    inputs,
  });

  // 3) Persistir la INTENCIÓN en `submitting` ANTES del submit (§9.6). La fila existe antes de
  //    llamar a fal → un crash deja rastro reconciliable (no un job facturándose sin registro).
  let generation = await createGeneration(db, {
    modelProfileId: input.modelProfileId,
    stepRunId: input.stepRunId,
    variantId: input.variantId,
    resolvedPrompt: input.resolvedPrompt,
    inputs,
    contentHash,
    // Procedencia (T4.4): se estampa en el MISMO INSERT que crea la fila (no un UPDATE suelto),
    // así la fila nace con su flag y una lectura concurrente nunca la ve a medio marcar.
    syntheticProduct: input.syntheticProduct ?? false,
    status: 'submitting',
    startedAt: new Date(),
  });

  const fal = makeFalClient({
    credentials: deps.falKey,
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    ...deps.falOptions,
  });

  // 4) SUBMIT. Las URLs devueltas se PERSISTEN (`submitted`) tal cual — nunca reconstruidas.
  const submitted = await fal.submit(profile.falEndpoint, {
    prompt: input.resolvedPrompt,
    ...inputs,
  });
  generation = await updateGeneration(db, generation.id, {
    status: 'submitted',
    falRequestId: submitted.requestId,
    statusUrl: submitted.statusUrl,
    responseUrl: submitted.responseUrl,
    falStatusPayload: submitted.raw,
  });

  // 5-9) POLL hasta COMPLETED, luego liquidar con el TAIL COMPARTIDO `finalizeGeneration` (T4.2):
  //   validar output → descargar el PNG a nuestro storage → cost_entry → completed, todo en una tx.
  //   El MISMO tail lo usa el consumer `output.download` del webhook — una sola verdad, no dos
  //   copias. `finalizeGeneration` LANZA en fallo (no se auto-marca `failed`): AQUÍ el catch mapea
  //   cualquier error (poll, validación, descarga) a `failed` con el estado real —nunca un
  //   `completed` mentiroso— y re-lanza para que el caller (executor T4.11) decida el reintento por
  //   el tipo (FalProviderError reintentable vs FalResponseError de contrato).
  try {
    const polled = await fal.poll({
      statusUrl: submitted.statusUrl,
      responseUrl: submitted.responseUrl,
    });
    const finalized = await finalizeGeneration(
      { db, storage, downloader: fal, logger: deps.logger ?? NOOP_LOGGER },
      { generation, output: polled.output, statusPayload: polled.statusPayload },
    );
    // El camino de polling (T4.1) es el ÚNICO liquidador de esta generación recién creada: NO puede
    // encontrarla ya `completed` bajo el lock (no hay webhook ni otro job compitiendo por una fila
    // que este mismo call acaba de crear). Un `assetId` null aquí (= la carrera se perdió) sería un
    // invariante roto (¿otra ruta liquidó una generación de polling?) → surface honesto, no un null silencioso.
    if (finalized.assetId === null) {
      throw new FalResponseError(
        `runGenerate: la generación ${generation.id} fue finalizada por otra ruta durante el polling (invariante roto)`,
      );
    }
    return {
      generation: finalized.generation,
      assetId: finalized.assetId,
      falOutputUrl: finalized.falOutputUrl,
      costCents: finalized.costCents,
      warnings: [...warnings, ...finalized.warnings],
    };
  } catch (err) {
    await updateGeneration(db, generation.id, { status: 'failed', completedAt: new Date() });
    throw err;
  }
}
