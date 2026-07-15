// Contrato de la DECISIÓN de un checkpoint (T1.11) — el canal GENÉRICO por el que un checkpoint
// humano transporta lo que el humano DECIDIÓ, y no solo lo que dejó escrito.
//
// LA DISTINCIÓN (es la razón de que este fichero exista, y no es sutil una vez vista):
//
//   - El ARTEFACTO (`step_run.output_refs`, `step-outputs.ts`) es lo que el checkpoint EDITA: el
//     brief, la matriz, los guiones. Tiene AUTOR, y el diff de `audit_log` (§19.1) lo compara
//     IA-vs-humano para medir cuánto corrige el humano a la máquina.
//   - La DECISIÓN es lo que el humano RESUELVE sobre cómo sigue el pipeline: CP1 "no hay fotos
//     del producto: ¿las subes o genero un packshot con IA?" (§7.2 N3 / §9.2), CP2 "qué variantes
//     de la matriz genero", CP3 "qué guiones apruebo", CP4 "re-genero o publico".
//
// No son la misma cosa y no viajan por el mismo sitio: una decisión colada dentro del
// `output_refs` aparecería en el diff de auditoría como si la IA hubiera cambiado de opinión, y
// además viviría lo que vive la fila versionada del brief (que se puede reeditar por
// `PATCH /api/briefs/:id` fuera de todo run, donde una decisión de imágenes no significa nada).
// La decisión vive lo que vive el STEP: se persiste en `checkpoint_decision`, en la MISMA
// transacción que la transición del checkpoint.
//
// UNIÓN DISCRIMINADA POR `kind`: cada checkpoint declara aquí SU forma. F2–F4 añaden miembros sin
// tocar ni la tabla (jsonb + `kind` texto) ni el route handler (que trata la decisión como una
// unidad opaca y solo la valida contra este schema). Hoy solo existe la de CP1.
import { z } from 'zod';
import { AdScriptSchema } from './ad-script';
import { BatchConfigSchema } from './batch-config';

/**
 * CP1 · BRIEF — la petición BLOQUEANTE de imágenes (§7.2 N3). El brief es VÁLIDO pero el pipeline
 * no puede seguir sin que el usuario decida de dónde sale el frame inicial del i2v. TRES salidas
 * (T1.15):
 *   - `upload_images`  : el usuario sube fotos reales del producto.
 *   - `ai_packshot`    : se deriva a un packshot generado por IA (N7a, T4.4 — el CONSUMIDOR de
 *                        esta decisión y quien creará el flag `synthetic_product`).
 *   - `promote_scraped`: se PROMUEVE a hero una de las imágenes que el scrape SÍ trajo (las que
 *                        N2 clasificó como `broll`/secundarias). Es la salida que faltaba: en una
 *                        web de servicio (stayforlong.com) no hay packshot, pero sí hay imágenes
 *                        —y el usuario, que sí sabe cuál sirve, no tenía forma de decirlo.
 *
 * `hero_image_url` acompaña SOLO a `promote_scraped` (la imagen elegida, que debe pertenecer al
 * `assets.images[]` del brief). El invariante se impone AQUÍ y no en el llamante: una decisión
 * `promote_scraped` sin URL es una decisión que N7a no podría ejecutar, y descubrirlo en F4
 * —gastando dinero en fal.ai— es exactamente lo que este contrato existe para impedir.
 *
 * El EFECTO sobre el brief (poner esa imagen en `assets.hero_image_url`) lo aplica el editor de
 * CP1 al versionar el brief: es una edición del ARTEFACTO. Esto de aquí es la DECISIÓN — se
 * persisten las dos, por sus dos canales, y la cabecera de este fichero explica por qué no son la
 * misma cosa.
 */
export const BriefCheckpointDecisionSchema = z
  .object({
    kind: z.literal('brief'),
    images: z.enum(['upload_images', 'ai_packshot', 'promote_scraped']),
    /** La imagen scrapeada elegida como hero. OBLIGATORIA con `promote_scraped`, ausente en el resto. */
    hero_image_url: z.url().optional(),
  })
  .refine((d) => (d.images === 'promote_scraped') === (d.hero_image_url !== undefined), {
    message:
      '`hero_image_url` es obligatoria con `promote_scraped` (y solo con ella): es la imagen que el usuario eligió',
    path: ['hero_image_url'],
  });
export type BriefCheckpointDecision = z.infer<typeof BriefCheckpointDecisionSchema>;

/**
 * CP2 · MATRIZ (T2.3, §7.2 N4) — lo que el humano RESUELVE al confirmar el gasto: **con qué
 * config se compone el lote**. La `BatchConfig` es exactamente la misma forma con la que se pidió
 * la ESTIMACIÓN (`POST /api/batches/estimate`), y eso es el invariante que hace que el lote creado
 * sea el lote presupuestado: si la confirmación viajara con otro shape, el usuario aprobaría un
 * número y el sistema crearía otro.
 *
 * El ARTEFACTO de N4 (`ad_batch.matrix`, el `BatchPlan`) NO viaja aquí — y esa es la distinción
 * que este fichero defiende: el plan lo RECOMPONE el servidor con `composeMatrix` sobre la config
 * decidida (y con el `batchDiscriminator` del lote nuevo, que el cliente no puede conocer porque
 * el `ad_batch.id` no existe hasta la transacción). Aceptar la matriz del cliente sería dejarle
 * escribir directamente las filas de `ad_variant` que se van a facturar.
 */
export const MatrixCheckpointDecisionSchema = z.object({
  kind: z.literal('matrix'),
  config: BatchConfigSchema,
});
export type MatrixCheckpointDecision = z.infer<typeof MatrixCheckpointDecisionSchema>;

/**
 * CP3 · GUIONES (T2.6, §7.2 N5) — lo que el humano RESUELVE al revisar los guiones del lote: qué
 * variantes APRUEBA y, para las que editó, el guion corregido. Un veredicto por variante, todos en
 * UN payload (la aprobación por-variante o del lote es N veredictos en una sola decisión, no N POSTs
 * — el 2.º POST daría 409: el step ya no está en `waiting_approval`).
 *
 * `verdicts` NO puede ir vacío (`.min(1)`): una decisión de CP3 sin ningún veredicto no significa
 * nada y colarla dejaría el step aprobado sin haber tocado ni una variante.
 *
 * ⚠ `editedScript` ES UN INPUT DEL CLIENTE, NO LA VERDAD. Trae el guion que el usuario reescribió;
 * el servidor lo persiste como v2 (`edited_by_user`) y lo RE-LINTEA (`lintScript`, server-side)
 * antes de decidir si la variante pasa a `scripted`. Un `approved:true` sobre un guion con un flag
 * bloqueante NO transiciona la variante — el guard vive en el efecto de dominio (`approveScriptsForStep`),
 * no en este contrato ni en el botón. El `approved` que manda el cliente es su INTENCIÓN; el
 * servidor deriva los flags y puede rechazarla.
 */
export const ScriptVerdictSchema = z.object({
  variantId: z.string().min(1),
  approved: z.boolean(),
  /** El guion reescrito por el usuario. Ausente = aprobar/rechazar el guion tal cual (sin edición,
   *  se conserva la v1 de la IA). Presente = el servidor crea la v2 y re-lintea sobre ELLA. */
  editedScript: AdScriptSchema.optional(),
});
export type ScriptVerdict = z.infer<typeof ScriptVerdictSchema>;

export const ScriptsCheckpointDecisionSchema = z.object({
  kind: z.literal('scripts'),
  verdicts: z.array(ScriptVerdictSchema).min(1),
});
export type ScriptsCheckpointDecision = z.infer<typeof ScriptsCheckpointDecisionSchema>;

/**
 * La decisión de CUALQUIER checkpoint. Unión discriminada por `kind`: CP3/CP4 entran aquí como
 * miembros nuevos, a diferencia de un `z.unknown()` que aceptaría cualquier basura en el body de
 * `/approve`. T1.11 prometió que añadir CP2 costaría **una línea** (sin migración, sin tocar el
 * repo, sin tocar los route handlers) — T2.3 lo ha cobrado: la genericidad era real. CP3 (T2.6) es
 * el segundo cobro: una línea en la unión.
 */
export const CheckpointDecisionSchema = z.discriminatedUnion('kind', [
  BriefCheckpointDecisionSchema,
  MatrixCheckpointDecisionSchema,
  ScriptsCheckpointDecisionSchema,
]);
export type CheckpointDecision = z.infer<typeof CheckpointDecisionSchema>;
