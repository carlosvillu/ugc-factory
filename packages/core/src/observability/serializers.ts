// Serializers de dominio (observability.md §5): un pipeline_run o step_run entero
// en un log son KBs de jsonb que entierran la señal — se loguea la proyección
// mínima. Tipado estructural mínimo hasta que existan los contratos
// PipelineRun/StepRun (T0.3+/T0.7a); entonces se retipan contra ellos.

interface RunLike {
  id: string;
  status: string;
}

interface StepLike {
  id: string;
  node_key: string;
  status: string;
}

// uso: log.info({ run, step }, 'transition applied') — pino aplica el serializer por clave
export const runSerializer = (run: RunLike) => ({ id: run.id, status: run.status });
export const stepSerializer = (step: StepLike) => ({
  id: step.id,
  node_key: step.node_key,
  status: step.status,
});
