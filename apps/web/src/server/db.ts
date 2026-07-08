// Accessor lazy de la conexión Drizzle para los route handlers (testing/api.md
// §2.1): NUNCA se crea la conexión en module scope — importar `route.ts` no debe
// abrir un pool ni leer env. El primer `getDb()` en producción la crea desde
// `DATABASE_URL`; los tests la sustituyen con `setDbForTests(testDb)` para apuntar
// al Postgres del Testcontainer.
import { createDb, type DbClient } from '@ugc/db';

let override: DbClient | undefined;
let fromEnv: DbClient | undefined;

/** Solo para tests: inyecta (o limpia con `undefined`) la BD del test database. */
export function setDbForTests(db: DbClient | undefined): void {
  override = db;
}

export function getDb(): DbClient {
  if (override) return override;
  fromEnv ??= createDb(process.env.DATABASE_URL ?? '');
  return fromEnv;
}
