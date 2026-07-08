// Creación idempotente de una cola de pg-boss desde su `JobDefinition` de core
// (jobs.md §3). El auto-create de colas se removió en pg-boss v12: cada cola
// declarada en core (`noopJob`, `stepExecuteJob`…) debe crearse EXPLÍCITAMENTE
// antes de encolar, con su DLQ y las options del registro. Este helper es el
// único sitio que conoce ese patrón — lo consumen el composition root del worker
// (createBoss) y los tests de integración del orquestador (misma cola real).
//
// Vive en `packages/db` (no en core: hace I/O de pg-boss, prohibido en core; no
// en apps/worker: los tests de db no pueden importar de una app). `JobDefinition`
// (core registry) expone `{ name, options }`, el seam limpio.
import type { PgBoss } from 'pg-boss';
import type { JobDefinition } from '@ugc/core/jobs';

/**
 * Crea la cola de `job` y su DLQ de forma idempotente (guard `getQueue`: la DLQ
 * debe existir ANTES de referenciarla desde la cola). Las options salen del
 * registro de core — incluida la policy, que decide qué índices únicos
 * (`singleton_key`) activa pg-boss.
 */
export async function ensureQueue(boss: PgBoss, job: JobDefinition): Promise<void> {
  const dlq = `${job.name}.dlq`;
  if ((await boss.getQueue(dlq)) === null) await boss.createQueue(dlq);
  if ((await boss.getQueue(job.name)) === null) {
    await boss.createQueue(job.name, { ...job.options, deadLetter: dlq });
  }
}
