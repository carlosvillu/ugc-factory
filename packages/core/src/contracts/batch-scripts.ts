// LA VISTA DE LECTURA DE CP3 (T2.6): lo que `GET /api/batches/:id/scripts` devuelve para que el
// editor de guiones pinte y EDITE los guiones vigentes de un lote. Es el espejo, del lado read, de
// `ScriptsCheckpointDecision` (el lado write): el panel recibe un `BatchScript[]`, edita el
// `AdScript` de cada uno y lo re-manda dentro de un `ScriptVerdict.editedScript`.
//
// POR QUÉ ES UN CONTRATO Y NO SE DERIVA DEL ARTEFACTO N5. El `N5Output` es un artefacto LIGERO
// (refs: `variantId`/`scriptId`/`filenameCode`/`blocked`), no lleva el TEXTO del guion — la verdad
// vive en las filas `ad_script` (§12). Y esas filas NO guardan dos campos que `AdScriptSchema`
// EXIGE: `filenameCode` (vive en `ad_variant`) y `sharedBodyKey` (vive en `ad_batch.matrix`, en
// `PlannedVariant.segmentKeys.body`). El servidor los RECONSTRUYE al leer (join fila + matriz) para
// entregar un `AdScript` VÁLIDO que el panel pueda devolver tal cual por el canal de decisión sin
// que `CheckpointDecisionSchema.parse` lo rechace en el borde.
import { z } from 'zod';
import { AdScriptSchema } from './ad-script';
import { GuardrailFlagSchema } from './guardrail-flag';

/**
 * El guion VIGENTE de UNA variante, tal como CP3 lo lista. `angleName`/`personaName` son solo para
 * pintar (salen de la matriz, la misma lectura que reconstruye `sharedBodyKey`); `variantId` es la
 * identidad sobre la que el veredicto vuelve; `script` es el `AdScript` completo y VÁLIDO (con sus
 * dos campos reconstruidos) que el editor edita y re-manda.
 */
export const BatchScriptSchema = z.object({
  /** `ad_variant.id`: sobre él vuelve el `ScriptVerdict`. */
  variantId: z.string().min(1),
  /** `PlannedVariant.filenameCode` (de `ad_variant`): la identidad legible de la variante. */
  filenameCode: z.string().min(1),
  /** El ángulo de la variante (de la matriz): para agrupar/pintar. */
  angleName: z.string().min(1),
  /** La persona asignada, o `null` si el lote rota / no casó ninguna (§11). */
  personaName: z.string().nullable(),
  /** El guion vigente COMPLETO y válido (con `filenameCode`/`sharedBodyKey` reconstruidos). */
  script: AdScriptSchema,
  /** Los flags de compliance de la versión vigente (§15.2): lo que CP3 resalta y lo que BLOQUEA la
   *  aprobación de esta variante si alguno es `blocking`. El servidor los DERIVA de nuevo al
   *  aprobar (nunca se fía de lo que el cliente reporte); aquí viajan para pintarlos. */
  guardrailFlags: z.array(GuardrailFlagSchema),
});
export type BatchScript = z.infer<typeof BatchScriptSchema>;

/** La respuesta de `GET /api/batches/:id/scripts`: los guiones vigentes del lote + el id del lote
 *  (que el panel re-usa para no depender de la ruta) y el id del step de N5 al que aprobar. */
export const BatchScriptsSchema = z.object({
  batchId: z.string().min(1),
  scripts: z.array(BatchScriptSchema),
});
export type BatchScripts = z.infer<typeof BatchScriptsSchema>;
