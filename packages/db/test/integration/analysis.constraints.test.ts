// Constraints de las tablas del análisis (T1.2, db-integration.md §5). Este test
// ES la Verificación automatizada de la tarea:
//  (a) la migración 0005 aplica sobre BD limpia — el globalSetup la aplica a la
//      template en cada run; aquí se confirma que las 3 tablas existen tras migrar;
//  (b) 2 filas de brand_kit con domain NULL entran sin conflicto (modo manual);
//  (c) 2 filas con el MISMO domain no-null → la segunda FALLA con 23505 (UNIQUE
//      PARCIAL `WHERE domain IS NOT NULL` verificado).
// Fija el COMPORTAMIENTO observable, no la implementación: da igual si mañana el
// índice cambia de forma, estos asserts deben seguir cumpliéndose.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  createTestDatabase,
  makeBrandKit,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import { brandKit, productBrief, project, urlAnalysis } from '@ugc/db/schema';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'analysis-constraints' });
});

afterAll(async () => {
  await tdb.close(); // OBLIGATORIO: sin esto el proceso de vitest no termina.
});

describe('migración 0005: las 3 tablas del análisis existen tras migrar (T1.2)', () => {
  it('brand_kit, url_analysis y product_brief están presentes en la BD limpia', async () => {
    const rows = await tdb.db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('brand_kit', 'url_analysis', 'product_brief')
      ORDER BY table_name
    `);
    expect(rows.rows.map((r) => (r as { table_name: string }).table_name)).toEqual([
      'brand_kit',
      'product_brief',
      'url_analysis',
    ]);
  });
});

describe('brand_kit: UNIQUE PARCIAL sobre domain (T1.2)', () => {
  it('admite N filas con domain NULL (modo manual sin dominio)', async () => {
    // 2 filas con domain NULL entran sin conflicto: NULL no colisiona bajo el
    // índice parcial `WHERE domain IS NOT NULL`.
    await tdb.db
      .insert(brandKit)
      .values([
        makeBrandKit({ domain: null, source: 'manual' }),
        makeBrandKit({ domain: null, source: 'manual' }),
      ]);
    const nullRows = await tdb.db
      .select()
      .from(brandKit)
      .where(sql`${brandKit.domain} IS NULL`);
    expect(nullRows.length).toBeGreaterThanOrEqual(2);
  });

  it('el índice brand_kit_domain_key ES PARCIAL (WHERE domain IS NOT NULL)', async () => {
    // Assert de la PARCIALIDAD directamente sobre el catálogo de Postgres. Sin
    // este assert, un UNIQUE plano sobre `domain` (NULLS DISTINCT por defecto en
    // pg) reproduciría los 2 casos de comportamiento de abajo (N NULLs OK + dup
    // no-null rechazado con 23505): son necesarios pero NO prueban la parcialidad.
    // db.md §8: el `WHERE` del índice parcial es justo lo que puede divergir entre
    // el schema TS y el SQL migrado — este assert lo pinnea. Si el `WHERE`
    // desaparece del schema/migración, ESTE test falla (y solo este).
    const idx = await tdb.db.execute(sql`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'brand_kit_domain_key'
    `);
    expect(idx.rows).toHaveLength(1);
    expect((idx.rows[0] as { indexdef: string }).indexdef).toMatch(/WHERE .*domain IS NOT NULL/i);
  });

  it('rechaza la segunda fila con el mismo domain no-null (23505)', async () => {
    await tdb.db.insert(brandKit).values(makeBrandKit({ domain: 'acme.com', source: 'extracted' }));
    const err = await tdb.db
      .insert(brandKit)
      .values(makeBrandKit({ domain: 'acme.com', source: 'extracted' }))
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeDefined();
    // SQLSTATE 23505 (unique_violation): el error de pg viaja en `cause`.
    const cause = (err as { cause?: { code?: string; message?: string; constraint?: string } })
      .cause;
    expect(cause?.code).toBe('23505');
    // El nombre de la constraint/índice viene del driver pg (DatabaseError.constraint):
    // asserta que el 23505 proviene de ESTE índice y no de otro UNIQUE futuro de la
    // tabla — un match genérico de mensaje lo satisfaría cualquiera.
    expect(cause?.constraint).toBe('brand_kit_domain_key');
    expect(cause?.message).toMatch(/duplicate key value/);
  });

  it('el enum brand_kit_source rechaza un valor fuera de §12', async () => {
    const err = await tdb.db
      .insert(brandKit)
      .values(makeBrandKit({ source: 'scraped' as never }))
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeDefined();
    const cause = (err as { cause?: { message?: string } }).cause;
    expect(cause?.message).toMatch(/invalid input value for enum/);
  });
});

describe('url_analysis / product_brief: roundtrip básico y FK (T1.2)', () => {
  it('inserta url_analysis (FK a project) y product_brief (FK + data jsonb)', async () => {
    const [proj] = await tdb.db.insert(project).values(makeProject()).returning();
    expect(proj).toBeDefined();
    const [ua] = await tdb.db
      .insert(urlAnalysis)
      .values(makeUrlAnalysis({ projectId: proj!.id }))
      .returning();
    expect(ua).toBeDefined();
    expect(ua!.status).toBe('pending'); // default de la BD
    expect(ua!.platform).toBe('shopify');

    const [pb] = await tdb.db
      .insert(productBrief)
      .values(makeProductBrief({ urlAnalysisId: ua!.id }))
      .returning();
    expect(pb).toBeDefined();
    // `data` es jsonb opaco: roundtrip sin validar el shape en la BD.
    expect(pb!.status).toBe('draft'); // default de la BD
    expect(pb!.version).toBe(1);
    expect((pb!.data as { product: { name: string } }).product.name).toBe('Sérum Hidratante 24h');
  });
});
