// Contrato del executor de un nodo (T0.7b): lo que el consumer genérico de
// `step.execute` (apps/worker) invoca tras poner el step en `running`. El
// executor hace el TRABAJO del nodo (llamada a fal, FFmpeg, o —en F0— nada más
// que dormir/fallar/colgarse); NO toca el estado del step: eso lo hace el
// consumer vía `transition()`. Un throw del executor = fallo del step; un retorno
// = éxito.
//
// Vive en core (contrato) para que la definición del DAG y los tests lo
// compartan; las IMPLEMENTACIONES (demo y, más tarde, los nodos reales) viven en
// apps/worker (jobs.md §4). El shape de `config` es opaco aquí: cada executor
// parsea el suyo.
import { z } from 'zod';

/** Lo que recibe un executor: la config per-step (de `step_run.config`) y una
 *  señal de aborto (shutdown/expiración del job — la propaga el consumer). */
export interface ExecutorContext {
  config: unknown;
  signal?: AbortSignal;
}

/** Un executor: ejecuta el nodo. Retorna (éxito) o lanza (fallo). */
export type StepExecutor = (ctx: ExecutorContext) => Promise<void>;

/**
 * Flags de los executors de DEMO (F0): el harness que las verificaciones de gate
 * de T0.7b/T0.9 necesitan para provocar comportamientos observables sin nodos
 * reales.
 *  - `sleepMs`: duerme N ms antes de terminar (simula trabajo; observa el paso
 *    por `running`).
 *  - `failRate`: probabilidad [0..1] de LANZAR en este intento (ejercita el path
 *    fail→retry→queued y el agotamiento de `retry_count`). Per-INTENTO, no
 *    per-step: un `failRate < 1` converge con reintentos.
 *  - `hang`: si `true`, NO retorna nunca (espera al abort). Andamiaje para el
 *    sweeper de T0.9; en T0.7b nada lo expira todavía.
 */
export const DemoConfigSchema = z.strictObject({
  sleepMs: z.number().int().nonnegative().optional(),
  failRate: z.number().min(0).max(1).optional(),
  hang: z.boolean().optional(),
  // Coste INYECTABLE (T0.12): si un step de demo lleva `costCents` en su config, el
  // executor registra ese cargo en `cost_entry` al terminar con éxito (mismo patrón
  // config-injectable que `failRate`/`sleepMs`). Es el reachability gate del ledger:
  // el verifier lanza 3 runs de demo con SUS importes y `/spend` los suma. `costCents`
  // en céntimos ENTEROS (coherente con el modelo de dinero del proyecto). `costProvider`
  // etiqueta el proveedor (default 'other'); `costQuantity`/`costUnit` describen la
  // facturación (opcionales). El coste se registra SOLO en el path de éxito.
  costCents: z.number().int().nonnegative().optional(),
  costProvider: z.enum(['fal', 'anthropic', 'firecrawl', 'other']).optional(),
  costQuantity: z.number().int().nonnegative().optional(),
  costUnit: z.string().optional(),
  // `timeout_ms` (T0.9): NO es un flag del executor de demo — es el override de
  // timeout que lee el orquestador (timeout.ts) para fijar `timeout_at`. Se
  // declara aquí (ignorado por el executor) para que un step de demo pueda llevar
  // AMBAS cosas en su `config` sin que el strictObject lo rechace: la Verificación
  // de T0.9 configura `demo.hang` con `{ hang: true, timeout_ms: 10000 }`.
  timeout_ms: z.number().int().positive().optional(),
});
export type DemoConfig = z.infer<typeof DemoConfigSchema>;
