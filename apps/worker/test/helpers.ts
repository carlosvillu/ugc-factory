// Helpers de test compartidos entre suites del worker (unit `src/**` e
// integración `test/integration/**`). No van a @ugc/test-utils: son específicos
// del worker, no harness cross-paquete.

/**
 * Polling con timeout explícito — nada de sleeps fijos (skill testing, principio
 * 7). Acepta un predicate sync o async (`await` cubre ambos). Resuelve cuando el
 * predicate es verdadero; rechaza al superar `timeoutMs`.
 */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
  pollIntervalMs = 50,
): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timeout (${String(timeoutMs)}ms) esperando: ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
