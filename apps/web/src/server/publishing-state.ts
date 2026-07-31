// HELPER de estado de publicación (T6.2, §15.4/§preámbulo F6): ensambla el `PublishingState` de una variante
// aprobada desde su LINAJE (plataformas + audio_source + destino del lote) y su estado PERSISTIDO (marcado
// del checklist + CP5). Lo reusan las tres rutas de publicación (GET estado, PATCH marca, POST cp5) para que
// TODAS respondan la misma forma tras cada mutación.
//
// La elegibilidad de Spark sale del `audio_source` REAL de la variante (`ad_variant.audio_source`), no del
// `none` degradado del bundle sin-bed: una variante `native_trending` bloquea Spark siempre (§14 pt 2).
import {
  AppError,
  buildPublishingState,
  type BundleAudioSource,
  type PublishingState,
} from '@ugc/core/contracts';
import {
  getPublishingState,
  getVariantLineage,
  type Db,
  type PublishingRow,
  type VariantLineage,
} from '@ugc/db';

/** El destino del lote (§14): el jsonb `matrix->>'destination'` puede traer valores legacy; se NORMALIZA a
 *  la unión del contrato (`organic`/`paid`/`both`), con `organic` como fallback conservador. */
function normalizeDestination(raw: string): 'organic' | 'paid' | 'both' {
  return raw === 'paid' || raw === 'both' ? raw : 'organic';
}

/**
 * Exige que la variante EXISTA y esté APROBADA, y devuelve su linaje. LANZA (AppError) si no (§9.7 N10: la
 * publicación es «por variante aprobada» — no se publica un borrador). Es el guard de autorización de las tres
 * rutas de publicación; devuelve el linaje para que el caller lo REUSE al ensamblar (no re-consultar).
 */
export async function requireApprovedLineage(db: Db, variantId: string): Promise<VariantLineage> {
  const lineage = await getVariantLineage(db, variantId);
  if (lineage === undefined) throw new AppError('not_found', 'variante no encontrada');
  if (lineage.variant.status !== 'approved') {
    throw new AppError(
      'invalid_transition',
      'la variante no está aprobada: no hay flujo de publicación',
    );
  }
  return lineage;
}

/** Ensambla el `PublishingState` desde un linaje YA validado + el estado persistido YA en mano (el
 *  `PublishingRow` que devuelve el upsert vía `.returning()`, o `getPublishingState` en el GET). No consulta
 *  la BD: es puro ensamblado, para que una mutación no re-lea el linaje ni el estado que acaba de escribir. */
export function assemblePublishingState(
  lineage: VariantLineage,
  persisted: PublishingRow,
): PublishingState {
  // El `audio_source` de la variante puede ser null (variante sin bed decidido) → `none` para el checklist.
  const audioSource: BundleAudioSource =
    (lineage.variant.audioSource as BundleAudioSource | null) ?? 'none';
  return buildPublishingState({
    platforms: lineage.variant.platformTargets,
    audioSource,
    destination: normalizeDestination(lineage.batch.destination),
    marks: persisted.marks,
    cp5Enabled: persisted.cp5Enabled,
    flowState: persisted.flowState,
  });
}

/**
 * Carga y ensambla el estado de publicación de una variante APROBADA (para el GET: valida + lee + ensambla).
 * Las mutaciones NO usan esto tras escribir — reusan `requireApprovedLineage` (que ya llamaron para validar)
 * + `assemblePublishingState` con el `PublishingRow` del upsert, evitando re-consultar linaje y estado.
 */
export async function loadPublishingState(db: Db, variantId: string): Promise<PublishingState> {
  const lineage = await requireApprovedLineage(db, variantId);
  const persisted = await getPublishingState(db, variantId);
  return assemblePublishingState(lineage, persisted);
}
