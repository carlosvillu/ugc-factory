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
