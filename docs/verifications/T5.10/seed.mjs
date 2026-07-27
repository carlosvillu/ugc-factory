// Seed del escenario de RE-VERIFICACIÓN de T5.10 (verifier, $0 — data en reposo).
// Siembra por repo/BD dev (NO por API bajo verificación): el step verificado es el
// dashboard MOSTRANDO datos + CRUD por UI, no la generación real.
//
// Escenario:
//  - Proyecto P con url_analysis + brief `approved`.
//  - Lote B1 (running) con 5 VARIANTES en estados DISTINTOS que el spec NO usa:
//      composing, qa, published, planned, generating  (+ una que flip-earemos).
//    El spec del implementer fija approved/rejected; estos son otros para que un
//    VARIANT_STATUS afinado a los dos del spec no cuele.
//  - Lote B2 (running) en el MISMO proyecto, con SU cargo del mes en curso:
//    prueba la rareza aparcada por el verifier previo ("gasto del mes DEL PROYECTO"
//    con >1 lote).
//  - Cargos: B1 = $5.55 mes en curso + $9.99 hace ~40 días (mes anterior);
//            B2 = $3.33 mes en curso. Importes elegidos por el verifier.
// DATABASE_URL llega por `node --env-file=.env` (o del entorno). Sin dotenv (no está en root).

const { createDbPool } = await import('../../../packages/db/src/index.ts');
const factories = await import('../../../packages/test-utils/src/index.ts');
const schema = await import('../../../packages/db/src/schema/index.ts');

const {
  makeProject,
  makeUrlAnalysis,
  makeProductBrief,
  makeAdBatch,
  makeAdVariant,
  makePipelineRun,
  makeStepRun,
} = factories;
const { project, urlAnalysis, productBrief, adBatch, adVariant, pipelineRun, stepRun, costEntry } =
  schema;

const { db, pool } = createDbPool(process.env.DATABASE_URL);
const SUF = Math.random().toString(36).slice(2, 8);

// ── Proyecto ────────────────────────────────────────────────────────────────
const p = makeProject({ name: `REVERIF T5.10 ${SUF}`, status: 'active' });
const [projRow] = await db.insert(project).values(p).returning();
const projectId = projRow.id;

const ua = makeUrlAnalysis({ projectId, status: 'done' });
await db.insert(urlAnalysis).values(ua);

const brief = makeProductBrief({
  urlAnalysisId: ua.id,
  status: 'approved',
  data: {
    ...factories.makeBrief(),
    product: { ...factories.makeBrief().product, name: `Zapatillas REVERIF ${SUF}` },
  },
});
await db.insert(productBrief).values(brief);

// ── Lote B1 (running) con 5 variantes en estados distintos ────────────────────
const b1 = makeAdBatch({ projectId, briefId: brief.id, status: 'running', objective: 'conversion' });
await db.insert(adBatch).values(b1);

// filenameCode legible por estado para localizarlas en pantalla
const mkVar = (status, angle) =>
  makeAdVariant({
    batchId: b1.id,
    status,
    angleName: angle,
    language: 'es',
    filenameCode: `reverif-${SUF}-${status}-es-30s`,
  });
const vComposing = mkVar('composing', 'social_proof');
const vQa = mkVar('qa', 'pain_point');
const vPublished = mkVar('published', 'benefit');
const vPlanned = mkVar('planned', 'curiosity');
const vFlip = mkVar('generating', 'urgency'); // sobre esta haremos el flip probe
await db.insert(adVariant).values([vComposing, vQa, vPublished, vPlanned, vFlip]);

// ── Lote B2 (running) en el MISMO proyecto (probe two-batch month spend) ──────
const b2 = makeAdBatch({ projectId, briefId: brief.id, status: 'running', objective: 'story' });
await db.insert(adBatch).values(b2);
const vB2 = makeAdVariant({
  batchId: b2.id,
  status: 'approved',
  angleName: 'testimonial',
  filenameCode: `reverif-${SUF}-b2approved-es-30s`,
});
await db.insert(adVariant).values(vB2);

// ── Runs + steps + cargos ─────────────────────────────────────────────────────
const now = new Date();
const lastMonth = new Date(now);
lastMonth.setUTCDate(lastMonth.getUTCDate() - 40); // ~40 días atrás = mes anterior

async function seedCharge(batchId, amountCents, occurredAt) {
  const run = makePipelineRun({ projectId, batchId, status: 'running' });
  await db.insert(pipelineRun).values(run);
  const step = makeStepRun({ runId: run.id, nodeKey: 'N7', status: 'succeeded' });
  await db.insert(stepRun).values(step);
  await db.insert(costEntry).values({
    provider: 'fal',
    stepRunId: step.id,
    amountCents,
    quantity: 1,
    unit: 'seconds',
    occurredAt,
  });
}

await seedCharge(b1.id, 555, now); // B1 mes en curso $5.55
await seedCharge(b1.id, 999, lastMonth); // B1 mes anterior $9.99 (probe filtro mensual)
await seedCharge(b2.id, 333, now); // B2 mes en curso $3.33 (probe two-batch)

console.log(
  JSON.stringify(
    {
      projectId,
      projectName: p.name,
      brief: brief.id,
      b1: b1.id,
      b2: b2.id,
      variants: {
        composing: vComposing.id,
        qa: vQa.id,
        published: vPublished.id,
        planned: vPlanned.id,
        flip_generating: vFlip.id,
        b2_approved: vB2.id,
      },
      charges: { b1_month: 555, b1_lastmonth: 999, b2_month: 333 },
    },
    null,
    2,
  ),
);
await pool.end();
process.exit(0);
