// Agregados del dashboard `/` y de la vista de proyecto `/projects/[id]` (T5.10, §8.1).
// Lecturas de PRESENTACIÓN (hermanas de `getSpendSummary`/`listRuns`), no filas de
// persistencia. Cada KPI se DERIVA de datos reales; lo que no tiene fuente hoy NO se
// inventa (regla dura: nada de ceros falsos) — ver las notas por función.
//
// ─────────────────────────────────────────────────────────────────────────────────
// LA ATRIBUCIÓN DE COSTE A UN PROYECTO ES `cost_entry → step_run → pipeline_run.project_id`.
// ─────────────────────────────────────────────────────────────────────────────────
// NO se usa `cost_entry.project_id` (nullable, "casi siempre null" — schema/ops.ts): esa
// ref quedó sin poblar en F0/F1. La verdad honesta del gasto de un proyecto es el ledger
// (`cost_entry`, append-only) unido a los steps de sus runs, y `pipeline_run.project_id`
// es NOT NULL. Es la misma fuente que `/spend` (el ledger), sólo que agrupada por proyecto.
// Coherente con `runLedgerCosts` (run-list.repo), que hace el mismo join hasta el run.
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type {
  ActiveBatch,
  AttentionItem,
  DashboardSummary,
  ProjectBatch,
  ProjectBrief,
  ProjectDetail,
  ProjectVariant,
} from '@ugc/core/contracts';
import type { Db } from '../client';
import { adBatch, adVariant } from '../schema/batch';
import { costEntry } from '../schema/ops';
import { pipelineRun, stepRun } from '../schema/pipeline';
import { productBrief, project, urlAnalysis } from '../schema/project';
import { findMonthlyBudget } from './spend.repo';

// ── Ventana del mes en curso (UTC) ────────────────────────────────────────────
//
// Determinista con independencia de la TZ de la sesión, igual que `date_trunc(... AT
// TIME ZONE 'UTC')` de spend.repo: el "mes en curso" es el mes UTC de `now`. Se computa
// en JS (no en SQL) para que el mismo límite se pueda pasar como parámetro a varias
// queries y para que el test lo pueda fijar (inyectando `now`).
function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

// ── Dashboard `/` ─────────────────────────────────────────────────────────────
//
// Los tipos de fila de este repo son los MISMOS tipos Zod-inferidos del contrato
// (`@ugc/core/contracts`): se importan en vez de reclonarlos aquí, para que una deriva
// repo↔contrato la cace el typechecker en vez de llegar al navegador. `DashboardSummaryRow`
// es exactamente `DashboardSummary`; se mantiene el alias por compatibilidad con los callers.
export type DashboardSummaryRow = DashboardSummary;

/**
 * GASTO DEL MES: suma del ledger cuyos cargos `occurred_at` caen en el mes UTC en curso.
 * Es la MISMA verdad que `/spend` (el ledger `cost_entry`), filtrada al mes.
 */
async function monthSpendCents(db: Db, monthStart: Date): Promise<number> {
  // DELIBERADAMENTE NO se une a `project` ni se filtra por `project.status='active'`: el dinero
  // gastado en un proyecto luego ARCHIVADO fue real y debe seguir contando en el gasto del mes.
  // Filtrarlo haría MENTIR al KPI (antipatrón «nada de valores falsos»). Las queries de LISTA
  // (activeBatches/attentionItems) SÍ filtran por proyecto activo — es lo que archivar oculta;
  // esta de agregación de dinero NO.
  //
  // `::bigint` + `Number(...)`, NO `::int`: esta suma es GLOBAL (todo el ledger del mes, sin
  // scope), así que puede rebasar el techo de int4 (~$21,4M en céntimos) → `integer out of
  // range` → 500. Es el mismo motivo (y patrón) documentado en `totalsByDay`/`totalsByProvider`
  // de spend.repo. Las otras 3 sumas de este fichero son per-batch/per-project (scoped) y su
  // `::int` es correcto. El driver de pg entrega `bigint` como STRING → `Number(...)`.
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${costEntry.amountCents}), 0)::bigint` })
    .from(costEntry)
    .where(gte(costEntry.occurredAt, monthStart));
  return row ? Number(row.total) : 0;
}

/** Presupuesto `monthly` vigente en céntimos, o null. Reusa `findMonthlyBudget` de
 *  spend.repo (lectura tipada por el schema) en vez de SQL crudo con nombre de columna
 *  string, que typechequearía pero 500earía en runtime ante un rename de columna. */
async function monthlyBudgetCents(db: Db): Promise<number | null> {
  const b = await findMonthlyBudget(db);
  return b?.limitCents ?? null;
}

/**
 * VARIANTES APROBADAS «ESTE MES»: variantes en estado `approved` cuya última
 * actualización (`updated_at`) cae en el mes UTC en curso.
 *
 * NOTA DE HONESTIDAD (no hay fuente perfecta): `ad_variant` NO tiene una columna de
 * "aprobada en tal fecha". `updated_at` es un PROXY — la aprobación (CP4) es la última
 * transición esperada de una variante, así que `updated_at` de una variante `approved`
 * es, en la práctica, cuándo se aprobó. Se documenta el proxy en el contrato; no se
 * inventa un timestamp que no existe.
 */
async function approvedThisMonth(db: Db, monthStart: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(adVariant)
    .where(and(eq(adVariant.status, 'approved'), gte(adVariant.updatedAt, monthStart)));
  return row?.n ?? 0;
}

/**
 * LOTES ACTIVOS: lotes no terminales (`status ∈ planned|running`), con su recuento de
 * variantes total y aprobadas (de donde sale la barra de progreso del mockup). Más
 * nuevos primero.
 *
 * NOTA: el mockup pinta una barra de progreso PASO A PASO del pipeline (`N3 de 11`) y un
 * enlace `/runs/8f21`. Eso NO tiene fuente de datos: `ad_batch` no guarda `run_id` (el
 * puntero es al revés y nullable, `pipeline_run.batch_id`), y un lote puede tener varios
 * runs. En su lugar el progreso se deriva HONESTAMENTE del recuento de variantes por
 * estado (aprobadas / total), que es dato real del lote. Ver el informe de T5.10.
 *
 * GASTO DEL MES DEL LOTE: por cada lote activo, su gasto del ledger cuyos cargos caen en
 * el mes UTC en curso (cost_entry -> step_run -> pipeline_run.batch_id, filtrado por
 * occurred_at >= monthStart). Es la interseccion mes ^ proyecto que pide la Verificacion,
 * scoped al lote (no un agregado global): se calcula en query APARTE del recuento de
 * variantes para no cruzar el fan-out de variantes con el de cargos, igual que projectBatches.
 */
async function activeBatches(db: Db, monthStart: Date): Promise<ActiveBatch[]> {
  const rows = await db
    .select({
      batchId: adBatch.id,
      projectId: adBatch.projectId,
      projectName: project.name,
      status: adBatch.status,
      tier: adBatch.tier,
      createdAt: adBatch.createdAt,
      totalVariants: sql<number>`count(${adVariant.id})::int`,
      approvedVariants: sql<number>`count(${adVariant.id}) filter (where ${adVariant.status} = 'approved')::int`,
    })
    .from(adBatch)
    .innerJoin(project, eq(adBatch.projectId, project.id))
    .leftJoin(adVariant, eq(adVariant.batchId, adBatch.id))
    // Solo proyectos ACTIVOS: un proyecto archivado desaparece de `/projects`, así que no debe
    // seguir listándose en «Lotes activos» del dashboard (nombre/gasto/link vivos). El KPI de
    // dinero (`monthSpendCents`) NO se filtra así — ver su nota.
    .where(and(inArray(adBatch.status, ['planned', 'running']), eq(project.status, 'active')))
    .groupBy(adBatch.id, project.name)
    .orderBy(desc(adBatch.id));

  if (rows.length === 0) return [];

  // Gasto del mes por lote del ledger vía sus runs (batch_id de pipeline_run), acotado al
  // mes UTC en curso. Query aparte para no cruzar el fan-out de variantes con el de cargos.
  const batchIds = rows.map((r) => r.batchId);
  const spendRows = await db
    .select({
      batchId: pipelineRun.batchId,
      monthSpendCents: sql<number>`coalesce(sum(${costEntry.amountCents}), 0)::int`,
    })
    .from(costEntry)
    .innerJoin(stepRun, eq(costEntry.stepRunId, stepRun.id))
    .innerJoin(pipelineRun, eq(stepRun.runId, pipelineRun.id))
    .where(and(inArray(pipelineRun.batchId, batchIds), gte(costEntry.occurredAt, monthStart)))
    .groupBy(pipelineRun.batchId);
  const monthSpendByBatch = new Map(spendRows.map((r) => [r.batchId, r.monthSpendCents]));

  return rows.map((r) => ({
    batchId: r.batchId,
    projectId: r.projectId,
    projectName: r.projectName,
    // El `where inArray` garantiza que status es planned|running; el tipo del enum es
    // más ancho, así que se estrecha aquí.
    status: r.status as 'planned' | 'running',
    tier: r.tier,
    totalVariants: r.totalVariants,
    approvedVariants: r.approvedVariants,
    monthSpendCents: monthSpendByBatch.get(r.batchId) ?? 0,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * REQUIERE ATENCIÓN: steps en `waiting_approval` (un checkpoint esperando decisión
 * humana). Dato real y derivable del pipeline. Se une al run para sacar su proyecto.
 * Ignora steps `superseded` (la verdad de un nodo es su fila viva).
 */
async function attentionItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db
    .select({
      runId: stepRun.runId,
      nodeKey: stepRun.nodeKey,
      projectId: pipelineRun.projectId,
      projectName: project.name,
    })
    .from(stepRun)
    .innerJoin(pipelineRun, eq(stepRun.runId, pipelineRun.id))
    .innerJoin(project, eq(pipelineRun.projectId, project.id))
    // Solo proyectos ACTIVOS: un checkpoint de un proyecto archivado no debe seguir pidiendo
    // atención en la home (coherente con «Lotes activos» y con `/projects`).
    .where(and(eq(stepRun.status, 'waiting_approval'), eq(project.status, 'active')))
    .orderBy(desc(stepRun.id));

  return rows.map((r) => ({
    runId: r.runId,
    projectId: r.projectId,
    projectName: r.projectName,
    nodeKey: r.nodeKey,
  }));
}

/** Compone todo lo que el dashboard `/` pinta en una sola llamada. `now` inyectable
 *  para fijar el mes en curso en los tests. */
export async function getDashboardSummary(
  db: Db,
  now: Date = new Date(),
): Promise<DashboardSummaryRow> {
  const monthStart = startOfMonthUtc(now);
  const [monthSpend, monthBudget, approved, batches, attention] = await Promise.all([
    monthSpendCents(db, monthStart),
    monthlyBudgetCents(db),
    approvedThisMonth(db, monthStart),
    activeBatches(db, monthStart),
    attentionItems(db),
  ]);
  return {
    monthSpendCents: monthSpend,
    monthBudgetCents: monthBudget,
    approvedThisMonth: approved,
    activeBatches: batches,
    attention,
  };
}

// ── Lista de proyectos `GET /api/projects` ────────────────────────────────────

export interface ProjectSummaryRow {
  batchCount: number;
  activeBatchCount: number;
}

/**
 * Recuento de lotes (total y activos) POR proyecto, en una query. Alimenta la vista de
 * lista de proyectos del dashboard. Devuelto como Map para que el handler lo cruce con
 * `listProjects` sin N+1.
 */
export async function batchCountsByProject(db: Db): Promise<Map<string, ProjectSummaryRow>> {
  const rows = await db
    .select({
      projectId: adBatch.projectId,
      batchCount: sql<number>`count(*)::int`,
      activeBatchCount: sql<number>`count(*) filter (where ${adBatch.status} in ('planned','running'))::int`,
    })
    .from(adBatch)
    .groupBy(adBatch.projectId);
  return new Map(
    rows.map((r) => [
      r.projectId,
      { batchCount: r.batchCount, activeBatchCount: r.activeBatchCount },
    ]),
  );
}

// ── Vista de proyecto `/projects/[id]` ────────────────────────────────────────
//
// El repo compone briefs + lotes + métricas; el `project` en sí lo añade el handler (que ya
// lo leyó con `getProject` para el 404). Por eso `ProjectDetailRow` es `ProjectDetail` SIN su
// campo `project`. Los tipos de las piezas son los del contrato (`@ugc/core/contracts`).
export type ProjectDetailRow = Omit<ProjectDetail, 'project'>;

/**
 * BRIEFS DEL PROYECTO: los `product_brief` que cuelgan de sus `url_analysis` (§12:
 * project → url_analysis → product_brief). El nombre del producto se extrae del jsonb
 * `data` (`data->'product'->>'name'`), null si el brief no lo trae. Más nuevos primero.
 */
async function projectBriefs(db: Db, projectId: string): Promise<ProjectBrief[]> {
  const rows = await db
    .select({
      id: productBrief.id,
      version: productBrief.version,
      status: productBrief.status,
      language: productBrief.language,
      createdAt: productBrief.createdAt,
      productName: sql<string | null>`${productBrief.data}->'product'->>'name'`,
    })
    .from(productBrief)
    .innerJoin(urlAnalysis, eq(productBrief.urlAnalysisId, urlAnalysis.id))
    .where(eq(urlAnalysis.projectId, projectId))
    .orderBy(desc(productBrief.id));
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    status: r.status,
    productName: r.productName,
    language: r.language,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * LOTES DEL PROYECTO con su recuento de variantes y su coste real. El coste se agrega
 * del LEDGER vía los runs del lote (`cost_entry → step_run → pipeline_run.batch_id`),
 * la misma verdad honesta que el resto del panel de gasto. Un lote sin runs/cargos → 0.
 */
async function projectBatches(db: Db, projectId: string): Promise<ProjectBatch[]> {
  const rows = await db
    .select({
      id: adBatch.id,
      status: adBatch.status,
      tier: adBatch.tier,
      objective: adBatch.objective,
      createdAt: adBatch.createdAt,
      totalVariants: sql<number>`count(${adVariant.id})::int`,
      approvedVariants: sql<number>`count(${adVariant.id}) filter (where ${adVariant.status} = 'approved')::int`,
    })
    .from(adBatch)
    .leftJoin(adVariant, eq(adVariant.batchId, adBatch.id))
    .where(eq(adBatch.projectId, projectId))
    .groupBy(adBatch.id)
    .orderBy(desc(adBatch.id));

  if (rows.length === 0) return [];

  // Coste por lote del ledger vía sus runs (batch_id de pipeline_run). En una query
  // aparte para no cruzar el fan-out de variantes con el de cargos (doble conteo).
  const batchIds = rows.map((r) => r.id);
  const costRows = await db
    .select({
      batchId: pipelineRun.batchId,
      costCents: sql<number>`coalesce(sum(${costEntry.amountCents}), 0)::int`,
    })
    .from(costEntry)
    .innerJoin(stepRun, eq(costEntry.stepRunId, stepRun.id))
    .innerJoin(pipelineRun, eq(stepRun.runId, pipelineRun.id))
    .where(inArray(pipelineRun.batchId, batchIds))
    .groupBy(pipelineRun.batchId);
  const costByBatch = new Map(costRows.map((r) => [r.batchId, r.costCents]));

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    tier: r.tier,
    objective: r.objective,
    totalVariants: r.totalVariants,
    approvedVariants: r.approvedVariants,
    costActualCents: costByBatch.get(r.id) ?? 0,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * VARIANTES DEL PROYECTO con su ESTADO INDIVIDUAL. §8.1 pide la vista de proyecto liste las
 * «variantes con estados correctos» (no solo el recuento agregado del lote): esto son las
 * FILAS por variante. Se unen a `ad_batch` para acotar al proyecto. Más nuevas primero. Sin
 * fan-out de coste: es una lectura simple de `ad_variant`.
 */
async function projectVariants(db: Db, projectId: string): Promise<ProjectVariant[]> {
  const rows = await db
    .select({
      id: adVariant.id,
      batchId: adVariant.batchId,
      status: adVariant.status,
      filenameCode: adVariant.filenameCode,
      angleName: adVariant.angleName,
      language: adVariant.language,
      createdAt: adVariant.createdAt,
    })
    .from(adVariant)
    .innerJoin(adBatch, eq(adVariant.batchId, adBatch.id))
    .where(eq(adBatch.projectId, projectId))
    .orderBy(desc(adVariant.id));
  return rows.map((r) => ({
    id: r.id,
    batchId: r.batchId,
    status: r.status,
    filenameCode: r.filenameCode,
    angleName: r.angleName,
    language: r.language,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * GASTO TOTAL DEL PROYECTO: el ledger entero del proyecto vía sus runs
 * (`cost_entry → step_run → pipeline_run.project_id`). La misma fuente que `/spend`,
 * agrupada por proyecto.
 */
async function projectSpendCents(db: Db, projectId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${costEntry.amountCents}), 0)::int` })
    .from(costEntry)
    .innerJoin(stepRun, eq(costEntry.stepRunId, stepRun.id))
    .innerJoin(pipelineRun, eq(stepRun.runId, pipelineRun.id))
    .where(eq(pipelineRun.projectId, projectId));
  return row?.total ?? 0;
}

/** Compone la vista de proyecto (briefs + lotes + variantes + métricas). El proyecto en sí lo
 *  lee el handler con `getProject` (404 si no existe) antes de llamar aquí. */
export async function getProjectDetail(db: Db, projectId: string): Promise<ProjectDetailRow> {
  const [briefs, batches, variants, spendCents] = await Promise.all([
    projectBriefs(db, projectId),
    projectBatches(db, projectId),
    projectVariants(db, projectId),
    projectSpendCents(db, projectId),
  ]);
  const totalVariants = batches.reduce((sum, b) => sum + b.totalVariants, 0);
  const approvedVariants = batches.reduce((sum, b) => sum + b.approvedVariants, 0);
  return {
    briefs,
    batches,
    variants,
    metrics: {
      totalBatches: batches.length,
      totalVariants,
      approvedVariants,
      spendCents,
    },
  };
}
