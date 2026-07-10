// Adaptador del puerto `WithTransaction` de core (db.md §5): abre la tx de
// Drizzle y entrega al orquestador los `TxStores` tx-scoped — core compone la
// transacción sin saber que Drizzle existe. Si `fn` lanza, `db.transaction` hace
// ROLLBACK: des-encola el job (fromDrizzle lo insertó en esta tx) y silencia el
// NOTIFY (Postgres solo lo entrega en COMMIT). Esa atomicidad es la propiedad que
// elimina las carreras webhook/consumer (§9.0).
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import type { WithTransaction } from '@ugc/core/orchestrator';
import type { DbClient } from '../client';
import { makeStepStore } from './step-store';
import { makeTxJobQueue } from './job-queue';
import { makeRunStore } from './run-store';
import { makeAuditStore } from './audit-store';

export function makeWithTransaction(db: DbClient, boss: PgBoss): WithTransaction {
  return (fn) =>
    db.transaction((tx) =>
      fn({
        steps: makeStepStore(tx),
        jobs: makeTxJobQueue(boss, tx), // INSERT del job pg-boss dentro de ESTA tx
        runs: makeRunStore(tx), // INSERT run + steps en ESTA tx (T0.7b)
        audit: makeAuditStore(tx), // INSERT audit_log en ESTA tx (T0.8, §19.1)
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
