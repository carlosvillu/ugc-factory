// Contratos de proyecto y dashboard (T5.10, §8.1). La vista PÚBLICA de los agregados
// del dashboard `/` y de la vista de proyecto `/projects/[id]`: lo que los route
// handlers de `/api/projects` serializan y las páginas RSC validan y pintan. Definido
// UNA vez en core; handler y cliente lo comparten (un drift servidor↔página revienta
// en test, no en producción).
//
// DINERO EN CÉNTIMOS ENTEROS, coherente con `SpendSummary` (spend.ts) y todo el
// proyecto: la suma es exacta, sin float.
import { z } from 'zod';
import { UlidSchema } from './ids';

// Espejo del pgEnum `project_status` de db (schema/project.ts): un proyecto está
// `active` mientras se trabaja o `archived` cuando se retira sin borrarlo.
export const ProjectStatusSchema = z.enum(['active', 'archived']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

/** Un proyecto tal cual lo devuelve la API (fila `project` serializada). */
export const ProjectSchema = z.object({
  id: UlidSchema,
  name: z.string(),
  defaultLocale: z.string(),
  status: ProjectStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.string(), // ISO
  updatedAt: z.string(), // ISO
});
export type Project = z.infer<typeof ProjectSchema>;

/** Cuerpo de `POST /api/projects` (crear) y `PATCH /api/projects/:id` (editar). El
 *  nombre es lo mínimo para crear; el resto es opcional. En PATCH todo es opcional
 *  (incluye `status` para archivar/reactivar, que es el "delete" de CRUD mínimo). */
export const CreateProjectSchema = z.object({
  name: z.string().min(1, 'El nombre no puede estar vacío').max(200),
  defaultLocale: z.string().min(2).max(10).optional(),
  notes: z.string().max(2000).nullish(),
});
export type CreateProject = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    defaultLocale: z.string().min(2).max(10).optional(),
    notes: z.string().max(2000).nullish(),
    status: ProjectStatusSchema.optional(),
  })
  // Un PATCH vacío no muta nada: se rechaza en la frontera (400) en vez de ser un
  // no-op silencioso.
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Nada que actualizar: envía al menos un campo',
  });
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;

// ── Dashboard `/` ────────────────────────────────────────────────────────────
//
// Cada KPI del mockup 2a (`docs/mockups/dashboard.html`) se DERIVA de datos reales.
// Lo que no tiene fuente real hoy se deja FUERA con nota (regla dura: nada de ceros
// falsos) — ver `dashboard.repo.ts` para el detalle de cada derivación.

/** Un lote ACTIVO (no terminal) de cara al dashboard: su proyecto, tier, el recuento de
 *  variantes por estado (del que sale la barra de progreso) y su gasto del mes en curso.
 *  `monthSpendCents` es la intersección mes ∧ proyecto que muestra el dashboard (scoped al
 *  lote, no un agregado global): céntimos del ledger atribuidos a este lote en el mes UTC. */
export const ActiveBatchSchema = z.object({
  batchId: UlidSchema,
  projectId: UlidSchema,
  projectName: z.string(),
  status: z.enum(['planned', 'running']),
  tier: z.enum(['test', 'standard', 'premium']),
  totalVariants: z.number().int(),
  approvedVariants: z.number().int(),
  monthSpendCents: z.number().int(),
  createdAt: z.string(), // ISO
});
export type ActiveBatch = z.infer<typeof ActiveBatchSchema>;

/** Un ítem del panel «Requiere atención»: un checkpoint esperando decisión humana
 *  (`step_run.status = waiting_approval`), derivado del estado real del pipeline. */
export const AttentionItemSchema = z.object({
  runId: UlidSchema,
  projectId: UlidSchema,
  projectName: z.string(),
  nodeKey: z.string(),
});
export type AttentionItem = z.infer<typeof AttentionItemSchema>;

/** Lo que el dashboard `/` pinta, todo server-computed en una carga. Los KPIs del
 *  mockup que SÍ tienen fuente real; los que no, ausentes (ver dashboard.repo.ts). */
export const DashboardSummarySchema = z.object({
  /** Gasto del MES en curso (bucket UTC), agregado del ledger — la misma verdad que
   *  `/spend`, filtrada al mes. */
  monthSpendCents: z.number().int(),
  /** Límite del presupuesto mensual vigente, o null si no hay ninguno. */
  monthBudgetCents: z.number().int().nullable(),
  /** Variantes aprobadas cuya última actualización cae en el mes en curso (proxy de
   *  «aprobadas este mes»: no hay timestamp de aprobación dedicado — ver nota). */
  approvedThisMonth: z.number().int(),
  activeBatches: z.array(ActiveBatchSchema),
  attention: z.array(AttentionItemSchema),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

// ── Vista de proyecto `/projects/[id]` ────────────────────────────────────────

/** Un brief del proyecto (fila `product_brief` + el nombre del producto extraído del
 *  jsonb `data`, si lo trae). */
export const ProjectBriefSchema = z.object({
  id: UlidSchema,
  version: z.number().int(),
  status: z.enum(['draft', 'approved']),
  productName: z.string().nullable(),
  language: z.string(),
  createdAt: z.string(), // ISO
});
export type ProjectBrief = z.infer<typeof ProjectBriefSchema>;

/** Un lote del proyecto con su recuento de variantes por estado y su coste real
 *  (agregado del ledger vía sus runs). */
export const ProjectBatchSchema = z.object({
  id: UlidSchema,
  status: z.enum(['planned', 'running', 'completed', 'cancelled']),
  tier: z.enum(['test', 'standard', 'premium']),
  objective: z.string(),
  totalVariants: z.number().int(),
  approvedVariants: z.number().int(),
  costActualCents: z.number().int(),
  createdAt: z.string(), // ISO
});
export type ProjectBatch = z.infer<typeof ProjectBatchSchema>;

/** Los estados por los que pasa una variante (`ad_variant.status`, schema/batch.ts). Se
 *  declara aquí, en el contrato de la vista de proyecto que los transporta, porque no había
 *  un enum Zod de variante en los contratos (los otros contratos de lote llevan config/plan,
 *  no el estado runtime). El orden replica el del pgEnum. */
export const VariantStatusSchema = z.enum([
  'planned',
  'scripting',
  'scripted',
  'generating',
  'composing',
  'qa',
  'approved',
  'rejected',
  'published',
]);
export type VariantStatus = z.infer<typeof VariantStatusSchema>;

/** Una variante del proyecto, con su ESTADO INDIVIDUAL (§8.1: la vista de proyecto lista las
 *  «variantes con estados correctos», no solo un recuento agregado del lote). Campos mínimos
 *  para identificarla en pantalla: el código legible del fichero (`filename_code`, UNIQUE), su
 *  ángulo e idioma, y el lote al que pertenece. */
export const ProjectVariantSchema = z.object({
  id: UlidSchema,
  batchId: UlidSchema,
  status: VariantStatusSchema,
  filenameCode: z.string(),
  angleName: z.string(),
  language: z.string(),
  createdAt: z.string(), // ISO
});
export type ProjectVariant = z.infer<typeof ProjectVariantSchema>;

/** Métricas agregadas del proyecto (§8.1: «métricas del proyecto»), todo derivado. */
export const ProjectMetricsSchema = z.object({
  totalBatches: z.number().int(),
  totalVariants: z.number().int(),
  approvedVariants: z.number().int(),
  /** Gasto TOTAL del proyecto (todo su ledger, vía sus runs), en céntimos. */
  spendCents: z.number().int(),
});
export type ProjectMetrics = z.infer<typeof ProjectMetricsSchema>;

/** Lo que `/projects/[id]` pinta: el proyecto + sus briefs, lotes, VARIANTES y métricas. */
export const ProjectDetailSchema = z.object({
  project: ProjectSchema,
  briefs: z.array(ProjectBriefSchema),
  batches: z.array(ProjectBatchSchema),
  variants: z.array(ProjectVariantSchema),
  metrics: ProjectMetricsSchema,
});
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

/** Lo que `GET /api/projects` devuelve: la lista de proyectos con un resumen ligero
 *  (para la sección de proyectos del dashboard y el índice `/projects`). */
export const ProjectSummarySchema = ProjectSchema.extend({
  batchCount: z.number().int(),
  activeBatchCount: z.number().int(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectListSchema = z.object({
  projects: z.array(ProjectSummarySchema),
});
export type ProjectList = z.infer<typeof ProjectListSchema>;
