// El cliente Drizzle sobre node-postgres y los alias de executor (db.md §4).
// `Db` = conexión | transacción: los repos reciben este tipo como primer
// argumento para correr igual dentro o fuera de una tx (lo que permite al
// orquestador componer repos bajo un solo `db.transaction`, T0.7a).
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type DbClient = NodePgDatabase<typeof schema>;
// `DbTx` es interno: solo alimenta la unión `Db`. Se exportará (y entrará al
// barrel) cuando un consumidor externo lo necesite (repos tx-scoped, T0.7a).
type DbTx = Parameters<Parameters<DbClient['transaction']>[0]>[0];
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
