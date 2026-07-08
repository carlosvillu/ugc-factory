import { NoopJobSchema, noopJob } from '@ugc/core/jobs';
import type { Logger } from '@ugc/core';
import type { PgBoss } from 'pg-boss';

/**
 * Decide si ESTE intento del job debe fallar. Es una dep inyectable para separar
 * los dos consumidores del comportamiento de fallo (jobs.md §4, `fail_rate` vs
 * `fail_times`):
 *  - producción / Verificación manual: 30% de fallo per-INTENTO aleatorio
 *    (`randomFailRate`) → los retries/backoff son observables en el log y la
 *    tabla, y con retryLimit 3 convergen con holgura.
 *  - tests de integración: inyección determinista keyed por `job.id` (K primeros
 *    intentos fallan, K < retryLimit) → todos `completed` Y `retry_count > 0`
 *    garantizados, sin flakiness (skill testing, principio 7).
 *
 * Per-INTENTO, nunca per-job determinista: un job "maldito" que siempre falla
 * jamás llegaría a `completed` por mucho retryLimit.
 */
export type FailDecider = (jobId: string) => boolean;

/** 30% de fallo aleatorio por intento — el default de producción. */
export function randomFailRate(rate: number): FailDecider {
  return () => Math.random() < rate;
}

/** Nunca falla — el decisor por defecto cuando no se configura caos. */
export const neverFail: FailDecider = () => false;

export interface NoopConsumerDeps {
  boss: PgBoss;
  logger: Logger;
  /** Decisor de fallo, ya resuelto por el composition root (nunca opcional). */
  shouldFail: FailDecider;
}

/**
 * Registra el consumer del job `demo.noop`. Handler idempotente y sin efectos:
 * su único trabajo es (opcionalmente) fallar para ejercitar retries/backoff.
 * pg-boss entrega `Job[]` (batchSize default 1) → se desestructura `[job]`.
 * El default (`neverFail`) se resuelve en el composition root (bootstrap), no
 * aquí: así la decisión "no fallar salvo config" vive en un único sitio visible.
 */
export async function registerNoopConsumer({
  boss,
  logger,
  shouldFail,
}: NoopConsumerDeps): Promise<void> {
  // batchSize 1 + localConcurrency > 1: cada worker procesa UN job (un throw
  // solo falla ese job, no un lote), pero varios drenan en paralelo. Sin esto el
  // consumer procesa serialmente y N jobs con retries tardan N·(intento+backoff)
  // — throughput, no corrección. pollingInterval bajo porque estos son jobs de
  // demo y `demo.noop` no usa NOTIFY (política standard sin notify).
  await boss.work(
    noopJob.name,
    { batchSize: 1, localConcurrency: 10, pollingIntervalSeconds: 0.5 },
    // El handler es de demo (sin I/O real), pero pg-boss exige que devuelva una
    // promesa (WorkHandler): async es obligatorio aunque no haya await.
    // eslint-disable-next-line @typescript-eslint/require-await
    async ([job]) => {
      if (job === undefined) return;
      // Revalida el payload en la punta consumidora (jobs.md §2): un payload
      // viejo o corrupto tras un deploy agota retries hacia la DLQ con error
      // legible en vez de reventar a mitad del handler.
      const parsed = NoopJobSchema.safeParse(job.data);
      if (!parsed.success) {
        throw new Error(`payload de demo.noop inválido: ${parsed.error.message}`);
      }

      const log = logger.child({ queue: noopJob.name, job_id: job.id });
      if (shouldFail(job.id)) {
        // Relanzar registra el intento en pg-boss: el job vuelve a `retry`, su
        // `retry_count` se incrementa en el siguiente fetch y el backoff aplica.
        log.warn({}, 'demo.noop: fallo inyectado — reintentará');
        throw new Error('demo.noop injected failure');
      }
      log.info({}, 'demo.noop: ejecutado');
    },
  );
}
