// Contrato de eventos del stream SSE `GET /api/runs/:id/events` (§9.0, T0.10). Un
// discriminated union Zod (`RunEventSchema`) con las tres variantes que el route
// handler emite y que el hook del frontend (T0.11) consume — MISMO contrato en
// ambos lados, definido una sola vez en core (contratos), nunca en el handler ni
// en el hook. El campo discriminante es `event` (coincide con el `event:` de cada
// frame SSE), de modo que parsear el frame y validar el payload comparten la misma
// etiqueta.
//
// Asimetría deliberada entre variantes: el `snapshot` porta un ARRAY de steps
// direccionados por `id` (la foto completa que el cliente indexa en un mapa); el
// `step_changed` direcciona UN step por `stepId`. NO se unifican los nombres: son
// dos sub-schemas distintos del union, y el cliente aplica el delta
// idempotentemente sobre el mapa sembrado por el snapshot.
import { z } from 'zod';

// Los 13 valores de `step_run.status` (§7.1), verbatim de la máquina pura
// (transitions.ts). Se declara aquí como enum Zod para VALIDAR el payload que
// cruza el stream; el tipo TS lo infiere `z.infer`, así que si la máquina de
// estados creciera y este enum no, el desajuste saldría en los tests del contrato,
// no en producción. El orden es el mismo que en transitions.ts a propósito.
const StepStatusSchema = z.enum([
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

// El estado de UN step tal como viaja por el stream: la identidad + lo que la UI
// pinta (estado, coste, un excerpt del output). Es la proyección observable, NO la
// fila completa de persistencia — `cost` es `cost_actual ?? cost_estimated` (en
// céntimos, entero) y `outputExcerpt` es un recorte de `output_refs`, no el jsonb
// entero (un vídeo de cientos de MB no viaja por SSE). `null` cuando no hay dato.
const StepSnapshotSchema = z.object({
  id: z.string(),
  nodeKey: z.string(),
  status: StepStatusSchema,
  cost: z.number().int().nullable(),
  outputExcerpt: z.string().nullable(),
});
export type StepSnapshot = z.infer<typeof StepSnapshotSchema>;

// `snapshot`: la foto COMPLETA del run al conectar (y en cada reconexión con
// `Last-Event-ID` — re-snapshot del estado ACTUAL, nunca replay de deltas). Porta
// TODOS los steps del run; el cliente los indexa por `id` y a partir de ahí aplica
// deltas. NO computa `run.status` derivado (deuda diferida de T0.8): la verdad son
// los estados de STEP.
const RunSnapshotEventSchema = z.object({
  event: z.literal('snapshot'),
  runId: z.string(),
  steps: z.array(StepSnapshotSchema),
});

// `step_changed`: un delta. Comparte `status/cost/outputExcerpt` con la foto pero
// direcciona por `stepId` (no `id`): el cliente lo localiza en el mapa sembrado por
// el snapshot y lo reemplaza. Como el NOTIFY solo transporta `run_id` (§9.0), el
// handler RELEE el estado actual del step y emite ESTA forma — el delta describe el
// estado presente, no un diff.
const StepChangedEventSchema = z.object({
  event: z.literal('step_changed'),
  stepId: z.string(),
  nodeKey: z.string(),
  status: StepStatusSchema,
  cost: z.number().int().nullable(),
  outputExcerpt: z.string().nullable(),
});
export type StepChangedEvent = z.infer<typeof StepChangedEventSchema>;

// `heartbeat`: keep-alive cada `SSE_HEARTBEAT_MS` (default 25 s, inyectable por
// env). Mantiene vivo el paso por proxies y permite al cliente detectar un stream
// zombi. Sin payload útil más allá de un timestamp.
const HeartbeatEventSchema = z.object({
  event: z.literal('heartbeat'),
  ts: z.number().int(),
});

// El union completo, discriminado por `event`. Lo consumen el handler (al construir
// cada frame) y el hook del frontend (al validar cada frame recibido).
export const RunEventSchema = z.discriminatedUnion('event', [
  RunSnapshotEventSchema,
  StepChangedEventSchema,
  HeartbeatEventSchema,
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
