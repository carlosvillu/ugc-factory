// El lock de migración (§18.2) es load-bearing pero la Verificación de T0.3 NO
// lo ejercita (`pnpm db:migrate` sobre BD vacía pasa igual con un lock roto).
// Este test lo cubre: si dos procesos arrancan a la vez, solo uno migra y el
// otro ESPERA en `pg_advisory_lock` — no corren ambos en paralelo.
//
// La trampa que este test evita: `migrate()` es idempotente, así que "lanzar dos
// y que ambos resuelvan" NO prueba nada. Lo que se prueba es el ORDEN observable:
// mientras un tercero retiene el lock, `runMigrations()` NO progresa; en cuanto
// se libera, progresa. El lock retenido externamente es el sustituto
// determinista del "primer proceso que aún está migrando".
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createTestDatabase, type TestDatabase } from '@ugc/test-utils';
import { MIGRATION_LOCK_KEY, runMigrations } from '../../src/migrate';

let tdb: TestDatabase;
let holder: Client | undefined;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'migrate-lock' });
});

afterEach(async () => {
  // Garantiza que ninguna conexión de "holder" queda reteniendo el lock entre
  // tests (aunque cada test cierra el suyo, este es el cinturón de seguridad).
  if (holder) {
    await holder.end().catch(() => {
      /* la conexión ya podía estar cerrada por el test */
    });
    holder = undefined;
  }
});

afterAll(async () => {
  await tdb.close();
});

/** Resuelve a 'timeout' si `p` no ha resuelto en `ms`; si no, a 'resolved'. */
async function raceAgainstTimer<T>(p: Promise<T>, ms: number): Promise<'resolved' | 'timeout'> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      resolve('timeout');
    }, ms);
  });
  const result = await Promise.race([p.then(() => 'resolved' as const), timeout]);
  clearTimeout(timer!);
  return result;
}

describe('runMigrations: serialización con advisory lock (§18.2)', () => {
  it('ESPERA mientras otra conexión retiene el lock, y progresa al liberarlo', async () => {
    // 1) Un tercero adquiere el mismo lock de migración desde SU propia conexión.
    holder = new Client({ connectionString: tdb.connectionString });
    await holder.connect();
    await holder.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    // 2) runMigrations() intenta adquirir el lock → bloquea en pg_advisory_lock.
    const migration = runMigrations(tdb.connectionString);

    // 3) Observable nº1: tras una espera holgada, la promesa NO ha resuelto.
    //    Si el lock estuviera roto, migrate() ya habría corrido y resuelto aquí.
    expect(await raceAgainstTimer(migration, 500)).toBe('timeout');

    // 4) El holder libera el lock (y cierra) → runMigrations se desbloquea.
    await holder.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    await holder.end();

    // 5) Observable nº2: ahora sí progresa y resuelve (migrate() es no-op sobre
    //    la template ya migrada, pero el punto es que el lock la dejó avanzar).
    await expect(migration).resolves.toBeUndefined();
  });

  it('dos runMigrations concurrentes no se pisan: ambas terminan sin error', async () => {
    // Sin holder externo: se ejercita el camino real de dos arranques a la vez.
    // El advisory lock las serializa; que ambas resuelvan (sobre una BD ya
    // migrada, idempotente) prueba que ninguna aborta por correr en paralelo.
    await expect(
      Promise.all([runMigrations(tdb.connectionString), runMigrations(tdb.connectionString)]),
    ).resolves.toHaveLength(2);
  });
});
