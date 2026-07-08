// Job de demo `demo.noop` (backend/references/jobs.md §3): el harness de F0 con el
// que la Verificación de T0.6 observa retries/backoff reales. Payload trivial
// (un objeto vacío) — el trabajo real del pipeline llega con `step.execute`
// (T0.7a). Sigue siendo un contrato Zod: la frontera de entrada del consumer lo
// revalida con safeParse.
import { z } from 'zod';
import { defineJob } from './registry';

// strictObject: rechaza campos inesperados (Zod v4; `.strict()` está deprecado).
export const NoopJobSchema = z.strictObject({});
export type NoopJob = z.infer<typeof NoopJobSchema>;

export const noopJob = defineJob({
  name: 'demo.noop',
  payload: NoopJobSchema,
  options: {
    // `standard`: sin dedupe por singletonKey — este job es de demo puro, se
    // encolan N a la vez y cada uno se ejecuta.
    policy: 'standard',
    // retryLimit 6 (DESVÍO DELIBERADO de jobs.md §3, que dice 3): la Verificación
    // corre el camino de fallo del 30% per-intento ALEATORIO. Con 3 reintentos
    // (4 intentos) P(un job agote) = 0.3^4 ≈ 0.8% → P(≥1 de 10 en la DLQ) ≈ 8%:
    // un FAIL espurio del verifier ~8% de las veces. Con 6 (7 intentos) baja a
    // ~0.2%. La inyección determinista de los tests (K=2 < 6) no se ve afectada.
    // El skill (fila demo.noop) necesita actualizar este número — reportado.
    retryLimit: 6,
    // Backoff exponencial REAL: pg-boss v12 espacia los reintentos con
    // `retryDelay * 2^n` acotado por `retryDelayMax`. retryDelay DEBE ser ≥1: con
    // el default 0, `0 * 2^n = 0` → backoff inerte (los reintentos solo se
    // espaciarían por el polling), y la Entrega pide "retries/backoff" reales.
    retryDelay: 1,
    retryBackoff: true,
    // Techo del backoff. Con retryDelay 1 + retryDelayMax 4 la curva de espera es
    // 1, 2, 4, 4, 4, 4 s (acotada a 4) → peor caso ≈ 19 s de backoff acumulado,
    // holgado dentro del timeout de la Verificación.
    retryDelayMax: 4,
  },
});
