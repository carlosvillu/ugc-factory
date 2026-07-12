// El canal de DECISIONES del checkpoint (T1.11) contra Postgres REAL (db-integration.md §6).
//
// POR QUÉ CONTRA POSTGRES Y NO CONTRA UN MOCK: lo que se prueba aquí son propiedades de la BD,
// no de la aplicación — el UNIQUE por `step_run_id` (que hace del upsert un upsert de verdad) y
// el ON DELETE CASCADE (la decisión no sobrevive al step que la produjo). Un mock pasaría estos
// tests con las dos barreras QUITADAS.
//
// La ATOMICIDAD con la transición del checkpoint —el otro contrato de T1.11— se prueba donde de
// verdad ocurre: en los route handlers, contra la misma tx (`apps/web/test/integration/api/
// checkpoints.test.ts`). Aquí, el repo.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  makePipelineRun,
  makeProject,
  makeStepRun,
  type TestDatabase,
} from '@ugc/test-utils';

import { pipelineRun, stepRun } from '../../src/schema/pipeline';
import { createProject } from '../../src/repos/project.repo';
import {
  findCheckpointDecision,
  recordCheckpointDecision,
} from '../../src/repos/checkpoint-decision.repo';

let tdb: TestDatabase;
let projectId: string;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'checkpoint-decision-repo' });
  const project = await createProject(tdb.db, makeProject({ name: 'CP1 T1.11' }));
  projectId = project.id;
});

afterAll(async () => {
  await tdb.close(); // OBLIGATORIO: sin esto el proceso de vitest no termina.
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE step_run, pipeline_run CASCADE');
});

/** Un step de checkpoint (el CP1 pausado que el humano tiene delante).
 *
 *  Por las FACTORIES (`makePipelineRun`/`makeStepRun` de @ugc/test-utils) y Drizzle, no por SQL
 *  crudo: es el patrón del resto de tests de integración de este paquete (ver
 *  `orchestrator-harness.ts`). Con INSERT a mano, una columna `NOT NULL` nueva en `step_run`
 *  rompería este test —y solo este— con un error de Postgres en vez de con uno de tipos. */
async function newCheckpointStep(): Promise<string> {
  const [run] = await tdb.db.insert(pipelineRun).values(makePipelineRun({ projectId })).returning();
  const [step] = await tdb.db
    .insert(stepRun)
    .values(
      makeStepRun({
        runId: run!.id,
        nodeKey: 'N3',
        status: 'waiting_approval',
        isCheckpoint: true,
      }),
    )
    .returning();
  return step!.id;
}

describe('checkpoint_decision: la decisión del humano, legible POR STEP (T1.11)', () => {
  it('escribe la decisión y la devuelve por su step (la lectura que N7a/T4.4 hará)', async () => {
    const stepId = await newCheckpointStep();

    await recordCheckpointDecision(tdb.db, {
      stepRunId: stepId,
      kind: 'brief',
      decision: { kind: 'brief', images: 'ai_packshot' },
    });

    const row = await findCheckpointDecision(tdb.db, stepId);
    expect(row?.kind).toBe('brief');
    expect(row?.decision).toEqual({ kind: 'brief', images: 'ai_packshot' });
    expect(row?.decidedAt).toBeInstanceOf(Date);
  });

  it('sin decisión (la rama URL de CP1, que no decide nada) la lectura devuelve undefined', async () => {
    const stepId = await newCheckpointStep();
    expect(await findCheckpointDecision(tdb.db, stepId)).toBeUndefined();
  });

  it('el CANAL ES GENÉRICO: una decisión de OTRO checkpoint (forma distinta) se persiste igual', async () => {
    // LA PROPIEDAD QUE HACE QUE ESTO SIRVA PARA CP2/CP3/CP4 y no solo para CP1: la tabla no sabe
    // qué es una decisión de imágenes — `kind` + jsonb. Si mañana CP2 persiste "genera estas 4
    // variantes", entra sin migración. (El `kind` de la fila es texto libre por eso mismo: un
    // enum obligaría a un ALTER TYPE por cada checkpoint nuevo.)
    const stepId = await newCheckpointStep();
    const matrixDecision = { kind: 'matrix', generate: ['v1', 'v3', 'v7'] };

    await recordCheckpointDecision(tdb.db, {
      stepRunId: stepId,
      kind: 'matrix',
      decision: matrixDecision,
    });

    const row = await findCheckpointDecision(tdb.db, stepId);
    expect(row?.kind).toBe('matrix');
    expect(row?.decision).toEqual(matrixDecision);
  });

  it('una SEGUNDA decisión sobre el mismo step NO sobrescribe, NO duplica y SE REPORTA (`false`)', async () => {
    // EL INVARIANTE (code-review de T1.11). El UNIQUE hace del step la clave natural: un step se
    // aprueba UNA vez (tras la transición ya no está en `waiting_approval`; el 2º POST da 409).
    // Un conflicto aquí NO es una carrera benigna: significa que DOS aprobaciones del MISMO step
    // commitearon — la guardia del orquestador falló. Como esta decisión alimenta a N7a (T4.4),
    // que gasta dinero real, el repo NO la sobrescribe en silencio: la primera GANA y el `false`
    // obliga al caller a hacer ruido (web loguea a nivel ERROR).
    const stepId = await newCheckpointStep();

    const primera = await recordCheckpointDecision(tdb.db, {
      stepRunId: stepId,
      kind: 'brief',
      decision: { kind: 'brief', images: 'upload_images' },
    });
    const segunda = await recordCheckpointDecision(tdb.db, {
      stepRunId: stepId,
      kind: 'brief',
      decision: { kind: 'brief', images: 'ai_packshot' },
    });

    expect(primera).toBe(true);
    expect(segunda).toBe(false); // la anomalía se REPORTA, no se traga

    const { rows } = await tdb.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM checkpoint_decision WHERE step_run_id = $1`,
      [stepId],
    );
    expect(rows[0]?.n).toBe('1'); // ni duplica…
    expect((await findCheckpointDecision(tdb.db, stepId))?.decision).toEqual({
      kind: 'brief',
      images: 'upload_images', // …ni sobrescribe: manda la PRIMERA (sobre la que commiteó la tx)
    });
  });

  it('DOS steps distintos tienen decisiones INDEPENDIENTES (la clave es el step, no el run)', async () => {
    // Importa para el supersede (§7.1.c): si CP1 se rehace, la fila nueva del step es OTRA y trae
    // su propia decisión — el linaje se conserva en vez de sobrescribirse.
    const a = await newCheckpointStep();
    const b = await newCheckpointStep();

    await recordCheckpointDecision(tdb.db, {
      stepRunId: a,
      kind: 'brief',
      decision: { kind: 'brief', images: 'upload_images' },
    });
    await recordCheckpointDecision(tdb.db, {
      stepRunId: b,
      kind: 'brief',
      decision: { kind: 'brief', images: 'ai_packshot' },
    });

    expect((await findCheckpointDecision(tdb.db, a))?.decision).toEqual({
      kind: 'brief',
      images: 'upload_images',
    });
    expect((await findCheckpointDecision(tdb.db, b))?.decision).toEqual({
      kind: 'brief',
      images: 'ai_packshot',
    });
  });

  it('la decisión NO sobrevive al step que la produjo (ON DELETE CASCADE)', async () => {
    const stepId = await newCheckpointStep();
    await recordCheckpointDecision(tdb.db, {
      stepRunId: stepId,
      kind: 'brief',
      decision: { kind: 'brief', images: 'ai_packshot' },
    });

    await tdb.pool.query(`DELETE FROM step_run WHERE id = $1`, [stepId]);

    expect(await findCheckpointDecision(tdb.db, stepId)).toBeUndefined();
  });
});
