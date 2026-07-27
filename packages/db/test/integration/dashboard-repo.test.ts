// Roundtrip real de los agregados del dashboard (T5.10) contra el clon de Testcontainers
// (db-integration.md §6). Cada KPI del dashboard `/` y de `/projects/[id]` se DERIVA de
// datos reales; aquí se codifica esa derivación como test permanente (regla de trabajo 8):
// la cláusula determinista de la Verificación de T5.10 («el dashboard muestra el lote activo
// y el gasto del mes del proyecto; /projects/[id] lista sus briefs y variantes con estados
// correctos») queda blindada contra regresión, además de la corrida en vivo del verifier.
//
// La ATRIBUCIÓN DE COSTE A PROYECTO/LOTE (cost_entry → step_run → pipeline_run.project_id/
// batch_id) es lo más frágil y lo que más importa afirmar: importes en céntimos enteros
// elegidos para sumar a mano.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createTestDatabase,
  makeAdBatch,
  makeAdVariant,
  makePipelineRun,
  makeProductBrief,
  makeProject,
  makeStepRun,
  makeUrlAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import {
  adBatch,
  adVariant,
  pipelineRun,
  productBrief,
  project,
  stepRun,
  urlAnalysis,
} from '@ugc/db/schema';
import { recordCost } from '../../src/repos/spend.repo';
import {
  batchCountsByProject,
  getDashboardSummary,
  getProjectDetail,
} from '../../src/repos/dashboard.repo';
import { listProjects, updateProject } from '../../src/repos/project.repo';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'dashboard-repo' });
});

afterAll(async () => {
  await tdb.close();
});

/** El mes en el que caen todos los fixtures (UTC). `now` inyectado a getDashboardSummary. */
const NOW = new Date('2026-07-15T12:00:00.000Z');
const IN_MONTH = new Date('2026-07-10T09:00:00.000Z');
const LAST_MONTH = new Date('2026-06-20T09:00:00.000Z');

/** Siembra un proyecto con su análisis y un brief. Devuelve ids reutilizables. */
async function seedProjectWithBrief(db: TestDatabase['db'], overrides: { name: string }) {
  const p = makeProject({ name: overrides.name });
  await db.insert(project).values(p);
  const projectId = (await db.select().from(project).where(eq(project.name, overrides.name)))[0]!
    .id;
  const ua = makeUrlAnalysis({ projectId });
  await db.insert(urlAnalysis).values(ua);
  const brief = makeProductBrief({
    urlAnalysisId: ua.id!,
    status: 'approved',
    data: { product: { name: `Producto de ${overrides.name}` } },
  });
  await db.insert(productBrief).values(brief);
  return { projectId, urlAnalysisId: ua.id!, briefId: brief.id! };
}

describe('dashboard repo — proyecto CRUD (T5.10)', () => {
  it('listProjects devuelve los proyectos más nuevos primero; updateProject archiva', async () => {
    const t = await createTestDatabase({ label: 'dash-crud' });
    try {
      const { projectId } = await seedProjectWithBrief(t.db, { name: 'CRUD Uno' });
      const before = await listProjects(t.db);
      expect(before.some((p) => p.id === projectId)).toBe(true);
      expect(before.find((p) => p.id === projectId)!.status).toBe('active');

      const archived = await updateProject(t.db, projectId, { status: 'archived' });
      expect(archived?.status).toBe('archived');

      // `listProjects` filtra a activos en el servidor (Fix F): tras archivar YA no aparece.
      const after = await listProjects(t.db);
      expect(after.some((p) => p.id === projectId)).toBe(false);

      const renamed = await updateProject(t.db, projectId, { name: 'CRUD Uno Editado' });
      expect(renamed?.name).toBe('CRUD Uno Editado');
      // status NO se toca si no se pasa (PATCH parcial).
      expect(renamed?.status).toBe('archived');

      // id inexistente → undefined (el handler lo traduce a 404).
      expect(
        await updateProject(t.db, '00000000000000000000000000', { name: 'x' }),
      ).toBeUndefined();
    } finally {
      await t.close();
    }
  });
});

describe('dashboard repo — getDashboardSummary (T5.10)', () => {
  it('gasto del mes suma SOLO el mes en curso (UTC); lotes activos y atención derivados', async () => {
    const t = await createTestDatabase({ label: 'dash-summary' });
    try {
      const { projectId, briefId } = await seedProjectWithBrief(t.db, { name: 'Nuvela' });

      // Lote ACTIVO (running) con 3 variantes, 1 aprobada.
      const batch = makeAdBatch({ projectId, briefId, status: 'running' });
      await t.db.insert(adBatch).values(batch);
      await t.db
        .insert(adVariant)
        .values([
          makeAdVariant({ batchId: batch.id!, status: 'approved', updatedAt: IN_MONTH }),
          makeAdVariant({ batchId: batch.id!, status: 'generating' }),
          makeAdVariant({ batchId: batch.id!, status: 'planned' }),
        ]);
      // Lote TERMINAL (completed) → NO debe aparecer en activos.
      const done = makeAdBatch({ projectId, briefId, status: 'completed' });
      await t.db.insert(adBatch).values(done);

      // Un run DEL LOTE (batchId) con un step para colgar cargos y un waiting_approval. Que
      // el run apunte al lote es lo que hace que el gasto se atribuya al lote (mes ∧ proyecto).
      const run = makePipelineRun({ projectId, batchId: batch.id!, status: 'running' });
      await t.db.insert(pipelineRun).values(run);
      const step = makeStepRun({ runId: run.id!, nodeKey: 'N3', status: 'waiting_approval' });
      await t.db.insert(stepRun).values(step);

      // Gasto: 500 este mes + 250 este mes = 750 cuentan; 999 del mes pasado NO.
      await recordCost(t.db, {
        provider: 'fal',
        amountCents: 500,
        stepRunId: step.id!,
        occurredAt: IN_MONTH,
      });
      await recordCost(t.db, {
        provider: 'anthropic',
        amountCents: 250,
        stepRunId: step.id!,
        occurredAt: IN_MONTH,
      });
      await recordCost(t.db, {
        provider: 'fal',
        amountCents: 999,
        stepRunId: step.id!,
        occurredAt: LAST_MONTH,
      });

      const summary = await getDashboardSummary(t.db, NOW);

      // Gasto del mes: EXACTO, sin el cargo del mes pasado.
      expect(summary.monthSpendCents).toBe(750);
      // Variantes aprobadas este mes: la aprobada con updated_at en el mes.
      expect(summary.approvedThisMonth).toBe(1);

      const active = summary.activeBatches.find((b) => b.batchId === batch.id);
      expect(active).toBeDefined();
      expect(active!.status).toBe('running');
      expect(active!.totalVariants).toBe(3);
      expect(active!.approvedVariants).toBe(1);
      expect(active!.projectName).toBe('Nuvela');
      // GASTO DEL MES DEL LOTE (mes ∧ proyecto): EXACTO 750, con el mismo control de límite
      // de mes que el agregado global — el cargo de 999 del mes pasado tampoco entra aquí.
      expect(active!.monthSpendCents).toBe(750);
      // El lote completado NO está en activos.
      expect(summary.activeBatches.some((b) => b.batchId === done.id)).toBe(false);

      // Requiere atención: el step waiting_approval, con su proyecto.
      const att = summary.attention.find((a) => a.runId === run.id);
      expect(att).toBeDefined();
      expect(att!.nodeKey).toBe('N3');
      expect(att!.projectName).toBe('Nuvela');
    } finally {
      await t.close();
    }
  });

  it('CONTROL NEGATIVO: un proyecto sin lotes no aporta lote activo ni gasto falso', async () => {
    const t = await createTestDatabase({ label: 'dash-empty' });
    try {
      const { projectId } = await seedProjectWithBrief(t.db, { name: 'Vacío' });
      const summary = await getDashboardSummary(t.db, NOW);
      // Ni lotes activos ni cargos: nada que pintar, y CERO no es un cero FALSO (es real).
      expect(summary.activeBatches.filter((b) => b.projectId === projectId)).toHaveLength(0);
      expect(summary.monthSpendCents).toBe(0);
      expect(summary.approvedThisMonth).toBe(0);
      expect(summary.attention).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it('un proyecto ARCHIVADO desaparece de lotes activos y de atención, pero su gasto del mes SIGUE contando', async () => {
    const t = await createTestDatabase({ label: 'dash-archived' });
    try {
      const { projectId, briefId } = await seedProjectWithBrief(t.db, { name: 'Archivado' });

      // Lote RUNNING con un run del lote, un step waiting_approval, y un cargo de 640¢ este mes.
      const batch = makeAdBatch({ projectId, briefId, status: 'running' });
      await t.db.insert(adBatch).values(batch);
      await t.db
        .insert(adVariant)
        .values([makeAdVariant({ batchId: batch.id!, status: 'generating' })]);
      const run = makePipelineRun({ projectId, batchId: batch.id!, status: 'running' });
      await t.db.insert(pipelineRun).values(run);
      const step = makeStepRun({ runId: run.id!, nodeKey: 'N3', status: 'waiting_approval' });
      await t.db.insert(stepRun).values(step);
      await recordCost(t.db, {
        provider: 'fal',
        amountCents: 640,
        stepRunId: step.id!,
        occurredAt: IN_MONTH,
      });

      // ANTES de archivar: el proyecto aporta lote activo + atención.
      const before = await getDashboardSummary(t.db, NOW);
      expect(before.activeBatches.some((b) => b.batchId === batch.id)).toBe(true);
      expect(before.attention.some((a) => a.runId === run.id)).toBe(true);

      // Se archiva el proyecto.
      await updateProject(t.db, projectId, { status: 'archived' });

      const after = await getDashboardSummary(t.db, NOW);
      // Las queries de LISTA lo excluyen (eq(project.status,'active')): fuera de `/`.
      expect(after.activeBatches.some((b) => b.batchId === batch.id)).toBe(false);
      expect(after.attention.some((a) => a.runId === run.id)).toBe(false);
      // Pero el KPI de dinero NO se filtra por proyecto activo: el gasto FUE real y sigue
      // contando (antipatrón «nada de valores falsos» si se filtrara). Es el único cargo
      // del mes en esta BD aislada → 640 exacto, antes y después de archivar.
      expect(before.monthSpendCents).toBe(640);
      expect(after.monthSpendCents).toBe(640);
    } finally {
      await t.close();
    }
  });
});

describe('dashboard repo — getProjectDetail + batchCountsByProject (T5.10)', () => {
  it('lista briefs y lotes del proyecto con estados y coste real; métricas agregadas', async () => {
    const t = await createTestDatabase({ label: 'dash-detail' });
    try {
      const { projectId, briefId } = await seedProjectWithBrief(t.db, { name: 'Terra' });

      const batch = makeAdBatch({ projectId, briefId, status: 'running', objective: 'conversion' });
      await t.db.insert(adBatch).values(batch);
      const vApproved = makeAdVariant({ batchId: batch.id!, status: 'approved' });
      const vRejected = makeAdVariant({ batchId: batch.id!, status: 'rejected' });
      await t.db.insert(adVariant).values([vApproved, vRejected]);

      // Coste del lote vía su run (batch_id) → 1234 céntimos.
      const run = makePipelineRun({ projectId, batchId: batch.id!, status: 'running' });
      await t.db.insert(pipelineRun).values(run);
      const step = makeStepRun({ runId: run.id!, nodeKey: 'N7', status: 'succeeded' });
      await t.db.insert(stepRun).values(step);
      await recordCost(t.db, {
        provider: 'fal',
        amountCents: 1234,
        stepRunId: step.id!,
        occurredAt: IN_MONTH,
      });

      const detail = await getProjectDetail(t.db, projectId);

      // Briefs: el aprobado sembrado, con el nombre del producto extraído del jsonb.
      expect(detail.briefs).toHaveLength(1);
      expect(detail.briefs[0]!.status).toBe('approved');
      expect(detail.briefs[0]!.productName).toBe('Producto de Terra');

      // Lotes: el lote con sus variantes y su coste real del ledger.
      expect(detail.batches).toHaveLength(1);
      const b = detail.batches[0]!;
      expect(b.status).toBe('running');
      expect(b.objective).toBe('conversion');
      expect(b.totalVariants).toBe(2);
      expect(b.approvedVariants).toBe(1);
      expect(b.costActualCents).toBe(1234);

      // Variantes con su ESTADO INDIVIDUAL (§8.1): las 2 sembradas, cada una con su estado
      // (no solo el recuento agregado del lote). Se localizan por id para afirmar el estado
      // POR VARIANTE, no en conjunto.
      expect(detail.variants).toHaveLength(2);
      const approvedRow = detail.variants.find((v) => v.id === vApproved.id);
      const rejectedRow = detail.variants.find((v) => v.id === vRejected.id);
      expect(approvedRow?.status).toBe('approved');
      expect(rejectedRow?.status).toBe('rejected');
      expect(approvedRow?.batchId).toBe(batch.id);
      expect(approvedRow?.filenameCode).toBe(vApproved.filenameCode);

      // Métricas agregadas del proyecto.
      expect(detail.metrics.totalBatches).toBe(1);
      expect(detail.metrics.totalVariants).toBe(2);
      expect(detail.metrics.approvedVariants).toBe(1);
      expect(detail.metrics.spendCents).toBe(1234);

      // Recuento de lotes por proyecto (para el índice de proyectos).
      const counts = await batchCountsByProject(t.db);
      expect(counts.get(projectId)).toEqual({ batchCount: 1, activeBatchCount: 1 });
    } finally {
      await t.close();
    }
  });
});
