// VERIFIER T1.9 — cláusula 3: "analizar 2 URLs del MISMO dominio extrae el BrandKit UNA SOLA VEZ
// (timestamps)". Contra POSTGRES 16 REAL (Testcontainers + las migraciones REALES del producto):
// el "una sola vez" lo impone el índice UNIQUE PARCIAL `brand_kit_domain_key`, y un mock ocultaría
// justo eso. Script del VERIFIER: arranca su PROPIO contenedor (no depende del harness de vitest
// del implementer) y comprueba la FILA REAL con SQL crudo, no solo el retorno del repo.
//
// Coste: $0 — cero red de pago. Solo Docker local.
// `startPostgresContainer` + `createTestDatabase` son la vía DOCUMENTADA para scripts fuera de
// vitest (test-utils/src/index.ts, e2e.md §2): arrancan Postgres 16 real y aplican las
// MIGRACIONES REALES del producto a la template. Se resuelven desde la raíz (@ugc/test-utils es
// devDependency del root).
import { createTestDatabase, startPostgresContainer } from '@ugc/test-utils';

import {
  brandKitDomain,
  deriveBrandKit,
} from '../../../packages/core/src/ingest/brand-kit';
import {
  upsertBrandKitByDomain,
  insertBrandKitIfAbsent,
} from '../../../packages/db/src/repos/brand-kit.repo';
import type { ProductBrief } from '../../../packages/core/src/contracts/product-brief';
import type { RawContent } from '../../../packages/core/src/contracts/raw-content';
import { readFileSync } from 'node:fs';

let failures = 0;
function check(label: string, cond: boolean, detail: string): void {
  if (!cond) failures += 1;
  console.log(`${cond ? 'OK  ' : 'FAIL'} | ${label} | ${detail}`);
}

// Rutas ancladas al fichero (el cwd es packages/test-utils, donde resuelven pg/testcontainers).
const REPO = new URL('../../../', import.meta.url).pathname;

// Brief REAL de Sonnet 5 (T1.8, ugmonk): el tono de voz y la paleta que alimentan el kit.
const realDoc = JSON.parse(
  readFileSync(`${REPO}docs/verifications/T1.8/briefs-c3-stage1.json`, 'utf8'),
) as { results: { label: string; brief: ProductBrief }[] };
const realBrief = realDoc.results.find((r) => r.label.includes('ugmonk'))!.brief;

function rawFor(url: string, palette: string[]): RawContent {
  return {
    url,
    source: 'url',
    fetched_at: '2026-07-11T19:24:58.596Z',
    provider: 'firecrawl',
    markdown: '# real',
    images: [],
    branding: { palette, typography: 'sans' },
    product: null,
  } as unknown as RawContent;
}

async function main(): Promise<void> {
  console.log('== arrancando Postgres 16 REAL (Testcontainers) + migraciones REALES del producto ==');
  const harness = await startPostgresContainer();
  const tdb = await createTestDatabase({
    label: 'T1.9-verifier',
    serverUri: harness.serverUri,
    templateDb: harness.templateDb,
  });
  const db = tdb.db;
  // SQL CRUDO contra la MISMA BD: la fila real, no el retorno del repo.
  const raw = { query: (text: string) => tdb.pool.query(text) };
  console.log('== BD lista:', tdb.connectionString.replace(/:[^:@]+@/, ':***@'), '==\n');

  // El índice que hace el trabajo — leído de la BD VIVA, no del schema.ts.
  const idx = await raw.query(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'brand_kit' AND indexname = 'brand_kit_domain_key'`,
  );
  console.log('ÍNDICE REAL EN LA BD:\n ', idx.rows[0]?.indexdef ?? '(NO EXISTE)');
  check(
    'C3-pre el UNIQUE PARCIAL brand_kit_domain_key existe en la BD real',
    typeof idx.rows[0]?.indexdef === 'string' &&
      idx.rows[0].indexdef.includes('UNIQUE') &&
      idx.rows[0].indexdef.includes('IS NOT NULL'),
    String(idx.rows[0]?.indexdef),
  );
  console.log();

  // ── CLÁUSULA 3 ────────────────────────────────────────────────────────────────────────────
  // DOS URLs DISTINTAS del MISMO dominio (dos productos reales de ugmonk.com, el dominio que
  // T1.8 analizó de verdad). Con `www.` en una: el dominio registrable debe colapsar.
  const url1 = 'https://ugmonk.com/products/analog-starter-kit';
  const url2 = 'https://www.ugmonk.com/products/gather-desk-organizer';

  console.log('=== C3 · 2 URLs del MISMO dominio (ugmonk.com) ⇒ el kit se extrae UNA SOLA VEZ ===');
  console.log('  URL 1:', url1);
  console.log('  URL 2:', url2);
  check(
    'C3 las 2 URLs colapsan al MISMO dominio registrable',
    brandKitDomain(url1) === 'ugmonk.com' && brandKitDomain(url2) === 'ugmonk.com',
    `d1=${brandKitDomain(url1)} d2=${brandKitDomain(url2)}`,
  );

  // Timestamps ELEGIDOS POR MÍ: el 2º análisis ocurre 8 h después. Son LA evidencia.
  const t1 = new Date('2026-07-11T10:00:00.000Z');
  const t2 = new Date('2026-07-11T18:00:00.000Z');

  // 1er análisis del dominio -> EXTRAE.
  const first = await upsertBrandKitByDomain(db, {
    ...deriveBrandKit({
      raw: rawFor(url1, ['#1A1A1A', '#F5F5F0']),
      brief: realBrief,
      visualAnalysis: null,
      extractedAt: t1,
    }),
    projectId: null,
  });
  console.log(
    `\n  [análisis 1 @ ${t1.toISOString()}] reused=${first.reused} id=${first.kit.id} extracted_at=${first.kit.extractedAt.toISOString()}`,
  );

  // 2º análisis del MISMO dominio, con datos DISTINTOS y timestamp POSTERIOR.
  // Si el upsert fuese DO UPDATE, esto pisaría el kit y su extracted_at (= re-extracción).
  const second = await upsertBrandKitByDomain(db, {
    ...deriveBrandKit({
      raw: rawFor(url2, ['#FF0000', '#00FF00']), // paleta DISTINTA a propósito
      brief: { ...realBrief, brand: { ...realBrief.brand, tone_of_voice: 'TONO DEL 2º ANÁLISIS' } },
      visualAnalysis: null,
      extractedAt: t2,
    }),
    projectId: null,
  });
  console.log(
    `  [análisis 2 @ ${t2.toISOString()}] reused=${second.reused} id=${second.kit.id} extracted_at=${second.kit.extractedAt.toISOString()}`,
  );

  check('C3 el 1er análisis EXTRAE (reused=false)', first.reused === false, `reused=${first.reused}`);
  check('C3 el 2º análisis REUTILIZA (reused=true)', second.reused === true, `reused=${second.reused}`);
  check('C3 es la MISMA fila (mismo id)', second.kit.id === first.kit.id, `${first.kit.id} vs ${second.kit.id}`);

  // ── LA EVIDENCIA DE LA CLÁUSULA: los TIMESTAMPS, leídos de la FILA REAL con SQL crudo ────
  const rows = await raw.query(
    `SELECT id, domain, source, palette, tone_of_voice, extracted_at, created_at, updated_at
       FROM brand_kit WHERE domain = 'ugmonk.com'`,
  );
  console.log('\n  FILAS REALES en brand_kit WHERE domain = ugmonk.com (SQL crudo):');
  console.log(JSON.stringify(rows.rows, null, 2));

  check('C3 hay UNA SOLA fila para el dominio (se extrajo una sola vez)', rows.rowCount === 1, `rowCount=${rows.rowCount}`);
  const row = rows.rows[0] as { extracted_at: Date; tone_of_voice: string; palette: unknown; updated_at: Date };
  check(
    'C3 TIMESTAMP: extracted_at sigue siendo el del PRIMER análisis (t1), NO el del segundo (t2)',
    row?.extracted_at?.toISOString() === t1.toISOString(),
    `extracted_at=${row?.extracted_at?.toISOString()} t1=${t1.toISOString()} t2=${t2.toISOString()}`,
  );
  check(
    'C3 el 2º análisis NO re-extrajo: el tono/paleta del 2º NO pisaron los del 1º (DO NOTHING, no DO UPDATE)',
    row?.tone_of_voice !== 'TONO DEL 2º ANÁLISIS' &&
      JSON.stringify(row?.palette) === JSON.stringify(['#1A1A1A', '#F5F5F0']),
    `tone=${JSON.stringify(row?.tone_of_voice).slice(0, 50)} palette=${JSON.stringify(row?.palette)}`,
  );
  check(
    'C3 el retorno del 2º análisis lleva el extracted_at del PRIMERO',
    second.kit.extractedAt.toISOString() === t1.toISOString(),
    `second.kit.extractedAt=${second.kit.extractedAt.toISOString()}`,
  );
  console.log();

  // ── INVARIANTE: kits MANUALES (domain NULL) exentos del dedup ────────────────────────────
  console.log('=== INV · kits MANUALES (domain NULL) quedan EXENTOS del dedup ===');
  const manualInput = {
    projectId: null,
    domain: null,
    source: 'manual' as const,
    palette: ['#000000'],
    typography: null,
    toneOfVoice: 'manual',
    aesthetic: 'raw',
    extractedAt: t1,
  };
  const m1 = await upsertBrandKitByDomain(db, manualInput);
  const m2 = await upsertBrandKitByDomain(db, manualInput);
  const manualRows = await raw.query(`SELECT id FROM brand_kit WHERE domain IS NULL`);
  check(
    'INV dos kits manuales (domain NULL) crean DOS filas distintas, ninguna reutiliza',
    m1.reused === false && m2.reused === false && m1.kit.id !== m2.kit.id && manualRows.rowCount === 2,
    `m1.reused=${m1.reused} m2.reused=${m2.reused} filas_null=${manualRows.rowCount}`,
  );
  console.log();

  // ── INVARIANTE: el upsert NO es DO UPDATE — comprobado por COMPORTAMIENTO ────────────────
  console.log('=== INV · insertBrandKitIfAbsent en conflicto ⇒ undefined y NADA se escribe ===');
  const conflicted = await insertBrandKitIfAbsent(db, {
    projectId: null,
    domain: 'ugmonk.com',
    source: 'extracted',
    palette: ['#PISOTON'],
    typography: 'PISOTON',
    toneOfVoice: 'PISOTON',
    aesthetic: 'PISOTON',
    extractedAt: t2,
  });
  const after = await raw.query(
    `SELECT tone_of_voice, extracted_at, updated_at FROM brand_kit WHERE domain='ugmonk.com'`,
  );
  check(
    'INV el insert en conflicto devuelve undefined y la fila queda INTACTA (extracted_at y updated_at sin tocar)',
    conflicted === undefined &&
      (after.rows[0] as { tone_of_voice: string }).tone_of_voice !== 'PISOTON' &&
      (after.rows[0] as { extracted_at: Date }).extracted_at.toISOString() === t1.toISOString() &&
      (after.rows[0] as { updated_at: Date }).updated_at.toISOString() ===
        (row.updated_at as Date).toISOString(),
    `conflicted=${String(conflicted)} tone=${JSON.stringify((after.rows[0] as { tone_of_voice: string }).tone_of_voice).slice(0, 40)} extracted_at=${(after.rows[0] as { extracted_at: Date }).extracted_at.toISOString()}`,
  );
  console.log();

  // ── INVARIANTE: dominios DISTINTOS no colapsan ───────────────────────────────────────────
  const other = await upsertBrandKitByDomain(db, {
    ...deriveBrandKit({
      raw: rawFor('https://www.allbirds.com/products/mens-tree-runners', ['#EDE7DE']),
      brief: realBrief,
      visualAnalysis: null,
      extractedAt: t2,
    }),
    projectId: null,
  });
  check(
    'INV un dominio DISTINTO (allbirds.com) SÍ extrae su propio kit',
    other.reused === false && other.kit.domain === 'allbirds.com' && other.kit.id !== first.kit.id,
    `reused=${other.reused} domain=${other.kit.domain}`,
  );

  const total = await raw.query(`SELECT domain, count(*) AS n FROM brand_kit GROUP BY domain ORDER BY domain NULLS LAST`);
  console.log('\n  RECUENTO FINAL por dominio (SQL crudo):');
  console.log(JSON.stringify(total.rows, null, 2));

  await tdb.close();
  await harness.stop();

  console.log();
  console.log(failures === 0 ? '=== TODO OK (0 fallos) ===' : `=== ${failures} FALLO(S) ===`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
