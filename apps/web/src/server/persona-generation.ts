// Servicio del lado servidor de la GENERACIÓN IA DE REFERENCE-IMAGES de una Persona (T4.12 pase B,
// identity lock §11). El route handler (`POST /api/personas/[id]/reference-images/generate`) queda fino
// (api.md §1): parsea → delega aquí → serializa. Aquí se resuelve la fal-key (cifrada en `app_setting`) y
// el seam `FAL_BASE_URL` (E2E) que la capa de core/services no lee nunca.
//
// Molde: `template-generation.ts` (mismo patrón de deps + `falOptionsFrom` + `loadFalKey` + baseUrlOverride).
import { AppError } from '@ugc/core/contracts';
import type { GeneratePersonaImagesResponse } from '@ugc/core/persona';
import { getSecretsKeyFromEnv } from '@ugc/core/secrets';
import { getPersona, type DbClient } from '@ugc/db';
import { runGeneratePersonaImages, loadFalKey, falOptionsFrom } from '@ugc/services';
import { toPersonaResponse } from './persona-response';

export interface PersonaGenerationDeps {
  db: DbClient;
  storage: import('@ugc/core').StorageAdapter;
  logger?: import('@ugc/core').Logger;
  /** `FAL_BASE_URL` (E2E): se pasa al FalClient de core como `baseUrlOverride` (seam de intercepción
   *  por-origen). AUSENTE en producción → fal real. */
  falBaseUrl?: string;
}

/**
 * Genera reference-images IA para una Persona (retrato base FLUX.2 → encuadres NB2 ≥2K → persistidos en
 * la persona) y devuelve la persona actualizada + las imágenes generadas + el coste. Lanza `not_found`
 * si la persona no existe. La fal-key se resuelve EAGER (`runGeneratePersonaImages` toma `falKey: string`
 * y SIEMPRE gasta — no hay caché que la ahorre, a diferencia del preview de voz).
 */
export async function generatePersonaReferenceImages(
  deps: PersonaGenerationDeps,
  input: { personaId: string; framingCount?: number },
): Promise<GeneratePersonaImagesResponse> {
  const { db } = deps;

  const existing = await getPersona(db, input.personaId);
  if (existing === undefined) {
    throw new AppError('not_found', 'persona no encontrada');
  }

  const falKey = await loadFalKey(db, getSecretsKeyFromEnv());
  const falOptions = falOptionsFrom(deps.falBaseUrl);

  const result = await runGeneratePersonaImages(
    {
      db,
      storage: deps.storage,
      falKey,
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      ...(falOptions !== undefined ? { falOptions } : {}),
    },
    {
      personaId: input.personaId,
      ...(input.framingCount !== undefined ? { framingCount: input.framingCount } : {}),
    },
  );

  // Re-leer la persona: `addReferenceImage` la dejó con las nuevas referencias en su lista. Un segundo
  // GET aquí (no un round-trip del cliente) evita que la UI tenga que refrescar.
  const updated = await getPersona(db, input.personaId);
  if (updated === undefined) {
    // La persona existía al empezar; que desaparezca a media generación es un invariante roto.
    throw new AppError('not_found', 'persona no encontrada tras generar sus referencias');
  }

  return {
    persona: toPersonaResponse(updated),
    images: result.images.map((img) => ({
      assetId: img.assetId,
      framingId: img.framingId,
      width: img.width,
      height: img.height,
    })),
    costCents: result.costCents,
  };
}
