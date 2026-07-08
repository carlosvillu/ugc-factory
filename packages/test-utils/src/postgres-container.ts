// Arranque del Testcontainer de Postgres 16 y creación de la template migrada
// (db-integration.md §2). Un contenedor por run; una template con TODAS las
// migraciones del producto aplicadas; N clones (uno por suite) vía
// `CREATE DATABASE … TEMPLATE`. Testcontainers gestiona el ciclo de vida del
// contenedor — nadie declara `services:` en CI.
import { createRequire } from 'node:module';
import path from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

// Nombre de la template migrada. Interno: solo lo usa este módulo (el nombre no
// cruza fronteras — quien clona lee `templateDb` del harness devuelto).
const TEMPLATE_DB = 'ugc_template';

export interface PostgresHarness {
  serverUri: string; // conexión al servidor (BD de mantenimiento `postgres`)
  templateDb: string; // template ya migrada
  stop: () => Promise<void>;
}

export function withDatabaseName(uri: string, dbName: string): string {
  const url = new URL(uri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function migrationsFolder(): string {
  // Ruta resuelta respecto al paquete @ugc/db, NUNCA process.cwd(): los scripts
  // por paquete ejecutan vitest desde el directorio del paquete.
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve('@ugc/db/package.json')), 'drizzle');
}

export async function startPostgresContainer(): Promise<PostgresHarness> {
  const container = await new PostgreSqlContainer('postgres:16')
    .withDatabase('postgres') // la conexión admin va a la BD de mantenimiento
    .withEnvironment({ TZ: 'UTC', PGTZ: 'UTC' })
    // Datos desechables: sin fsync el run va notablemente más rápido.
    .withCommand([
      'postgres',
      '-c',
      'fsync=off',
      '-c',
      'synchronous_commit=off',
      '-c',
      'full_page_writes=off',
    ])
    .start();

  const serverUri = container.getConnectionUri();

  // 1) Crear la template y aplicarle las migraciones reales del producto.
  const admin = new Client({ connectionString: serverUri });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);

  const migrator = new Client({
    connectionString: withDatabaseName(serverUri, TEMPLATE_DB),
  });
  await migrator.connect();
  await migrate(drizzle(migrator), { migrationsFolder: migrationsFolder() });
  // 2) CERRAR: CREATE DATABASE … TEMPLATE exige CERO conexiones activas a la BD
  //    origen. Un pool abierto aquí rompe todos los clones.
  await migrator.end();

  // 3) Blindaje contra conexiones accidentales (mismo truco que template0): una
  //    BD con datallowconn=false sigue siendo clonable como template.
  await admin.query(`UPDATE pg_database SET datallowconn = false WHERE datname = '${TEMPLATE_DB}'`);
  await admin.end();

  return {
    serverUri,
    templateDb: TEMPLATE_DB,
    stop: async () => {
      await container.stop();
    },
  };
}
