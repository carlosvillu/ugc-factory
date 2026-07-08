// Runner de migraciones con lock (§18.2, T0.3). Vive en @ugc/db —no en apps/web—
// porque es lógica de PERSISTENCIA: apps/web lo cablea al arranque
// (instrumentation.ts) y el CLI `db:migrate` lo invoca, pero un test de
// integración de db que lo ejercita no puede importar de apps/web sin invertir
// la dirección de dependencias (architecture.md §1). [Divergencia declarada
// respecto a db.md §3, que lo ubicaba en apps/web/src/server/migrate.ts;
// reportada para actualizar la skill.]
import { createRequire } from 'node:module';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

/**
 * Clave del advisory lock de migración. Constante propia, distinta de la del
 * harness de tests (CLONE_LOCK_KEY = 724_001). Se EXPORTA porque el test de
 * concurrencia adquiere este mismo lock desde otra conexión para provocar la
 * espera observable (db-integration.md; el lock es load-bearing y la
 * Verificación no lo ejercita).
 */
export const MIGRATION_LOCK_KEY = 724_100;

/**
 * Carpeta con el SQL committeado, resuelta respecto al PAQUETE @ugc/db, nunca
 * `process.cwd()`: el CLI corre desde el dir del paquete, pero instrumentation
 * de web corre desde apps/web y el harness desde cada paquete de tests.
 */
function migrationsFolder(): string {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve('@ugc/db/package.json')), 'drizzle');
}

/**
 * Aplica todas las migraciones pendientes, serializado con un advisory lock de
 * SESIÓN. Si dos procesos arrancan a la vez (deploy, restart de compose), solo
 * uno migra; el otro ESPERA en `pg_advisory_lock` y, al desbloquearse, encuentra
 * el schema ya al día y `migrate()` es un no-op (es idempotente).
 *
 * Usa un `pg.Client` propio (no el pool de Drizzle): un lock de sesión debe
 * adquirirse y liberarse sobre la MISMA conexión, y un Pool no lo garantiza.
 * Esta es la única conexión efímera del runner; se cierra siempre en `finally`.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Bloquea hasta adquirir: si otro proceso migra, esperamos aquí.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await migrate(drizzle(client), { migrationsFolder: migrationsFolder() });
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}
