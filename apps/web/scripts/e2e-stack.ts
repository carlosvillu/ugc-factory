// Stack E2E (e2e.md §2): lo lanza Playwright como `webServer` vía
// `pnpm exec tsx scripts/e2e-stack.ts` — tsx OBLIGATORIO porque importa
// @ugc/test-utils, que se consume como TypeScript sin build (Node plano falla con
// ERR_UNKNOWN_FILE_EXTENSION).
//
// Orden: Postgres (testcontainer) → clon aislado desde la template migrada → APIs
// externas FALSAS + semilla de sus API keys cifradas → worker (procesa los steps: los de
// demo del canvas de T0.11 y los REALES del análisis de T1.10a — sin él los nodos nunca
// cambian de estado y el spec cuelga) → web (que en su arranque migra idempotente +
// SIEMBRA el hash de password desde AUTH_BOOTSTRAP_PASSWORD vía
// instrumentation.register).
//
// T1.10a: los specs del análisis ejercitan los nodos REALES (N1 scrapea, N2 mira
// imágenes, N3 sintetiza), que llaman a Firecrawl/Jina/Anthropic. Para que la suite NO
// GASTE UN CÉNTIMO, el stack levanta un servidor HTTP local que finge esas tres APIs
// (startFakeExternalApis) y apunta los clientes ahí vía *_BASE_URL. Los specs de F0
// siguen usando los executors de demo, que no tocan la red.
//
// Si algo falla: exit != 0 y Playwright aborta mostrando el log (stdio 'inherit').
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startPostgresContainer, createTestDatabase, startFakeExternalApis } from '@ugc/test-utils';
import { deriveSecretsKey, encryptSecret } from '@ugc/core/secrets';
import { createDbPool, seedSecretIfAbsent } from '@ugc/db';

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

// Raíz de assets del StorageAdapter (T0.5): un tmpdir fresco, SIEMPRE fijado por el
// stack (no heredado del shell — el default de prod `/data/assets` no existe/no es
// escribible en dev). El spec de download escribe su asset aquí (mismo dir que lee
// web) e inserta la fila en la BD del stack. Se publica en .runtime.json.
const assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-e2e-assets-'));

// APIs externas FALSAS (T1.10a): Firecrawl, Jina y Anthropic servidos por un HTTP local
// en puerto efímero. Los nodos REALES del análisis (N1/N2/N3) que corre el worker las
// llaman a través de los overrides de base URL de abajo ⇒ la suite E2E NUNCA gasta
// dinero real. (El único gasto de la tarea es la Verificación manual con una URL real.)
const fakeApis = await startFakeExternalApis();

// La master key del stack, fijada INCONDICIONALMENTE (mismo criterio que ASSETS_DIR: un
// shell limpio debe pasar igual). Se usa para cifrar los secretos que se siembran justo
// debajo Y para que web/worker los descifren — han de ser LA MISMA.
const masterKey = 'e2e-app-master-key-not-a-secret';

// Semilla de las API keys de los proveedores (T0.14): sin ellas, N1 lanza ("no hay API
// key de Firecrawl configurada") y el pipeline nunca arranca. Son claves FALSAS — el
// servidor al que viajan es el fake de arriba, no el proveedor real. Se cifran con el
// mismo esquema de producción (AES-256-GCM sobre la clave derivada de la master key):
// el E2E ejercita el camino REAL de secretos, no un bypass.
const { db: seedDb, pool: seedPool } = createDbPool(connectionString);
const secretsKey = deriveSecretsKey(masterKey);
await seedSecretIfAbsent(seedDb, 'firecrawl', encryptSecret('fake-firecrawl-key', secretsKey));
await seedSecretIfAbsent(seedDb, 'anthropic', encryptSecret('fake-anthropic-key', secretsKey));
await seedPool.end();

const env: NodeJS.ProcessEnv = {
  ...process.env,
  PORT: String(PORT),
  DATABASE_URL: connectionString,
  UGC_DB_MIGRATIONS_DIR: migrationsDir,
  // Overrides de base URL de los clientes externos → al fake local. Fijados
  // INCONDICIONALMENTE: si se heredaran del shell, un entorno con las URLs reales haría
  // que la suite llamara (y pagara) a los proveedores de verdad.
  FIRECRAWL_BASE_URL: fakeApis.firecrawlBaseUrl,
  JINA_BASE_URL: fakeApis.jinaBaseUrl,
  ANTHROPIC_BASE_URL: fakeApis.anthropicBaseUrl,
  // StorageAdapter local (T0.5): web sirve /api/assets/:id/download desde aquí.
  // Fijado incondicionalmente (no `?? process.env.ASSETS_DIR`): un shell limpio
  // (`env -u ASSETS_DIR`) debe pasar igual — el fix no puede depender del entorno
  // del que lanza la suite.
  ASSETS_DIR: assetsDir,
  // Base interna que usa api-server (RSC): el web se llama A SÍ MISMO. Por defecto
  // api-server apunta a :3000, pero el stack corre en :3100 → sin esto el fetch del
  // RSC `/runs/[id]` iría a un puerto muerto y la página daría 500 (T0.11). Fijado
  // al puerto del stack.
  INTERNAL_API_URL: `http://localhost:${String(PORT)}`,
  // Fail-fast de boot (T0.4): APP_MASTER_KEY firma las sesiones; sin ella web
  // revienta en instrumentation.register. Valor de test (no es un secreto).
  // FIJADA (ya no `?? process.env`): es la MISMA con la que se cifraron los secretos
  // sembrados arriba. Si el shell traía otra, el worker no podría descifrar las API keys
  // y N1 fallaría — un heredado del entorno daría un fallo desconcertante.
  APP_MASTER_KEY: masterKey,
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
  JSON.stringify({ databaseUrl: connectionString, assetsDir }),
);

// Worker (T0.11): procesa los jobs `step.execute` de pg-boss con los executors de
// demo. Se lanza vía tsx (mismo motivo que este script: consume @ugc/test-utils/
// @ugc/core como TS sin build). Comparte el mismo DATABASE_URL → ve el mismo Postgres
// que web y el orquestador. Sin él, los steps quedan `queued` para siempre y el
// canvas nunca cambia de color.
const workerEntry = fileURLToPath(new URL('../../worker/src/main.ts', import.meta.url));
const tsxBin = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const worker: ChildProcess = spawn(tsxBin, [workerEntry], {
  env,
  stdio: 'inherit',
});

const web: ChildProcess = spawn(nextBin, ['dev', '--port', String(PORT)], {
  env,
  stdio: 'inherit',
});

// Apagado ordenado: al recibir la señal de Playwright (fin de suite) o un fallo,
// mata web + worker y para el contenedor. Sin esto quedarían huérfanos.
let shuttingDown = false;
async function shutdown(code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  web.kill('SIGTERM');
  worker.kill('SIGTERM');
  await fakeApis.close().catch(() => undefined);
  await pg.stop().catch(() => undefined);
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(0));
}
web.on('exit', (code) => void shutdown(code ?? 0));
worker.on('exit', (code) => void shutdown(code ?? 0));
