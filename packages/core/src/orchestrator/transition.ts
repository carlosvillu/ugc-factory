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
import type { StepEvent, StepStatus } from './transitions';
import { nextStatus } from './transitions';
import { timeoutAtFor } from './timeout';
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
    // T1.10a: el auto-skip del nodo inaplicable también TERMINA el trabajo del step
    // (skipped es terminal), igual que el `skip` de usuario.
    event === 'skip_inapplicable' ||
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
export async function enqueueStep(
  jobs: TxStores['jobs'],
  step: Pick<StepRow, 'id' | 'runId' | 'nodeKey'>,
): Promise<void> {
  await jobs.enqueue({
    job: stepExecuteJob,
    payload: { runId: step.runId, stepId: step.id, nodeKey: step.nodeKey },
    singletonKey: `${step.runId}:${step.nodeKey}`,
  });
}

/**
 * Dentro de la tx, resuelve los dependientes de `step` (aguas abajo) cuyas deps
 * YA están todas RESUELTAS: los promueve `awaiting_deps → pending → queued`
 * (§7.1.a: satisfecho ⇒ pending; y como está listo, se encola de inmediato) y
 * crea su job. Devuelve los steps encolados. Recorridos en orden por id
 * (findDependents ya lockea FOR UPDATE en ese orden) para evitar deadlock 40P01
 * (db.md §6) y el lost-wakeup de dos deps completando a la vez (ver el contrato
 * de StepStore.findDependents).
 *
 * Se ejecuta cuando el propio step acaba de RESOLVERSE — entrar en `succeeded` o
 * `skipped` (T0.8): ambos satisfacen una dependencia aguas abajo. Un nodo saltado
 * cuenta como dep cumplida (`resolvedStatus` = succeeded OR skipped), o sus
 * dependientes quedarían varados en `awaiting_deps` para siempre y el run no
 * completaría (Verificación T0.8: "skip lo salta y el run completa").
 */
async function resolveDownstream(
  steps: StepStore,
  jobs: TxStores['jobs'],
  stepId: string,
): Promise<void> {
  const dependents = await steps.findDependents(stepId);
  for (const dep of dependents) {
    if (dep.status !== 'awaiting_deps') continue; // ya avanzó o no aplica
    // ¿Están TODAS las deps de este dependiente RESUELTAS (succeeded o skipped)?
    // (incluida la que acabamos de completar). resolvedStatus lee bajo la misma tx;
    // el dependiente ya está lockeado (findDependents FOR UPDATE), así que la
    // lectura es coherente.
    const statuses = await steps.resolvedStatus(dep.dependsOn);
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
    await enqueueStep(jobs, dep);
  }
}

/**
 * Aplica UNA transición sobre stores YA ligados a una tx abierta: lock, validación
 * pura (§7.1), UPDATE + timestamps, encolado/resolución aguas abajo y NOTIFY. NO
 * abre la transacción — la abre el llamante (`transition` para una sola, `failStep`
 * para fail+retry en una tx coherente). Devuelve el estado destino aplicado.
 */
export async function applyTransition(
  { steps, jobs, events }: TxStores,
  stepId: string,
  event: StepEvent,
  // T0.11: contexto opcional del error para el evento `fail`. El consumer pasa el
  // mensaje del throw del executor; se persiste en `step_run.error` para el visor de
  // logs del panel del canvas. Ignorado en cualquier otro evento (solo `fail` lo
  // escribe; el `retry` lo LIMPIA a null aparte).
  //
  // T1.10a: `outputRefs` opcional — MISMO patrón que `error` en `fail`. Un executor real
  // (N1/N2/N3) produce un artefacto (RawContent, VisualAnalysis, ProductBrief) que el
  // consumer pasa aquí para que quede persistido en `step_run.output_refs` en la MISMA
  // transición (el canal `output_refs` ya existe desde T0.8/checkpoint-ops; esto lo
  // alimenta también desde el camino del EXECUTOR, no solo desde la edición humana de un
  // checkpoint).
  //
  // Lo escriben DOS eventos, no uno:
  //   - `succeed`            → el artefacto producido por el nodo.
  //   - `skip_inapplicable`  → el MOTIVO del auto-skip (p. ej. N2:
  //     `{skipped:true, reason:'no_analyzable_visuals'}`), para que el panel explique POR
  //     QUÉ se saltó el nodo en vez de mostrar un hueco. Si alguien "simplifica" la
  //     condición a solo `succeed`, BORRA ese motivo.
  // Ignorado en el resto de eventos.
  opts: { error?: unknown; outputRefs?: unknown } = {},
): Promise<StepStatus> {
  // 1) Lock de fila + estado BAJO el lock.
  const step = await steps.findForUpdate(stepId);
  if (!step) throw new StepNotFoundError(stepId);

  // 2) Validar contra §7.1 (PURO). Ilegal ⇒ throw ⇒ ROLLBACK (nada tocado).
  const to = nextStatus(step.status, event);
  if (to === null) throw new IllegalTransitionError(stepId, step.status, event);

  // 3) UPDATE del step + timestamps según la transición. El retry LIMPIA
  //    finished_at (null explícito), el resto de terminales lo FIJAN. El `start`
  //    (queued→running) fija además `timeout_at = now + timeoutFor(nodeKey,config)`
  //    (T0.9): el reloj es el de la app (`new Date()`), coherente con el reloj del
  //    host; el sweeper compara `timeout_at` contra el now() de Postgres (mismo
  //    host en el despliegue self-hosted). El override `config.timeout_ms` gana
  //    sobre el mapa por node_key (timeout.ts) — así la Verificación de T0.9
  //    fuerza un timeout de 10 s vía la config del step de demo.
  const now = new Date();
  await steps.update(stepId, {
    status: to,
    ...(setsStartedAt(event) && { startedAt: now }),
    ...(setsStartedAt(event) && { timeoutAt: timeoutAtFor(step.nodeKey, step.config, now) }),
    ...(setsFinishedAt(event) && { finishedAt: now }),
    ...(clearsFinishedAt(event) && { finishedAt: null }),
    // El `retry` (failed→queued) consume un intento: incrementa retry_count
    // ATÓMICAMENTE en el mismo UPDATE, bajo el lock (T0.7b). El GATE
    // `retry_count < max_retries` NO se decide aquí (la tabla pura de §7.1 no
    // conoce el contador): lo evalúa `failStep`/el consumer bajo el lock ANTES de
    // disparar `retry`; agotado ⇒ el step queda `failed` terminal sin retry. Así
    // el step_run.status es la fuente de verdad del progreso.
    ...(event === 'retry' && { incrementRetryCount: true }),
    // T0.11: persistir el error del executor en el `fail` (para el visor del panel);
    // LIMPIARLO (null) en el `retry`, para que un reintento no arrastre el error
    // viejo del intento anterior. Ambos escriben la columna `error`.
    ...(event === 'fail' && { error: opts.error ?? null }),
    ...(event === 'retry' && { error: null }),
    // T1.10a: `outputRefs` del executor — solo si el caller lo pasó (`undefined` = no
    // tocar la columna, mismo criterio de tres-estados que el resto de StepPatch). Lo
    // escriben TRES eventos:
    //   - `succeed`           → el artefacto que produjo el nodo.
    //   - `skip_inapplicable` → el MOTIVO del auto-skip (N2: `{skipped:true,
    //     reason:'no_analyzable_visuals'}`), para que el panel explique POR QUÉ se saltó
    //     el nodo en vez de mostrar un hueco. NO lo quites de la condición: sin él, el
    //     skip queda mudo en la UI.
    //   - `reach_checkpoint`  → T1.10b. Un checkpoint REAL (N3/CP1) hace SU TRABAJO y
    //     LUEGO pausa: el artefacto (el ProductBrief) YA existe cuando el step entra en
    //     `waiting_approval`, y es EXACTAMENTE lo que el usuario tiene que revisar. Sin
    //     esta rama, `reach_checkpoint` dejaba `output_refs` a NULL y CP1 abriría un
    //     editor VACÍO sobre un brief que sí se sintetizó (y se pagó). En F0 el hueco no
    //     se veía porque los checkpoints eran nodos de demo que no producían artefacto.
    // El resto de eventos no lo escriben aquí (edit/approve_edited siguen su propio
    // camino en checkpoint-ops.ts).
    ...((event === 'succeed' || event === 'skip_inapplicable' || event === 'reach_checkpoint') &&
      opts.outputRefs !== undefined && { outputRefs: opts.outputRefs }),
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
    await enqueueStep(jobs, step);
  }

  // 5) Resolver deps aguas abajo cuando este step se RESUELVE y habilita a sus
  //    dependientes (§7.1.a). Se gatea por EVENTO, no solo por estado destino:
  //    - `succeed`/`approve`: running/waiting_approval → succeeded ⇒ resolver.
  //    - `skip`: → skipped ⇒ resolver (un nodo saltado satisface la dep, T0.8).
  //    - `approve_edited`: → succeeded PERO se EXCLUYE a propósito. La invalidación
  //      de sub-grafo (editStep) es el ÚNICO manejador aguas abajo del path de
  //      edición: crea filas NUEVAS con supersedes_id y las encola ella misma. Si
  //      además resolviéramos aquí, promoveríamos la fila ANTIGUA del dependiente
  //      (que luego superseremos) y encolaríamos su job con el mismo singletonKey
  //      que la nueva → la nueva quedaría `queued` SIN job, varada para siempre.
  //    - `skip_inapplicable` (T1.10a): → skipped ⇒ resolver, EXACTAMENTE igual que el
  //      `skip` de usuario. `skipped` es una dep satisfecha venga del evento que venga
  //      (T0.8), así que N3 avanza aunque N2 se haya autodescartado por no tener
  //      imágenes (PRD §7.2). Si esto no resolviera, el run quedaría varado para
  //      siempre en el camino de texto libre sin imágenes.
  if (
    event === 'succeed' ||
    event === 'approve' ||
    event === 'skip' ||
    event === 'skip_inapplicable'
  ) {
    await resolveDownstream(steps, jobs, stepId);
  }

  // 6) NOTIFY pipeline_events, '<run_id>' — solo se entrega en COMMIT (db.md §6).
  await events.notify(step.runId);
  return to;
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
  // T0.11: contexto opcional del error para el evento `fail` (persiste en
  // `step_run.error` para el visor del panel). T1.10a: `outputRefs` opcional para
  // `succeed` (el artefacto que produjo el executor) y para `skip_inapplicable` (el
  // MOTIVO del auto-skip, que el panel muestra). Ignorados en el resto de eventos.
  opts: { error?: unknown; outputRefs?: unknown } = {},
): Promise<void> {
  await deps.withTransaction((stores) => applyTransition(stores, stepId, event, opts));
}

/** Resultado de `failStep`: si tras el fallo el step se reencoló para reintentar
 *  (`queued`) o quedó `failed` terminal (retries agotados). */
export type FailOutcome = 'retried' | 'exhausted';

/**
 * Falla un step Y decide el reintento en UNA SOLA transacción coherente (T0.7b).
 * El consumer llama a esto cuando el executor lanza: bajo el lock de la fila
 * (aplicando `fail` primero) lee `retry_count`/`max_retries` y, si hay margen
 * (`retry_count < max_retries`), aplica `retry` en la MISMA tx — failed→queued +
 * incremento atómico de retry_count + re-encolado del job. Agotado ⇒ deja el step
 * `failed` terminal. Un solo `withTransaction` = ningún otro proceso se cuela
 * entre el fail y la decisión de retry (sin la ventana de dos txs separadas).
 */
export async function failStep(
  deps: TransitionDeps,
  stepId: string,
  // T0.11: el error del executor a persistir en el `fail` (para el visor del panel).
  opts: { error?: unknown } = {},
): Promise<FailOutcome> {
  return deps.withTransaction(async (stores) => {
    await applyTransition(stores, stepId, 'fail', { error: opts.error });
    // Estado bajo el lock TRAS el fail (retry_count aún sin consumir por este
    // intento). El gate compara contra max_retries.
    const failed = await stores.steps.findForUpdate(stepId);
    if (!failed) throw new StepNotFoundError(stepId);
    if (failed.retryCount >= failed.maxRetries) return 'exhausted';
    await applyTransition(stores, stepId, 'retry'); // failed→queued + increment + enqueue
    return 'retried';
  });
}
