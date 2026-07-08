// Registro de jobs tipados (backend/references/jobs.md §2). Core DECLARA la cola
// (nombre + schema Zod del payload + opciones de retry); los HANDLERS viven en
// apps/worker. Core jamás importa pg-boss: la frontera prohibida de core es la
// BD/cola (SKILL.md principio 1). Estas interfaces son la forma que atraviesa el
// puerto JobQueue (orchestrator/ports.ts).
import type { z } from 'zod';

/** Política de cola de pg-boss que la semántica del job exige (jobs.md §3). */
export type QueuePolicy = 'standard' | 'short' | 'singleton';

/** Opciones de cola (createQueue). Cada job las hereda al crearse la cola. */
export interface JobOptions {
  policy: QueuePolicy;
  retryLimit: number;
  retryDelay?: number; // segundos entre reintentos
  retryBackoff?: boolean; // backoff exponencial sobre retryDelay
  retryDelayMax?: number; // segundos; solo aplica con retryBackoff
  expireInSeconds?: number;
  heartbeatSeconds?: number;
}

/**
 * Declaración de un job: nombre de cola, schema del payload y opciones. El
 * schema se valida en LAS DOS puntas — al encolar (`payload.parse` en el
 * adaptador) y al consumir (`safeParse` en el handler, jobs.md §2).
 */
export interface JobDefinition<TSchema extends z.ZodType = z.ZodType> {
  name: string; // nombre de la cola: '<dominio>.<acción>'
  payload: TSchema;
  options: JobOptions;
}

export function defineJob<T extends z.ZodType>(def: JobDefinition<T>): JobDefinition<T> {
  return def;
}

/**
 * Lo que viaja por el puerto JobQueue (orchestrator/ports.ts): la definición del
 * job, su payload sin validar y las opciones de encolado. El adaptador valida el
 * payload contra `job.payload` antes de tocar la cola.
 */
export interface EnqueueRequest<T extends z.ZodType = z.ZodType> {
  job: JobDefinition<T>;
  payload: z.infer<T>;
  singletonKey?: string;
  startAfter?: Date;
}
