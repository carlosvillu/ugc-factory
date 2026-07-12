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

/**
 * CP1 · BRIEF — la petición BLOQUEANTE de imágenes del modo manual (§7.2 N3). El brief es VÁLIDO
 * pero el pipeline no puede seguir sin que el usuario decida de dónde sale el frame inicial del
 * i2v: de fotos reales que él sube, o de un packshot que genera la IA (N7a, T4.4 — que es el
 * CONSUMIDOR de esta decisión y quien creará el flag `synthetic_product`).
 */
export const BriefCheckpointDecisionSchema = z.object({
  kind: z.literal('brief'),
  images: z.enum(['upload_images', 'ai_packshot']),
});
export type BriefCheckpointDecision = z.infer<typeof BriefCheckpointDecisionSchema>;

/**
 * La decisión de CUALQUIER checkpoint. Unión discriminada de un solo miembro HOY: `z.discriminatedUnion`
 * con un miembro es legal y expresa la intención (CP2/CP3/CP4 entran aquí como miembros nuevos),
 * a diferencia de un `z.unknown()` que aceptaría cualquier basura en el body de `/approve`.
 */
export const CheckpointDecisionSchema = z.discriminatedUnion('kind', [
  BriefCheckpointDecisionSchema,
]);
export type CheckpointDecision = z.infer<typeof CheckpointDecisionSchema>;
