// Servicio del THUMBNAIL de galería de un template (T4.12): genera la MINIATURA-IMAGEN de un template
// con fal (`fal-ai/flux-2` t2i) y la ASOCIA a `prompt_template.thumbnail_asset_id`. Es la pieza que
// permite promocionar un template a `published` (§10.2 regla 2: «ningún template a published sin
// thumbnail»); el guard de esa transición vive en `setTemplateStatus`.
//
// A DIFERENCIA de la imagen de PRUEBA (`runTemplateTest`), el thumbnail SÍ es un asset de PRODUCCIÓN
// (persiste, se pinta en la rejilla, no es efímero): por eso usa `runGenerate` TAL CUAL (dedup de
// producción, `voice_preview=false AND template_test=false`, asset `kind:'keyframe'`). El
// `thumbnail_asset_id` apunta a ese keyframe — es una imagen-output legítima; el valor de enum
// `asset.kind='thumbnail'` queda reservado para el frame-thumbnail del VÍDEO final (F5), otra cosa.
//
// El prompt sale de `buildTemplateThumbnailPrompt` (core, determinista): el MISMO que usa
// `runTemplateTest`, de modo que thumbnail y prueba del mismo template con el mismo modelo comparten
// `content_hash` y colapsan a una sola generación cuando coinciden (economía natural, no dos imágenes).
import { buildTemplateThumbnailPrompt } from '@ugc/core/gallery';
import type { Logger, StorageAdapter } from '@ugc/core';
import {
  getModelProfileByEndpoint,
  setTemplateThumbnail,
  type DbClient,
  type PromptTemplate,
} from '@ugc/db';
import type { GenerationInputs } from '@ugc/core/generation';

import { runGenerate, type GenerateDeps } from './generate';
import { FLUX2_ENDPOINT, FLUX2_IMAGE_SIZE_9_16 } from './generate-template-test';
import { NOOP_LOGGER } from './noop-logger';

export interface TemplateThumbnailDeps {
  db: DbClient;
  storage: StorageAdapter;
  /** La API key de fal EN CLARO (el caller la lee de secretos). */
  falKey: string;
  logger?: Logger;
  fetch?: typeof globalThis.fetch;
  falOptions?: GenerateDeps['falOptions'];
}

export interface TemplateThumbnailResult {
  /** El asset (keyframe) de la miniatura, ya asociado a `prompt_template.thumbnail_asset_id`. */
  assetId: string;
  /** `true` si la imagen se REUTILIZÓ de una generación idéntica previa (dedup, 0 coste). */
  reused: boolean;
  /** El coste en céntimos registrado (0 en un acierto de dedup). */
  costCents: number;
}

/**
 * Genera el thumbnail de un template y lo asocia. Resuelve el perfil flux-2, construye el prompt de
 * miniatura del template, genera con `runGenerate` (dedup de producción, coste registrado UNA vez) y
 * estampa `thumbnail_asset_id`. LANZA si el perfil flux-2 no está sembrado o si fal falla (el caller lo
 * mapea al envelope de error). Idempotente por el dedup: re-generar el thumbnail de un template no
 * cambiado reutiliza el asset (0 coste) y re-estampa el mismo id.
 */
export async function generateTemplateThumbnail(
  deps: TemplateThumbnailDeps,
  template: PromptTemplate,
): Promise<TemplateThumbnailResult> {
  const { db } = deps;
  const log = deps.logger ?? NOOP_LOGGER;

  const profile = await getModelProfileByEndpoint(db, FLUX2_ENDPOINT);
  if (profile === undefined) {
    throw new Error(
      `generateTemplateThumbnail: no existe el model_profile ${FLUX2_ENDPOINT} (¿galería sin sembrar?)`,
    );
  }

  const resolvedPrompt = buildTemplateThumbnailPrompt({
    title: template.title,
    description: template.description,
    body: template.body,
  });
  const inputs: GenerationInputs = { image_size: FLUX2_IMAGE_SIZE_9_16, num_images: 1 };

  const result = await runGenerate(
    {
      db,
      storage: deps.storage,
      falKey: deps.falKey,
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
      ...(deps.falOptions !== undefined ? { falOptions: deps.falOptions } : {}),
    },
    { modelProfileId: profile.id, resolvedPrompt, inputs },
  );

  await setTemplateThumbnail(db, template.id, result.assetId);
  log.info(
    { event: 'template_thumbnail_generated', templateId: template.id, assetId: result.assetId },
    'thumbnail de template generado y asociado',
  );

  return { assetId: result.assetId, reused: result.reused, costCents: result.costCents };
}
