// Un clon aislado de la template por suite (db-integration.md §3). El clon nace
// exactamente en el estado post-migraciones; el aislamiento es por construcción
// (una BD por fichero) y el paralelismo de workers de vitest es gratis.
import { randomBytes } from 'node:crypto';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import { inject } from 'vitest';
import * as schema from '@ugc/db/schema';
import { withDatabaseName } from './postgres-container';

// La augmentación de ProvidedContext vive aquí (donde se llama a inject) además
// de en global-setup.ts: el typecheck de @ugc/db compila este fichero sin
// arrastrar global-setup.ts al mismo programa, así que sin esto inject('pg…')
// infiere `never`.
declare module 'vitest' {
  export interface ProvidedContext {
    pgServerUri: string;
    pgTemplateDb: string;
  }
}

// Interno: solo tipa el campo `db` de `TestDatabase`. Los consumidores acceden a
// `tdb.db` sin nombrar el tipo; se exportará si algún test necesita anotarlo.
type DrizzleDb = NodePgDatabase<typeof schema>;

export interface TestDatabase {
  db: DrizzleDb;
  pool: Pool;
  connectionString: string;
  close: () => Promise<void>;
}

// Clave arbitraria pero fija: serializa los CREATE DATABASE … TEMPLATE entre
// workers paralelos. Distinta de MIGRATION_LOCK_KEY (724_100) de @ugc/db.
const CLONE_LOCK_KEY = 724_001;

/**
 * Clona la template en una BD nueva y aislada (~decenas de ms: copia de
 * ficheros, no re-migración). Dentro de vitest no pases serverUri/templateDb: se
 * leen vía inject(), nunca de env. Los overrides existen para scripts FUERA de
 * vitest.
 */
export async function createTestDatabase(opts?: {
  label?: string; // opcional: visible en pg_stat_activity (debugging). Ponlo siempre.
  serverUri?: string; // override para scripts fuera de vitest
  templateDb?: string;
}): Promise<TestDatabase> {
  const serverUri = opts?.serverUri ?? inject('pgServerUri');
  const templateDb = opts?.templateDb ?? inject('pgTemplateDb');
  const name = `test_${randomBytes(6).toString('hex')}`;

  const admin = new Client({ connectionString: serverUri });
  await admin.connect();
  // Postgres no permite clonar una template mientras otra clonación la tiene
  // abierta, y los workers paralelos clonan a la vez: el advisory lock serializa
  // el CREATE y el retry cubre sesiones rezagadas (55006).
  await admin.query('SELECT pg_advisory_lock($1)', [CLONE_LOCK_KEY]);
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        // Identificadores generados aquí mismo (hex), jamás input externo: la
        // interpolación en el DDL es segura (CREATE DATABASE no acepta $1).
        await admin.query(`CREATE DATABASE ${name} TEMPLATE ${templateDb}`);
        break;
      } catch (err) {
        if ((err as { code?: string }).code !== '55006' || attempt >= 5) throw err;
        await new Promise((r) => setTimeout(r, 100 * attempt));
      }
    }
  } finally {
    await admin.query('SELECT pg_advisory_unlock($1)', [CLONE_LOCK_KEY]);
  }

  const connectionString = withDatabaseName(serverUri, name);
  const pool = new Pool({
    connectionString,
    max: 5,
    // Visible en pg_stat_activity: pista nº1 para cazar una suite que filtró una
    // conexión (db-integration.md §8).
    application_name: opts?.label ?? 'ugc-test-db',
  });
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    connectionString,
    close: async () => {
      await pool.end(); // 1) soltar nuestras conexiones
      // 2) WITH (FORCE) (PG13+) mata sesiones filtradas: un leak dentro de la
      //    suite no bloquea la limpieza ni deja BDs zombis en el contenedor.
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}
