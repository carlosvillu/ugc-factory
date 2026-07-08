// API pública del orquestador (subpath `@ugc/core/orchestrator`, architecture.md
// §7). En T0.6 solo el puerto `JobQueue`; la máquina de estados, `transition()` y
// el resto de puertos llegan en T0.7a.
export type { JobQueue } from './ports';
