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
import type { ExecutorDep, StepExecutor } from '@ugc/core/orchestrator';
import { buildPackshotPrompt, type GenerationInputs } from '@ugc/core/generation';
import { ProductBriefSchema } from '@ugc/core/contracts';
import type { Logger, StorageAdapter } from '@ugc/core';
import { getBrief, getModelProfileByEndpoint, type DbClient } from '@ugc/db';
import { runGenerate } from '@ugc/services';

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
}

/** Lo que el consumer SIEMPRE inyecta en producción (el canal de salida). Sin él, N7a pagaría fal y
 *  terminaría con `output_refs` vacío — un bug de CABLEADO, no un caso a tolerar (mismo criterio de
 *  dinero que N1/N3/N5). `stepId` es OPCIONAL aquí: N7a corre STEPLESS en el smoke (sin step) y
 *  `runGenerate` lo propaga si está (atribución de coste). El `variantId` NO se lee del ctx: el
 *  `ExecutorContext` de core no lo expone hoy (solo `stepId`); cuando T4.11 lo añada, se recablea. */
function requireContext(ctx: {
  collectOutput?: (outputRefs: unknown) => void;
  stepId?: string;
  deps?: ExecutorDep[];
}): {
  collectOutput: (outputRefs: unknown) => void;
  stepId: string | undefined;
} {
  const { collectOutput, stepId } = ctx;
  if (collectOutput === undefined) {
    throw new PermanentStepError('N7a: el ExecutorContext no trae collectOutput (bug de cableado)');
  }
  return { collectOutput, stepId };
}

/** El artefacto LIGERO de N7a: los refs de los assets generados (la verdad vive en las filas
 *  `generation`/`asset`; el artefacto solo lleva refs para el excerpt SSE y para que N7d/CP4 sepan
 *  qué shots hay). `syntheticProduct` viaja aquí ADEMÁS de en la columna para que un lector del
 *  artefacto no tenga que hacer el join si solo quiere el flag. */
interface N7aShotRef {
  generationId: string;
  assetId: string;
  costCents: number;
}
interface N7aOutput {
  route: 'ai_packshot';
  syntheticProduct: true;
  shots: N7aShotRef[];
}

/**
 * N7a · PRODUCT SHOTS, ruta `ai_packshot` (T4.4, §7.2). Genera 2–3 packshots 9:16 del producto con
 * `fal-ai/flux-2` (text-to-image) a partir de la descripción del brief, y los marca
 * `synthetic_product=true`.
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
export function makeN7aExecutor(deps: GenerationExecutorDeps): StepExecutor {
  return async (ctx) => {
    const { collectOutput, stepId } = requireContext(ctx);

    const parsed = N7aConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      throw new PermanentStepError(`N7a: config inválida: ${parsed.error.message}`);
    }
    const cfg = parsed.data;

    // SEAM T4.4/T4.4b: T4.4 solo implementa la ruta packshot-IA. Las rutas con referencias reales
    // (fotos subidas / imagen scrapeada promovida) son T4.4b. Rechazo EXPLÍCITO (no fallthrough):
    // reintentarlo no cambia la ruta, así que es permanente.
    if (cfg.route !== 'ai_packshot') {
      throw new PermanentStepError(
        `N7a: la ruta "${cfg.route}" (referencias reales) es de T4.4b; T4.4 solo implementa ai_packshot`,
      );
    }

    // Dos lecturas read-only INDEPENDIENTES (no comparten datos): el brief (fuente de la descripción
    // del producto) y el model_profile t2i. En paralelo — gratis y correcto.
    const [briefRow, profile] = await Promise.all([
      getBrief(deps.db, cfg.briefId),
      // Resolver el modelo t2i por endpoint (clave natural del catálogo, patrón del smoke de T4.1).
      getModelProfileByEndpoint(deps.db, FLUX2_ENDPOINT),
    ]);
    // La fila del brief es la fuente de verdad; su `data` es jsonb OPACO al salir de la BD → se
    // VALIDA contra el contrato (patrón N5), no se castea.
    if (briefRow === undefined) {
      throw new PermanentStepError(`N7a: el brief ${cfg.briefId} no existe`);
    }
    const brief = ProductBriefSchema.parse(briefRow.data);
    if (profile === undefined) {
      throw new PermanentStepError(
        `N7a: no existe el model_profile ${FLUX2_ENDPOINT} (¿galería sin sembrar?)`,
      );
    }

    // Prompt de packshot: lógica PURA de core (determinista, sin red). Mismo prompt para los N shots;
    // el `seed` los diferencia.
    const resolvedPrompt = buildPackshotPrompt(brief);

    // N generaciones de `num_images:1` (ver el bloque de arriba). Secuencial: `runGenerate` ya
    // pollea inline hasta completion; el paralelismo lo gobierna el FalClient, no este bucle.
    const shots: N7aShotRef[] = [];
    for (let i = 0; i < cfg.numShots; i++) {
      // `seed` por shot: imágenes distintas + `content_hash` distinto. Determinista (i) para que un
      // retry del step reproduzca los mismos seeds (base de la idempotencia futura de N7a).
      const inputs: GenerationInputs = {
        image_size: FLUX2_IMAGE_SIZE_9_16,
        num_images: 1,
        seed: i,
      };
      const res = await runGenerate(
        {
          db: deps.db,
          storage: deps.storage,
          falKey: deps.falKey,
          ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
          ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
        },
        {
          modelProfileId: profile.id,
          resolvedPrompt,
          inputs,
          // Procedencia: ESTE es el marcado de `synthetic_product`. Se persiste en el INSERT de la
          // fila `generation` (columna de primera clase), no en un UPDATE suelto.
          syntheticProduct: true,
          ...(stepId !== undefined ? { stepRunId: stepId } : {}),
        },
      );
      shots.push({
        generationId: res.generation.id,
        assetId: res.assetId,
        costCents: res.costCents,
      });
    }

    collectOutput({
      route: 'ai_packshot',
      syntheticProduct: true,
      shots,
    } satisfies N7aOutput);
  };
}
