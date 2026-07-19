// Servicio de la IMAGEN DE PRUEBA de un template (T4.12, botón «Probar template» de la ficha):
// genera (o reutiliza de caché) UNA imagen barata de un template SIN un run — el equivalente-imagen
// del preview de voz de T4.6. Text-to-image con `fal-ai/flux-2` a partir del prompt de miniatura del
// template (`buildTemplateThumbnailPrompt`, core), coste registrado UNA vez.
//
// POR QUÉ ESTE SERVICIO Y NO `runGenerate`. `runGenerate` resuelve SIEMPRE el dedup de PRODUCCIÓN
// (`resolveProductionDedup` → `voice_preview=false`, índice `generation_production_content_hash_key`).
// Una prueba de template NO es un asset de producción: necesita su propia CACHÉ SCOPED (índice único
// parcial `generation_template_test_content_hash_key`, gateado por `template_test=true`) para que «N
// clicks de probar, 0 coste» quede garantizado a nivel BD sin contaminar el dedup de producción. Así
// que aquí se replica el patrón EXACTO de `runTtsOnly` (T4.6): lookup scoped → insert-if-absent
// atómico → submit/poll → liquidar en tx. El TAIL de liquidación es `finalizeGeneration` (el mismo
// liquidador de imagen que `runGenerate`, bajo su `SELECT … FOR UPDATE` anti-doble-cobro): produce el
// asset `kind:'keyframe'` + `cost_entry` + `completed`, que es exactamente lo que la prueba necesita.
//
// ALCANCE T4.12 pase A: SOLO templates `kind:'image'`. Los `video` (Veo/i2v) son caros → el CALLER los
// rechaza con un seam explícito ANTES de llegar aquí (mismo criterio que N7a rechaza rutas no
// soportadas). Este servicio no re-valida el kind: recibe el prompt ya construido y el perfil t2i.
import {
  computeContentHash,
  makeFalClient,
  FalResponseError,
  type GenerationInputs,
} from '@ugc/core/generation';
import type { Logger, StorageAdapter } from '@ugc/core';
import {
  getAssetByGenerationKind,
  getTemplateTestGenerationByContentHash,
  insertTemplateTestGenerationIfAbsent,
  updateGeneration,
  type DbClient,
  type ModelProfile,
} from '@ugc/db';

import { finalizeGeneration } from './finalize-generation';
import { degradeGenerationOnError } from './finalize-single-call-per-second';
import { NOOP_LOGGER } from './noop-logger';
import type { GenerateDeps } from './generate';

/** El endpoint del único modelo text-to-image sembrado (§13.1): `fal-ai/flux-2`. Se resuelve por
 *  endpoint (clave natural del catálogo), igual que N7a. */
export const FLUX2_ENDPOINT = 'fal-ai/flux-2';
/** `image_size` de flux-2 para 9:16 VERTICAL (`portrait_16_9`; confirmado vs fal.ai/models/fal-ai/flux-2,
 *  ver el executor N7a). Una miniatura de galería es 9:16 como el anuncio. */
export const FLUX2_IMAGE_SIZE_9_16 = 'portrait_16_9';

export interface TemplateTestResult {
  /** El asset de la imagen de prueba (descargable por `GET /api/assets/:id/download`). */
  assetId: string;
  /** `true` si se REUTILIZÓ de una prueba previa `completed` (0 coste, 0 llamadas a fal). */
  cached: boolean;
  /** El coste en céntimos registrado en `cost_entry` (0 en un cache-hit). */
  costCents: number;
}

export interface TemplateTestDeps {
  db: DbClient;
  storage: StorageAdapter;
  /** La API key de fal EN CLARO — PEREZOSA (`() => Promise<string>`): solo se resuelve en el
   *  cache-MISS, antes de gastar. Una prueba cacheada no paga el descifrado (invariante «key antes de
   *  gastar», mismo criterio que `runTtsOnly`). */
  falKey: () => Promise<string>;
  logger?: Logger;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  falOptions?: GenerateDeps['falOptions'];
}

export interface TemplateTestInput {
  /** El model_profile t2i (flux-2) ya resuelto por el caller (por endpoint). */
  t2iProfile: ModelProfile;
  /** El prompt YA construido (core `buildTemplateThumbnailPrompt`): el text-to-image que va a fal. */
  resolvedPrompt: string;
}

/**
 * CACHE-HIT (sin lock): una prueba `template_test` previa `completed` con ese `content_hash` y su asset
 * `keyframe` → el resultado reutilizable (0 coste). `undefined` si no hay caché usable. Espeja
 * `lookupCachedPreview` de T4.6.
 */
async function lookupCachedTest(
  db: DbClient,
  contentHash: string,
): Promise<TemplateTestResult | undefined> {
  const cached = await getTemplateTestGenerationByContentHash(db, contentHash);
  if (cached?.status !== 'completed') return undefined;
  const asset = await getAssetByGenerationKind(db, cached.id, 'keyframe');
  if (asset === undefined) return undefined;
  return { assetId: asset.id, cached: true, costCents: 0 };
}

/**
 * Genera (o reutiliza de caché) la imagen de prueba de un template (T4.12). CACHÉ SCOPED (patrón
 * `runTtsOnly`): el `content_hash` = prompt-de-prueba + modelo + inputs. Si ya existe una prueba
 * `template_test=true` `completed` con ese hash, devuelve su asset SIN tocar fal ni el ledger. Si no,
 * INSERTA la intención con `ON CONFLICT DO NOTHING` (dos clicks concurrentes → una sola generación),
 * genera y liquida (asset + cost_entry + completed) en la tx de `finalizeGeneration`. Así probar N
 * veces NO añade coste (visible en `/spend`).
 *
 * LANZA `FalResponseError` si fal falla, si el output no trae imagen, o si otra petición concurrente
 * está generando la misma prueba (el caller reintenta y pega en el fast-hit del ganador).
 */
export async function runTemplateTest(
  deps: TemplateTestDeps,
  input: TemplateTestInput,
): Promise<TemplateTestResult> {
  const { db, storage } = deps;
  const log = deps.logger ?? NOOP_LOGGER;
  const { t2iProfile } = input;

  const inputs: GenerationInputs = {
    image_size: FLUX2_IMAGE_SIZE_9_16,
    num_images: 1,
  };

  // content_hash de la caché: prompt + modelo + inputs. Mismo cálculo que la generación real → clave
  // determinista y comparable.
  const contentHash = computeContentHash({
    resolvedPrompt: input.resolvedPrompt,
    modelProfileId: t2iProfile.id,
    inputs,
  });

  // 1) CACHE-HIT rápido: una prueba `completed` previa con ese hash → su asset, sin fal ni coste.
  const fastHit = await lookupCachedTest(db, contentHash);
  if (fastHit !== undefined) {
    log.info(
      { event: 'template_test_cache_hit', assetId: fastHit.assetId },
      'imagen de prueba de template reutilizada de caché (0 coste)',
    );
    return fastHit;
  }

  // 2) CACHE-MISS: insertar la INTENCIÓN con ON CONFLICT DO NOTHING (clicks concurrentes → una sola
  //    generación). Si otra tx ganó, `created===undefined` → re-leer y usar su asset.
  const created = await insertTemplateTestGenerationIfAbsent(db, {
    modelProfileId: t2iProfile.id,
    resolvedPrompt: input.resolvedPrompt,
    inputs,
    contentHash,
    status: 'submitting',
    startedAt: new Date(),
  });
  if (created === undefined) {
    const winnerHit = await lookupCachedTest(db, contentHash);
    if (winnerHit !== undefined) return winnerHit;
    throw new FalResponseError(
      'runTemplateTest: la imagen de prueba se está generando en otra petición concurrente; reintenta',
    );
  }

  // CACHE-MISS confirmado: recién ahora se resuelve la key (perezosa) — una prueba cacheada no llega
  // aquí. La key se resuelve ANTES de cualquier `fal.submit` (invariante «key antes de gastar»).
  const fal = makeFalClient({
    credentials: await deps.falKey(),
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    ...deps.falOptions,
  });

  try {
    // 3) SUBMIT → `submitted` → POLL hasta COMPLETED → liquidar con el TAIL COMPARTIDO de imagen
    //    (`finalizeGeneration`): valida output → descarga el PNG → cost_entry → completed en una tx
    //    bajo `SELECT … FOR UPDATE`. Se reutiliza el MISMO liquidador que `runGenerate` (no una copia).
    const submitted = await fal.submit(t2iProfile.falEndpoint, {
      prompt: input.resolvedPrompt,
      ...inputs,
    });
    const submittedGen = await updateGeneration(db, created.id, {
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
    const finalized = await finalizeGeneration(
      { db, storage, downloader: fal, logger: log },
      { generation: submittedGen, output: polled.output, statusPayload: polled.statusPayload },
    );

    // NO-OP gracioso (carrera): otra ruta liquidó bajo el lock → `assetId===null`. Recuperar su asset
    // por (generation_id, kind) y devolverlo como reúso (0 coste: la otra ruta ya escribió el cost).
    if (finalized.assetId === null) {
      const existing = await getAssetByGenerationKind(db, created.id, 'keyframe');
      if (existing === undefined) {
        throw new FalResponseError(
          `runTemplateTest: la prueba ${created.id} está completed pero sin asset keyframe (invariante roto)`,
        );
      }
      return { assetId: existing.id, cached: true, costCents: 0 };
    }

    log.info(
      {
        event: 'template_test_generated',
        generationId: created.id,
        assetId: finalized.assetId,
        costCents: finalized.costCents,
      },
      'imagen de prueba de template generada',
    );
    return { assetId: finalized.assetId, cached: false, costCents: finalized.costCents };
  } catch (err) {
    // Degradar a `failed` SOLO si la fila NO es ya terminal: una ruta concurrente pudo haberla
    // completado legítimamente. Se reutiliza el helper compartido `degradeGenerationOnError` (el mismo
    // que `runGenerate`), que además protege la causa raíz `err` si el propio degrade fallara.
    await degradeGenerationOnError(
      { db, logger: log },
      { generationId: created.id, originalError: err, event: 'template_test_degrade_failed' },
    );
    throw err;
  }
}
