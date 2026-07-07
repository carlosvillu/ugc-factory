import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Polling con timeout explícito — nada de sleeps fijos (skill testing, principio 7). */
function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timeout (${String(timeoutMs)}ms) esperando: ${what}`));
      }
    }, 50);
  });
}

// Contrato de proceso del worker (main.ts, composition root): anuncia ready,
// y ante SIGTERM el último log NO se pierde (sin process.exit inmediato: el
// event loop drena y pino llega a flushear) y el exit code es 0.
describe('main del worker (proceso real)', () => {
  it('arranca, anuncia ready y el shutdown con SIGTERM conserva el último log y sale con 0', async () => {
    const workerDir = fileURLToPath(new URL('..', import.meta.url));
    // `--import tsx` (in-process) y NO el CLI de tsx: el CLI envuelve el script
    // en un child, relaya la señal y el wrapper muere con 143 — el proceso
    // spawneado debe SER el worker para observar su exit code real.
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: workerDir,
      env: { ...process.env, LOG_LEVEL: 'info', LOG_PRETTY: '', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
    });

    try {
      await waitFor(() => out.includes('"msg":"worker ready"'), 20_000, 'worker ready en stdout');
      child.kill('SIGTERM');
      const code = await new Promise<number | null>((resolve) => {
        child.once('close', (c) => {
          resolve(c);
        });
      });
      expect(out).toContain('"msg":"worker shutting down"');
      expect(out).toContain('"signal":"SIGTERM"');
      expect(code).toBe(0);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }, 30_000);
});
