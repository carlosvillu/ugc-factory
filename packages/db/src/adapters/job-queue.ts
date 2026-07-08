// Adaptador tx-scoped del puerto `JobQueue` de core (jobs.md §5): lo construye
// `makeWithTransaction` con la tx abierta. La propiedad crítica: el INSERT del
// job de pg-boss va en la MISMA transacción Drizzle que la transición de estado
// (rollback des-encola). `fromDrizzle(tx, sql)` es el adaptador oficial de
// pg-boss v12 que ejecuta el INSERT sobre `tx.execute` (verificado en el paquete
// instalado, pg-boss/dist/adapters/drizzle.js).
import { sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import type { EnqueueRequest } from '@ugc/core/jobs';
import type { JobQueue } from '@ugc/core/orchestrator';
import type { DbTx } from '../client';

export function makeTxJobQueue(boss: PgBoss, tx: DbTx): JobQueue {
  return {
    async enqueue(req: EnqueueRequest): Promise<void> {
      // Validación al ENCOLAR (jobs.md §2): el payload cruza el puerto sin
      // validar; se parsea contra el schema del job antes de tocar la cola.
      const data = req.job.payload.parse(req.payload) as object;
      await boss.send(req.job.name, data, {
        // El INSERT del job va en NUESTRA tx: fromDrizzle envuelve la tx como el
        // IDatabase que espera pg-boss.
        db: fromDrizzle(tx, sql),
        ...(req.singletonKey !== undefined && { singletonKey: req.singletonKey }),
        ...(req.startAfter !== undefined && { startAfter: req.startAfter }),
      });
    },
  };
}
