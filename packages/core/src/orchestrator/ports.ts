// Puertos del orquestador (backend/references/architecture.md §2). Un puerto vive
// junto al módulo que lo consume: `JobQueue` lo consumirá `transition()` (§9.0)
// para encolar la ejecución de los steps listos.
//
// Solo `JobQueue` existe hoy (T0.6): es lo que el helper de encolado necesita.
// StepStore / RunNotifier / TxStores / WithTransaction llegan con `transition()`
// en T0.7a (mismo criterio "llegan con sus consumidores" que Clock/StorageAdapter
// en ../ports.ts) — no se anticipan.
import type { EnqueueRequest } from '../jobs';

/**
 * Encola un job para su ejecución. En T0.6 la implementación (apps/worker) hace
 * `boss.send()` con el pool propio de pg-boss. En T0.7a `transition()` lo usará
 * con un adaptador tx-scoped (`fromDrizzle`) para que el INSERT del job comparta
 * la transacción de la transición de estado (jobs.md §5) — por eso el puerto NO
 * abre ni posee su propia conexión: recibe pg-boss (o la tx) desde el composition
 * root, dejando ese seam abierto sin construirlo aquí.
 */
export interface JobQueue {
  enqueue(req: EnqueueRequest): Promise<void>;
}
