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
export { createDb, createDbPool } from './client';
// El tipo del cliente Drizzle: lo consumen los accessors lazy de web (getDb) y el
// cableado de `makeWithTransaction` en el composition root (T0.7b). Solo el TIPO
// sale al barrel; `makeDb`/los alias internos siguen sin exportarse.
export type { DbClient } from './client';
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
// Lectura simple de un step (sin lock): la usa el consumer genérico del worker
// (T0.7b) para obtener `config`/retry counters tras arrancar el step. La
// revalidación bajo lock la hace `transition()`; esto solo lee datos.
export { findStep } from './repos/steps.repo';
// Ids de los steps colgados que el sweeper de T0.9 debe expirar
// (`status='running' AND timeout_at < now()`). La consumen el composition root
// del worker (setInterval del sweep) y los tests de integración del orquestador.
export { findExpiredRunningStepIds } from './repos/steps.repo';
// Lecturas del stream SSE (T0.10): la foto completa del run (`snapshot`) y los
// deltas por step (`step_changed`). Las consume el route handler
// `GET /api/runs/:id/events` de web. Proyección observable, no la fila entera.
export { readRunSnapshot, readChangedSteps } from './repos/steps.repo';
// Lectura simple del `autopilot` del run (T0.8): la usa el consumer genérico del
// worker para decidir si un checkpoint pausa (`shouldPause`). Inmutable tras la
// creación del run ⇒ sin lock.
export { findRunAutopilot } from './repos/runs.repo';
// Lectura del objeto run (`findRun`) y mutación del `autopilot` (`updateRunAutopilot`)
// para la página `/runs/[id]` (T0.11): el REST alimenta el run (autopilot/kind/id),
// el SSE alimenta los steps. El toggle de cabecera muta autopilot en vivo (ya no es
// inmutable tras la creación); `shouldPause` lo relee en cada checkpoint.
export { findRun, updateRunAutopilot } from './repos/runs.repo';
// Auth single-user (T0.4): lectura/seed idempotente del hash de password en
// `app_setting`. Los consume web (route de login + seeding en instrumentation).
export { getPasswordHash, seedPasswordHashIfAbsent } from './repos/auth.repo';
// Storage local (T0.5): implementación filesystem del puerto StorageAdapter de
// core. La cablean el accessor lazy de web (getStorage) y el bootstrap del worker.
// `LocalStorageOptions` no sale al barrel: los callers pasan `{ root }` inline
// (knip veta el type export sin consumidor).
export { makeLocalStorageAdapter } from './adapters/local-storage';
// Repo del agregado `asset` (T0.5): create/get tipados. Los consume el endpoint de
// download (web) y el smoke/seed de assets. `NewAsset` lo consume la factory
// makeAsset de test-utils; `Asset` no se importa por nombre (se infiere).
export { createAsset, getAsset } from './repos/asset.repo';
export type { NewAsset } from './schema/generation';
