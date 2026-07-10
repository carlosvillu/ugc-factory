// Arranque de un servidor Next REAL en subproceso para los tests server-level
// (testing/references/api.md §3.1). A diferencia de los tests handler-level (que
// invocan el route handler en proceso con `new Request()`), aquí el server vive en
// OTRO proceso: es la ÚNICA forma de ejercitar el streaming SSE de verdad — el
// abort de `req.signal` al desconectar, el flush de frames al vuelo y la conexión
// pg DEDICADA en LISTEN cruzando el borde de proceso (T0.10).
//
// DESVIACIÓN deliberada de la reference (§3.1, documentada en el informe de T0.10):
// la reference arranca `next start` y afirma que "el script test:integration de
// apps/web garantiza el build". Ese script NO existe en este repo (el gate llama
// `vitest run --project '*:integration'` directo, sin build previo). Añadir
// orquestación de `next build` al `pnpm gate` — propiedad del arnés — por UNA suite
// sería desproporcionado. En su lugar se arranca `next dev`, exactamente como el
// stack E2E de Playwright (scripts/e2e-stack.ts): mismo precedente del repo, cero
// build. El coste es la compilación en frío de la ruta al primer hit (los timeouts
// de conexión del test lo absorben).
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const nextBin = fileURLToPath(new URL('../../node_modules/.bin/next', import.meta.url));
// Raíz del paquete web: `next dev` la necesita como CWD para encontrar `app/`. NO
// se hereda del proceso de vitest — el gate corre desde la RAÍZ del monorepo
// (`pnpm gate`), donde el CWD es el repo, no apps/web. Fijarla explícito hace el
// arranque independiente de dónde se lance la suite.
const webRoot = fileURLToPath(new URL('../../', import.meta.url));
// Directorio de migraciones ABSOLUTO: el runner de arranque (instrumentation) lo
// necesita bajo Turbopack para encontrar meta/_journal.json. Idempotente contra el
// clon ya migrado (no-op), pero el arranque lo invoca igual.
const migrationsDir = fileURLToPath(new URL('../../../../packages/db/drizzle', import.meta.url));

export interface RunningServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

/**
 * Arranca `next dev` contra `databaseUrl` (un clon aislado del testcontainer) con
 * el env de test inyectado, y espera a que `/api/health` responda antes de
 * devolver. Un puerto aleatorio por suite → sin colisiones con otras suites/procesos.
 *
 * `env` extra (p. ej. `SSE_HEARTBEAT_MS: '250'`) se mezcla por encima del base.
 * `APP_MASTER_KEY` se PROPAGA desde el proceso de test (lo fija `.env.test`): el
 * subproceso DEBE firmar/verificar las cookies con la MISMA clave con la que el
 * test las genera, o el 401 sería un falso fallo.
 */
export async function startWebServer(opts: {
  databaseUrl: string;
  env?: Record<string, string>;
}): Promise<RunningServer> {
  const port = 3200 + Math.floor(Math.random() * 400);

  const proc: ChildProcess = spawn(nextBin, ['dev', '--port', String(port)], {
    cwd: webRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      DATABASE_URL: opts.databaseUrl,
      UGC_DB_MIGRATIONS_DIR: migrationsDir,
      // APP_MASTER_KEY viene del proceso de test (.env.test). Propagarla EXPLÍCITO
      // (no confiar solo en el spread de process.env) documenta la dependencia y
      // deja claro que el fail-fast de boot depende de ella.
      APP_MASTER_KEY: process.env.APP_MASTER_KEY ?? '',
      // El heartbeat inyectable (default lo pone el test a 250) — sin esto el
      // VERIFY esperaría 25 s reales para ver un latido.
      ...opts.env,
    },
    stdio: 'pipe',
  });

  // Diagnóstico si el arranque falla: el stderr del subproceso a la consola del
  // test (sin ruido en el caso feliz — pipe, no inherit).
  let bootLog = '';
  proc.stdout?.on('data', (d: Buffer) => (bootLog += d.toString()));
  proc.stderr?.on('data', (d: Buffer) => (bootLog += d.toString()));

  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const deadline = Date.now() + 90_000; // next dev en frío + migración idempotente
  for (;;) {
    if (proc.exitCode !== null) {
      throw new Error(
        `next dev murió durante el arranque (code ${String(proc.exitCode)}):\n${bootLog}`,
      );
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) break;
    } catch {
      // aún no escucha: reintentar
    }
    if (Date.now() > deadline) {
      proc.kill('SIGKILL');
      throw new Error(`timeout esperando /api/health en ${baseUrl}\n${bootLog}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const stop = async (): Promise<void> => {
    if (proc.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => {
      proc.once('exit', () => {
        resolve();
      });
    });
    proc.kill('SIGTERM');
    // Red de seguridad: si no muere limpio en 5 s, SIGKILL. Matar el proceso cierra
    // sus conexiones pg (incluida la que está en LISTEN) — imprescindible ANTES de
    // dropear la BD del test, o el DROP DATABASE quedaría bloqueado.
    const forced = new Promise<void>((resolve) =>
      setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 5_000),
    );
    await Promise.race([exited, forced]);
  };

  return { baseUrl, stop };
}
