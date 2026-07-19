// Executors del sub-DAG de GENERACIÓN (§7.2 N7). T4.4 estrena N7a · PRODUCT SHOTS (ruta
// `ai_packshot`). Molde: los executors de análisis (`analysis.ts`) y N5 (`write-scripts.ts`): una
// cáscara FINA que conecta el orquestador (que solo sabe de estados) con el servicio `runGenerate`
// (@ugc/services, T4.1). Aquí NO hay lógica de negocio de generación —esa vive en core/services—:
// parsear la config, resolver la ruta, construir el prompt (función pura de core), llamar al
// servicio, entregar los refs.
//
// FRONTERAS DE T4.4 (no over-build):
//   - SOLO la ruta `ai_packshot` (text-to-image con `fal-ai/flux-2`, sin fotos reales). Las rutas
//     con referencias (`upload_images`/`promote_scraped` → seedream/nano-banana edit) son T4.4b: el
//     executor las RECHAZA con `PermanentStepError` (seam explícito, no fallthrough).
//   - El executor es STEPLESS-capaz: elige la ruta desde su CONFIG (`route`), no desde un
//     `checkpoint_decision` que exigiría un `step_run_id` real. Así el smoke conduce `ai_packshot`
//     sin run. T4.11 rellenará ese `route` desde la decisión de CP1 al cablear N7a como nodo.
//   - CABLEARLO al DAG (step_run_id/variant_id/canvas) es T4.11, NO T4.4.
//
// CONTRATO DEL EXECUTOR (executor.ts): throw = fallo del step; retorno = éxito; el executor NUNCA
// toca el estado del step (lo hace el CONSUMER vía transition()). `PermanentStepError` para fallos
// NO reintentables (config inválida, ruta no soportada): reintentarlos no los arregla y quemaría
// dinero de fal.
import { N7aConfigSchema, PermanentStepError } from '@ugc/core/orchestrator';
import type { StepExecutor, PackshotRoute } from '@ugc/core/orchestrator';
import { buildPackshotPrompt, type GenerationInputs } from '@ugc/core/generation';
import { ProductBriefSchema, type ProductBrief, type N7aOutput } from '@ugc/core/contracts';
import { adaptToPayload, ModelCapabilitiesSchema, type ModelProfileSeed } from '@ugc/core/gallery';
import type { Logger, StorageAdapter } from '@ugc/core';
import { getBrief, getModelProfileByEndpoint, type DbClient, type ModelProfile } from '@ugc/db';
import {
  bridgeReferenceImageUrl,
  HeroReferenceUnavailableError,
  runGenerate,
  uploadInputCached,
  type BridgedReferenceImage,
} from '@ugc/services';

import { requireOutputContext, runGenerationStep } from './_shared';

/** El endpoint del ÚNICO modelo text-to-image sembrado (§13.1): `fal-ai/flux-2`. NO usa el sistema
 *  de adapters (no tiene `promptAdapter`): N7a le pasa `image_size`/`num_images` directo por
 *  `inputs`, como los smokes de T4.1. Se resuelve por endpoint (clave natural del catálogo), no por
 *  id hardcodeado. */
const FLUX2_ENDPOINT = 'fal-ai/flux-2';

/** `image_size` de flux-2 para 9:16 VERTICAL (confirmado 2026-07-16 vs fal.ai/models/fal-ai/flux-2:
 *  el enum es `square_hd|square|portrait_4_3|portrait_16_9|landscape_4_3|landscape_16_9`, y
 *  `portrait_16_9` es el vertical 9:16). flux-2 declara `9:16` en `capabilities.aspects` pero SIN
 *  adapter que lo derive → N7a lo traduce aquí al valor real del payload. */
const FLUX2_IMAGE_SIZE_9_16 = 'portrait_16_9';

/** Endpoint del editor de imagen con referencias de la ruta de N7a (T4.4b, §13.1): seedream v4.5/edit.
 *  Toma las fotos hero REALES como `image_urls` y las recompone en un shot 9:16. `fal:verify` confirma
 *  su vigencia; el fallback es NB2/edit (abajo). */
const SEEDREAM_EDIT_ENDPOINT = 'fal-ai/bytedance/seedream/v4.5/edit';
/** Fallback del editor de referencias (T4.4b, Entrega): nano-banana-2/edit. Se usa si seedream/edit no
 *  está sembrado (galería sin recablear). Su dialecto de aspect es `aspect_ratio` (no `image_size`) —
 *  el `imageEditAdapter` lo emite según `capabilities.aspectParam` del profile, sin ramificar aquí. */
const NB2_EDIT_ENDPOINT = 'fal-ai/nano-banana-2/edit';
/** El aspect canónico de N7a (9:16 vertical, §7.2). El adapter lo traduce al valor del endpoint
 *  (`portrait_16_9` en seedream, `9:16` verbatim en NB2) vía `capabilities.aspectValues`. */
const N7A_ASPECT_9_16 = '9:16';

/** Deps de los executors de generación, cableadas por el composition root del worker. N7a PAGA fal
 *  (text-to-image), así que necesita BD + storage (descargar el PNG) + la `FAL_KEY` en claro. Es un
 *  grupo propio (no reusa el del análisis) porque su superficie externa es fal, no Firecrawl/Jina/
 *  Anthropic. */
export interface GenerationExecutorDeps {
  db: DbClient;
  storage: StorageAdapter;
  /** La API key de fal EN CLARO (el composition root la lee de `FAL_KEY`). */
  falKey: string;
  /** Logger estructurado (observability.md); default no-op vía `runGenerate` si no se inyecta. */
  logger?: Logger;
  /** `fetch` inyectable (msw en tests); default global en producción. */
  fetch?: typeof globalThis.fetch;
  /** `FAL_BASE_URL` (E2E, T4.11): se pasa al FalClient de core como `baseUrlOverride` (seam de
   *  intercepción por-origen). Ausente en producción → fal real; el fake server del stack lo fija para
   *  que submit/upload/poll/download del WORKER caigan en el fake y la suite NO gaste. Mismo mecanismo
   *  que el preview de voz de WEB (server/voice-preview.ts). Se lee de `FAL_BASE_URL` SOLO en el
   *  composition root del worker (boss.ts), nunca en core. */
  falBaseUrl?: string;
}

/** El artefacto LIGERO de N7a: los refs de los assets generados (la verdad vive en las filas
 *  `generation`/`asset`; el artefacto solo lleva refs para el excerpt SSE y para que N7d/CP4 sepan
 *  qué shots hay). `syntheticProduct` viaja aquí ADEMÁS de en la columna para que un lector del
 *  artefacto no tenga que hacer el join si solo quiere el flag. */
// El shape del artefacto vive en core (`N7aOutputSchema`, contracts/step-outputs.ts): es la FRONTERA
// CROSS-NODE por la que N7d consume los keyframes (`shots[].assetId`). El executor solo lo produce
// tipado contra ella (`satisfies N7aOutput`).
type N7aShotRef = N7aOutput['shots'][number];

/** Convierte una fila `model_profile` de BD (con `capabilities`/`cost` jsonb OPACOS) en el
 *  `ModelProfileSeed` que `adaptToPayload` consume. El adapter solo lee `falEndpoint`, `promptAdapter`
 *  y `capabilities` — se VALIDA el jsonb de capabilities contra su schema (patrón N5: nunca castear
 *  jsonb de BD). El `cost` no lo lee el adapter (el coste lo liquida `finalizeGeneration` aparte), así
 *  que se rellena con un placeholder válido: este seed es SOLO para el transform del payload. */
function toAdapterProfile(row: ModelProfile): ModelProfileSeed {
  return {
    falEndpoint: row.falEndpoint,
    kind: 'image',
    cost: { unit: 'image', amountCents: 0 },
    capabilities: ModelCapabilitiesSchema.parse(row.capabilities),
    ...(row.promptAdapter !== null ? { promptAdapter: row.promptAdapter } : {}),
    unverified: false,
  };
}

/**
 * Selecciona las URLs de las fotos hero REALES del brief según la RUTA de referencias (T4.4b). Las dos
 * rutas tienen fuentes DISTINTAS y NO intercambiables (§9.2, checkpoint-decision.ts):
 *   · `promote_scraped`: SOLO `assets.hero_image_url` — el usuario promovió UNA imagen scrapeada a hero.
 *     El resto de `assets.images[]` son secundarias que N2 clasificó como broll/detail: NO son
 *     necesariamente el producto, así que meterlas corrompería el shot. Es la URL en riesgo de 403
 *     (CDN externo) que la re-validación pre-gasto protege (planning:352).
 *   · `upload_images`: las fotos que el usuario SUBIÓ, todas referencias del producto. Viven en
 *     `assets.images[]` (el editor de CP1 versiona el brief con ellas); `hero_image_url` va PRIMERO si
 *     está. Se deduplica por URL (no subir/mandar el hero dos veces).
 * `ai_packshot` no pasa por aquí (no lleva referencias). Sin URLs usables → `PermanentStepError`
 * (rehúsa el step antes de gastar; reintentar no aparece fotos que el brief no tiene).
 */
function selectReferenceUrls(brief: ProductBrief, route: PackshotRoute): string[] {
  const hero = brief.assets.hero_image_url;
  if (route === 'promote_scraped') {
    if (hero === null || hero === '') {
      throw new PermanentStepError(
        'N7a (promote_scraped): el brief no tiene `assets.hero_image_url` (la imagen promovida): sin ella no hay referencia que editar',
      );
    }
    return [hero];
  }
  // upload_images: hero primero (si está) + todas las imágenes subidas, deduplicado por URL. `Set`+spread
  // preserva el orden de inserción (hero primero, primera ocurrencia) y descarta duplicados y vacíos.
  const urls = [
    ...new Set(
      [
        ...(hero !== null && hero !== '' ? [hero] : []),
        ...brief.assets.images.map((i) => i.url),
      ].filter((u) => u !== ''),
    ),
  ];
  if (urls.length === 0) {
    throw new PermanentStepError(
      'N7a (upload_images): el brief no trae ninguna foto en `assets` (ni hero ni images[]): no hay referencias que subir',
    );
  }
  return urls;
}

export function makeN7aExecutor(deps: GenerationExecutorDeps): StepExecutor {
  return async (ctx) => {
    const { collectOutput, stepId } = requireOutputContext(ctx, 'N7a');

    const parsed = N7aConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      throw new PermanentStepError(`N7a: config inválida: ${parsed.error.message}`);
    }
    const cfg = parsed.data;

    // El brief es la fuente de verdad para ambas rutas (la descripción para el prompt, y las fotos hero
    // para las referencias). Su `data` es jsonb OPACO → se VALIDA contra el contrato (patrón N5).
    const briefRow = await getBrief(deps.db, cfg.briefId);
    if (briefRow === undefined) {
      throw new PermanentStepError(`N7a: el brief ${cfg.briefId} no existe`);
    }
    const brief = ProductBriefSchema.parse(briefRow.data);

    // DISPATCH POR RUTA (config, no lookup — la costura stepless de N5/N6/N7a). `ai_packshot` (T4.4)
    // genera con text-to-image; las rutas de referencias (T4.4b) editan las fotos hero reales.
    const shots =
      cfg.route === 'ai_packshot'
        ? await runAiPackshotRoute(deps, { cfg, brief, stepId })
        : await runReferenceRoute(deps, {
            cfg,
            brief,
            briefId: cfg.briefId,
            route: cfg.route,
            stepId,
          });

    collectOutput(shots satisfies N7aOutput);
  };
}

/**
 * El bucle COMPARTIDO de N generaciones `num_images:1` (lo usan ambas rutas de N7a). Cada shot
 * construye sus `inputs` (el `seed:i` los diferencia y evita colisión de `content_hash`) vía
 * `perShotInputs(i)`; el resto (submit→poll→finalize, anti-doble-cobro, taxonomía de error) es
 * idéntico entre rutas y vive en `runGenerate`/`runGenerationStep`.
 *
 * POR QUÉ UN BUCLE DE `num_images:1` Y NO `num_images:2-3` EN UNA SOLA GENERACIÓN. `finalizeGeneration`
 * (T4.1/T4.2, el liquidador COMPARTIDO y contendido por el FOR UPDATE anti-doble-cobro) persiste
 * SOLO la PRIMERA imagen del output (`firstImage`), pero cobra por TODAS (`cost.imageCount`). Una
 * sola generación con `num_images:3` facturaría 3 imágenes y guardaría 1 asset — deliverable roto y
 * dinero quemado. En vez de tocar ese liquidador (blast radius enorme: 4 callers concurrentes,
 * FOR UPDATE, tests de T4.1/T4.2/T4.3), N7a hace N generaciones de `num_images:1`: N filas
 * `generation`, N assets, N cost_entries de 1 imagen cada uno. Cada shot lleva un `seed` distinto
 * para que (a) fal produzca imágenes DISTINTAS y (b) sus `content_hash` no colisionen (dos
 * generaciones idénticas colapsarían cuando el dedupe de F5 entre en juego).
 */
async function runShotLoop(
  deps: GenerationExecutorDeps,
  args: {
    modelProfileId: string;
    resolvedPrompt: string;
    numShots: number;
    syntheticProduct: boolean;
    stepId: string | undefined;
    perShotInputs: (i: number) => GenerationInputs;
  },
): Promise<N7aShotRef[]> {
  const shots: N7aShotRef[] = [];
  for (let i = 0; i < args.numShots; i++) {
    const res = await runGenerationStep(() =>
      runGenerate(
        {
          db: deps.db,
          storage: deps.storage,
          falKey: deps.falKey,
          ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
          ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
          ...(deps.falBaseUrl !== undefined
            ? { falOptions: { baseUrlOverride: deps.falBaseUrl } }
            : {}),
        },
        {
          modelProfileId: args.modelProfileId,
          resolvedPrompt: args.resolvedPrompt,
          inputs: args.perShotInputs(i),
          syntheticProduct: args.syntheticProduct,
          ...(args.stepId !== undefined ? { stepRunId: args.stepId } : {}),
        },
      ),
    );
    shots.push({
      generationId: res.generation.id,
      assetId: res.assetId,
      costCents: res.costCents,
    });
  }
  return shots;
}

/**
 * RUTA `ai_packshot` (T4.4, §7.2). Genera 2–3 packshots 9:16 del producto con `fal-ai/flux-2`
 * (text-to-image) a partir de la descripción del brief, y los marca `synthetic_product=true`. El
 * bucle `num_images:1` (y el porqué del anti-doble-cobro) vive en `runShotLoop`.
 */
async function runAiPackshotRoute(
  deps: GenerationExecutorDeps,
  args: { cfg: { numShots: number }; brief: ProductBrief; stepId: string | undefined },
): Promise<N7aOutput> {
  const profile = await getModelProfileByEndpoint(deps.db, FLUX2_ENDPOINT);
  if (profile === undefined) {
    throw new PermanentStepError(
      `N7a: no existe el model_profile ${FLUX2_ENDPOINT} (¿galería sin sembrar?)`,
    );
  }
  // Prompt de packshot: lógica PURA de core (determinista, sin red). Mismo prompt para los N shots;
  // el `seed` los diferencia.
  const resolvedPrompt = buildPackshotPrompt(args.brief);
  const shots = await runShotLoop(deps, {
    modelProfileId: profile.id,
    resolvedPrompt,
    numShots: args.cfg.numShots,
    syntheticProduct: true,
    stepId: args.stepId,
    // `seed` por shot: imágenes distintas + `content_hash` distinto. Determinista (i) para que un
    // retry del step reproduzca los mismos seeds (base de la idempotencia futura de N7a).
    perShotInputs: (i) => ({ image_size: FLUX2_IMAGE_SIZE_9_16, num_images: 1, seed: i }),
  });
  return { route: 'ai_packshot', syntheticProduct: true, shots };
}

/**
 * RUTA DE REFERENCIAS REALES (T4.4b, §7.2). Edita las fotos hero REALES del brief con un editor de
 * imagen (`fal-ai/bytedance/seedream/v4.5/edit`, fallback `nano-banana-2/edit`) en 2–3 shots 9:16.
 * Los shots muestran el PRODUCTO REAL (no un packshot sintético) → `synthetic_product=false`.
 *
 * PIPELINE (por qué en este orden):
 *   1. Seleccionar las URLs hero por ruta (`selectReferenceUrls`): NO todas las imágenes valen igual.
 *   2. PUENTE URL→ASSET + RE-VALIDACIÓN (`bridgeReferenceImageUrl`): descarga CADA URL, re-valida que
 *      es descargable (planning:352) y la normaliza a PNG (defensa AVIF). Si el hero está muerto/403,
 *      REHÚSA aquí — ANTES de cualquier `submit` a fal (control negativo: 0 gasto con hero muerto).
 *   3. `uploadInputCached` (T4.1): sube cada asset a fal storage (con caché §9.6 por hash).
 *   4. `adaptToPayload` (image-edit, T3.6/T4.4b): construye `{prompt, image_urls, image_size|aspect_ratio}`
 *      — el 9:16 LLEGA al payload por `capabilities.aspectParam` del profile (seedream `image_size`,
 *      NB2 `aspect_ratio`). El `resolvedPrompt` (prompt canónico) se separa y el resto son `inputs`.
 *   5. Bucle `num_images:1` COMPARTIDO (mismo anti-doble-cobro que `ai_packshot`): las mismas
 *      `image_urls` en cada shot, `seed:i` distinto para outputs distintos y sin colisión de hash.
 *
 * La taxonomía de error se respeta (NO se colapsa): `HeroReferenceUnavailableError` (referencia de
 * entrada inexistente, DETERMINISTA) → `PermanentStepError` (rehúsa sin re-pagar); los fallos de fal
 * (4xx/401/429/timeout vs output malformado) los cría `runGenerate`/`runGenerationStep` como siempre.
 */
async function runReferenceRoute(
  deps: GenerationExecutorDeps,
  args: {
    cfg: { numShots: number };
    brief: ProductBrief;
    briefId: string;
    route: Exclude<PackshotRoute, 'ai_packshot'>;
    stepId: string | undefined;
  },
): Promise<N7aOutput> {
  // Resolver el editor de referencias: seedream/edit, o NB2/edit como fallback (Entrega T4.4b).
  const profileRow =
    (await getModelProfileByEndpoint(deps.db, SEEDREAM_EDIT_ENDPOINT)) ??
    (await getModelProfileByEndpoint(deps.db, NB2_EDIT_ENDPOINT));
  if (profileRow === undefined) {
    throw new PermanentStepError(
      `N7a (${args.route}): no existe el model_profile ${SEEDREAM_EDIT_ENDPOINT} ni el fallback ${NB2_EDIT_ENDPOINT} (¿galería sin sembrar?)`,
    );
  }
  const adapterProfile = toAdapterProfile(profileRow);

  // (1) URLs hero por ruta + (2) PUENTE + RE-VALIDACIÓN de CADA una ANTES de gastar. Un hero muerto/403
  // lanza `HeroReferenceUnavailableError` → se traduce a `PermanentStepError` (rehúsa sin gastar). El
  // `catch` es TIPADO (solo la referencia de entrada), no colapsa los fallos de fal.
  const urls = selectReferenceUrls(args.brief, args.route);
  const refFalUrls: string[] = [];
  for (const url of urls) {
    let bridged: BridgedReferenceImage;
    try {
      bridged = await bridgeReferenceImageUrl(
        {
          db: deps.db,
          storage: deps.storage,
          ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
          ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
        },
        { url, briefId: args.briefId },
      );
    } catch (err) {
      if (err instanceof HeroReferenceUnavailableError) {
        // DETERMINISTA y NO-reintentable (re-descargar un 403 da 403): NO se gasta en fal.
        throw new PermanentStepError(`N7a (${args.route}): ${err.message}`);
      }
      throw err;
    }
    // (3) Subir el asset a fal storage (caché §9.6). El bridge acaba de crear la fila → `fal_url` null.
    const { falUrl } = await uploadInputCached(
      {
        db: deps.db,
        storage: deps.storage,
        falKey: deps.falKey,
        ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
        ...(deps.falBaseUrl !== undefined ? { baseUrlOverride: deps.falBaseUrl } : {}),
      },
      {
        assetId: bridged.assetId,
        storageKey: bridged.storageKey,
        falUrl: bridged.falUrl,
        mime: bridged.mime,
      },
    );
    refFalUrls.push(falUrl);
  }

  // (4) ADAPTER image-edit: el prompt de packshot (mismo constructor puro que ai_packshot) + las fal-urls
  // como referencias + el aspect 9:16. El adapter recorta a `capabilities.refImages` y emite el aspect
  // bajo la clave del profile. NO lanza: devuelve issues tipadas → `PermanentStepError` (config del
  // catálogo, DETERMINISTA).
  const resolvedPrompt = buildPackshotPrompt(args.brief);
  const adapted = adaptToPayload({
    resolvedPrompt,
    profile: adapterProfile,
    aspect: N7A_ASPECT_9_16,
    durationSeconds: 0,
    assets: { refImages: refFalUrls },
  });
  if (!adapted.ok) {
    throw new PermanentStepError(
      `N7a (${args.route}): el adapter image-edit rechazó el payload: ${JSON.stringify(adapted.issues)}`,
    );
  }
  // El adapter emite `prompt` (= resolvedPrompt) + el resto (`image_urls`, `image_size`/`aspect_ratio`).
  // `runGenerate` ya manda `{prompt: resolvedPrompt, ...inputs}`: se separa el prompt del resto para no
  // duplicarlo (el prompt viaja por `resolvedPrompt`, los demás por `inputs` → entran en `content_hash`).
  const { prompt: _prompt, ...baseInputs } = adapted.payload;

  // (5) Bucle `num_images:1` COMPARTIDO. Mismas referencias en cada shot; `seed:i` los diferencia.
  const shots = await runShotLoop(deps, {
    modelProfileId: profileRow.id,
    resolvedPrompt,
    numShots: args.cfg.numShots,
    syntheticProduct: false,
    stepId: args.stepId,
    perShotInputs: (i) => ({ ...baseInputs, num_images: 1, seed: i }),
  });
  return { route: args.route, syntheticProduct: false, shots };
}
