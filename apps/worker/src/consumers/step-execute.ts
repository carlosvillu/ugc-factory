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
  type StepExecutor,
  type TransitionDeps,
  failStep,
  shouldPause,
  transition,
} from '@ugc/core/orchestrator';
import type { Logger } from '@ugc/core';
import { findRunAutopilot, findStep } from '@ugc/db';
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
        await transition(transitionDeps, stepId, 'fail');
        throw new Error(`executor desconocido para node_key ${nodeKey}`);
      }

      // La config vive en la fila; se lee tras el start (sin lock — solo datos).
      const step = await findStep(db, stepId);
      const config = step?.config ?? null;

      // 4) Ejecutar el TRABAJO del nodo. El fallo del EXECUTOR y el fallo de
      //    `transition('succeed')` son dos mundos distintos y NO comparten catch:
      //    un `succeed` que falla tras un executor exitoso NO debe re-ejecutar el
      //    trabajo (doble gasto en fal.ai para un executor real de F4). Invariante:
      //    éxito del executor ⇒ JAMÁS failStep.
      try {
        await executor({ config, signal: job.signal });
      } catch (err) {
        // Fallo REAL del trabajo del executor ⇒ failStep (fail + retry atómico
        // gateado por retry_count/max_retries). NO relanzamos: el estado del
        // pipeline (step_run) es la fuente de verdad del progreso, no la cola;
        // failStep ya reencoló un job nuevo si procedía, y relanzar duplicaría el
        // reintento (retryLimit 0 + nuestro re-encolado). El job queda `completed`:
        // su trabajo (delegar en la máquina de estados) terminó bien.
        log.warn({ err }, 'step.execute: executor falló; evaluando retry');
        // failStep aplica `fail` bajo el lock. CARRERA esperada con el sweeper de
        // T0.9: éste puede haber expirado el step (running→expired, terminal)
        // mientras el executor seguía corriendo; el `fail` sobre un step ya
        // `expired` es una transición ilegal → IllegalTransitionError. Es benigno
        // (el step ya está terminal, no hay retry que aplicar): NO-OP idempotente,
        // simétrico con el path de éxito (ver el cierre más abajo). Cualquier otro
        // error (infra: BD caída) SÍ propaga.
        try {
          const outcome = await failStep(transitionDeps, stepId);
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
      const autopilot = (await findRunAutopilot(db, runId)) ?? false;
      const pause = shouldPause({
        isCheckpoint: step?.isCheckpoint ?? false,
        checkpointConfig: step?.checkpointConfig ?? null,
        autopilot,
      });
      const closingEvent = pause ? 'reach_checkpoint' : 'succeed';
      try {
        await transition(transitionDeps, stepId, closingEvent);
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
