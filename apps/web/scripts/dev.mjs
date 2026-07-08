// Wrapper de arranque de `next dev` (dev-only). Existe por un problema concreto
// de Turbopack: el runner de migraciones de @ugc/db (packages/db/src/migrate.ts)
// se BUNDLEA en `.next` (transpilePackages), así que su `require.resolve('@ugc/db
// /package.json')` dentro del bundle devuelve el sentinel virtual `[project]/...`
// de Turbopack, no una ruta real en disco → drizzle no encuentra
// `meta/_journal.json` y el arranque de web crashea.
//
// La solución es inyectar la ruta ABSOLUTA de las migraciones por env
// (UGC_DB_MIGRATIONS_DIR) para que migrationsFolder() la prefiera al
// require.resolve. Pero esa var debe llegar al RUNTIME nodejs que ejecuta
// instrumentation.register(): una asignación `process.env.X = …` dentro de
// next.config.ts NO llega ahí (Turbopack corre instrumentation en un worker que
// no ve las mutaciones de process.env hechas en la config; probado). El único
// canal que SÍ llega es el ENTORNO REAL DEL PROCESO `next dev`, heredado por sus
// workers. Por eso este wrapper: computa la ruta desde la raíz del repo (portable
// entre máquinas — nada hardcodeado), la mete en process.env y spawnea `next dev`
// como hijo, que la hereda.
//
// El CLI `pnpm db:migrate` y los tests de integración NO pasan por aquí: no fijan
// la var → migrationsFolder() cae a su require.resolve, que resuelve bien desde
// Node puro. NUNCA meter esta var en un `.env`/`.env.test`: envenenaría ese
// fallback (el CLI carga el `.env` raíz con --env-file-if-exists).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// apps/web/scripts/dev.mjs → repo root: ../../../
const migrationsDir = fileURLToPath(new URL('../../../packages/db/drizzle', import.meta.url));
const nextBin = fileURLToPath(new URL('../node_modules/.bin/next', import.meta.url));

const child = spawn(nextBin, ['dev'], {
  stdio: 'inherit',
  env: { ...process.env, UGC_DB_MIGRATIONS_DIR: migrationsDir },
});

// Propaga señales de terminación para que Ctrl-C / SIGTERM maten el server hijo
// en vez de dejarlo huérfano.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
