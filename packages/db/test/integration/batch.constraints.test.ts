// Constraints de las tablas del LOTE y de la LIBRERÍA (T2.1, db-integration.md §5).
// Fija el COMPORTAMIENTO observable que la migración 0011 promete:
//  (a) las 6 tablas existen tras migrar sobre BD limpia;
//  (b) el enum `ad_variant_status` lleva `scripted` TRAS `planned` (§12 literal): es EL
//      punto que la Entrega de T2.1 nombra, y se comprueba contra el catálogo de pg —
//      no contra la constante de TypeScript, que es justo lo que podría divergir;
//  (c) `ad_variant.filename_code` es UNIQUE (la Verificación de T2.3 depende de ello);
//  (d) los `ON DELETE` declarados se comportan como dicen (cascade del lote, set null del
//      hook_line: purgar una línea de la librería NO borra los anuncios hechos con ella);
//  (e) el UNIQUE (language, text) de hook_line/cta_line — la clave natural que hace
//      IDEMPOTENTE a `pnpm seed`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  createTestDatabase,
  makeAdBatch,
  makeAdScript,
  makeAdVariant,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import {
  adBatch,
  adScript,
  adVariant,
  ctaLine,
  hookLine,
  project,
  productBrief,
  urlAnalysis,
} from '@ugc/db/schema';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'batch-constraints' });
});

afterAll(async () => {
  await tdb.close(); // OBLIGATORIO: sin esto el proceso de vitest no termina.
});

/** El error de pg viaja en `cause` del DrizzleQueryError (patrón de analysis.constraints). */
interface PgCause {
  code?: string;
  message?: string;
  constraint?: string;
}
async function expectRejection(promise: Promise<unknown>): Promise<PgCause> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeDefined();
  const cause = (err as { cause?: PgCause }).cause;
  expect(cause).toBeDefined();
  return cause ?? {};
}

/** Crea project → url_analysis → product_brief → ad_batch y devuelve el id del lote. */
async function seedBatch(): Promise<string> {
  const [p] = await tdb.db.insert(project).values(makeProject()).returning();
  if (!p) throw new Error('project no insertado');
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p.id }))
    .returning();
  if (!ua) throw new Error('url_analysis no insertado');
  const [brief] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua.id }))
    .returning();
  if (!brief) throw new Error('product_brief no insertado');
  const [batch] = await tdb.db
    .insert(adBatch)
    .values(makeAdBatch({ projectId: p.id, briefId: brief.id }))
    .returning();
  if (!batch) throw new Error('ad_batch no insertado');
  return batch.id;
}

describe('migración 0011: las 6 tablas de T2.1 existen tras migrar', () => {
  it('hook_line, cta_line, ad_batch, ad_variant, ad_script y recipe están presentes', async () => {
    const rows = await tdb.db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('hook_line', 'cta_line', 'ad_batch', 'ad_variant', 'ad_script', 'recipe')
      ORDER BY table_name
    `);
    expect(rows.rows.map((r) => (r as { table_name: string }).table_name)).toEqual([
      'ad_batch',
      'ad_script',
      'ad_variant',
      'cta_line',
      'hook_line',
      'recipe',
    ]);
  });

  it('el enum `ad_variant_status` lleva `scripted` justo tras `planned` (§12 literal)', async () => {
    // Se pregunta a POSTGRES (pg_enum), no a la constante de TS: el schema TypeScript y el
    // SQL migrado son dos artefactos distintos y es justo su divergencia lo que se testea.
    const rows = await tdb.db.execute(sql`
      SELECT e.enumlabel AS label
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'ad_variant_status'
      ORDER BY e.enumsortorder
    `);
    expect(rows.rows.map((r) => (r as { label: string }).label)).toEqual([
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
  });

  it('el default de `ad_variant.status` es `planned` (CP2 crea las variantes ahí)', async () => {
    const batchId = await seedBatch();
    const [variant] = await tdb.db.insert(adVariant).values(makeAdVariant({ batchId })).returning();
    expect(variant?.status).toBe('planned');
  });

  it('rechaza un status fuera del enum', async () => {
    const batchId = await seedBatch();
    const cause = await expectRejection(
      tdb.db.insert(adVariant).values(makeAdVariant({ batchId, status: 'drafting' as never })),
    );
    expect(cause.message).toMatch(/invalid input value for enum/);
  });
});

describe('ad_variant: filename_code es UNIQUE global', () => {
  it('rechaza la segunda variante con el mismo filename_code', async () => {
    const batchId = await seedBatch();
    await tdb.db
      .insert(adVariant)
      .values(makeAdVariant({ batchId, filenameCode: 'acme-pain-h02-es-30s' }));
    const cause = await expectRejection(
      tdb.db
        .insert(adVariant)
        .values(makeAdVariant({ batchId, filenameCode: 'acme-pain-h02-es-30s' })),
    );
    expect(cause.code).toBe('23505'); // unique_violation
    // El nombre de la constraint: asserta que el 23505 viene de ESTE UNIQUE y no de otro.
    expect(cause.constraint).toBe('ad_variant_filename_code_unique');
  });
});

describe('ON DELETE: la política declarada en la migración', () => {
  it('borrar el lote CASCADEA a sus variantes y a los guiones de esas variantes', async () => {
    const batchId = await seedBatch();
    const [variant] = await tdb.db.insert(adVariant).values(makeAdVariant({ batchId })).returning();
    if (!variant) throw new Error('variante no insertada');
    await tdb.db.insert(adScript).values(makeAdScript({ variantId: variant.id }));

    await tdb.db.delete(adBatch).where(eq(adBatch.id, batchId));

    expect(
      await tdb.db.select().from(adVariant).where(eq(adVariant.batchId, batchId)),
    ).toHaveLength(0);
    expect(
      await tdb.db.select().from(adScript).where(eq(adScript.variantId, variant.id)),
    ).toHaveLength(0);
  });

  it('borrar una hook_line pone a NULL la referencia de la variante, NO la borra', async () => {
    // La invariante de producto: purgar copy de la librería no puede destruir el historial
    // de anuncios que se hicieron con ella.
    const batchId = await seedBatch();
    const [line] = await tdb.db
      .insert(hookLine)
      .values({ angle: 'pain_point', text: 'Un hook de prueba.', language: 'es', verticals: [] })
      .returning();
    if (!line) throw new Error('hook_line no insertada');
    const [variant] = await tdb.db
      .insert(adVariant)
      .values(makeAdVariant({ batchId, hookLineId: line.id }))
      .returning();
    if (!variant) throw new Error('variante no insertada');

    await tdb.db.delete(hookLine).where(eq(hookLine.id, line.id));

    const [after] = await tdb.db.select().from(adVariant).where(eq(adVariant.id, variant.id));
    expect(after).toBeDefined();
    expect(after?.hookLineId).toBeNull();
  });
});

describe('hook_line / cta_line: UNIQUE (language, text) — la clave natural del seed', () => {
  it('rechaza la misma línea repetida en el mismo idioma', async () => {
    const line = { angle: 'curiosity' as const, text: 'Nadie te cuenta esto.', language: 'es' };
    await tdb.db.insert(hookLine).values(line);
    const cause = await expectRejection(tdb.db.insert(hookLine).values(line));
    expect(cause.code).toBe('23505');
    expect(cause.constraint).toBe('hook_line_language_text_key');
  });

  it('la MISMA frase en otro idioma sí entra (la unicidad es por idioma)', async () => {
    await tdb.db.insert(hookLine).values({
      angle: 'curiosity',
      text: 'Same words, different language.',
      language: 'es',
    });
    await tdb.db.insert(hookLine).values({
      angle: 'curiosity',
      text: 'Same words, different language.',
      language: 'en',
    });
    const rows = await tdb.db
      .select()
      .from(hookLine)
      .where(eq(hookLine.text, 'Same words, different language.'));
    expect(rows).toHaveLength(2);
  });

  it('cta_line aplica el mismo UNIQUE', async () => {
    const cta = { objective: 'conversion' as const, text: 'Enlace en la bio.', language: 'es' };
    await tdb.db.insert(ctaLine).values(cta);
    const cause = await expectRejection(tdb.db.insert(ctaLine).values(cta));
    expect(cause.code).toBe('23505');
    expect(cause.constraint).toBe('cta_line_language_text_key');
  });
});
