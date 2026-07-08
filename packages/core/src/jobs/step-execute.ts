// Job `step.execute` (jobs.md §5): lo que `transition()` (§9.0) encola cuando un
// step queda listo. Core DECLARA la cola (nombre + payload Zod + opciones); el
// HANDLER (el executor que ejecuta el nodo del pipeline) vive en apps/worker y
// llega en T0.7b — aquí solo el contrato, que `transition()` consume al encolar.
import { z } from 'zod';
import { UlidSchema } from '../contracts';
import { defineJob } from './registry';

// El payload identifica el step a ejecutar dentro de su run. `strictObject`
// rechaza campos inesperados (Zod v4). Validado en LAS DOS puntas: al encolar
// (`payload.parse` en el adaptador tx) y al consumir (`safeParse` en el handler).
export const StepExecuteJobSchema = z.strictObject({
  runId: UlidSchema,
  stepId: UlidSchema,
  nodeKey: z.string().min(1),
});
export type StepExecuteJob = z.infer<typeof StepExecuteJobSchema>;

export const stepExecuteJob = defineJob({
  name: 'step.execute',
  payload: StepExecuteJobSchema,
  options: {
    // `short`: activa el índice único sobre `singleton_key` — un `send` con una
    // key ya en cola resuelve `null` en vez de crear un duplicado (jobs.md §5).
    // `transition()` usa singletonKey = `${runId}:${nodeKey}`. NO es la barrera
    // primaria contra el doble-encolado (eso es el LOCK DE FILA del orquestador,
    // que serializa los dos caminos de encolado): es DEFENSA EN PROFUNDIDAD, un
    // belt sobre un path hoy inalcanzable (ver transition.ts / informe FIX 6).
    // Por eso la policy es correcta pero NO load-bearing — cambiarla no rompe la
    // corrección, solo retira el belt.
    policy: 'short',
    // Los reintentos de EJECUCIÓN los gobierna la máquina de estados
    // (running → failed → queued, §7.1) con retry_count/max_retries del step_run,
    // no el retry nativo de pg-boss: el estado del pipeline es la fuente de verdad
    // del progreso, no la cola. Por eso 0 aquí — un fallo del job NO lo reintenta
    // pg-boss; lo reencola `transition()` si procede. (Ajustable en T0.7b cuando
    // el executor exista y se decida la política definitiva.)
    retryLimit: 0,
  },
});
