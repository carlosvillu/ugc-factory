// API pública de @ugc/db. El ping de conexión (T0.2) convive con el pool de
// Drizzle, el runner de migraciones y los repos tipados (T0.3). El `schema`
// tiene su propio subpath export (`@ugc/db/schema`) que consume el harness de
// tests y drizzle-kit; no se re-exporta aquí para no acoplar los consumidores de
// runtime al barrel completo del schema.
// El barrel expone SOLO lo que se consume desde FUERA del paquete; lo de uso
// interno vive en sus ficheros y se importa relativo (los tests/scripts internos
// importan de ../src/... directo). Consumidores externos actuales: pingDb
// (web /api/health, worker bootstrap), runMigrations (web instrumentation),
// createDb + repo de project (scripts de smoke/CLI), NewProject (factory de
// @ugc/test-utils). makeDb, MIGRATION_LOCK_KEY, los alias Db/DbClient/DbTx y el
// tipo Project son internos o se importan relativo — fuera del barrel.
export { pingDb } from './health';
export { createDb } from './client';
export { runMigrations } from './migrate';
export { createProject, getProject } from './repos/project.repo';
export type { NewProject } from './schema/project';
// El adaptador `WithTransaction` del orquestador (T0.7a): lo cablean el
// composition root de web/worker (transition() sobre la BD real) y los tests de
// integración. `makeStepStore`/`makeTxJobQueue` son piezas internas que este
// compone; no van al barrel.
export { makeWithTransaction } from './adapters/with-transaction';
export type { NewPipelineRun, NewStepRun } from './schema/pipeline';
// Creación idempotente de colas de pg-boss desde su JobDefinition de core. La
// consumen el composition root del worker (createBoss) y los tests de
// integración del orquestador (misma cola real que producción).
export { ensureQueue } from './adapters/ensure-queue';
