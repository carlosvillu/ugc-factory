import type { EnqueueRequest } from '@ugc/core/jobs';
import type { JobQueue } from '@ugc/core/orchestrator';
import type { PgBoss } from 'pg-boss';

/**
 * Implementación concreta del puerto `JobQueue` de core (jobs.md §2), cableada en
 * el composition root del worker. Valida el payload al ENCOLAR (la otra punta la
 * revalida el consumer con safeParse) y delega en `boss.send()`.
 *
 * pg-boss se INYECTA — la impl no abre ni posee su propia conexión. Ese es el
 * único punto que forzaría un rewrite en T0.7a, donde `transition()` encolará con
 * un adaptador tx-scoped (`fromDrizzle`) sobre la MISMA transacción de la
 * transición (jobs.md §5); ahí vivirá una `makeTxJobQueue(boss, tx)` separada.
 * Recibir pg-boss desde fuera deja ese seam abierto sin construirlo aquí.
 */
export function makeJobQueue(boss: PgBoss): JobQueue {
  return {
    async enqueue(req: EnqueueRequest): Promise<void> {
      const data = req.job.payload.parse(req.payload) as object;
      await boss.send(req.job.name, data, {
        ...(req.singletonKey !== undefined && { singletonKey: req.singletonKey }),
        ...(req.startAfter !== undefined && { startAfter: req.startAfter }),
      });
    },
  };
}
