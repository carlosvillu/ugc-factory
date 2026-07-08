// `transition(stepId, event)` (§9.0): el corazón del orquestador. Una transición
// de estado de un step, TRANSACCIONAL, que elimina las carreras webhook (web) vs
// consumer (worker). Orquesta EFECTOS vía puertos (ports.ts) sin saber que
// Drizzle o pg-boss existen; la validación es lógica PURA (transitions.ts).
//
// Orden dentro de UNA transacción (db.md §6):
//   1. SELECT … FOR UPDATE sobre la fila (StepStore.findForUpdate): lock + estado
//      BAJO el lock.
//   2. Validar contra §7.1 (nextStatus): ilegal ⇒ throw ⇒ ROLLBACK, fila intacta,
//      cero jobs, cero NOTIFY.
//   3. UPDATE del step (+ timestamps según la transición).
//   4. Resolver depends_on aguas abajo: dependientes en `awaiting_deps` cuyas
//      deps YA están todas en `succeeded` pasan a `pending`.
//   5. Encolar en pg-boss (JobQueue tx-scoped, fromDrizzle) los steps LISTOS.
//   6. NOTIFY pipeline_events (RunNotifier): solo se entrega en COMMIT.
// Rollback des-encola el job y silencia el NOTIFY: la atomicidad es la propiedad
// clave (jobs.md §5).
import { stepExecuteJob } from '../jobs';
import type { StepEvent } from './transitions';
import { nextStatus } from './transitions';
import type { StepRow, StepStore, TxStores, WithTransaction } from './ports';

/**
 * Se lanza cuando (estado, evento) no es una transición válida de §7.1, o cuando
 * bajo el lock el estado ya no admite el evento (carrera: el otro proceso ya
 * aplicó la transición). El llamante la distingue de un error de infraestructura
 * y responde 409/no-op sin reintentar (db.md §6).
 */
export class IllegalTransitionError extends Error {
  readonly stepId: string;
  readonly from: string;
  readonly event: StepEvent;
  constructor(stepId: string, from: string, event: StepEvent) {
    super(`Illegal transition for step ${stepId}: '${from}' --(${event})--> ✗ (§7.1)`);
    this.name = 'IllegalTransitionError';
    this.stepId = stepId;
    this.from = from;
    this.event = event;
  }
}

/** Se lanza si el step referenciado no existe (findForUpdate → null). */
export class StepNotFoundError extends Error {
  readonly stepId: string;
  constructor(stepId: string) {
    super(`Step not found: ${stepId}`);
    this.name = 'StepNotFoundError';
    this.stepId = stepId;
  }
}

/** Dependencias de `transition()`: el composition root cablea `withTransaction`
 *  (adaptador de db.md §5). Un objeto para que crezca sin romper la firma. */
export interface TransitionDeps {
  withTransaction: WithTransaction;
}

/** Estados que cuentan como "trabajo empezado": fijan `started_at` al entrar. */
function setsStartedAt(event: StepEvent): boolean {
  return event === 'start';
}

/** Eventos que terminan el trabajo de un step: fijan `finished_at` al entrar.
 *  Incluye `supersede`: `superseded` es un estado terminal como el resto y su
 *  `finished_at` alimenta el linaje de costes (§7.1.c). */
function setsFinishedAt(event: StepEvent): boolean {
  return (
    event === 'succeed' ||
    event === 'approve' ||
    event === 'approve_edited' ||
    event === 'fail' ||
    event === 'reject' ||
    event === 'expire' ||
    event === 'skip' ||
    event === 'cancel' ||
    event === 'supersede'
  );
}

/** El retry (failed→queued) reabre el trabajo: LIMPIA el `finished_at` que fijó
 *  el `fail`, o el run reintentado tendría `finished_at < started_at`. */
function clearsFinishedAt(event: StepEvent): boolean {
  return event === 'retry';
}

/**
 * Encola un step para su ejecución (jobs.md §5): crea el job `step.execute` en la
 * MISMA tx (rollback des-encola). Se llama SIEMPRE que un step alcanza `queued` —
 * así `queued` (§7.1) significa de verdad "en la cola con un job", no un estado
 * huérfano.
 *
 * La barrera PRIMARIA contra el doble-encolado es el LOCK DE FILA (findForUpdate /
 * findDependents FOR UPDATE): los dos caminos que encolan un step gatean en
 * estados mutuamente excluyentes (`enqueue` sobre `pending`, `resolveDownstream`
 * sobre `awaiting_deps`) y se serializan sobre el lock, de modo que el segundo
 * intento ve el estado ya cambiado y no reencola. La `singletonKey =
 * '${runId}:${nodeKey}'` + policy `short` es DEFENSA EN PROFUNDIDAD sobre ese
 * mecanismo: un belt que hoy protege un path inalcanzable (ver informe FIX 6). Se
 * mantiene por corrección del contrato, no porque el dedup sea load-bearing.
 */
async function enqueueStep(jobs: TxStores['jobs'], step: StepRow): Promise<void> {
  await jobs.enqueue({
    job: stepExecuteJob,
    payload: { runId: step.runId, stepId: step.id, nodeKey: step.nodeKey },
    singletonKey: `${step.runId}:${step.nodeKey}`,
  });
}

/**
 * Dentro de la tx, resuelve los dependientes de `step` (aguas abajo) cuyas deps
 * YA están todas en `succeeded`: los promueve `awaiting_deps → pending → queued`
 * (§7.1.a: satisfecho ⇒ pending; y como está listo, se encola de inmediato) y
 * crea su job. Devuelve los steps encolados. Recorridos en orden por id
 * (findDependents ya lockea FOR UPDATE en ese orden) para evitar deadlock 40P01
 * (db.md §6) y el lost-wakeup de dos deps completando a la vez (ver el contrato
 * de StepStore.findDependents).
 *
 * SOLO se ejecuta cuando el propio step acaba de entrar en `succeeded`: es la
 * única transición que puede satisfacer una dependencia aguas abajo.
 */
async function resolveDownstream(
  steps: StepStore,
  jobs: TxStores['jobs'],
  stepId: string,
): Promise<void> {
  const dependents = await steps.findDependents(stepId);
  for (const dep of dependents) {
    if (dep.status !== 'awaiting_deps') continue; // ya avanzó o no aplica
    // ¿Están TODAS las deps de este dependiente en succeeded? (incluida la que
    // acabamos de completar). succeededStatus lee bajo la misma tx; el dependiente
    // ya está lockeado (findDependents FOR UPDATE), así que la lectura es coherente.
    const statuses = await steps.succeededStatus(dep.dependsOn);
    const allSatisfied = dep.dependsOn.every((id) => statuses[id] === true);
    if (!allSatisfied) continue;
    // awaiting_deps satisfecho ⇒ el step queda listo: pasa directo a `queued`
    // (deps_satisfied→pending y pending→enqueue en un paso, ya que no hay nada que
    // espere entremedias) y se encola. §7.1.a + jobs.md §5.
    // DELIBERADO: este salto colapsa DOS transiciones de §7.1 (awaiting_deps→
    // pending→queued) en un UPDATE que NO pasa por nextStatus. El par
    // awaiting_deps→queued no es una entrada de la tabla pura a propósito: es un
    // atajo interno del resolver, no una transición dirigible por evento. El
    // estado final es idéntico al de los dos saltos encadenados.
    await steps.update(dep.id, { status: 'queued' });
    await enqueueStep(jobs, { ...dep, status: 'queued' });
  }
}

/**
 * Aplica `event` al step `stepId` (§9.0). Atómico: o toda la transición
 * (UPDATE + deps + encolado + NOTIFY) o nada (rollback). Lanza
 * `IllegalTransitionError` (transición inválida bajo el lock) o
 * `StepNotFoundError` sin efectos.
 */
export async function transition(
  deps: TransitionDeps,
  stepId: string,
  event: StepEvent,
): Promise<void> {
  await deps.withTransaction(async ({ steps, jobs, events }: TxStores) => {
    // 1) Lock de fila + estado BAJO el lock.
    const step = await steps.findForUpdate(stepId);
    if (!step) throw new StepNotFoundError(stepId);

    // 2) Validar contra §7.1 (PURO). Ilegal ⇒ throw ⇒ ROLLBACK (nada tocado).
    const to = nextStatus(step.status, event);
    if (to === null) throw new IllegalTransitionError(stepId, step.status, event);

    // 3) UPDATE del step + timestamps según la transición. El retry LIMPIA
    //    finished_at (null explícito), el resto de terminales lo FIJAN.
    await steps.update(stepId, {
      status: to,
      ...(setsStartedAt(event) && { startedAt: new Date() }),
      ...(setsFinishedAt(event) && { finishedAt: new Date() }),
      ...(clearsFinishedAt(event) && { finishedAt: null }),
    });

    // Invalidación de sub-grafo (§7.1.b editar / §7.1.c superseder): EFECTO en
    // T0.8. Aquí la transición a `succeeded`/`superseded` ya está aplicada; la
    // creación del step_run nuevo con supersedes_id y el paso del sub-grafo a
    // `superseded` son un no-op documentado hasta T0.8.
    // invalidación sub-grafo: T0.8

    // 4) ENCOLADO en la MISMA tx (rollback des-encola). Un step que alcanza
    //    `queued` (evento `enqueue`: pending→queued) tiene, por definición de
    //    §7.1, un job en la cola: se crea aquí.
    if (to === 'queued') {
      await enqueueStep(jobs, { ...step, status: 'queued' });
    }

    // 5) Resolver deps aguas abajo SOLO cuando este step entró en `succeeded`:
    //    es lo único que puede habilitar a un dependiente (§7.1.a). Los
    //    dependientes listos pasan a `queued` y se encolan dentro de resolveDownstream.
    if (to === 'succeeded') {
      await resolveDownstream(steps, jobs, stepId);
    }

    // 6) NOTIFY pipeline_events, '<run_id>' — solo se entrega en COMMIT (db.md §6).
    await events.notify(step.runId);
  });
}
