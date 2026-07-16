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
import { newUlid } from '@ugc/core/contracts';
import {
  computeContentHash,
  extractImageOutput,
  makeFalClient,
  FalResponseError,
  type FalClientDeps,
  type GenerationInputs,
} from '@ugc/core/generation';
import { ModelCostSchema } from '@ugc/core/gallery';
import type { Logger, StorageAdapter } from '@ugc/core';
import {
  createAsset,
  createGeneration,
  getModelProfile,
  recordCost,
  setAssetFalUpload,
  updateGeneration,
  type DbClient,
  type Generation,
} from '@ugc/db';

import { falImageCostOf } from './fal-pricing';

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
  const costParsed = ModelCostSchema.safeParse(profile.cost);

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

  // Pasos 5-7 comparten el MISMO manejo de fallo: cualquier error (poll, validación de output,
  // descarga) deja la fila `failed` con el estado real —nunca un `completed` mentiroso— y re-lanza
  // el mismo error para que el caller (executor T4.11) decida el reintento por su tipo
  // (FalProviderError reintentable vs FalResponseError de contrato). Un solo catch en vez de
  // estampar `failed` a mano en cada punto de salida.
  let asset: Awaited<ReturnType<typeof createAsset>>;
  let output: NonNullable<ReturnType<typeof extractImageOutput>>;
  let falOutputUrl: string;
  let statusPayload: unknown;
  try {
    // 5) POLL hasta COMPLETED sobre la status_url guardada, luego lee el output de response_url.
    const polled = await fal.poll({
      statusUrl: submitted.statusUrl,
      responseUrl: submitted.responseUrl,
    });
    statusPayload = polled.statusPayload;

    // 6) Validar el output (rama de VALIDACIÓN: se pagó, pero el contrato debe cumplirse).
    const parsed = extractImageOutput(polled.output);
    if (parsed === null) {
      throw new FalResponseError(
        `runGenerate: el output de ${profile.falEndpoint} no trae images[]: ${JSON.stringify(polled.output)}`,
      );
    }
    output = parsed;
    const firstImage = output.images[0];
    if (firstImage === undefined) {
      // Imposible por el `.min(1)` del schema, pero el tipo lo permite: guard honesto en vez de `!`.
      throw new FalResponseError(
        `runGenerate: el output de ${profile.falEndpoint} no trae imágenes`,
      );
    }
    falOutputUrl = firstImage.url;

    // 7) DESCARGAR el PNG del output a NUESTRO storage (la Verificación exige "PNG en storage
    //    propio"). Es un asset NUEVO con generation_id — NO pasa por la caché de fal_url (esa es de
    //    INPUTS, §9.6). La descarga usa `fal.download`: MISMO timeout duro que submit/poll (un CDN
    //    que cuelga la conexión aborta a los `timeoutMs` en vez de bloquear DESPUÉS de haber pagado).
    const outRes = await fal.download(firstImage.url);
    if (outRes.body === null) {
      throw new FalResponseError(
        `runGenerate: el output ${firstImage.url} no trae cuerpo descargable`,
      );
    }
    const mime = firstImage.content_type ?? 'image/png';
    const ext = mime.includes('jpeg') ? 'jpg' : 'png';
    const storageKey = `generations/${generation.id}/${newUlid()}.${ext}`;
    const put = await storage.put(storageKey, outRes.body, { mime });
    asset = await createAsset(db, {
      kind: 'keyframe',
      storageKey,
      mime,
      bytes: put.bytes,
      checksum: put.checksum,
      width: firstImage.width,
      height: firstImage.height,
      generationId: generation.id,
    });
  } catch (err) {
    await updateGeneration(db, generation.id, { status: 'failed', completedAt: new Date() });
    throw err;
  }

  // 8) COSTE (record-first): céntimos = megapíxeles × precio/MP del perfil. NUNCA lanza por precio
  //    desconocido (la llamada de pago ya ocurrió) — degrada a 0 con warning, la fila se escribe.
  const cost = costParsed.success
    ? falImageCostOf({
        output,
        unit: costParsed.data.unit,
        centsPerUnit: costParsed.data.amountCents,
      })
    : {
        cents: 0,
        megapixels: 0,
        imageCount: output.images.length,
        warning: 'fal-pricing: model_profile.cost inválido',
      };
  if (cost.warning !== null) warnings.push(cost.warning);
  // `quantity` es INTEGER (nº de unidades facturadas): las IMÁGENES generadas, `unit='images'`.
  // Los megapíxeles son el INPUT del precio (fraccionario), no la unidad del ledger — vivirían
  // mal en una columna int. El importe (`amount_cents`) ya incorpora el precio por MP.
  await recordCost(db, {
    provider: 'fal',
    amountCents: cost.cents,
    quantity: cost.imageCount,
    unit: 'images',
    stepRunId: input.stepRunId,
    generationId: generation.id,
  });

  // 9) Liquidar la generación como `completed` con el coste, el payload de status y la DURACIÓN
  //    (§12 l.527: `duration_s`). Se mide desde `started_at` (estampado en el create) hasta ahora.
  const completedAt = new Date();
  const startedAt = generation.startedAt ?? completedAt;
  generation = await updateGeneration(db, generation.id, {
    status: 'completed',
    costActual: cost.cents,
    falStatusPayload: statusPayload,
    durationS: (completedAt.getTime() - startedAt.getTime()) / 1000,
    completedAt,
  });

  return {
    generation,
    assetId: asset.id,
    falOutputUrl,
    costCents: cost.cents,
    warnings,
  };
}
