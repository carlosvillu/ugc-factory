// Operaciones de checkpoint, skip y cancel (T0.8, §7.1.b/§7.1.c). Cada una es una
// transición (o un BARRIDO de transiciones) TRANSACCIONAL sobre el orquestador,
// más — en el path de edición — la invalidación del sub-grafo aguas abajo y —en
// approve/edit/reject— la escritura del diff en `audit_log` (§19.1).
//
// Todas reusan el `applyTransition` INTERNO (transition.ts) dentro de UN solo
// `withTransaction`: el precedente exacto es `failStep` (dos applyTransition, una
// tx). El `transition()` público abre su propia tx y no sirve para los fan-outs de
// una-sola-tx que exigen cancel (barrido de todo el run) e invalidación (superseder
// el sub-grafo entero de forma atómica).
//
// Frontera de core (SKILL.md backend, principio 1): sin BD, sin cola. Orquesta
// puertos.
import { newUlid } from '../contracts';
import { applyTransition, enqueueStep, StepNotFoundError, transition } from './transition';
import type { TransitionDeps } from './transition';
import type { NewSupersedingStepRow, StepRow, TxStores } from './ports';

/** Deps de las operaciones de checkpoint: el mismo `withTransaction` que el resto
 *  del orquestador. Un objeto para crecer sin romper la firma. */
export type CheckpointOpsDeps = TransitionDeps;

/** Actor fijo del audit_log en mono-usuario (§19.1). */
const AUDIT_ACTOR = 'user';
const AUDIT_ENTITY = 'step_run';

/**
 * APRUEBA un step en `waiting_approval` sin cambios: `approve` → `succeeded`
 * (resuelve deps aguas abajo con los artefactos de la IA intactos) + fila de
 * auditoría con diff vacío (aprobó tal cual). Todo en UNA tx.
 */
export async function approveStep(deps: CheckpointOpsDeps, stepId: string): Promise<void> {
  await deps.withTransaction(async (stores) => {
    const before = await stores.steps.findForUpdate(stepId);
    if (!before) throw new StepNotFoundError(stepId);
    // `approve`: waiting_approval → succeeded. applyTransition resuelve deps aguas
    // abajo (los dependientes con todas sus deps satisfechas pasan a queued).
    await applyTransition(stores, stepId, 'approve');
    // Auditoría (§19.1): aprobó sin editar ⇒ ai y edited coinciden (diff sin cambio).
    await writeCheckpointAudit(stores, {
      action: 'approve',
      stepId,
      ai: before.outputRefs,
      edited: before.outputRefs,
    });
  });
}

/**
 * RECHAZA un step en `waiting_approval`: `reject` → `rejected` (terminal). Los
 * dependientes quedan varados en `awaiting_deps` a propósito (una rama rechazada
 * no continúa): NO se resuelve nada aguas abajo. Escribe auditoría del rechazo.
 * Todo en UNA tx.
 */
export async function rejectStep(deps: CheckpointOpsDeps, stepId: string): Promise<void> {
  await deps.withTransaction(async (stores) => {
    const before = await stores.steps.findForUpdate(stepId);
    if (!before) throw new StepNotFoundError(stepId);
    await applyTransition(stores, stepId, 'reject');
    await writeCheckpointAudit(stores, {
      action: 'reject',
      stepId,
      ai: before.outputRefs,
      edited: null, // rechazado: no hay artefacto editado
    });
  });
}

/**
 * EDITA y aprueba un step en `waiting_approval` (§7.1.b): el usuario reemplaza los
 * artefactos de la IA (`output_refs`) por los suyos, se aprueba, y se INVALIDA el
 * sub-grafo aguas abajo (§7.1.c). En UNA tx:
 *   1. `approve_edited`: waiting_approval → succeeded. NO resuelve deps aguas abajo
 *      (applyTransition excluye `approve_edited` a propósito — la invalidación es el
 *      único manejador del path de edición).
 *   2. persiste el `output_refs` editado sobre el step aprobado.
 *   3. invalida el cierre transitivo aguas abajo (supersede + filas nuevas).
 *   4. escribe el diff IA-vs-editado en `audit_log`.
 */
export async function editStep(
  deps: CheckpointOpsDeps,
  stepId: string,
  editedOutputRefs: unknown,
): Promise<void> {
  await deps.withTransaction(async (stores) => {
    // 0) LOCK ORDERING (FIX deadlock 40P01): adquiere el lock de E JUNTO a su
    //    cierre transitivo en orden de id monótono, ANTES de cualquier transición.
    //    Si lockeáramos E primero (findForUpdate) y el cierre después, E podría
    //    quedar delante de un descendiente con id menor (createRun genera los ULID
    //    en orden de DEFINICIÓN, no topológico), invirtiendo el orden respecto a
    //    `cancelRun` (que lockea el run entero por id) → deadlock. Con este barrido
    //    ordenado, edit y cancel adquieren los locks del run en el MISMO orden.
    const locked = await stores.steps.findStepAndClosureForUpdate(stepId);
    const before = locked.find((s) => s.id === stepId);
    if (!before) throw new StepNotFoundError(stepId);
    // El cierre transitivo aguas abajo es el conjunto lockeado MENOS E. Ya está
    // bloqueado (FOR UPDATE, orden por id) por la query de arriba; no se re-consulta
    // en invalidateDownstream. El `approve_edited` + el `update` intermedios solo
    // tocan E, así que el lock del closure sigue válido.
    const closure = locked.filter((s) => s.id !== stepId);

    // 1) approve_edited → succeeded. applyTransition NO resuelve aguas abajo para
    //    este evento (evita promover/encolar la fila antigua del dependiente que
    //    luego superseremos — colisión de singletonKey, ver transition.ts).
    await applyTransition(stores, stepId, 'approve_edited');

    // 2) Persistir el artefacto editado sobre el step ya `succeeded`. El estado no
    //    cambia; solo output_refs.
    await stores.steps.update(stepId, { status: 'succeeded', outputRefs: editedOutputRefs });

    // 3) Invalidar el sub-grafo aguas abajo: superseder cada step alcanzable y
    //    re-encolar los nuevos roots. Se le pasa el `closure` YA lockeado.
    await invalidateDownstream(stores, closure);

    // 4) Auditoría (§19.1): diff artefacto-IA (output_refs original) vs editado.
    await writeCheckpointAudit(stores, {
      action: 'edit',
      stepId,
      ai: before.outputRefs,
      edited: editedOutputRefs,
    });
  });
}

/**
 * SALTA un step skippable: `skip` → `skipped`. applyTransition resuelve deps aguas
 * abajo tratando `skipped` como dep satisfecha (T0.8), de modo que los
 * dependientes del nodo saltado avanzan y el run completa. UNA tx. Sin auditoría:
 * skip no es una edición de artefacto (§19.1 audita edits en checkpoints).
 */
export async function skipStep(deps: CheckpointOpsDeps, stepId: string): Promise<void> {
  // skip no audita (no es una edición de artefacto), así que no necesita el
  // pre-fetch de outputRefs que sí hacen approve/edit/reject. Colapsa a una
  // transición simple: `transition` ya lockea la fila y lanza StepNotFoundError /
  // IllegalTransitionError igual. applyTransition('skip') resuelve deps aguas abajo
  // tratando `skipped` como dep satisfecha (T0.8), de modo que el run puede completar.
  await transition(deps, stepId, 'skip');
}

/**
 * CANCELA un run en curso (§7.1): barrido de `cancel` sobre TODOS los steps
 * NO-terminales del run, en UNA tx. No basta cancelar "el step actual": un step en
 * `awaiting_deps`/`queued` sobreviviría y el run no quedaría detenido
 * (Verificación T0.8: "cancel detiene un run en curso"). Devuelve cuántos steps se
 * cancelaron.
 *
 * Idempotente: los steps ya terminales (succeeded/failed/skipped/cancelled/…) no
 * admiten `cancel` (transición ilegal) y se saltan sin error.
 */
export async function cancelRun(deps: CheckpointOpsDeps, runId: string): Promise<number> {
  return deps.withTransaction(async (stores) => {
    // Todos los steps NO-terminales del run, LOCKEADOS en orden por id (evita
    // deadlock 40P01 con transiciones concurrentes). `cancel` es legal desde
    // cualquier estado no terminal.
    const cancellable = await stores.steps.findCancellableByRun(runId);
    for (const step of cancellable) {
      await applyTransition(stores, step.id, 'cancel');
    }
    return cancellable.length;
  });
}

// --- Invalidación de sub-grafo (§7.1.c) --------------------------------------

/**
 * Invalida el cierre transitivo aguas abajo de un step editado (T0.8, anclaje A).
 * Recibe el `closure` YA lockeado (FOR UPDATE, orden por id) que `editStep`
 * obtuvo con `findStepAndClosureForUpdate` — NO lo re-consulta. En la MISMA tx del
 * edit:
 *  - Cada step del cierre: la fila antigua → `superseded`; una fila NUEVA con el
 *    MISMO node_key, supersedes_id→id de la antigua, dependsOn REMAPEADO (ids
 *    nuevos para deps DENTRO del cierre; ids originales para deps fuera), y estado
 *    inicial recalculado (pending si todas sus deps ya están resueltas;
 *    awaiting_deps si no).
 *  - Re-encola los nuevos roots (deps ya resueltas) — mismo encolado transaccional
 *    que createRun.
 *
 * INVARIANTE (journal T0.7b #4): NO hay UNIQUE(run_id, node_key); la fila nueva
 * comparte node_key con la superseded. El singletonKey del encolado es
 * `${runId}:${nodeKey}`: como la fila antigua del sub-grafo estaba en
 * `awaiting_deps` (no encolada, sin job — a un checkpoint no le siguen jobs vivos),
 * no hay colisión con el job de la fila nueva.
 */
async function invalidateDownstream(stores: TxStores, closure: StepRow[]): Promise<void> {
  const { steps, jobs } = stores;
  if (closure.length === 0) return;

  // Cada fila del cierre estrena un ULID nuevo. `newId` mapea id-antiguo→nuevo;
  // el `?? depId` del remapeo es una salvaguarda de tipo (una dep dentro del cierre
  // SIEMPRE tiene entrada, pero evita el non-null assertion vetado por lint).
  const newId = new Map<string, string>(closure.map((s) => [s.id, newUlid()]));

  // 1) Superseder cada fila antigua (evento `supersede`: → superseded, terminal).
  //    Se hace ANTES de insertar/resolver las nuevas para que resolvedStatus no
  //    cuente una fila antigua como satisfactoria de una nueva.
  for (const old of closure) {
    await applyTransition(stores, old.id, 'supersede');
  }

  // 2) Construir e insertar las filas nuevas con dependsOn remapeado.
  const newRows: NewSupersedingStepRow[] = closure.map((old) => {
    const remappedDeps = old.dependsOn.map(
      // Dep DENTRO del cierre ⇒ apunta al id nuevo del sub-grafo. Dep FUERA del
      // cierre (p. ej. el step editado, que queda `succeeded` con su id) ⇒ id
      // original (el `?? depId` cubre ambos casos sin assertion).
      (depId) => newId.get(depId) ?? depId,
    );
    return {
      id: newId.get(old.id) ?? old.id,
      runId: old.runId,
      nodeKey: old.nodeKey,
      // Estado provisional; se recalcula tras conocer los estados de las deps.
      status: 'awaiting_deps',
      dependsOn: remappedDeps,
      supersedesId: old.id,
      config: old.config,
      isCheckpoint: old.isCheckpoint,
      checkpointConfig: old.checkpointConfig,
    } satisfies NewSupersedingStepRow;
  });

  for (const row of newRows) {
    await steps.insertSuperseding(row);
  }

  // 3) Resolver el estado inicial de cada fila nueva y encolar los que quedan
  //    listos. Una dep está resuelta si su step está en succeeded/skipped
  //    (resolvedStatus). Las deps remapeadas dentro del cierre apuntan a filas
  //    nuevas recién insertadas en `awaiting_deps` (no resueltas) ⇒ el dependiente
  //    espera; las deps fuera del cierre (el step editado) ya están succeeded ⇒
  //    satisfechas. Así los roots del sub-grafo (dependientes DIRECTOS del step
  //    editado, sin otras deps sin resolver) pasan a queued y se encolan.
  //
  //    Se consultan TODOS los depends_on de una vez (un solo SELECT en vez de N):
  //    el mapa es estable durante el bucle porque las únicas escrituras de aquí
  //    ponen filas a `queued`, y `resolvedStatus` solo cuenta succeeded/skipped —
  //    nunca `queued` — así que ninguna fila cambia de "no resuelta" a "resuelta"
  //    a mitad de bucle.
  const allDeps = [...new Set(newRows.flatMap((row) => row.dependsOn))];
  const resolved = await steps.resolvedStatus(allDeps);
  for (const row of newRows) {
    const allResolved = row.dependsOn.every((id) => resolved[id] === true);
    if (!allResolved) continue; // sigue en awaiting_deps
    await steps.update(row.id, { status: 'queued' });
    await enqueueStep(jobs, { id: row.id, runId: row.runId, nodeKey: row.nodeKey });
  }

  // El NOTIFY del run lo emite el applyTransition del approve_edited/supersede; no
  // hace falta uno extra aquí.
}

// --- Auditoría (§19.1) -------------------------------------------------------

interface CheckpointAuditInput {
  action: 'approve' | 'edit' | 'reject';
  stepId: string;
  /** output_refs propuesto por la IA (el original). */
  ai: unknown;
  /** output_refs tras la acción del usuario (editado / aprobado / null en reject). */
  edited: unknown;
}

/**
 * Escribe una fila de `audit_log` (§19.1) con el diff artefacto-IA vs editado.
 * `diff` es un objeto `{ ai, edited }` en JSONB — útil para comparar qué cambió el
 * usuario respecto a lo que propuso la IA (mejora de prompts).
 */
async function writeCheckpointAudit(stores: TxStores, input: CheckpointAuditInput): Promise<void> {
  await stores.audit.write({
    actor: AUDIT_ACTOR,
    action: input.action,
    entity: AUDIT_ENTITY,
    entityId: input.stepId,
    diff: { ai: input.ai ?? null, edited: input.edited ?? null },
  });
}
