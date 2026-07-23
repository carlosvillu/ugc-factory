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
  createRun,
  generationRunDefinition,
  type VariantGenerationPlan,
  type WithTransaction,
} from '@ugc/core/orchestrator';
import {
  applyScriptVerdicts,
  getBatch,
  getBrief,
  getLatestScriptsByBatch,
  type DecidedVerdict,
  type Db,
} from '@ugc/db';
import { buildVariantGenerationPlan, isTierGenerationReady } from '@ugc/services';
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

/** El resultado de aprobar CP3: el id del RUN DE GENERACIÓN N6→N7 arrancado en la MISMA tx para las
 *  variantes `scripted`, o `undefined` si CP3 no aprobó ninguna (nada que generar) O si el tier aún no
 *  es generation-ready (b-roll pendiente-F4 → las variantes quedan `scripted` sin arrancar run). Viaja
 *  hasta la respuesta de `/approve` para que el cliente navegue al canvas de generación (patrón del
 *  `nextRunId` de CP2); su ausencia significa «aprobado, sin run de generación que mostrar». */
export interface ScriptsCheckpointResult {
  nextRunId?: string;
}

/**
 * Efecto de APROBAR el checkpoint de guiones (CP3): aplica los veredictos por-variante y —si el tier es
 * generation-ready— arranca el RUN DE GENERACIÓN N6→N7 de las variantes que quedaron `scripted`.
 *
 * No-op si el step no es N5 o si la decisión no es `scripts` (mismo criterio que CP1/CP2: un efecto
 * que no reconoce su artefacto/decisión no hace nada) → `{}`.
 *
 * DOS ETAPAS SEPARADAS (regla 6, 2026-07-23 — se relaja deliberadamente la atomicidad que T4.11 declaraba
 * «ninguna variante scripted sin su run»): (1) los veredictos → `scripted` commitean SIEMPRE que la
 * aprobación proceda; (2) el arranque de generación es BEST-EFFORT y solo ocurre si `isTierGenerationReady`
 * (los tiers test/standard con b-roll aún etiqueta NO lo están). Cuando el tier SÍ está listo, veredictos
 * + `createRun` siguen commiteando juntos (un throw de plan/createRun hace rollback de ambos) — la
 * money-safety se conserva para los tiers que generan; lo que cambia es que un tier NO-listo ya no tumba
 * la transición `scripted` (era la regresión: aprobar guiones en tier test daba 500 y revertía todo).
 */
export async function approveScriptsForStep(
  db: Db,
  withTransaction: WithTransaction,
  outputRefs: unknown,
  decision: CheckpointDecision | undefined,
): Promise<ScriptsCheckpointResult> {
  const output = parseScriptsOutput(outputRefs);
  if (output === undefined) return {};
  if (decision?.kind !== 'scripts') return {};

  return applyDecidedVerdicts(db, withTransaction, output.batchId, decision);
}

async function applyDecidedVerdicts(
  db: Db,
  withTransaction: WithTransaction,
  batchId: string,
  decision: ScriptsCheckpointDecision,
): Promise<ScriptsCheckpointResult> {
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

  // ── EL ARRANQUE (BEST-EFFORT) DEL RUN DE GENERACIÓN N6→N7, EN ESTA MISMA TX ───────────────────────
  // Las variantes que quedaron `scripted` (aprobadas + sin flag bloqueante) son EXACTAMENTE las que
  // `applyScriptVerdicts` transicionó — se derivan del `decided` (no se re-consulta la BD): `approve:true`.
  const scriptedVariantIds = decided.filter((d) => d.approve).map((d) => d.variantId);
  if (scriptedVariantIds.length === 0) {
    // CP3 no aprobó ninguna variante (todo rechazado o bloqueado): no hay nada que generar. Como CP2
    // sin decisión `matrix`, no se arranca ningún run.
    return {};
  }

  // DESACOPLE DE ETAPAS (regla 6, 2026-07-23): aprobar guiones → `scripted` es un hecho sobre el TEXTO,
  // incondicional. Arrancar la generación es SEPARADO y solo tiene sentido si el tier es generation-ready.
  // T4.11 los fusionó en una sola tx con atomicidad «ninguna variante scripted sin su run»; eso hacía que
  // un tier con el b-roll aún ETIQUETA (test/standard, §13.1) reventara la aprobación entera —
  // `buildVariantGenerationPlan` lanzaba y el rollback deshacía los `scripted` (regresión: N5 nunca
  // llegaba a `succeeded`, E2E de fase F2 rojo en silencio desde T4.11). Ahora la generación es
  // BEST-EFFORT: si el tier no está listo, las variantes quedan `scripted` (commit) y NO se arranca run.
  //
  // El gate es un PREDICADO explícito (`isTierGenerationReady`), NO un try/catch alrededor de
  // `buildVariantGenerationPlan` — eso se tragaría los throws REALES (voz incoherente, persona sin
  // imagen) igual que el benigno endpoint-pendiente-F4 (regla 5a: no colapsar errores tipados en un
  // estado genérico). Con el tier listo, cualquier throw de `buildVariantGenerationPlan` SIGUE siendo un
  // bug ruidoso que aborta la aprobación — money-safety intacta para los tiers que SÍ generan.
  if (!(await isTierGenerationReady(db, batch.tier))) {
    return {};
  }

  // Un `VariantGenerationPlan` por variante `scripted` (lee recipe×tier + voice_map + guion de la BD —
  // la MISMA tx). Con el tier ya confirmado generation-ready, un throw aquí es un fallo REAL (persona mal
  // configurada, catálogo incoherente), no un endpoint pendiente → sigue ruidoso, aborta el lote entero
  // (rollback) antes de crear un run a medias. Secuencial: fail-fast.
  const plans: VariantGenerationPlan[] = [];
  for (const variantId of scriptedVariantIds) {
    plans.push(await buildVariantGenerationPlan({ db }, { variantId }));
  }

  // `createRun` inserta el `pipeline_run` de generación + su sub-DAG N6→N7a-e POR VARIANTE y encola los
  // roots (N6), todo dentro del `withTransaction` del scope de dominio (savepoint sobre la tx de la
  // aprobación de CP3). Si lanza, `applyScriptVerdicts` de arriba se deshace con el rollback externo.
  const { runId } = await createRun(
    { withTransaction },
    generationRunDefinition(batch.projectId, plans),
  );

  return { nextRunId: runId };
}
