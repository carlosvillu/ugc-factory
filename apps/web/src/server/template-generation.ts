// Servicios del lado servidor de la GENERACIÓN DE IMÁGENES de un template (T4.12): el THUMBNAIL de
// galería y la IMAGEN DE PRUEBA del botón «Probar template». Los route handlers
// (`POST /api/templates/[id]/thumbnail`, `POST /api/templates/[id]/test`) quedan finos (api.md §1):
// parsean → delegan aquí → serializan. Aquí se resuelve la fal-key (cifrada en `app_setting`) y el
// seam `FAL_BASE_URL` (E2E) que la capa de core no lee nunca.
//
// ALCANCE T4.12 pase A del botón «Probar template»: SOLO templates `kind:'image'`. Los `video`
// (Veo/i2v) son caros → se rechazan con un seam EXPLÍCITO (`validation_error`), NO un fallthrough. El
// thumbnail SÍ se genera para cualquier template (una miniatura-imagen representa igual a un template
// de vídeo que de imagen).
import { AppError } from '@ugc/core/contracts';
import {
  buildTemplateThumbnailPrompt,
  type TemplateTestResult as TemplateTestResultContract,
} from '@ugc/core/gallery';
import { getModelProfileByEndpoint, getTemplate, type DbClient } from '@ugc/db';
import { getSecretsKeyFromEnv } from '@ugc/core/secrets';
import {
  runTemplateTest,
  generateTemplateThumbnail,
  FLUX2_ENDPOINT,
  loadFalKey,
  falOptionsFrom,
  type TemplateThumbnailResult,
} from '@ugc/services';

export interface TemplateGenerationDeps {
  db: DbClient;
  storage: import('@ugc/core').StorageAdapter;
  logger?: import('@ugc/core').Logger;
  /** `FAL_BASE_URL` (E2E): se pasa al FalClient de core como `baseUrlOverride` (seam de intercepción
   *  por-origen). Lo pasa el route handler desde su accessor. AUSENTE en producción → fal real. */
  falBaseUrl?: string;
}

/**
 * Genera (o reutiliza) la IMAGEN DE PRUEBA de un template para el botón «Probar template». Lanza:
 *  · `not_found` si el template no existe;
 *  · `validation_error` si el template NO es `kind:'image'` (los de vídeo son caros — seam de alcance
 *    T4.12 pase A, no soportado aún).
 */
export async function generateTemplateTestImage(
  deps: TemplateGenerationDeps,
  input: { templateId: string },
): Promise<TemplateTestResultContract> {
  const { db } = deps;

  const template = await getTemplate(db, input.templateId);
  if (template === undefined) {
    throw new AppError('not_found', 'template no encontrado');
  }
  // SEAM DE ALCANCE (T4.12 pase A): «probar template» soporta SOLO image-kind. Los `video` (Veo/i2v)
  // son caros → rechazo EXPLÍCITO, no un fallthrough que quemaría dinero.
  if (template.kind !== 'image') {
    throw new AppError(
      'validation_error',
      `probar un template de tipo «${template.kind}» aún no está soportado (solo imagen)`,
    );
  }

  const profile = await getModelProfileByEndpoint(db, FLUX2_ENDPOINT);
  if (profile === undefined) {
    throw new AppError('provider_error', `no hay model_profile sembrado para «${FLUX2_ENDPOINT}»`);
  }

  const resolvedPrompt = buildTemplateThumbnailPrompt({
    title: template.title,
    description: template.description,
    body: template.body,
  });
  const falOptions = falOptionsFrom(deps.falBaseUrl);

  return runTemplateTest(
    {
      db,
      storage: deps.storage,
      // Key PEREZOSA: `runTemplateTest` solo la resuelve en el cache-miss (antes de gastar).
      falKey: () => loadFalKey(db, getSecretsKeyFromEnv()),
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      ...(falOptions !== undefined ? { falOptions } : {}),
    },
    { t2iProfile: profile, resolvedPrompt },
  );
}

/**
 * Genera el THUMBNAIL de un template y lo asocia (§10.2 regla 2: sin thumbnail no se publica). Lanza
 * `not_found` si el template no existe. La fal-key se resuelve eager (no perezosa como en la prueba)
 * porque el thumbnail va por `runGenerate`, cuyo contrato toma `falKey: string` directo; `runGenerate`
 * SÍ tiene dedup de producción (un thumbnail repetido reutiliza su asset a 0 coste), así que en un
 * cache-hit ese descifrado se paga en balde — deuda menor (propagar el thunk hasta runGenerate).
 */
export async function generateTemplateThumbnailImage(
  deps: TemplateGenerationDeps,
  input: { templateId: string },
): Promise<TemplateThumbnailResult> {
  const { db } = deps;

  const template = await getTemplate(db, input.templateId);
  if (template === undefined) {
    throw new AppError('not_found', 'template no encontrado');
  }

  const falKey = await loadFalKey(db, getSecretsKeyFromEnv());
  const falOptions = falOptionsFrom(deps.falBaseUrl);

  return generateTemplateThumbnail(
    {
      db,
      storage: deps.storage,
      falKey,
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      ...(falOptions !== undefined ? { falOptions } : {}),
    },
    template,
  );
}
