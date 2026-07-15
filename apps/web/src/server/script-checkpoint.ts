// EL SEAM de CP3 (T2.6): el efecto sobre `ad_script` + `ad_variant` que acompaña a la aprobación del
// checkpoint de guiones (N5). Hermano de `brief-checkpoint.ts` (CP1) y `batch-checkpoint.ts` (CP2).
//
// POR QUÉ VIVE AQUÍ Y NO EN CORE (mismo argumento que sus hermanos): `approveStep` es genérico —no
// sabe qué hay en un `output_refs`—; esto es LEER el lote/brief/guiones y ESCRIBIR versiones nuevas y
// estados de variante. Y por qué no en el repo (db): el RE-LINT es lógica de core (`lintScriptForBrief`),
// y la DECISIÓN de si una variante puede pasar a `scripted` depende de ese re-lint. El repo
// (`applyScriptVerdicts`) recibe la decisión YA TOMADA; aquí se toma.
//
// LOS INVARIANTES DUROS (blueprint T2.6):
//
//   1. BLOQUEO SERVER-SIDE. El `approved` del cliente es solo su INTENCIÓN. El servidor DERIVA los
//      flags (re-lint de la edición, o los flags guardados de la v1) y RECHAZA la transición a
//      `scripted` si queda algún flag bloqueante — un POST directo con `approved:true` sobre un
//      guion bloqueante NO lo cuela. NO se confía en ningún flag que mande el cliente.
//
//   2. v2 SOLO SI EL CONTENIDO CAMBIÓ DE VERDAD (misma regla que CP1: «aprobar sin editar NO crea
//      versión»). El SERVIDOR compara el `editedScript` contra la fila vigente; idénticos ⇒ se trata
//      como sin editar (ni v2 ni `edited_by_user`). Que el cliente incluya el campo NO basta: si
//      redonda-viaja los 6 guiones, solo los REALMENTE tocados crean v2. La Verificación pide
//      «`edited_by_user` en LA editada» (singular).
//
//   3. RE-LINT CON EL MISMO BRIEF QUE N5. `lintScriptForBrief` saca bannedClaims/briefLanguage del
//      brief igual que el executor de N5 — así el bloqueo de CP3 reproduce el de la v1 (un flag no
//      aparece/desaparece entre versiones sin que el texto cambie).
//
//   4. ATOMICIDAD. Los tres efectos —insertar v2, fijar flags, pasar a `scripted`— van en UNA tx
//      (la de `applyScriptVerdicts`, anidada bajo la de la aprobación de CP3).
import {
  N5OutputSchema,
  ProductBriefSchema,
  type AdScript,
  type CheckpointDecision,
  type GuardrailFlag,
  type ScriptsCheckpointDecision,
} from '@ugc/core/contracts';
import { lintScriptForBrief, rebuildEditedScript } from '@ugc/core/scripting';
import {
  applyScriptVerdicts,
  getBatch,
  getBrief,
  getLatestScriptsByBatch,
  type DecidedVerdict,
  type Db,
} from '@ugc/db';
import { AppError } from '@ugc/core/contracts';

/** El artefacto de un step de guiones (N5), o `undefined` si el step no es uno. Se discrimina por
 *  SCHEMA (`N5OutputSchema`), nunca por `node_key` (T0.8). */
function parseScriptsOutput(outputRefs: unknown): { batchId: string } | undefined {
  const parsed = N5OutputSchema.safeParse(outputRefs);
  return parsed.success ? { batchId: parsed.data.batchId } : undefined;
}

/** LAS NARRACIONES de las escenas de un guion, en orden: la ÚNICA cosa que el editor de CP3 deja
 *  tocar (todo lo demás —`hook`/`cta`/`fullText`/timing— se DERIVA de ellas, ver `rebuildEditedScript`).
 *  Comparar sobre esto es cómo el servidor decide si hubo edición de verdad: si las narraciones son
 *  idénticas, el guion reconstruido es byte a byte el mismo y no hay nada que versionar. */
function narrationFingerprint(scenes: readonly { narration: string }[]): string {
  return JSON.stringify(scenes.map((s) => s.narration));
}

/**
 * ¿El guion editado del cliente cambia algo respecto a la fila vigente? Compara las NARRACIONES de
 * las escenas (la única superficie editable). El `edited` que llega es el `AdScript` YA
 * RECONSTRUIDO (`rebuildEditedScript`), así que sus escenas están normalizadas; se comparan contra
 * las de la fila vigente, que también se reconstruyen desde sus narraciones para que el round-trip
 * jsonb (reordenar claves, re-timear) no invente una diferencia.
 */
function isRealEdit(rebuilt: AdScript, currentScenes: readonly { narration: string }[]): boolean {
  return narrationFingerprint(rebuilt.scenes) !== narrationFingerprint(currentScenes);
}

/**
 * Efecto de APROBAR el checkpoint de guiones (CP3): aplica los veredictos por-variante.
 *
 * No-op si el step no es N5 o si la decisión no es `scripts` (mismo criterio que CP1/CP2: un efecto
 * que no reconoce su artefacto/decisión no hace nada).
 */
export async function approveScriptsForStep(
  db: Db,
  outputRefs: unknown,
  decision: CheckpointDecision | undefined,
): Promise<void> {
  const output = parseScriptsOutput(outputRefs);
  if (output === undefined) return;
  if (decision?.kind !== 'scripts') return;

  await applyDecidedVerdicts(db, output.batchId, decision);
}

async function applyDecidedVerdicts(
  db: Db,
  batchId: string,
  decision: ScriptsCheckpointDecision,
): Promise<void> {
  // El brief del lote: la fuente de bannedClaims/briefLanguage para el re-lint (la MISMA que usó N5).
  const batch = await getBatch(db, batchId);
  if (batch === undefined) {
    throw new AppError('not_found', `el lote ${batchId} del step de guiones no existe`);
  }
  const briefRow = await getBrief(db, batch.briefId);
  if (briefRow === undefined) {
    throw new AppError('not_found', `el brief ${batch.briefId} del lote no existe`);
  }
  const brief = ProductBriefSchema.parse(briefRow.data);

  // Los guiones VIGENTES del lote, indexados por variante (con su filename_code y flags actuales).
  const latest = await getLatestScriptsByBatch(db, batchId);
  const currentByVariant = new Map(latest.map((l) => [l.variantId, l]));

  const decided: DecidedVerdict[] = decision.verdicts.map((verdict) => {
    const current = currentByVariant.get(verdict.variantId);
    if (current === undefined) {
      // Un veredicto sobre una variante que no es de este lote (o sin guion): el caller está
      // confundido. Rechazar es más honesto que aplicar a ciegas.
      throw new AppError(
        'validation_error',
        `el veredicto apunta a la variante ${verdict.variantId}, que no tiene guion en el lote ${batchId}`,
      );
    }

    // ¿Edición REAL? Solo si el cliente mandó `editedScript` Y difiere de la fila vigente.
    //
    // El `editedScript` se RECONSTRUYE (`rebuildEditedScript`) ANTES de comparar y de lintear: el
    // editor solo toca las narraciones, y `hook`/`cta`/`fullText`/timing se derivan de ellas. Si no
    // se reconstruyera, el cliente (que no calcula timing) mandaría un `fullText`/`hook` RANCIO y el
    // re-lint vería el texto viejo — un claim borrado de una escena seguiría bloqueando y el usuario
    // no podría resolverlo (`lintScript` escanea `fullText + hook + cta + narraciones`).
    const rebuilt =
      verdict.editedScript !== undefined ? rebuildEditedScript(verdict.editedScript) : undefined;
    // Las narraciones de la fila vigente (jsonb) para decidir si la edición cambia algo de verdad.
    const currentScenes = (current.script.scenes as { narration: string }[] | null) ?? [];
    const edited =
      rebuilt !== undefined && isRealEdit(rebuilt, currentScenes) ? rebuilt : undefined;

    // Los FLAGS que gobiernan el bloqueo los DERIVA el servidor, nunca el cliente:
    //   - edición real ⇒ se re-lintea el guion editado (con el brief del lote).
    //   - sin edición  ⇒ se usan los flags guardados de la v1 (mismo texto ⇒ mismo resultado; el
    //                    executor de N5 los escribió con el mismo linter).
    const flags: GuardrailFlag[] = edited
      ? lintScriptForBrief(edited, brief)
      : ((current.script.guardrailFlags as GuardrailFlag[] | null) ?? []);

    const hasBlocking = flags.some((f) => f.blocking);

    return {
      variantId: verdict.variantId,
      // GUARD SERVER-SIDE: solo se aprueba si el cliente lo pidió Y no queda flag bloqueante. Un
      // `approved:true` sobre un guion con flag bloqueante NO transiciona la variante.
      approve: verdict.approved && !hasBlocking,
      // v2 SOLO en edición real; lleva el guion editado + sus flags re-linteados.
      newVersion: edited ? { content: edited, guardrailFlags: flags } : undefined,
    };
  });

  await applyScriptVerdicts(db, { batchId, verdicts: decided });
}
