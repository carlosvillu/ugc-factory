// Stack E2E (e2e.md §2): lo lanza Playwright como `webServer` vía
// `pnpm exec tsx scripts/e2e-stack.ts` — tsx OBLIGATORIO porque importa
// @ugc/test-utils, que se consume como TypeScript sin build (Node plano falla con
// ERR_UNKNOWN_FILE_EXTENSION).
//
// Orden: Postgres (testcontainer) → clon aislado desde la template migrada → web
// (que en su arranque migra idempotente + SIEMBRA el hash de password desde
// AUTH_BOOTSTRAP_PASSWORD vía instrumentation.register). En F0 NO hace falta ni el
// worker ni las fake APIs ni seedFixtures: los specs de auth y /design-system no
// tocan el pipeline (e2e.md §4: "Para specs de F0 no necesitas ni el fake").
//
// Si algo falla: exit != 0 y Playwright aborta mostrando el log (stdio 'inherit').
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { startPostgresContainer, createTestDatabase } from '@ugc/test-utils';

const PORT = 3100;
// Password de bootstrap del stack: el nombre de la env es el que LEE nuestro
// código (AUTH_BOOTSTRAP_PASSWORD en instrumentation.register), no el APP_PASSWORD
// del ejemplo de e2e.md §2 (deuda de doc de la reference). Debe coincidir con el
// que usa auth.setup.ts / auth.spec.ts.
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password';

const pg = await startPostgresContainer(); // pg16 + template migrada (ugc_template)
const { connectionString } = await createTestDatabase({
  label: 'e2e',
  serverUri: pg.serverUri, // overrides: este script corre FUERA de vitest, no hay inject()
  templateDb: pg.templateDb,
});

// El env que hereda web. La ruta ABSOLUTA de migraciones (UGC_DB_MIGRATIONS_DIR)
// es la que el wrapper dev.mjs inyecta para que el runner de migraciones bajo
// Turbopack encuentre meta/_journal.json; aquí la ponemos directamente porque
// arrancamos `next dev` sin pasar por dev.mjs.
const migrationsDir = fileURLToPath(new URL('../../../packages/db/drizzle', import.meta.url));
const nextBin = fileURLToPath(new URL('../node_modules/.bin/next', import.meta.url));

const env: NodeJS.ProcessEnv = {
  ...process.env,
  PORT: String(PORT),
  DATABASE_URL: connectionString,
  UGC_DB_MIGRATIONS_DIR: migrationsDir,
  // Fail-fast de boot (T0.4): APP_MASTER_KEY firma las sesiones; sin ella web
  // revienta en instrumentation.register. Valor de test (no es un secreto).
  APP_MASTER_KEY: process.env.APP_MASTER_KEY ?? 'e2e-app-master-key-not-a-secret',
  // Seeding first-boot del hash: el nombre que LEE nuestro código.
  AUTH_BOOTSTRAP_PASSWORD: E2E_PASSWORD,
  // Rate limit del login: max=2 → el 3.er intento fallido ya es 429 (literal a la
  // Verificación). El AISLAMIENTO entre specs es por IP única (x-forwarded-for
  // distinto por test, e2e.md §12), no por ventana — así que la ventana se deja
  // holgada (60 s) para que NO expire entre los 3 clicks del spec de rate limit
  // (una ventana de 2 s haría flaky el 3.er intento si el navegador va lento).
  LOGIN_MAX_ATTEMPTS: process.env.LOGIN_MAX_ATTEMPTS ?? '2',
  LOGIN_WINDOW_MS: process.env.LOGIN_WINDOW_MS ?? '60000',
  NODE_ENV: 'development', // `next dev` (F0: sin build de prod; E2E_DEV implícito)
};

// Los specs corren en OTRO proceso: publica el runtime en un fichero conocido.
writeFileSync(
  fileURLToPath(new URL('../e2e/.runtime.json', import.meta.url)),
  JSON.stringify({ databaseUrl: connectionString }),
);

const web: ChildProcess = spawn(nextBin, ['dev', '--port', String(PORT)], {
  env,
  stdio: 'inherit',
});

// Apagado ordenado: al recibir la señal de Playwright (fin de suite) o un fallo,
// mata web y para el contenedor. Sin esto el contenedor quedaría huérfano.
let shuttingDown = false;
async function shutdown(code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  web.kill('SIGTERM');
  await pg.stop().catch(() => undefined);
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(0));
}
web.on('exit', (code) => void shutdown(code ?? 0));
