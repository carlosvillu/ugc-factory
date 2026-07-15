import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@ugc/test-utils';
import { promptTemplate, type NewPromptTemplate } from '@ugc/db/schema';

// ── Diseño de la selectividad (el eje de T3.1) ──────────────────────────────
//
// Para que el planner ELIJA el GIN por coste (plan natural, sin forzarlo), la
// combinación objetivo debe ser RARA: si la mayoría de las filas casan, un Seq Scan
// gana honestamente aunque el índice exista. Diseño deliberado:
//
//   - FONDO (la inmensa mayoría): facetas que NUNCA casan el predicado objetivo —
//     format `demo`, ángulo `question`. ~99% de las filas.
//   - OBJETIVO (raro, conocido): exactamente TARGET_HITS filas con format `grwm` Y
//     ángulo `pain-point`. Es < 1% del total → el GIN es el plan barato.
//
// El test asserta el conteo EXACTO de esas TARGET_HITS filas, así que la corrección
// del resultado (no solo el plan) queda fijada.
const N = 8000;
const TARGET_HITS = 40;

const TARGET_FORMAT = 'grwm';
const TARGET_ANGLE = 'pain-point';
const BG_FORMAT = 'demo';
const BG_ANGLE = 'question';

function baseRow(i: number): NewPromptTemplate {
  const n = String(i);
  return {
    slug: `tpl-${n}`,
    title: `Template ${n}`,
    kind: 'video',
    body: `UGC smartphone video style. Template ${n} body with {product.name}.`,
    language: 'es',
    // Fondo por defecto: NO casa el predicado objetivo.
    formats: [BG_FORMAT],
    hookAngles: [BG_ANGLE],
    verticals: ['beauty'],
    platforms: ['tiktok'],
    aesthetics: ['clean'],
  };
}

function seedRow(i: number): NewPromptTemplate {
  const row = baseRow(i);
  // Las primeras TARGET_HITS filas son la combinación objetivo RARA.
  if (i < TARGET_HITS) {
    row.formats = [TARGET_FORMAT];
    row.hookAngles = [TARGET_ANGLE];
  }
  return row;
}

let tdb: TestDatabase;
beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'prompt-template.gin' });
  // Insert por lotes: cada fila lleva ~11 binds, y Postgres limita a 65535 binds por
  // query — un único INSERT de 8000 filas los excede. Lotes de 500 filas van sobrados.
  const rows = Array.from({ length: N }, (_, i) => seedRow(i));
  for (let i = 0; i < rows.length; i += 500) {
    await tdb.db.insert(promptTemplate).values(rows.slice(i, i + 500));
  }
  // Sin ANALYZE el planner decide con estadísticas vacías → Seq Scan falso.
  await tdb.db.execute(sql`ANALYZE prompt_template`);
});
afterAll(async () => {
  await tdb.close();
});

// El GIN se nombra por FACETA (no un `/Index Scan/` genérico). Como no existe ningún
// btree sobre las facetas, cualquier Bitmap Index Scan aquí es forzosamente sobre un GIN.
const GIN_NAME = /prompt_template_(formats|hook_angles|verticals|platforms|aesthetics)_gin/;

describe('búsqueda facetada de prompt_template — índice GIN sobre text[] (T3.1)', () => {
  it('plan natural: usa Bitmap Index Scan sobre el GIN por nombre y devuelve exactamente lo esperado', async () => {
    const plan = await tdb.db.execute(sql`
      EXPLAIN (FORMAT JSON)
      SELECT id FROM prompt_template
      WHERE formats @> ARRAY[${TARGET_FORMAT}]::text[]
        AND hook_angles @> ARRAY[${TARGET_ANGLE}]::text[]
    `);
    const planText = JSON.stringify(plan.rows);

    // El planner puede hacer BitmapAnd (aparecen los DOS nombres) o usar solo el índice más
    // selectivo + recheck del otro (aparece UNO). Robusto a ambos: exige Bitmap Index Scan
    // sobre ALGÚN GIN nombrado, no los dos.
    expect(planText).toMatch(/Bitmap Index Scan/);
    expect(planText).toMatch(GIN_NAME);

    // El plan no basta: corrección del resultado con el conteo EXACTO diseñado.
    const hits = await tdb.db.execute(sql`
      SELECT id FROM prompt_template
      WHERE formats @> ARRAY[${TARGET_FORMAT}]::text[]
        AND hook_angles @> ARRAY[${TARGET_ANGLE}]::text[]
    `);
    expect(hits.rows).toHaveLength(TARGET_HITS);
  });

  it('overlap (&&) sobre una faceta también es GIN-servable', async () => {
    const plan = await tdb.db.execute(sql`
      EXPLAIN (FORMAT JSON)
      SELECT id FROM prompt_template
      WHERE formats && ARRAY[${TARGET_FORMAT}]::text[]
    `);
    const planText = JSON.stringify(plan.rows);
    expect(planText).toMatch(/Bitmap Index Scan/);
    expect(planText).toMatch(/prompt_template_formats_gin/);
  });

  it('fallback nombrado por la cláusula: enable_seqscan=off confirma que el GIN es utilizable', async () => {
    // SET LOCAL dentro de una transacción: con un Pool, dos execute() sueltos pueden ir
    // por conexiones distintas y el SET no aplicaría al EXPLAIN.
    await tdb.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      const plan = await tx.execute(sql`
        EXPLAIN (FORMAT JSON)
        SELECT id FROM prompt_template
        WHERE verticals @> ARRAY['beauty']::text[]
      `);
      const planText = JSON.stringify(plan.rows);
      expect(planText).toMatch(/Bitmap Index Scan/);
      expect(planText).toMatch(/prompt_template_verticals_gin/);
    });
  });

  // ── Control negativo: el ÍNDICE es load-bearing (experimento de una variable) ──
  // `free_tags` es un `text[]` HERMANO de las facetas pero SIN GIN (por diseño: no es una
  // faceta ortogonal, ver gallery.ts). La misma query `@>` — MISMO operador, GIN-servable
  // en las facetas — sobre `free_tags` NO tiene índice que la sirva → Seq Scan.
  //
  // Mantener el operador constante y variar solo la presencia del índice aísla lo que de
  // verdad importa: que el Bitmap Index Scan de los tests positivos viene del GIN y de nada
  // más. Si alguien borrara el GIN de una faceta, esa faceta se comportaría como `free_tags`
  // aquí — y los tests positivos caerían. (El operador `=` sobre `text[]` NO sirve de control
  // negativo: `array_ops` también lo sirve — ver nota en gallery.ts.)
  //
  // `free_tags` está vacío en todas las filas → 0 resultados; da igual, se asserta sobre el
  // PLAN (Seq Scan / sin nombre de GIN), no sobre el conteo.
  it('control negativo: `@>` sobre una columna text[] SIN GIN cae a Seq Scan', async () => {
    const plan = await tdb.db.execute(sql`
      EXPLAIN (FORMAT JSON)
      SELECT id FROM prompt_template
      WHERE free_tags @> ARRAY['nonexistent']::text[]
    `);
    const planText = JSON.stringify(plan.rows);
    // Sin recurso a ningún GIN de faceta.
    expect(planText).not.toMatch(/Bitmap Index Scan/);
    expect(planText).not.toMatch(GIN_NAME);
    expect(planText).toMatch(/Seq Scan/);
  });
});
