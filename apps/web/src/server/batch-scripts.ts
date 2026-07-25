// LA LECTURA DE CP3 (T2.6): reconstruye los guiones vigentes de un lote como `BatchScript[]` para
// que el editor de guiones los pinte y edite. Es lo que sirve `GET /api/batches/:id/scripts`.
//
// EL PROBLEMA QUE RESUELVE. `AdScriptSchema` (lo que el panel edita y RE-MANDA por el canal de
// decisión) exige `filenameCode` y `sharedBodyKey`, pero la fila `ad_script` NO guarda ninguno:
//   · `filenameCode` vive en `ad_variant` (lo trae el join de `getLatestScriptsByBatch`).
//   · `sharedBodyKey` vive en `ad_batch.matrix` → `PlannedVariant.segmentKeys.body`.
// Sin reconstruirlos, el `AdScript` que el panel devolviera NO pasaría `CheckpointDecisionSchema`
// en el borde de `/approve`, y CP3 no podría aprobar ni una edición.
//
// LA MATRIZ Y LAS VARIANTES COMPARTEN `filenameCode`: `createBatchWithVariants` compone el plan UNA
// vez con el `batchDiscriminator` = id del lote y escribe ESE plan tanto en `ad_batch.matrix` como
// en `ad_variant.filename_code` (batch.repo.ts). Así el `filenameCode` es la clave de cruce fiable
// entre la fila (que tiene `variantId`) y la matriz (que tiene `sharedBodyKey`/`angleName`/persona).
import {
  BatchPlanSchema,
  GuardrailFlagSchema,
  reconstructAdScriptFromRow,
  type BatchScript,
  type BatchScripts,
  type GuardrailFlag,
} from '@ugc/core/contracts';
import { getBatch, getLatestScriptsByBatch, type Db } from '@ugc/db';
import { AppError } from '@ugc/core/contracts';

/** Los flags guardados en la fila (`guardrail_flags`, jsonb nullable), validados. Un valor corrupto
 *  se trata como «sin flags» —degradar, no romper la lectura del panel—; el bloqueo REAL lo re-deriva
 *  el servidor al aprobar (`server/script-checkpoint.ts`), nunca se fía de esto. */
function parseFlags(raw: unknown): GuardrailFlag[] {
  const parsed = GuardrailFlagSchema.array().safeParse(raw ?? []);
  return parsed.success ? parsed.data : [];
}

/**
 * Los guiones vigentes de un lote como `BatchScript[]`, listos para el editor de CP3.
 *
 * Lanza `not_found` si el lote no existe. Si una variante con guion no aparece en la matriz (no
 * debería: la matriz ES de dónde salieron las variantes), se OMITE — mejor un guion menos que un
 * `AdScript` sin `sharedBodyKey` que reventaría el `parse`; el bloqueo server-side sigue intacto.
 */
export async function readBatchScripts(db: Db, batchId: string): Promise<BatchScripts> {
  const batch = await getBatch(db, batchId);
  if (batch === undefined) {
    throw new AppError('not_found', `el lote ${batchId} no existe`);
  }

  // La matriz del lote: la fuente de `sharedBodyKey`/`angleName`/persona, indexada por filenameCode.
  const plan = BatchPlanSchema.parse(batch.matrix);
  const byFilenameCode = new Map(plan.variants.map((v) => [v.filenameCode, v]));

  const latest = await getLatestScriptsByBatch(db, batchId);

  const scripts: BatchScript[] = [];
  for (const row of latest) {
    const planned = byFilenameCode.get(row.filenameCode);
    if (planned === undefined) continue; // ver el jsdoc: se omite, no se rompe.
    // `segmentKeys.body` lo GARANTIZA el contrato de la matriz (`BatchPlanSchema.parse` de arriba ya
    // validó que cada variante trae sus tres segmentos), así que aquí es un `string`, no opcional.
    const sharedBodyKey = planned.segmentKeys.body;
    scripts.push({
      variantId: row.variantId,
      filenameCode: row.filenameCode,
      angleName: planned.angleName,
      personaName: planned.personaName,
      personaId: planned.personaId,
      script: reconstructAdScriptFromRow(row.script, row.filenameCode, sharedBodyKey),
      guardrailFlags: parseFlags(row.script.guardrailFlags),
    });
  }

  // La cuenta ESPERADA sale de la MATRIZ del lote (una variante = un guion), no de las filas leídas:
  // es justo la referencia que falta para detectar un lote TRUNCADO (T5.11). Comparar `scripts`
  // consigo mismo siempre daría «completo».
  return { batchId, scripts, expectedCount: plan.variants.length };
}
