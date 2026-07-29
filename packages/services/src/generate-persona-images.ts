// Servicio de GENERACIÓN IA DE IMÁGENES DE REFERENCIA de una Persona (T4.12 pase B, §11 identity lock).
// Produce 2–3 reference-images del MISMO sujeto en encuadres distintos, ≥2K, con curación manual (las
// sube a la persona; el usuario descarta las que no valgan por el CRUD existente).
//
// EL MECANISMO (decidido y validado con probes de fal real, journal 2026-07-19 — NO re-litigar):
//   1. RETRATO BASE con FLUX.2 t2i (`buildPersonaPortraitPrompt`, core): la cara del sujeto. `image_size`
//      CUSTOM `{width:1216, height:2160}` (NO el preset portrait_16_9, que da 576×1024): el base debe ser
//      ≥2K para no perder densidad de cara. Es INTERMEDIO — se sube a fal storage y alimenta NB2; NO se
//      persiste como reference_image.
//   2. Cada ENCUADRE con `fal-ai/nano-banana-2/edit` (NB2): `{prompt, image_urls:[baseFalUrl],
//      resolution:"2K", aspect_ratio:"9:16"}`. El prompt describe SOLO el encuadre (la cara la carga la
//      referencia; re-describirla rompe el lock). `resolution`/`aspect_ratio` NO los plumbea el adapter
//      `image-edit` → BYPASS del adapter (submit a mano, patrón avatar/broll). Da ~1536×2752 (≥2K ✓).
//
// DEFENSA ≥2K OBLIGATORIA: se llama `validateReferenceImage(bytes)` sobre CADA output de NB2 ANTES de
// createAsset/addReferenceImage — el MISMO guard que el upload manual/seed. Si NB2 devolviera <2048, lanza
// (nunca se persiste una referencia que la UI rechazaría; principio 9 de testing).
//
// SIN CACHÉ / SEEDLESS (decisión del brief): el botón se llama «Generar variación» → cada click debe dar
// output FRESCO. NO se calcula content_hash (contentHash=null → las filas de persona NO participan del
// dedup de producción, NULLs distintos en el índice único parcial) y NO se manda `seed` en el payload de
// fal. Esto último es CRÍTICO para el E2E: el fal fake designa como «fallo determinista» (doom) el primer
// submit de imagen que lleva `seed` (f4-generation.spec); un submit seedless NUNCA es doom-elegible, así
// que coexiste sin robarle su fallo. La frescura la garantiza el retrato base: se REGENERA por invocación
// (no se cachea) → su fal-url es nueva → cada encuadre NB2 recibe una entrada distinta.
//
// POR QUÉ UN FINALIZER PROPIO. `finalizeGeneration` hardcodea `kind:'keyframe'` (l.151) y el
// `finalizeSingleCallPerSecondGeneration` es `unit:'seconds'` (vídeo/audio). Una reference-image es
// `kind:'reference_image'` + `unit:'images'`. Se liquida aquí con el patrón anti-doble-cobro de
// `finalizeGeneration` (tx + FOR UPDATE + recover-on-null), y ADEMÁS createAsset + addReferenceImage +
// completed van en UNA sola tx: un fallo a media no puede dejar un asset huérfano sin referencia (mejora
// sobre el bucle no-transaccional del seed).
import {
  extractImageOutput,
  extractImageUrlOutput,
  makeFalClient,
  FalResponseError,
  type FalClientDeps,
  type GenerationInputs,
} from '@ugc/core/generation';
import { newUlid } from '@ugc/core/contracts';
import { ModelCostSchema } from '@ugc/core/gallery';
import { buildPersonaPortraitPrompt, REFERENCE_FRAMINGS } from '@ugc/core/persona';
import {
  NORMALIZED_REFERENCE_MIME,
  normalizeReferenceImage,
  validateReferenceImage,
} from '@ugc/core/persona/server';
import type { Logger, StorageAdapter } from '@ugc/core';
import {
  addReferenceImage,
  createAsset,
  createGeneration,
  getGenerationForUpdate,
  getModelProfileByEndpoint,
  getPersona,
  recordCost,
  updateGeneration,
  type DbClient,
  type ModelProfile,
} from '@ugc/db';

import { falImageCostOf, falPerImageCostOf } from './fal-pricing';
import { degradeGenerationOnError } from './finalize-single-call-per-second';
import { NOOP_LOGGER } from './noop-logger';

/** Endpoint del text-to-image del retrato base (§13.1): `fal-ai/flux-2`. Se define localmente (NO se
 *  importa de `generate-template-test` para evitar un ciclo de módulos: el barrel re-exporta AQUÍ solo
 *  `NB2_EDIT_ENDPOINT`, y `FLUX2_ENDPOINT` sale del barrel por su definición original en
 *  generate-template-test). Este export es para los tests de este módulo (registran el handler de flux). */
export const FLUX2_ENDPOINT = 'fal-ai/flux-2';
/** Endpoint del editor de identity lock (§13.1): `fal-ai/nano-banana-2/edit` (NB2). Mantiene la cara de
 *  la referencia base con solo el prompt de framing. NO usar `nano-banana-pro/edit` (capabilities:{} sin
 *  refImages → el adapter no emitiría image_urls → lock roto). */
export const NB2_EDIT_ENDPOINT = 'fal-ai/nano-banana-2/edit';

/** `image_size` CUSTOM del retrato base FLUX.2 (probe 2026-07-19: da ~1216×2176, lado largo ≥2048). NO
 *  el preset `portrait_16_9` (576×1024, insuficiente). El base es intermedio → no persiste. */
const PERSONA_BASE_IMAGE_SIZE = { width: 1216, height: 2160 } as const;
/** `resolution` del schema REAL de NB2 (enum "0.5K"|"1K"|"2K"|"4K", default "1K"). "2K" da ~1536×2752
 *  (≥2048 ✓). NO es `image_size`. */
const NB2_RESOLUTION_2K = '2K';
/** `aspect_ratio` de NB2 para 9:16 vertical (como el anuncio y el retrato de referencia). */
const NB2_ASPECT_9_16 = '9:16';

export interface GeneratePersonaImagesDeps {
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

export interface GeneratePersonaImagesInput {
  /** La persona cuyas reference-images IA se generan. */
  personaId: string;
  /** Cuántos encuadres generar (por defecto todos los de `REFERENCE_FRAMINGS`). Acotado a
   *  `[1, REFERENCE_FRAMINGS.length]`. El botón «Generar variación» usa el default. */
  framingCount?: number;
}

/** Una reference-image IA generada (curable): su asset + dimensiones + coste. */
interface GeneratedReferenceImage {
  assetId: string;
  framingId: string;
  width: number;
  height: number;
  costCents: number;
}

export interface GeneratePersonaImagesResult {
  /** Las reference-images generadas Y añadidas a la persona, en orden de encuadre. */
  images: GeneratedReferenceImage[];
  /** Coste TOTAL en céntimos (base FLUX.2 + cada encuadre NB2). Visible en `/spend`. */
  costCents: number;
  /** Warnings observables (coste incalculable, etc.). */
  warnings: string[];
}

/** El FalClient con todas las opciones de deps. Se construye UNA vez por invocación en
 *  `runGeneratePersonaImages` y se reparte a los helpers (base + encuadres). */
function makeFal(deps: GeneratePersonaImagesDeps) {
  return makeFalClient({
    credentials: deps.falKey,
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    ...deps.falOptions,
  });
}

type Fal = ReturnType<typeof makeFal>;

/**
 * CABEZA COMÚN de los dos ejecutores (base y encuadre): submit → marcar `submitted` → poll → extraer el
 * output → descargar los bytes. La ÚNICA divergencia es el parser (`extract`: estricto para el base —que
 * factura por megapíxel y necesita las dims— vs tolerante para el encuadre —que relee las dims del
 * fichero—), que entra como callback. La `generation` la crea y liquida el CALLER (mantiene `gen.id` en
 * su scope para el catch de degradación); este helper solo cubre el tramo compartido y LANZA
 * `FalResponseError` si el output no trae imagen o cuerpo descargable.
 */
async function submitPollDownload<T extends { images: { url: string; content_type?: string }[] }>(
  fal: Fal,
  db: DbClient,
  args: {
    generationId: string;
    endpoint: string;
    prompt: string;
    inputs: GenerationInputs;
    extract: (output: unknown) => T | null;
  },
): Promise<{ output: T; bytes: Uint8Array; mime: string; statusPayload: unknown }> {
  const submitted = await fal.submit(args.endpoint, { prompt: args.prompt, ...args.inputs });
  await updateGeneration(db, args.generationId, {
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
  const output = args.extract(polled.output);
  const firstImage = output?.images[0];
  if (output === null || firstImage === undefined) {
    throw new FalResponseError(
      `generatePersonaImages: el output de ${args.generationId} no trae imagen: ${JSON.stringify(polled.output)}`,
    );
  }
  const res = await fal.download(firstImage.url);
  if (res.body === null) {
    throw new FalResponseError(
      `generatePersonaImages: el output ${firstImage.url} de ${args.generationId} no trae cuerpo descargable`,
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mime = firstImage.content_type ?? 'image/png';
  return { output, bytes, mime, statusPayload: polled.statusPayload };
}

/**
 * Genera el RETRATO BASE (FLUX.2 t2i, ≥2K) y lo sube a fal storage. Devuelve la fal-url del base (para
 * `image_urls[0]` de NB2) y el coste del base. La fila `generation` del base se liquida `completed` con su
 * `cost_entry` (money-path honesto: es una llamada de pago real). El base NO se persiste como asset de
 * persona — es intermedio. LANZA si fal falla o el output no trae imagen; el caller degrada la fila.
 */
async function generateBasePortrait(
  deps: GeneratePersonaImagesDeps,
  fal: Fal,
  args: { fluxProfile: ModelProfile; prompt: string; warnings: string[] },
): Promise<{ baseFalUrl: string; costCents: number }> {
  const { db } = deps;
  const log = deps.logger ?? NOOP_LOGGER;

  const inputs: GenerationInputs = {
    image_size: PERSONA_BASE_IMAGE_SIZE,
    num_images: 1,
  };
  // SEEDLESS y SIN content_hash (ver cabecera): fila viva reconciliable, no participa del dedup.
  const gen = await createGeneration(db, {
    modelProfileId: args.fluxProfile.id,
    resolvedPrompt: args.prompt,
    inputs,
    status: 'submitting',
    startedAt: new Date(),
  });

  try {
    // Cabeza común (submit→poll→download). Parser ESTRICTO: el base factura por megapíxel → necesita las
    // dims del output (flux-2 SÍ las emite, a diferencia de NB2).
    const { output, bytes, mime, statusPayload } = await submitPollDownload(fal, db, {
      generationId: gen.id,
      endpoint: args.fluxProfile.falEndpoint,
      prompt: args.prompt,
      inputs,
      extract: extractImageOutput,
    });

    // Subir el base a fal storage (image_urls[0] de NB2). fal no lee nuestro storage.
    const baseFalUrl = await fal.uploadInput(bytes, { mime });

    // COSTE del base (flux-2 factura por MEGAPÍXEL). Money-path honesto: el base es una llamada de pago.
    // Se valida el `cost` jsonb con `ModelCostSchema` (mismo criterio que `finalizeGeneration`): un perfil
    // sin `cost` válido degrada a 0¢ con warning, nunca lanza.
    const costParsed = ModelCostSchema.safeParse(args.fluxProfile.cost);
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
          warning: 'fal-pricing: model_profile flux-2.cost inválido o ausente (retrato base)',
        };
    if (cost.warning !== null) args.warnings.push(cost.warning);

    // Liquidar la fila del base en UNA tx bajo el lock (anti-doble-cobro). El base NO tiene asset de
    // persona; su `cost_entry` sí (gasto real). No hay carrera concurrente aquí (fila propia recién
    // creada), pero se respeta el patrón FOR UPDATE por consistencia.
    await db.transaction(async (tx) => {
      const locked = await getGenerationForUpdate(tx, gen.id);
      if (locked?.status === 'completed') return;
      await recordCost(tx, {
        provider: 'fal',
        amountCents: cost.cents,
        quantity: cost.imageCount,
        unit: 'images',
        generationId: gen.id,
      });
      await updateGeneration(tx, gen.id, {
        status: 'completed',
        costActual: cost.cents,
        falStatusPayload: statusPayload,
        completedAt: new Date(),
      });
    });

    log.info(
      { event: 'persona_base_portrait_generated', generationId: gen.id, costCents: cost.cents },
      'retrato base de persona generado y subido a fal storage',
    );
    return { baseFalUrl, costCents: cost.cents };
  } catch (err) {
    await degradeGenerationOnError(
      { db, logger: log },
      { generationId: gen.id, originalError: err, event: 'persona_base_degrade_failed' },
    );
    throw err;
  }
}

/**
 * Genera UN encuadre (NB2 edit) desde el retrato base, valida ≥2K, y lo persiste como reference-image de
 * la persona. Devuelve el asset generado. LANZA si fal falla, el output no trae imagen, o la imagen es
 * <2048 (defensa ≥2K). createAsset + recordCost + completed + addReferenceImage en UNA tx (atómico: sin
 * assets huérfanos).
 */
async function generateFraming(
  deps: GeneratePersonaImagesDeps,
  fal: Fal,
  args: {
    nb2Profile: ModelProfile;
    personaId: string;
    baseFalUrl: string;
    framing: (typeof REFERENCE_FRAMINGS)[number];
    warnings: string[];
  },
): Promise<GeneratedReferenceImage> {
  const { db, storage } = deps;
  const log = deps.logger ?? NOOP_LOGGER;

  // BYPASS del adapter `image-edit` (no plumbea resolution/aspect_ratio): submit a mano, patrón
  // avatar/broll. `image_urls:[baseFalUrl]` carga la identidad; el prompt es SOLO framing.
  const inputs: GenerationInputs = {
    image_urls: [args.baseFalUrl],
    resolution: NB2_RESOLUTION_2K,
    aspect_ratio: NB2_ASPECT_9_16,
  };
  const gen = await createGeneration(db, {
    modelProfileId: args.nb2Profile.id,
    resolvedPrompt: args.framing.prompt,
    inputs,
    status: 'submitting',
    startedAt: new Date(),
  });

  try {
    // Cabeza común (submit→poll→download). Parser TOLERANTE: NB2/edit REAL emite `width:null, height:null`
    // (nulls que el parser estricto rechaza); aquí NO facturamos por megapíxel y releemos las dims DEL
    // FICHERO abajo (`validateReferenceImage`), así que solo exigimos la URL descargable.
    const {
      output,
      bytes: rawBytes,
      statusPayload,
    } = await submitPollDownload(fal, db, {
      generationId: gen.id,
      endpoint: args.nb2Profile.falEndpoint,
      prompt: args.framing.prompt,
      inputs,
      extract: extractImageUrlOutput,
    });

    // DEFENSA ≥2K (§11) — SOBRE LOS BYTES CRUDOS: el MISMO guard que el upload manual/seed, leyendo el LADO
    // LARGO DEL FICHERO. Si NB2 devolviera <2048, lanza — nunca se persiste una referencia inválida. Va ANTES
    // de normalizar; el guard mira max(w,h), invariante a que la normalización luego transponga W/H.
    await validateReferenceImage(rawBytes);

    // NORMALIZAR para que N7c pueda DESCARGARLA (T5.19, fix del FAIL de VERIFY): NB2 devuelve PNGs de ~6 MB
    // que fal/OmniHuman NO puede descargar (`file_download_error`, 422) — este es el origen EXACTO de los
    // bytes que la 1ª entrega commiteó. Aplica orientación EXIF, recodifica a JPEG y reduce hacia 2K si hace
    // falta. Mismo invariante que el seed y el upload por CRUD: ninguna reference se persiste inconsumible.
    // Devuelve las dims REALES de salida — se persisten ESAS en la fila `asset`, no las del crudo.
    const normalized = await normalizeReferenceImage(rawBytes);

    // Guardar el fichero NORMALIZADO en NUESTRO storage (fuera de la tx: I/O de red).
    const assetId = newUlid();
    const storageKey = `personas/${args.personaId}/${assetId}.jpg`;
    const put = await storage.put(storageKey, normalized.bytes, {
      mime: NORMALIZED_REFERENCE_MIME,
    });

    // COSTE del encuadre (NB2 factura por IMAGEN, no por megapíxel).
    const cost = falPerImageCostOf({
      cost: args.nb2Profile.cost,
      imageCount: output.images.length,
    });
    if (cost.warning !== null) args.warnings.push(cost.warning);

    // ATÓMICO: asset + cost + completed + addReferenceImage en UNA tx bajo el lock. Recover-on-null como
    // finalizeGeneration (aquí no hay carrera real —fila propia—, pero se respeta el patrón).
    await db.transaction(async (tx) => {
      const locked = await getGenerationForUpdate(tx, gen.id);
      if (locked?.status === 'completed') return;
      await createAsset(tx, {
        id: assetId,
        kind: 'reference_image',
        storageKey,
        mime: NORMALIZED_REFERENCE_MIME,
        bytes: put.bytes,
        checksum: put.checksum,
        width: normalized.width,
        height: normalized.height,
        generationId: gen.id,
      });
      await recordCost(tx, {
        provider: 'fal',
        amountCents: cost.cents,
        quantity: cost.imageCount,
        unit: 'images',
        generationId: gen.id,
      });
      await updateGeneration(tx, gen.id, {
        status: 'completed',
        costActual: cost.cents,
        falStatusPayload: statusPayload,
        completedAt: new Date(),
      });
      // La referencia entra en la persona DENTRO de la misma tx: sin asset huérfano si algo falla.
      await addReferenceImage(tx, args.personaId, assetId);
    });

    log.info(
      {
        event: 'persona_reference_image_generated',
        generationId: gen.id,
        assetId,
        framingId: args.framing.id,
        width: normalized.width,
        height: normalized.height,
        costCents: cost.cents,
      },
      'reference-image IA de persona generada, validada ≥2K y añadida',
    );
    return {
      assetId,
      framingId: args.framing.id,
      width: normalized.width,
      height: normalized.height,
      costCents: cost.cents,
    };
  } catch (err) {
    await degradeGenerationOnError(
      { db, logger: log },
      { generationId: gen.id, originalError: err, event: 'persona_framing_degrade_failed' },
    );
    throw err;
  }
}

/**
 * Genera las reference-images IA de una Persona (identity lock, §11). Retrato base (FLUX.2) → subida a fal
 * → cada encuadre (NB2 edit, ≥2K validado) → persistido en la persona. Devuelve los assets generados y el
 * coste total (visible en `/spend`). LANZA `not_found` si la persona no existe, `provider_error` si falta
 * un model_profile sembrado, y propaga los fallos de fal (cada fila queda con su estado real).
 *
 * NO deduplica (cada click = output fresco: base regenerado, seedless). Los encuadres se generan
 * SECUENCIALMENTE: todos comparten el MISMO retrato base (el identity lock lo exige), y así un fallo del
 * base no arrastra gasto de NB2.
 */
export async function runGeneratePersonaImages(
  deps: GeneratePersonaImagesDeps,
  input: GeneratePersonaImagesInput,
): Promise<GeneratePersonaImagesResult> {
  const { db } = deps;
  const log = deps.logger ?? NOOP_LOGGER;
  const warnings: string[] = [];

  const [persona, fluxProfile, nb2Profile] = await Promise.all([
    getPersona(db, input.personaId),
    getModelProfileByEndpoint(db, FLUX2_ENDPOINT),
    getModelProfileByEndpoint(db, NB2_EDIT_ENDPOINT),
  ]);
  if (persona === undefined) {
    throw new FalResponseError(`runGeneratePersonaImages: la persona ${input.personaId} no existe`);
  }
  if (fluxProfile === undefined) {
    throw new FalResponseError(
      `runGeneratePersonaImages: no hay model_profile sembrado para «${FLUX2_ENDPOINT}»`,
    );
  }
  if (nb2Profile === undefined) {
    throw new FalResponseError(
      `runGeneratePersonaImages: no hay model_profile sembrado para «${NB2_EDIT_ENDPOINT}»`,
    );
  }

  // Cuántos encuadres: acotado a [1, todos].
  const requested = input.framingCount ?? REFERENCE_FRAMINGS.length;
  const framingCount = Math.max(1, Math.min(REFERENCE_FRAMINGS.length, requested));
  const framings = REFERENCE_FRAMINGS.slice(0, framingCount);

  const basePrompt = buildPersonaPortraitPrompt({
    descriptor: persona.descriptor,
    ethnicity: persona.ethnicity,
    gender: persona.gender,
    ageRange: persona.ageRange,
    style: persona.style,
    setting: persona.setting,
    wardrobeNotes: persona.wardrobeNotes,
  });

  // FalClient UNA vez por invocación (se reparte al base y a cada encuadre; comparte el limitador de
  // concurrencia y la config de reintentos, como el resto de servicios del paquete).
  const fal = makeFal(deps);

  // 1) RETRATO BASE (regenerado por invocación → frescura sin seed ni cache).
  const base = await generateBasePortrait(deps, fal, { fluxProfile, prompt: basePrompt, warnings });

  // 2) Cada ENCUADRE desde el mismo base, secuencial.
  const images: GeneratedReferenceImage[] = [];
  let totalCost = base.costCents;
  for (const framing of framings) {
    const image = await generateFraming(deps, fal, {
      nb2Profile,
      personaId: input.personaId,
      baseFalUrl: base.baseFalUrl,
      framing,
      warnings,
    });
    images.push(image);
    totalCost += image.costCents;
  }

  log.info(
    {
      event: 'persona_images_generated',
      personaId: input.personaId,
      count: images.length,
      costCents: totalCost,
    },
    'reference-images IA de persona generadas',
  );
  return { images, costCents: totalCost, warnings };
}
