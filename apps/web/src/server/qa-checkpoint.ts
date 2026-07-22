// EL SEAM de CP4 (T5.5c): el efecto sobre `ad_variant.status` que acompaña a la resolución humana del
// checkpoint de QA (N9). Hermano de `brief-checkpoint.ts` (CP1), `batch-checkpoint.ts` (CP2) y
// `script-checkpoint.ts` (CP3).
//
// POR QUÉ VIVE AQUÍ Y NO EN CORE (mismo argumento que sus hermanos): `approveStep`/`rejectStep`
// (checkpoint-ops.ts) son GENÉRICOS —mueven el step_run entre estados, no saben qué hay en un
// `output_refs`—; esto es LEER el artefacto de N9 (por schema) y ESCRIBIR el veredicto de QA en la fila de
// la variante. Meterlo en la máquina de estados la acoplaría al dominio de las variantes.
//
// LA ASIMETRÍA CP4 vs CP1/CP2/CP3: CP4 tiene efecto de dominio en AMBAS ramas —aprobar Y rechazar—, no
// solo en aprobar. Aprobar CP4 lleva la variante a `approved`; rechazar CP4 la lleva a `rejected` (§9.0:
// una variante rechazada en QA se descarta). Los checkpoints anteriores no tenían efecto de dominio en el
// reject (una rama rechazada simplemente no continuaba); CP4 es el PRIMERO que lo estrena, por eso el route
// de reject adopta `withDomainTransaction` (antes solo `rejectStep` genérico) y el registro de efectos gana
// un despacho de reject (`domain-effects.ts`).
//
// ATOMICIDAD (patrón de CP1/CP3): las dos funciones toman un `Db` —conexión O TRANSACCIÓN— y los route
// handlers las llaman DENTRO de la misma tx que la transición del orquestador. El status de la variante y
// la transición del step commitean JUNTOS o nada: si el status se escribiera fuera de la tx y la transición
// fallara (409: el step ya no está en `waiting_approval`), la variante quedaría `approved`/`rejected` sobre
// un step que no se movió — dos verdades del mismo veredicto.
//
// «REGENERAR» NO ESTÁ AQUÍ: la tercera acción de CP4 (regenerar) NO es un efecto de dominio de la
// aprobación/rechazo del step — es el arranque de un run `kind='regen'` NUEVO, y su flujo pleno es T5.8.
// T5.5c deja SOLO el arranque de ese run (ver la op de regen), separado de aprobar/rechazar.
import { N9OutputSchema } from '@ugc/core/contracts';
import { setVariantQaVerdict, type Db } from '@ugc/db';

/**
 * Efecto de dominio de CP4: fija el veredicto de QA sobre la variante del máster —`approved` (publicable,
 * §9.0) o `rejected` (descartada)— según la resolución humana del checkpoint N9. Las DOS ramas de CP4
 * (aprobar Y rechazar) pasan por aquí: se diferencian solo en el literal `status`.
 *
 * DISCRIMINACIÓN POR SCHEMA: el artefacto se reconoce por `N9OutputSchema`, nunca por `node_key` (T0.8) —
 * la forma del artefacto es lo que decide si hay una variante cuyo veredicto escribir. NO-OP si el step no
 * es N9 (su `output_refs` no valida): mismo criterio que CP1/CP2/CP3 — un efecto que no reconoce su
 * artefacto no hace nada. `N9Output.variantId` es la variante a mutar.
 *
 * ATOMICIDAD: el `db` que recibe ES la tx de la transición del checkpoint (los route handlers la llaman
 * dentro de `withDomainTransaction`). El status de la variante y la transición del step commitean JUNTOS o
 * nada: si el status se escribiera fuera de la tx y la transición fallara (409: el step ya no está en
 * `waiting_approval`), la variante quedaría `approved`/`rejected` sobre un step que no se movió.
 *
 * LA ASIMETRÍA CP4 vs CP1/CP2/CP3: CP4 es el PRIMER checkpoint con efecto de dominio en la rama de RECHAZO
 * (los anteriores solo tenían efecto al aprobar —una rama rechazada simplemente no continuaba—). Por eso el
 * route de reject adopta `withDomainTransaction` (antes solo `rejectStep` genérico) y el registro de
 * efectos gana un despacho de reject (`domain-effects.ts`).
 */
export async function applyQaVerdict(
  db: Db,
  outputRefs: unknown,
  status: 'approved' | 'rejected',
): Promise<void> {
  const parsed = N9OutputSchema.safeParse(outputRefs);
  if (!parsed.success) return;
  await setVariantQaVerdict(db, parsed.data.variantId, status);
}
