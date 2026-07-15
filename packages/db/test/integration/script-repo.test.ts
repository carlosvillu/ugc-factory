// LA VERIFICACIÓN DE T2.6, EN LA PARTE DETERMINISTA Y GRATUITA (regla de trabajo 8: vive en
// `pnpm gate`). Contra Postgres REAL (Testcontainers). Prueba las tres piezas del repo de guiones:
//
//   1. `createScriptsForBatch` + `findScriptsByOriginStep` — la persistencia v1 y la IDEMPOTENCIA DE
//      DINERO de N5: N filas escritas por un step comparten `origin_step_run_id` (índice NO unique),
//      y se releen todas por ese origen (un retry las reusa en vez de re-pagar Sonnet).
//   2. `getLatestScriptsByBatch` — el guion VIGENTE (versión más alta) de cada variante, con su
//      `filename_code` (que la fila `ad_script` no guarda): es lo que CP3 lista y compara.
//   3. `applyScriptVerdicts` — LA PIEZA TRANSACCIONAL DE CP3: inserta la v2 SOLO de las variantes
//      con `newVersion` (edición real) y transiciona a `scripted` SOLO las aprobadas. El rechazo NO
//      transiciona. Editar UNA variante y aprobar todo ⇒ EXACTAMENTE una v2 `edited_by_user`, el
//      resto v1 — el «`edited_by_user` en la editada» (singular) de la Verificación.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  createTestDatabase,
  makeAdBatch,
  makeAdVariant,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import type { AdScript, GuardrailFlag } from '@ugc/core/contracts';
import { newUlid } from '@ugc/core/contracts';
import { adBatch, adScript, adVariant, productBrief, project, urlAnalysis } from '@ugc/db/schema';
import {
  applyScriptVerdicts,
  createScriptsForBatch,
  findScriptsByOriginStep,
  getLatestScriptsByBatch,
} from '../../src/repos/script.repo';

let tdb: TestDatabase;

/** Un CONTRATO `AdScript` (no la fila): lo que produce N5 y lo que CP3 manda como `editedScript`. */
function makeScriptContract(overrides: Partial<AdScript> = {}): AdScript {
  const hook = overrides.hook ?? 'Mira esto ahora.';
  return {
    filenameCode: 'demo-x-es-30s',
    hook,
    cta: 'Enlace abajo.',
    scenes: [
      {
        t: 0,
        seconds: 2,
        segment: 'hook',
        narration: hook,
        visual: 'v',
        camera: 'c',
        emotion: 'e',
      },
      {
        t: 2,
        seconds: 5,
        segment: 'body',
        narration: 'Cuerpo.',
        visual: 'v',
        camera: 'c',
        emotion: 'e',
      },
      {
        t: 7,
        seconds: 2,
        segment: 'cta',
        narration: 'Enlace abajo.',
        visual: 'v',
        camera: 'c',
        emotion: 'e',
      },
    ],
    subtitles: [{ start: 0, end: 2, text: hook }],
    fullText: `${hook} Cuerpo. Enlace abajo.`,
    wordCount: 6,
    estSeconds: 9,
    tone: 'directo',
    language: 'es',
    sharedBodyKey: 'body-key',
    ...overrides,
  };
}

/** Siembra un lote nuevo con `n` variantes y devuelve sus ids. Cada test usa su propio lote (datos
 *  únicos por ULID: no hay dependencia de orden entre tests). */
async function seedBatch(n: number): Promise<{ batchId: string; variantIds: string[] }> {
  const [p] = await tdb.db.insert(project).values(makeProject()).returning();
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p!.id }))
    .returning();
  const [brief] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id }))
    .returning();
  const [batch] = await tdb.db
    .insert(adBatch)
    .values(makeAdBatch({ projectId: p!.id, briefId: brief!.id }))
    .returning();
  const variantIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const [v] = await tdb.db
      .insert(adVariant)
      .values(
        makeAdVariant({ batchId: batch!.id, filenameCode: `code-${newUlid().toLowerCase()}` }),
      )
      .returning();
    variantIds.push(v!.id);
  }
  return { batchId: batch!.id, variantIds };
}

const CLEAN: GuardrailFlag[] = [];
const BLOCKING: GuardrailFlag[] = [
  {
    rule: 'banned_claim',
    blocking: true,
    excerpt: 'cura el acné',
    explanation: 'afirmación de salud no permitida',
    suggestion: 'reformula sin prometer resultados médicos',
  },
];

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'script-repo' });
});

afterAll(async () => {
  await tdb.close(); // OBLIGATORIO: sin esto el proceso de vitest no termina.
});

describe('createScriptsForBatch + findScriptsByOriginStep (idempotencia de N5, T2.6)', () => {
  it('persiste un guion v1 por variante, todos con el MISMO origin_step (índice NO unique)', async () => {
    const { variantIds } = await seedBatch(3);
    const stepId = newUlid();

    const created = await createScriptsForBatch(tdb.db, {
      stepRunId: stepId,
      scripts: variantIds.map((variantId, i) => ({
        variantId,
        content: makeScriptContract({ hook: `Hook ${String(i)}.` }),
        guardrailFlags: CLEAN,
      })),
    });
    expect(created).toHaveLength(3);
    expect(created.every((r) => r.version === 1)).toBe(true);
    expect(created.every((r) => !r.editedByUser)).toBe(true);
    expect(created.every((r) => r.originStepRunId === stepId)).toBe(true);
    // `guardrail_flags` desde el arranque (lista vacía = linteado y limpio, ≠ null = sin lintear).
    expect(created.every((r) => Array.isArray(r.guardrailFlags))).toBe(true);

    // La RELECTURA por origen devuelve las TRES (un step escribe el lote entero): es lo que un retry
    // de N5 usa para reusar en vez de re-pagar. Un origen distinto no devuelve nada.
    const reread = await findScriptsByOriginStep(tdb.db, stepId);
    expect(reread).toHaveLength(3);
    expect(await findScriptsByOriginStep(tdb.db, newUlid())).toHaveLength(0);
  });

  it('un guion con flag bloqueante persiste el flag (el bloqueo no impide escribir la v1)', async () => {
    const { variantIds } = await seedBatch(1);
    const stepId = newUlid();
    const [row] = await createScriptsForBatch(tdb.db, {
      stepRunId: stepId,
      scripts: [
        { variantId: variantIds[0]!, content: makeScriptContract(), guardrailFlags: BLOCKING },
      ],
    });
    expect((row!.guardrailFlags as GuardrailFlag[])[0]?.blocking).toBe(true);
  });
});

describe('getLatestScriptsByBatch (lo que CP3 lista, T2.6)', () => {
  it('devuelve la versión MÁS ALTA de cada variante, con su filename_code', async () => {
    const { batchId, variantIds } = await seedBatch(2);
    const stepId = newUlid();
    await createScriptsForBatch(tdb.db, {
      stepRunId: stepId,
      scripts: variantIds.map((variantId) => ({
        variantId,
        content: makeScriptContract(),
        guardrailFlags: CLEAN,
      })),
    });
    // Una v2 en la primera variante (simula una edición ya aplicada).
    await applyScriptVerdicts(tdb.db, {
      batchId,
      verdicts: [
        {
          variantId: variantIds[0]!,
          approve: false,
          newVersion: { content: makeScriptContract({ hook: 'V2.' }), guardrailFlags: CLEAN },
        },
      ],
    });

    const latest = await getLatestScriptsByBatch(tdb.db, batchId);
    expect(latest).toHaveLength(2);
    const byVariant = new Map(latest.map((l) => [l.variantId, l]));
    expect(byVariant.get(variantIds[0]!)?.script.version).toBe(2);
    expect(byVariant.get(variantIds[0]!)?.script.hook).toBe('V2.');
    expect(byVariant.get(variantIds[1]!)?.script.version).toBe(1);
    // El filename_code viene del JOIN con ad_variant (la fila ad_script no lo guarda).
    expect(byVariant.get(variantIds[0]!)?.filenameCode).toMatch(/^code-/);
  });
});

describe('applyScriptVerdicts (la aprobación transaccional de CP3, T2.6)', () => {
  it('edita UNA variante y aprueba TODAS: exactamente una v2 edited_by_user, el resto v1', async () => {
    const { batchId, variantIds } = await seedBatch(3);
    const stepId = newUlid();
    await createScriptsForBatch(tdb.db, {
      stepRunId: stepId,
      scripts: variantIds.map((variantId) => ({
        variantId,
        content: makeScriptContract(),
        guardrailFlags: CLEAN,
      })),
    });

    await applyScriptVerdicts(tdb.db, {
      batchId,
      verdicts: [
        // La editada: v2 con edited_by_user, y aprobada.
        {
          variantId: variantIds[0]!,
          approve: true,
          newVersion: { content: makeScriptContract({ hook: 'Editado.' }), guardrailFlags: CLEAN },
        },
        // Las demás: aprobadas sin editar (sin newVersion ⇒ NO se crea v2).
        { variantId: variantIds[1]!, approve: true },
        { variantId: variantIds[2]!, approve: true },
      ],
    });

    // Las 3 variantes quedan `scripted` (valor LITERAL en BD — lo que la Verificación asserta).
    const variants = await tdb.db.select().from(adVariant).where(eq(adVariant.batchId, batchId));
    expect(variants.every((v) => v.status === 'scripted')).toBe(true);

    // EXACTAMENTE una v2 con edited_by_user (la editada); ninguna otra fila v2.
    const v2s = await tdb.db.select().from(adScript).where(eq(adScript.version, 2));
    const v2sOfBatch = v2s.filter((s) => variantIds.includes(s.variantId));
    expect(v2sOfBatch).toHaveLength(1);
    expect(v2sOfBatch[0]?.variantId).toBe(variantIds[0]);
    expect(v2sOfBatch[0]?.editedByUser).toBe(true);
    expect(v2sOfBatch[0]?.hook).toBe('Editado.');
    // La v2 de una edición humana NO tiene origen de step (mismo criterio que product_brief v2).
    expect(v2sOfBatch[0]?.originStepRunId).toBeNull();
  });

  it('un veredicto NO aprobado NO transiciona la variante (rechazo se queda como estaba)', async () => {
    const { batchId, variantIds } = await seedBatch(2);
    const stepId = newUlid();
    await createScriptsForBatch(tdb.db, {
      stepRunId: stepId,
      scripts: variantIds.map((variantId) => ({
        variantId,
        content: makeScriptContract(),
        guardrailFlags: CLEAN,
      })),
    });

    await applyScriptVerdicts(tdb.db, {
      batchId,
      verdicts: [
        { variantId: variantIds[0]!, approve: true },
        { variantId: variantIds[1]!, approve: false },
      ],
    });

    const approved = await tdb.db
      .select()
      .from(adVariant)
      .where(and(eq(adVariant.id, variantIds[0]!), eq(adVariant.batchId, batchId)));
    const rejected = await tdb.db.select().from(adVariant).where(eq(adVariant.id, variantIds[1]!));
    expect(approved[0]?.status).toBe('scripted');
    // La rechazada se queda `planned` (o como estuviera): NO llega a `scripted`.
    expect(rejected[0]?.status).not.toBe('scripted');
  });
});
