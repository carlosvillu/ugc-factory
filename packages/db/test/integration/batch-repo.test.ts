// LA VERIFICACIÓN DE T2.3, EN LA PARTE QUE ES DETERMINISTA Y GRATUITA (regla de trabajo 8 del
// planning: toda cláusula así vive dentro de `pnpm gate`). Contra Postgres REAL (Testcontainers),
// con la librería y las recetas REALES sembradas:
//
//   «aprobar crea EXACTAMENTE las variantes de la matriz (filas con `filename_code` únicos y
//    legibles)»
//
// Lo que se prueba aquí y no se puede probar en otra capa:
//   1. Se crean `ad_batch` + N `ad_variant` en `planned`, y N es EXACTAMENTE el número de
//      variantes del plan (ni una más: un lote que crea filas de más gasta dinero de más).
//   2. Los `filename_code` son ÚNICOS y LEGIBLES (§8.3), y **dos lotes del MISMO brief con la
//      MISMA config NO colisionan** — el UNIQUE GLOBAL de §12 es lo que reventaría con un 500
//      justo al confirmar el gasto, y el `batchDiscriminator` es la defensa.
//   3. El `hook_line_id` de un hook de LIBRERÍA apunta a su fila (resuelto por la clave natural
//      `(language, text)`, no por posición); el de un hook del BRIEF es NULL.
//   4. La `persona_id` se resuelve por nombre.
//   5. ATOMICIDAD: si un INSERT de variante choca contra el UNIQUE, NO queda ni el lote.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createTestDatabase,
  makeBrief,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import { SEED_LIBRARY, validateSeeds } from '@ugc/core/library';
import type { BatchConfig, BatchPlan } from '@ugc/core/contracts';
import { planBatch } from '@ugc/core/strategy';
import {
  adBatch,
  adVariant,
  hookLine,
  persona,
  productBrief,
  project,
  urlAnalysis,
} from '@ugc/db/schema';
import {
  createBatchWithVariants,
  findBatchesByBrief,
  listBatchVariants,
} from '../../src/repos/batch.repo';
import { getRecipe, listHookLines, seedLibrary } from '../../src/repos/library.repo';

let tdb: TestDatabase;
let projectId: string;
let briefId: string;

/** La persona que casa con el `avatar_hint` del brief de `makeBrief` («Creadora 30 años, estilo
 *  natural, baño luminoso»). Se INSERTA de verdad: el repo resuelve su id por nombre. */
const LUCIA = {
  name: 'Lucía',
  ageRange: '25-34',
  gender: 'female' as const,
  ethnicity: 'latina',
  style: 'natural',
  descriptor: 'creadora de 30 años, estilo natural',
  setting: 'baño luminoso',
  personality: 'cercana',
};

const BRIEF = makeBrief();

const CONFIG: BatchConfig = {
  angleIndices: [0, 1],
  hooksPerAngle: 2,
  objective: 'hook_test',
  tier: 'test',
  languages: ['es'],
  personaMode: 'rotate',
};

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'batch-repo' });

  const validation = validateSeeds(SEED_LIBRARY);
  if (!validation.library) throw new Error('la librería real no valida');
  await seedLibrary(tdb.db, validation.library);
  await tdb.db.insert(persona).values(LUCIA);

  const [p] = await tdb.db.insert(project).values(makeProject()).returning();
  if (!p) throw new Error('project no insertado');
  projectId = p.id;
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p.id }))
    .returning();
  if (!ua) throw new Error('url_analysis no insertado');
  const [brief] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua.id, data: BRIEF }))
    .returning();
  if (!brief) throw new Error('product_brief no insertado');
  briefId = brief.id;
});

afterAll(async () => {
  await tdb.close(); // OBLIGATORIO: sin esto el proceso de vitest no termina.
});

/** Compone y crea un lote con la config dada, EXACTAMENTE como lo hará el efecto de dominio de
 *  CP2: la matriz se compone DENTRO, con el id del lote como `batchDiscriminator`. */
async function createBatch(config: BatchConfig = CONFIG) {
  const recipe = await getRecipe(tdb.db, config.tier);
  if (!recipe) throw new Error(`no hay receta de ${config.tier}`);
  const hooks = await listHookLines(tdb.db);
  // La fila de `persona` YA satisface `PlannablePersona`: no se re-proyecta campo a campo (era un
  // no-op, y un punto de drift silencioso el día que el contrato gane campos).
  const personas = await tdb.db.select().from(persona);

  // El coste se estima con la receta REAL (nunca una constante): es lo que autoriza el gasto.
  const args = { brief: BRIEF, config, libraryHooks: hooks, personas, recipe };
  const preview = planBatch(args);

  const created = await createBatchWithVariants(tdb.db, {
    projectId,
    briefId,
    tier: config.tier,
    objective: config.objective,
    languages: config.languages,
    costEstimatedCents: preview.estimate.total.maxCents,
    composePlan: (batchId) => planBatch({ ...args, batchDiscriminator: batchId }).plan,
  });

  return { ...created, preview };
}

describe('createBatchWithVariants (CP2, T2.3)', () => {
  it('crea el lote y EXACTAMENTE las variantes de la matriz, todas en `planned`', async () => {
    const { batch, variants, preview } = await createBatch();

    // 2 ángulos × 2 hooks × 1 idioma = 4 variantes. NI UNA MÁS: cada fila de más es dinero de más.
    expect(preview.plan.variants).toHaveLength(4);
    expect(variants).toHaveLength(preview.plan.variants.length);
    expect(variants.every((v) => v.status === 'planned')).toBe(true);

    // El lote guarda su matriz (jsonb) y el coste autorizado (el TECHO de la horquilla).
    expect(batch.status).toBe('planned');
    expect(batch.tier).toBe('test');
    expect(batch.objective).toBe('hook_test');
    expect(batch.languages).toEqual(['es']);
    expect(batch.costEstimatedCents).toBe(preview.estimate.total.maxCents);
    expect((batch.matrix as BatchPlan).variants).toHaveLength(4);

    // Y las variantes persistidas son LAS DEL PLAN QUE SE GUARDÓ (el del discriminante), no las
    // del preview: los `filename_code` de la fila y del jsonb tienen que coincidir o `ad_batch.
    // matrix` estaría describiendo un lote que no es el que hay en `ad_variant`.
    const persistedCodes = (batch.matrix as BatchPlan).variants.map((v) => v.filenameCode).sort();
    expect(variants.map((v) => v.filenameCode).sort()).toEqual(persistedCodes);
  });

  it('los `filename_code` son únicos y LEGIBLES (§8.3)', async () => {
    const { variants } = await createBatch({ ...CONFIG, languages: ['es', 'en'] });
    const codes = variants.map((v) => v.filenameCode);

    expect(new Set(codes).size).toBe(codes.length);
    // Legible = slug del producto + ángulo + hook + persona + idioma + duración (+ lote).
    // Se comprueba la FORMA, no un literal: el literal ataría el test al nombre del fixture.
    for (const code of codes) {
      expect(code).toMatch(/^[a-z0-9-]+$/);
      expect(code).toMatch(/-hook\d\d-/);
      expect(code).toMatch(/-12s-/); // el preset de hook_test (§8.4)
    }
    expect(codes.some((c) => c.includes('-es-'))).toBe(true);
    expect(codes.some((c) => c.includes('-en-'))).toBe(true);
  });

  it('DOS lotes del MISMO brief con la MISMA config NO colisionan (UNIQUE GLOBAL, §12)', async () => {
    // ESTE ES EL 500 QUE EL `batchDiscriminator` EXISTE PARA IMPEDIR: sin él, el segundo INSERT
    // revienta contra `ad_variant.filename_code` UNIQUE — justo al confirmar el gasto.
    const first = await createBatch();
    const second = await createBatch();

    expect(second.batch.id).not.toBe(first.batch.id);
    const all = [...first.variants, ...second.variants].map((v) => v.filenameCode);
    expect(new Set(all).size).toBe(all.length);

    // Y los dos lotes cuelgan del mismo brief (que es legítimo: configs distintas, o re-lanzar).
    const batches = await findBatchesByBrief(tdb.db, briefId);
    expect(batches.map((b) => b.id)).toEqual(
      expect.arrayContaining([first.batch.id, second.batch.id]),
    );
  });

  it('el hook de LIBRERÍA lleva su FK (resuelta por (language, text)); el del BRIEF, NULL', async () => {
    // `hooksPerAngle: 3` con un ángulo que solo trae 2 `hook_examples` fuerza a que el tercero
    // salga de la LIBRERÍA — que es el hook con FK.
    const { batch } = await createBatch({ ...CONFIG, angleIndices: [0], hooksPerAngle: 3 });
    const plan = batch.matrix as BatchPlan;
    const rows = await listBatchVariants(tdb.db, batch.id);

    const libraryHook = plan.variants.find((v) => v.hook.source === 'library');
    const briefHook = plan.variants.find((v) => v.hook.source === 'brief');
    expect(libraryHook).toBeDefined();
    expect(briefHook).toBeDefined();

    const libRow = rows.find((r) => r.filenameCode === libraryHook?.filenameCode);
    const briefRow = rows.find((r) => r.filenameCode === briefHook?.filenameCode);

    // El del brief NO tiene fila que referenciar (§12: `hook_line_id?`).
    expect(briefRow?.hookLineId).toBeNull();
    // El de librería SÍ, y apunta a LA línea de su (idioma, texto) — no a otra con el mismo texto.
    expect(libRow?.hookLineId).not.toBeNull();
    const [line] = await tdb.db
      .select()
      .from(hookLine)
      .where(eq(hookLine.id, libRow?.hookLineId ?? ''));
    expect(line?.text).toBe(libraryHook?.hook.text);
    expect(line?.language).toBe(libraryHook?.language);
  });

  it('la `persona_id` se resuelve por su nombre', async () => {
    const { batch, variants } = await createBatch();
    const plan = batch.matrix as BatchPlan;
    expect(plan.personaSelection).toBe('matched');

    const [lucia] = await tdb.db.select().from(persona).where(eq(persona.name, 'Lucía'));
    expect(variants.every((v) => v.personaId === lucia?.id)).toBe(true);
  });

  it('ATÓMICO: si una variante choca contra el UNIQUE, NO queda ni el lote', async () => {
    // Se compone SIN discriminante A PROPÓSITO (lo que un llamante despistado haría, y lo que el
    // contrato prohíbe): el segundo lote produce los MISMOS `filename_code` que el primero.
    const recipe = await getRecipe(tdb.db, 'test');
    if (!recipe) throw new Error('sin receta');
    const hooks = await listHookLines(tdb.db);
    const config: BatchConfig = { ...CONFIG, angleIndices: [3], hooksPerAngle: 1 };
    const noDiscriminator = (): BatchPlan =>
      planBatch({ brief: BRIEF, config, libraryHooks: hooks, personas: [], recipe }).plan;

    const args = {
      projectId,
      briefId,
      tier: 'test' as const,
      objective: 'hook_test' as const,
      languages: ['es'],
      costEstimatedCents: 100,
      composePlan: noDiscriminator,
    };

    await createBatchWithVariants(tdb.db, args);
    const before = await tdb.db.select().from(adBatch);

    await expect(createBatchWithVariants(tdb.db, args)).rejects.toThrow();

    // LA CLÁUSULA: el lote del intento fallido NO existe (la tx lo deshizo). Un `ad_batch`
    // huérfano sin variantes sería un lote fantasma que la UI enseñaría vacío.
    const after = await tdb.db.select().from(adBatch);
    expect(after).toHaveLength(before.length);
    const orphan = await tdb.db.select().from(adVariant).where(eq(adVariant.batchId, 'nunca'));
    expect(orphan).toHaveLength(0);
  });

  // ── DRIFT: EL PLAN REFERENCIA ALGO QUE NO ESTÁ EN LA BD ────────────────────────────────────
  // `hook_line_id` y `persona_id` son NULLABLE, pero su NULL ya SIGNIFICA algo («hook del brief»,
  // «variante sin cara»). Si la resolución falla y escribimos NULL, el drift queda guardado con el
  // MISMO valor que una decisión legítima: indistinguible, y por tanto invisible. Estas dos pruebas
  // fijan que la creación REVIENTA en vez de insertar la fila que miente — dentro de la tx del
  // gasto, antes de gastar un céntimo, abortar es barato.

  it('DRIFT: un hook de LIBRERÍA que no existe en `hook_line` REVIENTA (no escribe la FK a NULL)', async () => {
    const recipe = await getRecipe(tdb.db, 'test');
    if (!recipe) throw new Error('sin receta');
    const hooks = await listHookLines(tdb.db);
    const config: BatchConfig = { ...CONFIG, angleIndices: [0], hooksPerAngle: 3 };
    const args = { brief: BRIEF, config, libraryHooks: hooks, personas: [], recipe };

    const before = await tdb.db.select().from(adBatch);

    await expect(
      createBatchWithVariants(tdb.db, {
        projectId,
        briefId,
        tier: config.tier,
        objective: config.objective,
        languages: config.languages,
        costEstimatedCents: 100,
        // El plan sale del compositor REAL y luego se le cambia el texto al hook de librería: es
        // exactamente el drift que se quiere cazar (el plan dice una línea que la BD no tiene).
        composePlan: (batchId) => {
          const plan = planBatch({ ...args, batchDiscriminator: batchId }).plan;
          const target = plan.variants.find((v) => v.hook.source === 'library');
          if (!target) throw new Error('el fixture debía producir un hook de librería');
          return {
            ...plan,
            variants: plan.variants.map((v) =>
              v === target ? { ...v, hook: { ...v.hook, text: 'una línea que no existe' } } : v,
            ),
          };
        },
      }),
    ).rejects.toThrow(/no existe en la BD/);

    // Y NO queda el lote: si esto se hubiera tragado el NULL, la fila estaría creada y la línea de
    // librería habría perdido su trazabilidad (la que F7 realimenta por FK) SIN un solo error.
    expect(await tdb.db.select().from(adBatch)).toHaveLength(before.length);
  });

  it('DRIFT: una persona que no existe en `persona` REVIENTA (no escribe la variante sin cara)', async () => {
    const recipe = await getRecipe(tdb.db, 'test');
    if (!recipe) throw new Error('sin receta');
    const hooks = await listHookLines(tdb.db);
    const args = { brief: BRIEF, config: CONFIG, libraryHooks: hooks, personas: [], recipe };

    const before = await tdb.db.select().from(adBatch);

    await expect(
      createBatchWithVariants(tdb.db, {
        projectId,
        briefId,
        tier: CONFIG.tier,
        objective: CONFIG.objective,
        languages: CONFIG.languages,
        costEstimatedCents: 100,
        composePlan: (batchId) => {
          const plan = planBatch({ ...args, batchDiscriminator: batchId }).plan;
          // El usuario aprobó un lote CON una cara concreta; esa persona no está en la BD. Sin este
          // throw, obtendría variantes SIN cara y nadie se enteraría.
          return {
            ...plan,
            variants: plan.variants.map((v) => ({ ...v, personaName: 'Fantasma' })),
          };
        },
      }),
    ).rejects.toThrow(/no existe en la BD/);

    expect(await tdb.db.select().from(adBatch)).toHaveLength(before.length);
  });
});
