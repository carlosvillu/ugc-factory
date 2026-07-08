// El cliente Drizzle sobre node-postgres y los alias de executor (db.md §4).
// `Db` = conexión | transacción: los repos reciben este tipo como primer
// argumento para correr igual dentro o fuera de una tx (lo que permite al
// orquestador componer repos bajo un solo `db.transaction`, T0.7a).
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type DbClient = NodePgDatabase<typeof schema>;
// `DbTx` lo consume el adaptador tx-scoped del orquestador (job-queue.ts, T0.7a):
// `fromDrizzle` necesita la tx tipada. Interno al paquete (import relativo desde
// los adaptadores); NO entra al barrel público hasta que un consumidor externo
// lo pida.
export type DbTx = Parameters<Parameters<DbClient['transaction']>[0]>[0];
export type Db = DbClient | DbTx;

/**
 * Bajo nivel: quien posee el pool (worker) lo pasa y lo cierra él en el shutdown.
 * Interno por ahora — el único consumidor es `createDb`; el worker lo usará
 * (y entonces se exporta) cuando cablee su pool propio (T0.6).
 */
function makeDb(pool: Pool): DbClient {
  return drizzle(pool, { schema });
}

/**
 * Conveniencia: pool interno a partir de una connection string. Lo usan los
 * accessors de web (T0.4) y los tests que abren conexiones propias. Quien lo
 * crea es dueño del pool y responsable de cerrarlo.
 */
export function createDb(connectionString: string): DbClient {
  return makeDb(new Pool({ connectionString }));
}

/**
 * Como `createDb` pero DEVUELVE también el `Pool` para que el dueño lo cierre
 * (`pool.end()`) en su shutdown (architecture.md §6: el worker POSEE su pool). El
 * consumer del worker (T0.7b) necesita cerrar su pool al parar pg-boss, o sus
 * conexiones vivas reciben un 57P01 cuando la BD del test se dropea con FORCE.
 */
export function createDbPool(connectionString: string): { db: DbClient; pool: Pool } {
  const pool = new Pool({ connectionString });
  // Un `error` de Pool sin listener tumba el proceso. Cuando la BD se cae o se
  // reinicia (57P01/57P03: admin shutdown), o —en tests— se dropea con FORCE
  // mientras el pool aún cierra, las conexiones vivas emiten ese error de forma
  // esperada: se absorbe. Cualquier OTRO error se re-lanza para no ocultar bugs.
  // Paralelo (no idéntico) al pool de @ugc/test-utils, que absorbe solo 57P01: el
  // pool de producción cubre además 57P03 (admin shutdown por reinicio de la BD),
  // que test-utils no necesita. Si se unifican, conservar el superconjunto.
  pool.on('error', (err: Error & { code?: string }) => {
    if (err.code === '57P01' || err.code === '57P03') return;
    throw err;
  });
  return { db: makeDb(pool), pool };
}
