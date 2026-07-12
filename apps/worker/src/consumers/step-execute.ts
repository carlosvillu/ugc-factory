// Consumer GENÉRICO de `step.execute` (T0.7b, jobs.md §4): un único handler para
// toda la cola que resuelve el executor por `node_key` y delega TODO cambio de
// estado en el orquestador (`transition`/`failStep`, §9.0). pg-boss es
// at-least-once → este handler es idempotente por diseño.
//
// Flujo de un job:
//   1. parse del payload (safeParse — payload viejo/corrupto ⇒ DLQ legible).
//   2. transition('start'): queued→running. Si lanza IllegalTransitionError, el
//      step YA NO está en `queued` (redelivery tras crash / doble entrega): NO-OP
//      seguro (log + return), NUNCA un fallo del job. Es la barrera de
//      idempotencia bajo at-least-once.
//   3. resolver el executor por node_key y ejecutarlo con la `config` del step.
//   4. éxito ⇒ transition('succeed'); fallo ⇒ failStep() (fail + gate de retry
//      atómico: reintenta si retry_count<max_retries, si no queda failed terminal).
import { StepExecuteJobSchema, stepExecuteJob } from '@ugc/core/jobs';
import {
  IllegalTransitionError,
  PermanentStepError,
  type ExecutorDep,
  type StepEvent,
  type StepExecutor,
  type TransitionDeps,
  failStep,
  shouldPause,
  transition,
} from '@ugc/core/orchestrator';
import type { Logger } from '@ugc/core';
import { findRunAutopilot, findStep, findStepsByIds, rollupStepCost } from '@ugc/db';
import type { DbClient } from '@ugc/db';
import type { PgBoss } from 'pg-boss';

export interface StepConsumerDeps {
  boss: PgBoss;
  db: DbClient;
  /** withTransaction ya cableado (T0.7a): lo comparten transition/failStep/createRun. */
  transitionDeps: TransitionDeps;
  /** Mapa node_key → executor (executors/index.ts). */
  executors: Record<string, StepExecutor>;
  logger: Logger;
}

export async function registerStepConsumer({
  boss,
  db,
  transitionDeps,
  executors,
  logger,
}: StepConsumerDeps): Promise<void> {
  // batchSize 1 + localConcurrency > 1: cada worker procesa UN job (un throw solo
  // falla ese job), pero varios drenan en paralelo — necesario para que 20 runs
  // concurrentes no se serialicen. La política de la cola (short, retryLimit 0) la
  // fija el registro de core: los reintentos de EJECUCIÓN los gobierna la máquina
  // de estados (failStep), no el retry nativo de pg-boss.
  await boss.work(
    stepExecuteJob.name,
    { batchSize: 1, localConcurrency: 10, pollingIntervalSeconds: 0.5 },
    async ([job]) => {
      if (job === undefined) return;
      const parsed = StepExecuteJobSchema.safeParse(job.data);
      if (!parsed.success) {
        // Payload inválido: agota retries hacia la DLQ con error legible (jobs.md §2).
        throw new Error(`payload de step.execute inválido: ${parsed.error.message}`);
      }
      const { runId, stepId, nodeKey } = parsed.data;
      const log = logger.child({
        queue: stepExecuteJob.name,
        job_id: job.id,
        run_id: runId,
        step_id: stepId,
        node_key: nodeKey,
      });

      // 2) queued→running. La revalidación REAL bajo lock la hace transition(): si
      //    el step ya no está en `queued`, lanza IllegalTransitionError y aquí es un
      //    NO-OP seguro. Este guard es load-bearing: cubre el ÚNICO redelivery real
      //    de pg-boss bajo `retryLimit:0` — la EXPIRACIÓN de un job `active` cuando
      //    el worker que lo tomó MUERE/cuelga sin resolverlo (crash), independiente
      //    de retryLimit. Un segundo worker re-toma el job, encuentra el step ya
      //    `running`/terminal y no-opea sin re-ejecutar.
      //
      //    Otras excepciones (infra: BD caída en el commit del `start`) SÍ propagan.
      //    OJO (honesto): con `retryLimit:0` un throw NO se re-entrega — el job va a
      //    la DLQ y el step queda VARADO en `queued` SIN `timeout_at` (el UPDATE del
      //    `start`, que es quien fija `timeout_at`, no llegó a commitear). El sweeper
      //    de T0.9 SOLO barre los `running` con `timeout_at < now()`, así que NO
      //    rescata estos `queued` varados: quedan como DEUDA CONOCIDA (un reconciler
      //    de `queued` huérfanos está fuera del alcance de T0.9). Aquí solo dejamos
      //    rastro en la DLQ para autopsia, no fingimos recuperación.
      try {
        await transition(transitionDeps, stepId, 'start');
      } catch (err) {
        if (err instanceof IllegalTransitionError) {
          log.info({}, 'step.execute: re-entrega sobre step ya no-queued: no-op idempotente');
          return;
        }
        throw err;
      }

      // 3) Resolver el executor. Un node_key sin executor es un bug de config
      //    PERMANENTE: reintentar es inútil (el executor no va a aparecer). El step
      //    ya está en `running`, así que lo llevamos a `failed` TERMINAL con
      //    `transition('fail')` — NO `failStep`, que gatearía retry_count y
      //    reencolaría hasta agotar max_retries (3 vueltas inútiles + una entrada
      //    DLQ por vuelta). Un solo throw deja rastro en la DLQ.
      const executor = executors[nodeKey];
      if (executor === undefined) {
        log.error({}, 'step.execute: executor desconocido');
        await transition(transitionDeps, stepId, 'fail', {
          error: { message: `executor desconocido para node_key ${nodeKey}` },
        });
        throw new Error(`executor desconocido para node_key ${nodeKey}`);
      }

      // La config vive en la fila; se lee tras el start (sin lock — solo datos).
      const step = await findStep(db, stepId);
      const config = step?.config ?? null;

      // T1.10a: resolver las DEPENDENCIAS del step y entregárselas ya cargadas al executor.
      // Se hace AQUÍ, en el consumer genérico, y no en cada executor, por dos razones:
      //
      //  1) CORRECCIÓN. Se resuelven por los ULIDs EXACTOS de `step.dependsOn`, NUNCA por
      //     `node_key`. `node_key` NO identifica una fila dentro de un run: la invalidación
      //     de un checkpoint (T0.8, `insertSuperseding`) crea una fila NUEVA con el MISMO
      //     `node_key` que la que supersede. Un executor que buscase "el step N1 de mi run"
      //     por su clave leería una fila AL AZAR entre la vigente y la `superseded` — es
      //     decir, podría sintetizar sobre datos VIEJOS sin lanzar un solo error. En cuanto
      //     CP1 (T1.10b) permita editar el brief, ese caso deja de ser hipotético.
      //     `dependsOn` es inmune: el supersede REMAPEA los ids a las filas nuevas.
      //
      //  2) ALTITUD. El executor deja de saber cómo se llaman sus vecinos y deja de hacer
      //     su propio SELECT. Escala a F2–F4, donde hay decenas de nodos hermanos (una
      //     variante por fila de la matriz) sin un `node_key` singular que buscar.
      const depRows = step === undefined ? [] : await findStepsByIds(db, step.dependsOn);
      const deps: ExecutorDep[] = depRows.map((d) => ({
        stepId: d.id,
        nodeKey: d.nodeKey,
        status: d.status,
        outputRefs: d.outputRefs,
      }));

      // 4) Ejecutar el TRABAJO del nodo. El fallo del EXECUTOR y el fallo de
      //    `transition('succeed')` son dos mundos distintos y NO comparten catch:
      //    un `succeed` que falla tras un executor exitoso NO debe re-ejecutar el
      //    trabajo (doble gasto en fal.ai para un executor real de F4). Invariante:
      //    éxito del executor ⇒ JAMÁS failStep.
      //
      //    T1.10a: `capturedOutput` es el canal simétrico a `errorInfo` del catch de
      //    abajo — un executor real (N1/N2/N3) entrega su artefacto llamando a
      //    `collectOutput(refs)` antes de retornar; queda `undefined` si no lo llama
      //    (los executors de demo nunca lo hacen), y el `succeed` de más abajo solo
      //    escribe `output_refs` cuando hay algo capturado (StepPatch: `undefined` =
      //    no tocar la columna).
      //
      //    T1.10a: `inapplicable` es el otro canal de salida del executor — el nodo se
      //    declara NO APLICABLE (N2 sin imágenes que analizar, PRD §7.1/§7.2). No es un
      //    fallo (no lanza) ni un éxito (no hizo el trabajo): cambia el EVENTO DE CIERRE
      //    que elige el consumer más abajo. El executor sigue sin tocar el estado del
      //    step — ese invariante de T0.7b se mantiene intacto.
      //
      //    Ambas señales viven en un objeto mutable (no en dos `let`): el executor las
      //    escribe desde un callback, y TypeScript no sigue esa escritura a través del
      //    closure — con `let` estrecharía el tipo al literal inicial y marcaría los
      //    checks de más abajo como "condición innecesaria". Un campo de objeto no se
      //    estrecha así.
      const outcome: { output?: unknown; inapplicable: boolean } = { inapplicable: false };
      try {
        await executor({
          config,
          signal: job.signal,
          runId,
          stepId,
          deps,
          collectOutput: (refs) => {
            outcome.output = refs;
          },
          markInapplicable: () => {
            outcome.inapplicable = true;
          },
        });
      } catch (err) {
        // Fallo REAL del trabajo del executor ⇒ failStep (fail + retry atómico
        // gateado por retry_count/max_retries). NO relanzamos: el estado del
        // pipeline (step_run) es la fuente de verdad del progreso, no la cola;
        // failStep ya reencoló un job nuevo si procedía, y relanzar duplicaría el
        // reintento (retryLimit 0 + nuestro re-encolado). El job queda `completed`:
        // su trabajo (delegar en la máquina de estados) terminó bien.
        // T1.10a — FALLO PERMANENTE: el executor declara que reintentar es inútil (la
        // entrada es la que es y el resultado sería el mismo: refusal del modelo, config
        // inválida, contrato incumplido). Va a `failed` TERMINAL con `transition('fail')`,
        // NO por `failStep` — exactamente el mismo camino que el "executor desconocido" de
        // más arriba, y por la misma razón. En un nodo de PAGO esto no es una optimización:
        // reintentar 3 veces una síntesis que siempre va a fallar quema ~$0,60 de Sonnet 5
        // para acabar igualmente en `failed`. El coste YA registrado no se pierde
        // (recordAnthropicCost escribe la fila ANTES de que esto se lance: record-first).
        if (err instanceof PermanentStepError) {
          log.error(
            { err },
            'step.execute: fallo PERMANENTE del executor; failed terminal SIN retry',
          );
          try {
            await transition(transitionDeps, stepId, 'fail', {
              error: { message: err.message, permanent: true },
            });
          } catch (failErr) {
            if (failErr instanceof IllegalTransitionError) {
              log.info({}, 'step.execute: fallo permanente sobre step ya no-running: no-op');
              return;
            }
            throw failErr;
          }
          return;
        }

        log.warn({ err }, 'step.execute: executor falló; evaluando retry');
        // failStep aplica `fail` bajo el lock. CARRERA esperada con el sweeper de
        // T0.9: éste puede haber expirado el step (running→expired, terminal)
        // mientras el executor seguía corriendo; el `fail` sobre un step ya
        // `expired` es una transición ilegal → IllegalTransitionError. Es benigno
        // (el step ya está terminal, no hay retry que aplicar): NO-OP idempotente,
        // simétrico con el path de éxito (ver el cierre más abajo). Cualquier otro
        // error (infra: BD caída) SÍ propaga.
        try {
          // T0.11: persistir el mensaje del throw del executor en `step_run.error`
          // para el visor de logs del panel del canvas. Solo el `message` (un jsonb
          // pequeño); el stack no viaja por SSE.
          const errorInfo = { message: err instanceof Error ? err.message : String(err) };
          const outcome = await failStep(transitionDeps, stepId, { error: errorInfo });
          log.info(
            { outcome },
            `step.execute: ${outcome === 'retried' ? 'reencolado para reintento' : 'reintentos agotados, failed terminal'}`,
          );
        } catch (failErr) {
          if (failErr instanceof IllegalTransitionError) {
            log.info(
              {},
              'step.execute: fallo sobre step ya no-running (p.ej. expirado por el sweeper): no-op idempotente',
            );
            return;
          }
          throw failErr;
        }
        return;
      }

      // Executor OK ⇒ decidir la transición de cierre (T0.8): si el step es un
      // checkpoint que debe PAUSAR (según su config + autopilot del run),
      // `reach_checkpoint` (running→waiting_approval); si no, `succeed`
      // (running→succeeded, resuelve deps aguas abajo). La decisión es PURA
      // (shouldPause) sobre banderas INMUTABLES post-creación (is_checkpoint,
      // checkpoint_config, autopilot) ⇒ leerlas sin lock es seguro; la transición
      // re-valida bajo el lock. Su fallo es de INFRAESTRUCTURA/transición, no del
      // trabajo: NUNCA dispara failStep.
      //
      // T1.10a: el nodo INAPLICABLE cierra con `skip_inapplicable` (running→skipped) y
      // ese evento GANA sobre el checkpoint: un nodo que no ha hecho trabajo no tiene
      // artefacto que aprobar, así que pausarlo en `waiting_approval` dejaría al usuario
      // revisando la nada y al run bloqueado. `skipped` satisface la dep aguas abajo
      // (T0.8) ⇒ los dependientes (N3) avanzan igual.
      const autopilot = (await findRunAutopilot(db, runId)) ?? false;
      const pause = shouldPause({
        isCheckpoint: step?.isCheckpoint ?? false,
        checkpointConfig: step?.checkpointConfig ?? null,
        autopilot,
      });
      const closingEvent: StepEvent = outcome.inapplicable
        ? 'skip_inapplicable'
        : pause
          ? 'reach_checkpoint'
          : 'succeed';

      // T1.10b — ROLLUP DEL COSTE REAL, ANTES de la transición de cierre.
      //
      // El servicio que gastó (Firecrawl/Anthropic) YA escribió su `cost_entry` con
      // `step_run_id = este step` (record-first, T1.4: la fila del gasto se escribe DENTRO del
      // servicio, ANTES de retornar — nunca se mueve de ahí, o un throw intermedio perdería
      // dinero ya gastado). Lo que faltaba —y lo que hacía que el canvas mostrase $0,00 con 20
      // céntimos gastados— es la columna `step_run.cost_actual`, que es la que suma el KPI. Se
      // RECOMPUTA aquí desde `cost_entry` (rollup, no acumulador: recalculable ⇒ no puede
      // derivar de la verdad granular del ledger).
      //
      // FRONTERA (T1.10a): la columna del step la escribe el ORQUESTADOR (esto), nunca
      // `@ugc/services` — los servicios solo escriben SU gasto.
      //
      // ANTES del cierre y no después: el cierre es lo que dispara el NOTIFY → SSE, así que si
      // el rollup fuese después, el frontend recibiría el step ya `succeeded`/`waiting_approval`
      // con `cost_actual` todavía a NULL y no habría un segundo evento que lo corrigiera (el KPI
      // se quedaría a 0 hasta el siguiente cambio del run).
      //
      // Su fallo NO tumba el step (el trabajo está hecho y el gasto está registrado en
      // `cost_entry`, que es la verdad del ledger): se loguea y se sigue. El rollup es
      // RECOMPUTABLE — un fallo aquí es una columna desactualizada, no dinero perdido.
      try {
        await rollupStepCost(db, stepId);
      } catch (err) {
        log.warn({ err }, 'step.execute: rollup de cost_actual falló (el cost_entry sí está)');
      }

      try {
        // T1.10a: `outputRefs` capturado del executor (si lo hubo) viaja en la MISMA
        // transición de cierre — sea `succeed` (N1/N2/N3, sin checkpoint) o
        // `reach_checkpoint` (un futuro nodo real que además sea checkpoint). `opts`
        // ignora el campo si el evento no es uno de los dos que lo persisten
        // (transition.ts solo lo escribe en `succeed`; ver su comentario).
        await transition(transitionDeps, stepId, closingEvent, { outputRefs: outcome.output });
      } catch (err) {
        if (err instanceof IllegalTransitionError) {
          // Carrera: el step ya no está `running` (p. ej. cancel/supersede en T0.8,
          // o un redelivery que ya lo cerró). No-op idempotente — el trabajo está
          // hecho, no hay nada que rehacer.
          log.info({}, 'step.execute: cierre sobre step ya no-running: no-op idempotente');
          return;
        }
        // Infra (BD caída en el commit del succeed): propaga. HONESTO: con
        // `retryLimit:0` el job va a la DLQ SIN re-entrega y el step queda VARADO en
        // `running` con su trabajo YA hecho. Como sigue `running` y CONSERVA el
        // `timeout_at` que fijó el `start`, el sweeper de T0.9 lo llevará a `expired`
        // cuando venza — no es una recuperación (el trabajo se pierde) pero SÍ lo
        // saca del limbo `running` sin intervención. Aquí NO fingimos recuperación ni
        // re-ejecutamos — dejamos rastro para autopsia. Crítico: NO pasa por failStep
        // (el trabajo se completó).
        log.error(
          { err },
          'step.execute: succeed falló por infra; step varado en running (el sweeper de T0.9 lo expira al vencer timeout_at)',
        );
        throw err;
      }
    },
  );
}
