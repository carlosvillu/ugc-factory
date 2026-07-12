// EL SEAM de CP1 (T1.10b): el efecto sobre `product_brief` que acompaña a la aprobación o
// edición del checkpoint del brief (N3).
//
// POR QUÉ VIVE AQUÍ Y NO EN CORE. `approveStep`/`editStep` (checkpoint-ops.ts) son operaciones
// GENÉRICAS del orquestador: mueven estados, invalidan sub-grafos y auditan diffs, y no saben —
// ni deben saber— qué hay dentro de un `output_refs`. Meter `product_brief` ahí acoplaría la
// máquina de estados al dominio del análisis, y en F2–F4 habría que meter también la matriz, los
// guiones y las variantes. El efecto de DOMINIO se compone FUERA: el route handler llama al
// mecanismo genérico de checkpoint (que sigue siendo el único) y, si el artefacto del step es un
// brief, además versiona la fila. No hay una segunda máquina de checkpoints.
//
// ATOMICIDAD (T1.10b, post-review): las dos funciones de aquí toman un `Db` —conexión O
// TRANSACCIÓN— y los route handlers las llaman DENTRO de la misma tx que la operación del
// orquestador (`withDomainTransaction`, @ugc/db). No es un detalle: el efecto de dominio y la
// transición de estado tienen que commitear JUNTOS o no commitear.
//   - edit:    si `editStep` falla DESPUÉS de crear la v2, la v2 quedaría HUÉRFANA (una versión
//              que ningún step referencia, que quema un número y que un lector futuro de "el
//              brief actual" —F2, el compositor de la matriz— se llevaría creyendo que el usuario
//              la aprobó). Y no se arregla invirtiendo el orden: `editStep` necesita el `briefId`
//              nuevo para escribirlo en el `output_refs`.
//   - approve: si `approveBrief` falla DESPUÉS de `approveStep`, el run ya ha REANUDADO aguas
//              abajo y el brief se queda en `draft` PARA SIEMPRE — y no es reintentable (un
//              segundo POST da IllegalTransitionError: el step ya no está en `waiting_approval`).
//              El usuario aprobó y su brief figura como borrador.
// Con una sola tx los dos casos desaparecen por CONSTRUCCIÓN: o las dos mitades, o ninguna.
//
// EL VERSIONADO, en una frase: `product_brief.version` es un contador por `url_analysis_id`,
// INDEPENDIENTE del ciclo de vida de los steps (el supersede versiona STEPS; esto versiona
// BRIEFS). Se cruzan solo en que un `editStep` sobre CP1 PROVOCA un bump.
//
//   v1 → la escribe N3 (worker) al sintetizar: `draft`, `edited_by_user:false`,
//        `origin_step_run_id` = el step que la produjo (su clave de idempotencia: es lo que le
//        permite REUSAR el brief ya pagado en un reintento en vez de re-sintetizarlo).
//   v2 → CP1 con edición: fila NUEVA `approved` + `edited_by_user:true`, y el `output_refs`
//        editado que se pasa a `editStep` referencia SU `briefId` (el step apunta a la versión
//        que el usuario aprobó, no a la de la IA). SIN `origin_step_run_id`: no la produjo una
//        máquina, la escribió el humano — y un humano puede editar dos veces.
//   v3+ → `PATCH /api/briefs/:id`, fuera de un run (otro camino, sin step).
//
// APROBAR SIN EDITAR **NO** CREA v2: solo marca el v1 `approved`. Un v2 idéntico al v1 pero con
// `edited_by_user:true` MENTIRÍA sobre quién escribió ese contenido — y ese campo existe justo
// para medir cuánto corrige el humano a la IA (§19.1).
import { N3OutputSchema, type ProductBrief } from '@ugc/core/contracts';
import { approveBrief, createBriefVersion, getBrief, type Db } from '@ugc/db';

/** El artefacto de un step de brief (N3), o `undefined` si el step no es uno (o no tiene
 *  artefacto). Se discrimina por SCHEMA (`N3OutputSchema`), no por `node_key`: `node_key` no
 *  identifica una fila tras un supersede (T0.8), y además la forma del artefacto es lo que de
 *  verdad decide si hay un brief que versionar. */
function parseBriefOutput(outputRefs: unknown): { briefId: string } | undefined {
  const parsed = N3OutputSchema.safeParse(outputRefs);
  return parsed.success ? { briefId: parsed.data.briefId } : undefined;
}

/**
 * Efecto de APROBAR SIN EDITAR el checkpoint del brief: el v1 de la IA pasa a `approved`. Sin
 * versión nueva y sin `edited_by_user` (ver cabecera). No-op si el step no es un brief.
 */
export async function approveBriefForStep(db: Db, outputRefs: unknown): Promise<void> {
  const output = parseBriefOutput(outputRefs);
  if (output === undefined) return;
  await approveBrief(db, output.briefId);
}

/**
 * Efecto de EDITAR el checkpoint del brief: crea la versión SIGUIENTE (v2) con el brief que el
 * usuario dejó, `approved` + `edited_by_user:true`, y devuelve el `output_refs` que hay que
 * pasarle a `editStep` — el MISMO artefacto pero apuntando a la versión nueva.
 *
 * El `output_refs` resultante lleva las dos cosas: el `briefId` de la fila v2 (fuente de verdad)
 * y el brief inline (lo que el panel del canvas y el excerpt del SSE muestran sin ir a la BD).
 * Si divergen, manda la fila.
 */
export async function createEditedBriefVersion(
  db: Db,
  previousOutputRefs: unknown,
  editedBrief: ProductBrief,
): Promise<unknown> {
  const parsed = N3OutputSchema.safeParse(previousOutputRefs);
  if (!parsed.success) {
    // El step no tiene un artefacto de brief: quien llame con `{brief}` a un step que no es CP1
    // está confundido, y tragárselo persistiría una edición en ningún sitio.
    throw new Error('el step no es un checkpoint de brief (su output no es un N3Output)');
  }
  const previous = await getBrief(db, parsed.data.briefId);
  if (previous === undefined) {
    throw new Error(`el brief ${parsed.data.briefId} del step no existe`);
  }

  const next = await createBriefVersion(db, {
    urlAnalysisId: previous.urlAnalysisId,
    data: editedBrief,
    // El idioma es del ANÁLISIS: se hereda (editar un hook no cambia en qué idioma se analizó).
    language: previous.language,
    editedByUser: true,
    status: 'approved',
  });

  return {
    ...parsed.data,
    briefId: next.id,
    brief: editedBrief,
  };
}
