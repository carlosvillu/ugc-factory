// DISCRIMINADOR PURO de la LIMPIEZA de referencias de una Persona (T4.12 Pase B, escalado a 10 personas).
//
// EL PROBLEMA (cláusula 1 de la Verificación, «referencias consistentes / mismo sujeto»): `seedPersonas`
// da a cada persona 2 rectángulos SINTÉTICOS (PNGs sharp de relleno, NO una persona). El escalado genera
// además ≥2 referencias IA del mismo sujeto (identity lock). Sin limpiar, la persona acaba
// `[sintética, sintética, IA, IA, IA]` — dos referencias que no son ni una persona → NO son «referencias
// consistentes». Hay que borrar las sintéticas y dejar SOLO las IA.
//
// EL DISCRIMINADOR: las referencias IA llevan `generationId` no-null (lo estampa `createAsset` en
// generate-persona-images.ts); las sintéticas del seed lo tienen null (persona-seed.ts hace `createAsset`
// SIN `generationId`). Así que «sintética a borrar» ≡ `reference_image` con `generationId === null`.
//
// ⚠ RESTRICCIÓN (el porqué de que este discriminador sea seguro AQUÍ y no en general): una referencia que
// el USUARIO subió a mano por el CRUD (`POST /api/personas/:id/reference-images`) TAMBIÉN tiene
// `generationId` null. En el dev-DB de este escalado NO hay uploads manuales (las 10 personas son seed +
// generación IA), así que null ≡ sintética-del-seed. Este helper y el script que lo usa NO deben correr
// contra una BD con referencias subidas a mano: borrarían el trabajo del usuario. Es un one-shot de
// escalado, no una rutina de mantenimiento.

/** La forma mínima de un asset que el discriminador necesita (evita acoplar a `@ugc/db`). */
export interface ReferenceAssetLike {
  id: string;
  kind: string;
  generationId: string | null;
}

/**
 * Parte los assets de las `reference_image_ids` de una persona en las IA (a conservar) y las sintéticas
 * del seed (a borrar). SOLO considera `kind === 'reference_image'` (defensa: un id colado de otro kind no
 * se toca). Puro y determinista → testeable sin BD (el gate lo protege, regla de trabajo 8).
 */
export function partitionPersonaReferences(assets: readonly ReferenceAssetLike[]): {
  /** Referencias IA (identity lock): `generationId` no-null. Son las que quedan tras la limpieza. */
  aiRefIds: string[];
  /** Referencias sintéticas del seed a borrar: `reference_image` con `generationId === null`. */
  syntheticRefIds: string[];
} {
  const aiRefIds: string[] = [];
  const syntheticRefIds: string[] = [];
  for (const a of assets) {
    if (a.kind !== 'reference_image') continue;
    if (a.generationId === null) syntheticRefIds.push(a.id);
    else aiRefIds.push(a.id);
  }
  return { aiRefIds, syntheticRefIds };
}

// `MIN_AI_REFERENCES` (el suelo de referencias IA «activa» + anti-stranding) vive junto a los umbrales
// §11 de persona en `@ugc/core/persona`; se re-exporta aquí por conveniencia del consumidor (el script
// de escalado importa discriminador + umbral del mismo módulo de services).
export { MIN_AI_REFERENCES } from '@ugc/core/persona';
