// Adaptador del puerto `WithTransaction` de core (db.md §5): abre la tx de
// Drizzle y entrega al orquestador los `TxStores` tx-scoped — core compone la
// transacción sin saber que Drizzle existe. Si `fn` lanza, `db.transaction` hace
// ROLLBACK: des-encola el job (fromDrizzle lo insertó en esta tx) y silencia el
// NOTIFY (Postgres solo lo entrega en COMMIT). Esa atomicidad es la propiedad que
// elimina las carreras webhook/consumer (§9.0).
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import type { WithTransaction } from '@ugc/core/orchestrator';
import type { Logger } from '@ugc/core';
import type { DbClient } from '../client';
import { makeStepStore } from './step-store';
import { makeTxJobQueue } from './job-queue';
import { makeRunStore } from './run-store';
import { makeAuditStore } from './audit-store';
import { makeCostStore } from './cost-store';

export function makeWithTransaction(db: DbClient, boss: PgBoss, logger: Logger): WithTransaction {
  return (fn) =>
    db.transaction((tx) =>
      fn({
        steps: makeStepStore(tx),
        jobs: makeTxJobQueue(boss, tx), // INSERT del job pg-boss dentro de ESTA tx
        runs: makeRunStore(tx), // INSERT run + steps en ESTA tx (T0.7b)
        audit: makeAuditStore(tx), // INSERT audit_log en ESTA tx (T0.8, §19.1)
        // T1.20: rollup del coste real desde el ledger al liquidar un step, en ESTA tx y aislado
        // con un SAVEPOINT (su fallo no puede tumbar la transición). Tx-scoped también en otro
        // sentido: deduplica el agregado del run dentro de la tx (un `cancelRun` de 40 steps
        // recomputa el run UNA vez, no 40). El `logger` es obligatorio — un rollup que se traga
        // su error sin traza estructurada volvería a dejar la columna mintiendo en silencio.
        // Ver cost-store.ts.
        costs: makeCostStore(tx, logger),
        events: {
          notify: async (runId) => {
            // pg_notify parametrizado (no NOTIFY a pelo): solo se ENTREGA en
            // COMMIT (db.md §6, paso 5).
            await tx.execute(sql`SELECT pg_notify('pipeline_events', ${runId})`);
          },
        },
      }),
    );
}
