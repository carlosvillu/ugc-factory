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
 * Ids de los steps que el cancel NO debe barrer (T5.18, BUG DE PRODUCCIÓN que
 * atrapa dinero gastado). Recibe el conjunto de steps NO-terminales del run (lo que
 * `findCancellableByRun` devuelve) y computa, de forma PURA e inspeccionable sin
 * Postgres, el conjunto a PRESERVAR: cada step `failed` MÁS su cierre transitivo
 * aguas abajo dentro de ese conjunto.
 *
 * POR QUÉ (opción (a), decisión de producto). Un step `failed` es recuperable por el
 * retry granular existente (`retryStep`: failed→queued, reset de retry_count, mismo
 * step_run.id ⇒ top-up; el dedup hace que los hermanos ya generados reusen a 0¢).
 * Barrerlo a `cancelled` (terminal, sin arista de `retry`) DESTRUYE esa
 * recuperabilidad y atrapa los assets ya pagados. Y no basta con preservar el
 * `failed`: la cadena que llega al MÁSTER (N8→N9) cuelga de él en `awaiting_deps`; si
 * el cancel la barriera a `cancelled` (terminal, sin salida), reintentar el `failed`
 * daría el clip pero el máster seguiría INALCANZABLE — el mismo estado atrapado por
 * otra ruta. Por eso se preserva el cierre transitivo aguas abajo COMPLETO.
 *
 * NO se gatea por `retry_count < max_retries`: el retry MANUAL (`retryStep`) RESETEA
 * el contador, así que TODO step `failed` es recuperable — un predicado "recuperable"
 * sería un segundo bug (dejaría atrapado justo el caso que T5.18 existe para escapar).
 *
 * WALKING DENTRO DEL CONJUNTO CANCELABLE (suficiente y declarado): las aristas se
 * derivan del `dependsOn` de los propios steps cancelables. Un dependiente aguas abajo
 * de un `failed` NO puede estar `succeeded`/`queued`/`running` (su dep nunca se
 * resolvió) — está en `awaiting_deps`, luego ES cancelable y ESTÁ en este conjunto.
 * Los únicos nodos que el walk podría "no ver" son ya-terminales, que el barrido no
 * toca de todos modos. Así que recorrer solo las aristas internas basta para preservar
 * la cadena hacia el máster.
 *
 * DEUDA DECLARADA (T5.18): si un `failed` tiene ramas dependientes que NO conducen al
 * máster (p. ej. otra escena independiente), este cierre las preserva TODAS (más simple
 * y defendible: no discriminamos por destino). Quedan en `awaiting_deps` sin auto-avanzar
 * hasta que el usuario resuelva el `failed`; si nunca lo reintenta, son inocuas (sin job,
 * sin coste). No se recomponen automáticamente tras el retry de un dependiente cancelado.
 */
function idsToPreserveOnCancel(steps: StepRow[]): Set<string> {
  // Índice inverso dep→dependientes, construido SOLO con las aristas internas al
  // conjunto cancelable (los ids que no están aquí no importan: son terminales).
  const idsInSet = new Set(steps.map((s) => s.id));
  const dependentsOf = new Map<string, string[]>();
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!idsInSet.has(dep)) continue; // arista hacia fuera del conjunto: irrelevante
      const list = dependentsOf.get(dep);
      if (list) list.push(step.id);
      else dependentsOf.set(dep, [step.id]);
    }
  }
  // Cierre transitivo aguas abajo desde cada `failed`, por PUNTO FIJO: se expande el
  // conjunto `preserve` mientras un step preservado tenga un dependiente aún fuera. El
  // grafo es un DAG finito, así que converge en ≤ |steps| pasadas. Evita el
  // shift/index de una cola BFS (y con ello el non-null assertion vetado por lint).
  const preserve = new Set<string>(steps.filter((s) => s.status === 'failed').map((s) => s.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of [...preserve]) {
      for (const dependent of dependentsOf.get(id) ?? []) {
        if (!preserve.has(dependent)) {
          preserve.add(dependent);
          grew = true;
        }
      }
    }
  }
  return preserve;
}

/**
 * CANCELA un run en curso (§7.1): barrido de `cancel` sobre los steps NO-terminales
 * del run, en UNA tx. No basta cancelar "el step actual": un step en
 * `awaiting_deps`/`queued` sobreviviría y el run no quedaría detenido (Verificación
 * T0.8: "cancel detiene un run en curso"). Devuelve cuántos steps se cancelaron
 * REALMENTE (excluidos los preservados).
 *
 * T5.18 — NO barre el `failed` recuperable NI su cierre transitivo aguas abajo (ver
 * `idsToPreserveOnCancel`): esos sobreviven en su estado (failed / awaiting_deps) para
 * que un retry granular del `failed` desemboque en el máster sin re-pagar. El invariante
 * correcto de "run detenido" NO es "todo lo no-terminal muere" sino "ningún step VIVO
 * (queued/running, con job) sobrevive": un `awaiting_deps` preservado no tiene job y no
 * puede auto-avanzar (solo avanza si el `failed` del que depende se resuelve por un retry
 * EXPLÍCITO del usuario).
 *
 * Idempotente: los steps ya terminales (succeeded/skipped/cancelled/…) no admiten
 * `cancel` (transición ilegal) y ni siquiera entran en `findCancellableByRun`.
 */
export async function cancelRun(deps: CheckpointOpsDeps, runId: string): Promise<number> {
  return deps.withTransaction(async (stores) => {
    // Todos los steps NO-terminales del run, LOCKEADOS en orden por id (evita
    // deadlock 40P01 con transiciones concurrentes). `cancel` es legal desde
    // cualquier estado no terminal.
    const cancellable = await stores.steps.findCancellableByRun(runId);
    // T5.18: excluir del barrido el `failed` recuperable y su downstream (cadena al máster).
    const preserve = idsToPreserveOnCancel(cancellable);
    let cancelled = 0;
    for (const step of cancellable) {
      if (preserve.has(step.id)) continue; // preservado: sigue failed / awaiting_deps
      await applyTransition(stores, step.id, 'cancel');
      cancelled++;
    }
    return cancelled;
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
      // Conserva la identidad de variante (T4.11): un N7 invalidado se re-ejecuta para la MISMA variante.
      ...(old.variantId !== null ? { variantId: old.variantId } : {}),
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
    await enqueueStep(jobs, {
      id: row.id,
      runId: row.runId,
      nodeKey: row.nodeKey,
      variantId: row.variantId ?? null,
    });
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
