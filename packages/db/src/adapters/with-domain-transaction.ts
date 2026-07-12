// `withDomainTransaction` (T1.10b): compone una escritura de DOMINIO con una operación del
// ORQUESTADOR en UNA SOLA transacción.
//
// EL PROBLEMA QUE RESUELVE (y es un problema de CORRECCIÓN, no de estilo). Los checkpoints
// tienen dos mitades que deben ser atómicas entre sí:
//
//   1. el efecto de DOMINIO: versionar el `product_brief` que el usuario acaba de editar (y en
//      F2–F4: la matriz, los guiones, las variantes…).
//   2. la operación del ORQUESTADOR: `editStep` (approve_edited + persistir el artefacto +
//      invalidar el sub-grafo aguas abajo + auditar el diff).
//
// Si (1) commitea y (2) falla —doble clic, run cancelado entre medias, step ya no en
// `waiting_approval`—, queda una fila `product_brief` HUÉRFANA: una versión que ningún step
// referencia, que quema un número de versión (el linaje v1→v3 sugiere una edición que nunca
// ocurrió) y que un lector futuro de "el brief actual de este producto" (F2, el compositor de la
// matriz) se llevaría por delante creyendo que el usuario la aprobó. Y no se arregla invirtiendo
// el orden: `editStep` NECESITA el `briefId` de la versión nueva para escribirlo en el
// `output_refs`; la versión tiene que existir ANTES.
//
// CÓMO. Se abre UNA tx; el callback recibe (a) el executor `Db` de esa tx —para los repos de
// dominio— y (b) un `WithTransaction` ATADO A ESA MISMA TX, que es lo que el orquestador espera.
// El `withTransaction` interno abre una transacción ANIDADA de Drizzle: en Postgres eso es un
// SAVEPOINT, no una tx nueva — participa del mismo commit. Si CUALQUIERA de las dos mitades
// lanza, la tx externa hace ROLLBACK y las dos desaparecen: ni brief huérfano, ni step editado
// sin su brief. La misma propiedad que ya sostiene al orquestador (rollback ⇒ des-encola el job y
// silencia el NOTIFY) se extiende así al efecto de dominio.
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import type { WithTransaction } from '@ugc/core/orchestrator';
import type { Db, DbClient } from '../client';
import { makeStepStore } from './step-store';
import { makeTxJobQueue } from './job-queue';
import { makeRunStore } from './run-store';
import { makeAuditStore } from './audit-store';

/** Lo que el callback recibe: el executor de la tx (para los repos) y el `withTransaction` que
 *  hay que pasarle a la operación del orquestador para que corra DENTRO de ella. */
export interface DomainTxScope {
  db: Db;
  withTransaction: WithTransaction;
}

export async function withDomainTransaction<T>(
  db: DbClient,
  boss: PgBoss,
  fn: (scope: DomainTxScope) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) =>
    fn({
      db: tx,
      // Transacción ANIDADA = SAVEPOINT sobre la de fuera (Drizzle/Postgres). El orquestador
      // sigue viendo el mismo puerto `WithTransaction` de siempre y no se entera de nada: no
      // aprende qué es un brief, que es justo lo que no debe aprender.
      withTransaction: (inner) =>
        tx.transaction((tx2) =>
          inner({
            steps: makeStepStore(tx2),
            jobs: makeTxJobQueue(boss, tx2),
            runs: makeRunStore(tx2),
            audit: makeAuditStore(tx2),
            events: {
              notify: async (runId) => {
                await tx2.execute(sql`SELECT pg_notify('pipeline_events', ${runId})`);
              },
            },
          }),
        ),
    }),
  );
}
