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
// `Db` = conexión O transacción (client.ts): es lo que aceptan TODOS los repos, y es lo que
// `withDomainTransaction` entrega a su callback. Sale al barrel para que un consumidor (los route
// handlers de los checkpoints en web) pueda tipar una función que corre indistintamente dentro o
// fuera de una tx — que es justo la propiedad que hace atómico el efecto de dominio.
export type { Db } from './client';
export { runMigrations } from './migrate';
export { createProject, getProject, ensureDefaultProject } from './repos/project.repo';
export type { NewProject } from './schema/project';
// Tipos de fila de las tablas del análisis (T1.2): los consumen las factories
// makeUrlAnalysis/makeProductBrief/makeBrandKit de @ugc/test-utils. Los repos de
// caso de uso de estas tablas llegan con sus consumidores (T1.3+); aquí solo el
// schema + los tipos que la factory necesita.
export type { NewUrlAnalysis, NewProductBrief, NewBrandKit } from './schema/project';
// El adaptador `WithTransaction` del orquestador (T0.7a): lo cablean el
// composition root de web/worker (transition() sobre la BD real) y los tests de
// integración. `makeStepStore`/`makeTxJobQueue` son piezas internas que este
// compone; no van al barrel.
export { makeWithTransaction } from './adapters/with-transaction';
// T1.10b: compone una escritura de DOMINIO (versionar el brief de CP1) con una operación del
// ORQUESTADOR (`editStep`) en UNA sola transacción — o commitean las dos, o no commitea ninguna.
// Sin esto, un `editStep` que falla tras crear la versión deja una fila `product_brief` huérfana
// que nadie referencia (y que F2 leería creyendo que el usuario la aprobó). Ver su cabecera.
export { withDomainTransaction } from './adapters/with-domain-transaction';
export type { NewPipelineRun, NewStepRun } from './schema/pipeline';
// Creación idempotente de colas de pg-boss desde su JobDefinition de core. La
// consumen el composition root del worker (createBoss) y los tests de
// integración del orquestador (misma cola real que producción).
export { ensureQueue } from './adapters/ensure-queue';
// Lectura simple de un step (sin lock): la usa el consumer genérico del worker
// (T0.7b) para obtener `config`/retry counters tras arrancar el step. La
// revalidación bajo lock la hace `transition()`; esto solo lee datos.
export { findStep } from './repos/steps.repo';
// Lectura de PRESENTACIÓN de un step (T1.16): el artefacto y el error ENTEROS, para
// `GET /api/steps/:id` (editor de CP1 + visores modales del canvas). Vive aparte del puerto
// `StepRow` del orquestador a propósito: el motor no necesita el `error`, y la UI sí.
export { findStepDetail } from './repos/steps.repo';
// Steps por sus ULIDs exactos, sin lock (T1.10a): la usa el consumer de `step.execute`
// para resolver las DEPENDENCIAS de un step (los ids exactos vienen en `dependsOn`) y
// entregarle sus outputs al executor. Por id y NUNCA por `node_key`: el supersede de T0.8
// crea filas nuevas con el MISMO node_key, así que la clave no identifica una fila.
export { findStepsByIds } from './repos/steps.repo';
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
// Settings (T0.14): repo genérico de `app_setting` para credenciales cifradas (blobs
// producidos por core/secrets en web) y preferencias. Los consume web (route
// GET/PATCH /api/settings + seeding de FAL_KEY en instrumentation). db no conoce el
// cifrado: solo persiste jsonb por clave.
export {
  getSecretBlob,
  setSecretBlob,
  seedSecretIfAbsent,
  getPreferences,
  setPreferences,
} from './repos/settings.repo';
// Storage local (T0.5): implementación filesystem del puerto StorageAdapter de
// core. La cablean el accessor lazy de web (getStorage) y el bootstrap del worker.
// `LocalStorageOptions` no sale al barrel: los callers pasan `{ root }` inline
// (knip veta el type export sin consumidor).
export { makeLocalStorageAdapter } from './adapters/local-storage';
// El adaptador cableado desde el ENTORNO (ASSETS_DIR + default de prod). Lo comparten los DOS
// composition roots (web y worker): una sola verdad sobre dónde viven los assets — si cada uno
// tuviera su copia, un cambio de directorio en el deploy los desincronizaría en silencio.
export { makeLocalStorageAdapterFromEnv } from './adapters/local-storage';
// Repo del agregado `asset` (T0.5): create/get tipados. Los consume el endpoint de
// download (web) y el smoke/seed de assets. `NewAsset` lo consume la factory
// makeAsset de test-utils; `Asset` no se importa por nombre (se infiere).
export { createAsset, getAsset } from './repos/asset.repo';
export type { NewAsset } from './schema/generation';
// Ledger de gasto (T0.12): `recordCost` (efecto de escritura, lo llama el executor
// de demo config-injectable y, en fases reales, cada nodo que gasta), el resumen
// del panel /spend (`getSpendSummary`: totales por día/proveedor + presupuesto +
// alerta over-limit) y el seed idempotente del presupuesto mensual (lo llama el
// arranque de web desde BUDGET_MONTHLY_LIMIT_CENTS). `RecordCostInput`/`SpendSummary`
// son los shapes públicos (los consumen el executor de demo y el route handler).
export { recordCost, getSpendSummary, seedMonthlyBudgetIfAbsent } from './repos/spend.repo';
// Escritura del análisis de URL (T1.3): el fast path de ingesta persiste el
// RawContent + campos derivados (platform, url_normalized, content_hash) en
// `url_analysis`. Lo consume el smoke de ingesta (`pnpm smoke:ingest`) y, en tareas
// posteriores, el endpoint de N1. `getUrlAnalysis` (lectura por id) no sale al barrel
// todavía: solo la usan los tests de integración (import relativo), sin consumidor de
// runtime aún — knip vetaría el export sin consumidor.
export { createUrlAnalysis } from './repos/url-analysis.repo';
// El tipo de fila `url_analysis` (retorno de createUrlAnalysis): lo consume el servicio
// de ingesta N2 de web (T1.4) para tipar su resultado.
export type { UrlAnalysis } from './schema/project';
// Modo MANUAL (T1.6, §7.4): la caché lookup-then-insert del intake por texto libre.
// `findManualUrlAnalysisByHash` (lookup por (project_id, content_hash, source='manual'))
// + `createManualUrlAnalysis` (insert source='manual', status='done') los compone el
// servicio de intake manual de core; el route handler los cablea vía web.
export {
  insertManualUrlAnalysisIfAbsent,
  findManualUrlAnalysisByHash,
  getUrlAnalysis,
} from './repos/url-analysis.repo';
// Brief versionado (T1.10b, CP1): `product_brief` estrena persistencia. `createBriefVersion` es
// el bump ATÓMICO (advisory lock por análisis + UNIQUE como barrera estructural) que usan los
// TRES caminos — v1 (N3, worker), v2 (edición en CP1, web) y v3 (PATCH /api/briefs/:id, web).
// `getBrief` lo lee el endpoint standalone; `approveBrief` marca aprobado el brief cuando CP1 se
// aprueba SIN editar (no crea versión: no hubo edición humana). `findBriefByOriginStep` es la
// clave de IDEMPOTENCIA de N3: le permite reusar el brief que YA pagó en vez de re-sintetizarlo
// tras un fallo de persistencia (ver su docstring — es una salvaguarda de dinero).
// `getLatestBriefByAnalysis` NO sale al barrel: solo lo usan los tests de integración (import
// relativo) — knip veta el export sin consumidor de runtime, y volverá cuando la pantalla del
// brief standalone lo consuma.
export {
  createBriefVersion,
  getBrief,
  // T2.3: el brief + su PROYECTO (JOIN vía `url_analysis`). Lo necesita CP2 para crear el lote:
  // `ad_batch.project_id` es NOT NULL y el proyecto no es una columna de `product_brief`.
  getBriefWithProject,
  approveBrief,
  findBriefByOriginStep,
} from './repos/brief.repo';
// El tipo de fila `product_brief` (retorno de los repos de arriba): lo consumen los route
// handlers de web (`/api/briefs/:id`, `/api/steps/:id/{approve,edit}`) para tipar la respuesta.
export type { ProductBrief as ProductBriefRow } from './schema/project';
// La DECISIÓN de un checkpoint (T1.11): `recordCheckpointDecision` la persiste en la MISMA tx que
// la transición (la llaman los route handlers de `/approve` y `/edit` dentro de
// `withDomainTransaction`). Es el canal genérico —`kind` + `decision` jsonb— que CP2/CP3/CP4
// reutilizan sin tocar el schema. `findCheckpointDecision` (la lectura por step) NO sale al barrel
// todavía: su consumidor de runtime es N7a (T4.4) y hoy solo lo usan los tests de integración
// (import relativo) — knip veta el export sin consumidor.
export { recordCheckpointDecision } from './repos/checkpoint-decision.repo';
// LAS ENTRADAS DE `planBatch` QUE VIVEN EN LA BD, en UNA sola lectura (T2.3). La consumen los DOS
// brazos que componen la matriz —el worker en N4 (que la PROPONE) y web (que la ESTIMA y la CREA)—
// y ese es justo el punto: mantenidas a mano eran dos listas de lecturas que había que acordarse de
// tocar a la vez, y una entrada añadida en un solo brazo haría que el usuario apruebe una matriz y
// el sistema cree otra. Ver `repos/planning.repo.ts`.
//
// `getRecipe`/`listHookLines` vuelven a ser INTERNAS del paquete (las llama `listPlanningInputs`, y
// el test de integración las importa por ruta relativa): sacarlas al barrel ya no tiene consumidor
// de fuera, y knip veta el export sin consumidor. `seedLibrary` sigue interna (su consumidor es el
// script `pnpm seed`); `listRecipes` también (el seed y su test).
export { listPlanningInputs } from './repos/planning.repo';
// LA SIEMBRA, ahora también desde FUERA del paquete (T2.3). `seedLibrary`/`seedPersonas` eran
// internas («su único consumidor es el script `pnpm seed`»): ya no. **El stack E2E las necesita**,
// y no por comodidad: N4 (CP2) compone la matriz con la librería de hooks y estima su coste con la
// fila `recipe` — sin sembrarlas, el checkpoint que la suite tiene que ejercitar ni siquiera
// puede abrirse. Un E2E que se saltara el seed probaría un sistema que no es el que se despliega.
export { seedLibrary } from './repos/library.repo';
export { seedPersonas } from './repos/persona-seed';
// El LOTE (T2.3, CP2): la creación TRANSACCIONAL de `ad_batch` + sus `ad_variant` en `planned`. La
// matriz se compone DENTRO de la función, con el id del lote ya asignado (es el
// `batchDiscriminator` que hace globalmente único el `filename_code`, §12) — ver la cabecera del
// repo. `findBatchesByBrief` NO sale al barrel todavía (solo lo usan los tests de integración); sí
// salen `getBatch` y `listBatchVariants`, que ESTRENAN consumidor de runtime en T2.6: el executor de
// N5 saca del lote la matriz y el brief (`getBatch`) y resuelve `filenameCode→variantId` para
// persistir cada guion (`listBatchVariants`).
export {
  createBatchWithVariants,
  getBatch,
  listBatchVariants,
  type CreatedBatch,
} from './repos/batch.repo';
// GUIONES (T2.6, N5+CP3): la idempotencia de dinero de N5 (`findScriptsByOriginStep`), la
// persistencia v1 del lote (`createScriptsForBatch`), la lectura del guion vigente de cada variante
// para CP3 (`getLatestScriptsByBatch`) y la aplicación transaccional de los veredictos de CP3
// (`applyScriptVerdicts`). Ver `repos/script.repo.ts`.
export {
  findScriptsByOriginStep,
  createScriptsForBatch,
  getLatestScriptsByBatch,
  applyScriptVerdicts,
  type ScriptToPersist,
  type DecidedVerdict,
} from './repos/script.repo';
// Tipos de fila de las tablas del LOTE (T2.1): los consumen las factories makeAdBatch/
// makeAdVariant/makeAdScript de @ugc/test-utils (los tests de constraints los insertan). `AdScriptRow`
// (T2.6): la fila `ad_script` tal cual, que consumen el efecto de CP3 y el listado del panel.
export type { NewAdBatch, NewAdVariant, NewAdScript, AdScriptRow } from './schema/batch';
// Librería de PERSONAS (T2.0): el CRUD que consume `/api/personas` en web, la gestión de sus
// imágenes de referencia y la lista que alimenta el endpoint de candidatas (la REGLA de
// matching por `avatar_hint` es pura y vive en `@ugc/core/persona`; db solo lee).
// `upsertPersonaByName`/`countPersonas` NO salen al barrel: sus únicos consumidores viven DENTRO
// del paquete (el script `pnpm seed` vía `persona-seed.ts`, y los tests de integración, que
// importan relativo) — mismo criterio que `seedLibrary`/`listRecipes` de T2.1.
export {
  listPersonas,
  getPersona,
  createPersona,
  updatePersona,
  removePersona,
  addReferenceImage,
  removeReferenceImage,
  // T2.3: `upsertPersonaByName` SÍ sale ahora. Su segundo consumidor es el spec E2E de CP2, que
  // siembra una persona compatible con el `avatar_hint` del brief del fake — y lo hace por el REPO
  // y no con SQL crudo porque la PK de `persona` es un ULID que genera la APLICACIÓN (`ulidPk()`),
  // no un default de Postgres: un INSERT a mano sin `id` muere con un NOT NULL. El upsert además lo
  // hace idempotente entre corridas de la suite.
  upsertPersonaByName,
} from './repos/persona.repo';
// El tipo de fila `persona` (retorno de los repos de arriba): lo consumen los route handlers de
// web para serializar la respuesta contra el contrato `PersonaSchema` de core.
export type { Persona as PersonaRow } from './schema/gallery';
// T1.20: `rollupStepCost`/`rollupRunCost` YA NO salen al barrel — y su ausencia es el fix.
// El rollup del coste dejó de ser algo que un llamante (el consumer del worker) recuerda hacer
// al cerrar bien un step, precisamente porque olvidarse en los DEMÁS caminos de cierre (`fail`,
// `expire`, `cancel`, `reject`, `supersede`…) era lo que dejaba la columna mintiendo con dinero
// REAL gastado. Ahora corre SIEMPRE, dentro de `applyTransition` (el embudo único de core), vía
// el puerto `CostStore` que implementa `adapters/cost-store.ts`. Los repos quedan INTERNOS al
// paquete: nadie de fuera debe volver a invocarlos a mano (si vuelve a hacer falta exportarlos,
// pregúntate primero por qué el camino de cierre no pasa por la transición).
// El LISTADO de runs (T1.17): la lectura que alimenta `GET /api/runs`. Deriva el estado
// agregado de los STEPS (las columnas `pipeline_run.status`/`total_cost_actual` no las
// mantiene nadie) y agrega el coste desde el LEDGER (`cost_entry`, la única verdad del dinero:
// `step_run.cost_actual` queda NULL cuando un step FALLA habiendo gastado). Ver su cabecera.
export { listRuns } from './repos/run-list.repo';
// El coste REAL de UN run desde el LEDGER (T1.17): lo consume `GET /api/runs/:id`, que alimenta
// la cabecera del canvas. Antes esa cabecera SUMABA `step_run.cost_actual` y enseñaba **$0.00 en
// los runs que murieron habiendo gastado** (el rollup de esa columna solo corre al cerrar BIEN un
// step). Misma función que usa el listado: dos sitios que responden «cuánto costó este run» tienen
// que responder LO MISMO. Ver `run-list.repo.ts`.
export { runLedgerCost } from './repos/run-list.repo';
