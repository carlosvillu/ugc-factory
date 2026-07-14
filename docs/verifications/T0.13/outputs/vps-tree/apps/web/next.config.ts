import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// UN solo `.env` en la raíz del repo (el mismo que usa docker-compose.dev.yml).
// next.config.ts corre en el proceso padre de Next ANTES de arrancar el server,
// así que cargar aquí el env raíz lo deja disponible para el runtime nodejs de
// los route handlers (/api/health lee process.env.DATABASE_URL). Next solo
// autolee `apps/web/.env`; sin esto, el `.env` raíz documentado no llegaría al
// server (T0.2). Es dev-only: `next build`/`start` en producción usa el env real
// del contenedor (T0.13), no un `.env` en disco. `--env-file-if-exists` en el
// script `dev` no sirve aquí: Next reenvía la flag a sus workers vía NODE_OPTIONS
// y Node la rechaza — por eso el env raíz se carga en la config, no en el arranque.
// Guard a development: `next.config.ts` corre también en `build`/`start`, y
// process.loadEnvFile PISA el env ya presente — en el contenedor de producción
// (T0.13) un `.env` en disco no puede sobrescribir el env real. Solo dev.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (process.env.NODE_ENV === 'development' && existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}
// La ruta absoluta de las migraciones (UGC_DB_MIGRATIONS_DIR) que el runner de
// @ugc/db necesita bajo Turbopack NO se inyecta aquí: una asignación
// `process.env.X = …` en next.config.ts NO llega al runtime nodejs que ejecuta
// instrumentation.register() (Turbopack lo corre en un worker que no ve esa
// mutación; probado). Se inyecta en el ENTORNO REAL del proceso `next dev` desde
// el wrapper `scripts/dev.mjs`, único canal que llega al runtime. DATABASE_URL sí
// llega desde aquí porque `loadEnvFile` alimenta el pipeline de env de Next, que
// snapshotea `.env`; UGC_DB_MIGRATIONS_DIR no está en ningún `.env` (a propósito:
// envenenaría el fallback require.resolve del CLI/tests) → ese canal no la lleva.

const nextConfig: NextConfig = {
  // Salida standalone SOLO para la imagen Docker de producción (T0.13): su
  // Dockerfile exporta NEXT_OUTPUT=standalone en el stage de build. Se gatea por
  // env porque con `output: 'standalone'` fijo, `next start` local (el flujo de
  // T0.14 y de cualquier smoke de prod en el host) deja de funcionar — el server
  // pasa a ser `node .next/standalone/apps/web/server.js`.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
  // Monorepo: raíz explícita del file tracing (standalone copia desde aquí los
  // node_modules trazados). Sin esto Next la infiere del lockfile — explícito es
  // determinista y no depende de qué haya alrededor del repo.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  // Los paquetes internos exportan TS fuente (JIT): Next los transpila
  // (architecture.md §7). @ugc/db entra en T0.2: web consume su ping de conexión
  // (@ugc/db → pingDb) en /api/health.
  transpilePackages: ['@ugc/core', '@ugc/db', '@ugc/services'],
  // pino resuelve pino-pretty y sus workers (thread-stream) en runtime:
  // fuera del bundle del server o el transport no encuentra sus ficheros.
  serverExternalPackages: ['pino', 'pino-pretty'],
};

export default nextConfig;
