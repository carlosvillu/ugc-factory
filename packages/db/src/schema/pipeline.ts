// Dominio `pipeline` (§12): las dos tablas del orquestador — `pipeline_run` y
// `step_run` — con sus enums nativos (§7.1). El resto del modelo (ad_batch,
// ad_variant, generation…) es F2 y llega con sus tareas; aquí SOLO estas dos.
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { timestamps, ulidPk } from './columns.helpers';
import { project } from './project';

// §12: `pipeline_run.kind ENUM(full|partial|regen)`.
export const runKind = pgEnum('run_kind', ['full', 'partial', 'regen']);

// §12/§7.1.e: el estado del run se DERIVA de sus steps. Los 7 valores verbatim.
export const runStatus = pgEnum('run_status', [
  'pending',
  'running',
  'waiting_approval',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
]);

// §7.1: enum COMPLETO de `step_run.status` (13 valores verbatim). `submitting`
// es la intención persistida antes de una llamada HTTP externa (db.md §6): no
// aparece en el grafo de §7.1 como transición nombrada pero es un estado válido
// del enum, reservado para el trabajo externo de F3+ (fal.ai). Aquí solo lo
// declara el enum; la tabla de transiciones vive en core y no lo usa todavía.
export const stepStatus = pgEnum('step_status', [
  'awaiting_deps',
  'pending',
  'queued',
  'submitting',
  'running',
  'waiting_approval',
  'succeeded',
  'failed',
  'rejected',
  'skipped',
  'cancelled',
  'expired',
  'superseded',
]);

export const pipelineRun = pgTable('pipeline_run', {
  id: ulidPk(),
  projectId: text('project_id')
    .notNull()
    .references(() => project.id, { onDelete: 'cascade' }),
  // `batch_id` referencia ad_batch (F2, NO EXISTE): ULID nullable SIN FK.
  // FK a ad_batch en F2 cuando la tabla exista.
  batchId: text('batch_id'),
  kind: runKind('kind').notNull().default('full'),
  autopilot: boolean('autopilot').notNull().default(false),
  status: runStatus('status').notNull().default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  totalCostEstimated: integer('total_cost_estimated'),
  totalCostActual: integer('total_cost_actual'),
  ...timestamps,
});

export const stepRun = pgTable(
  'step_run',
  {
    id: ulidPk(),
    runId: text('run_id')
      .notNull()
      .references(() => pipelineRun.id, { onDelete: 'cascade' }),
    nodeKey: text('node_key').notNull(), // N0..N11 / N7a..N7e
    // `variant_id` referencia ad_variant (F2, NO EXISTE): ULID nullable SIN FK.
    // FK a ad_variant en F2 cuando la tabla exista.
    variantId: text('variant_id'),
    status: stepStatus('status').notNull().default('pending'),
    // §7.1.c: la invalidación (T0.8) crea filas NUEVAS con supersedes_id y pone
    // la anterior en `superseded`; JAMÁS resetea. Self-FK: la anotación
    // AnyPgColumn rompe la inferencia circular de tipos.
    supersedesId: text('supersedes_id').references((): AnyPgColumn => stepRun.id, {
      onDelete: 'set null',
    }),
    isCheckpoint: boolean('is_checkpoint').notNull().default(false),
    checkpointConfig: jsonb('checkpoint_config'),
    // ULIDs de steps del MISMO run cuyo éxito habilita a este step.
    dependsOn: text('depends_on')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    inputRefs: jsonb('input_refs'),
    outputRefs: jsonb('output_refs'),
    error: jsonb('error'),
    // Config GENERAL per-step del nodo (T0.7b): parámetros de ejecución del
    // executor, poblados en la creación del run desde la definición del DAG. Los
    // executors de demo la leen (`sleep_ms`, `fail_rate`, `hang`) para provocar
    // fallos/cuelgues verificables; los nodos reales la usarán para su propia
    // config. NO es `input_refs` (eso es "input artifacts" de F2) ni andamiaje a
    // retirar: T0.9 la muta (p. ej. `fail_rate=1→0` al reintentar). Nullable: un
    // nodo sin parámetros no necesita fila de config.
    config: jsonb('config'),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(3),
    // El sweeper (T0.9) compara contra now() de Postgres; nullable hasta que un
    // step entra en running con timeout.
    timeoutAt: timestamp('timeout_at', { withTimezone: true }),
    costEstimated: integer('cost_estimated'),
    costActual: integer('cost_actual'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // El snapshot SSE (T0.10) lee todos los steps de un run.
    index('step_run_run_id_idx').on(t.runId),
    // El cron de barrido (T0.9) solo mira steps con timeout puesto.
    index('step_run_sweep_idx')
      .on(t.timeoutAt)
      .where(sql`${t.timeoutAt} IS NOT NULL`),
  ],
);

export type PipelineRun = typeof pipelineRun.$inferSelect;
export type NewPipelineRun = typeof pipelineRun.$inferInsert;
export type StepRun = typeof stepRun.$inferSelect;
export type NewStepRun = typeof stepRun.$inferInsert;

// ────────────────────────────────────────────────────────────────────────────────────────────
// `checkpoint_decision` (T1.11): LA DECISIÓN que un humano toma en un checkpoint.
//
// UN CHECKPOINT PRODUCE DOS COSAS Y NO SON LA MISMA. (1) un ARTEFACTO (el brief que el usuario
// dejó, la matriz que editó): vive en `step_run.output_refs`, tiene AUTOR, y el diff de
// `audit_log` (§19.1) lo compara IA-vs-humano para medir cuánto corrige el humano a la máquina.
// (2) una DECISIÓN sobre CÓMO SEGUIR el pipeline (CP1: ¿subo fotos o genero packshot-IA?; CP2:
// ¿qué variantes genero?; CP4: ¿re-genero o publico?). La decisión NO es parte del artefacto:
// colarla en `output_refs` haría que el diff de auditoría la leyese como "la IA cambió de
// opinión", y además la decisión vive lo que vive el STEP, no lo que vive la fila versionada del
// brief (que se puede reeditar por `PATCH /api/briefs/:id` fuera de todo run, donde una decisión
// de imágenes no significa nada).
//
// POR QUÉ TABLA PROPIA Y NO `audit_log`. `audit_log` es un registro APPEND-ONLY de *qué pasó*:
// bueno para auditar, malo para consultar ESTADO ACTUAL. El consumidor real de esto es N7a
// (T4.4), que necesita preguntar "¿qué decidió el humano en el checkpoint del que dependo?" para
// saber si genera un packshot-IA o usa fotos reales — una lectura POR CLAVE, no un
// `ORDER BY at DESC LIMIT 1` con filtros de `action`/`entity` sobre un log que crece sin techo.
// La decisión es ESTADO, con su clave natural (el step) y su unicidad (una por aprobación).
//
// GENÉRICA POR CONSTRUCCIÓN: `kind` (qué checkpoint decidió) + `decision` jsonb (la decisión, con
// la forma que su checkpoint le dé). CP1 la estrena con `{"images":"ai_packshot"}`; CP2/CP3/CP4
// escriben la suya sin tocar el schema. Aquí NO hay una columna `image_decision`.
export const checkpointDecision = pgTable('checkpoint_decision', {
  id: ulidPk(),
  // La clave natural: el step del checkpoint. UNIQUE porque un step se aprueba UNA vez (tras la
  // transición ya no está en `waiting_approval`: un segundo POST da 409). Si el checkpoint se
  // rehace tras un supersede (§7.1.c), la fila nueva del step es OTRA (ids distintos) y trae su
  // propia decisión — el linaje se conserva en vez de sobrescribirse.
  // ON DELETE CASCADE: la decisión no sobrevive al step que la produjo (borrar un run se lleva
  // sus steps; una decisión colgando de un step inexistente no es auditable ni consultable).
  stepRunId: text('step_run_id')
    .notNull()
    .unique('checkpoint_decision_step_run_id_key')
    .references(() => stepRun.id, { onDelete: 'cascade' }),
  // QUÉ checkpoint la tomó, en texto libre (no un enum): los checkpoints de F2–F4 llegarán sin
  // migración, y un enum obligaría a un ALTER TYPE por cada uno. Hoy: `brief` (CP1).
  kind: text('kind').notNull(),
  // LA DECISIÓN, jsonb opaco para la BD: su forma la valida el contrato de SU checkpoint en core
  // (el mismo criterio que `output_refs`). CP1: `{"images":"upload_images"|"ai_packshot"}`.
  decision: jsonb('decision').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CheckpointDecision = typeof checkpointDecision.$inferSelect;
export type NewCheckpointDecision = typeof checkpointDecision.$inferInsert;
