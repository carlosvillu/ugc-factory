// Dedup real del `brand_kit` por dominio (T1.9, PRD §9.1) contra el clon de Testcontainers
// (db-integration.md §6). NADA de mocks: el "una sola vez" depende del UNIQUE PARCIAL
// `brand_kit_domain_key` que verificó T1.2 — un doble de test ocultaría justo el
// comportamiento que la Verificación exige.
//
// Cláusula de la Verificación de T1.9 codificada como test permanente (regla de trabajo 8):
// "analizar 2 URLs del MISMO dominio extrae el BrandKit UNA SOLA VEZ (timestamps)" — el
// segundo análisis reutiliza la fila y su `extracted_at` sigue siendo el del PRIMERO.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  makeBrief,
  makeProject,
  makeRawContent,
  makeVisualAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import { brandKitDomain, deriveBrandKit } from '@ugc/core/ingest';

import { brandKit } from '../../src/schema/project';
import { createProject } from '../../src/repos/project.repo';
import {
  findBrandKitByDomain,
  insertBrandKitIfAbsent,
  upsertBrandKitByDomain,
} from '../../src/repos/brand-kit.repo';

let tdb: TestDatabase;
let projectId: string;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'brand-kit-repo' });
  const project = await createProject(tdb.db, makeProject({ name: 'BrandKit T1.9' }));
  projectId = project.id;
});

afterAll(async () => {
  await tdb.close(); // OBLIGATORIO: sin esto el proceso de vitest no termina.
});

/** El kit tal como lo deriva core (T1.9) a partir del análisis de UNA url del dominio. */
function kitFor(url: string, extractedAt: Date) {
  const derived = deriveBrandKit({
    raw: makeRawContent({ url }),
    brief: makeBrief(),
    visualAnalysis: makeVisualAnalysis(),
    extractedAt,
  });
  return { ...derived, projectId };
}

describe('brand_kit · dedup por dominio (§9.1)', () => {
  it('2 URLs del MISMO dominio extraen el BrandKit UNA sola vez (los timestamps lo prueban)', async () => {
    // Dos productos DISTINTOS de la misma tienda: el dominio registrable colapsa (T1.5).
    const url1 = 'https://tienda.dedup-a.example/products/serum';
    const url2 = 'https://shop.dedup-a.example/products/crema';
    const domain = brandKitDomain(url1);
    expect(domain).toBe('dedup-a.example');
    expect(brandKitDomain(url2)).toBe(domain);

    const t1 = new Date('2026-07-11T10:00:00.000Z');
    const t2 = new Date('2026-07-11T18:30:00.000Z'); // segundo análisis, 8h después

    // 1er análisis: no hay kit del dominio → se EXTRAE.
    const first = await upsertBrandKitByDomain(tdb.db, kitFor(url1, t1));
    expect(first.reused).toBe(false);
    expect(first.kit.domain).toBe('dedup-a.example');
    expect(first.kit.source).toBe('extracted');
    expect(first.kit.extractedAt).toEqual(t1);

    // 2º análisis del MISMO dominio: se REUTILIZA, no se re-extrae (§9.1).
    const second = await upsertBrandKitByDomain(tdb.db, kitFor(url2, t2));
    expect(second.reused).toBe(true);
    expect(second.kit.id).toBe(first.kit.id); // la MISMA fila
    // LA EVIDENCIA: el timestamp sigue siendo el del PRIMER análisis. Un `DO UPDATE` lo habría
    // pisado con t2 — y eso sería exactamente la re-extracción que el PRD prohíbe.
    expect(second.kit.extractedAt).toEqual(t1);
    expect(second.kit.extractedAt).not.toEqual(t2);
    expect(second.kit.updatedAt).toEqual(first.kit.updatedAt); // la fila no se ha tocado

    // Y hay UNA sola fila para ese dominio.
    const rows = await tdb.db.select().from(brandKit).where(eq(brandKit.domain, 'dedup-a.example'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.kit.id);
  });

  it('dominios DISTINTOS extraen kits distintos (el dedup no colapsa de más)', async () => {
    const a = await upsertBrandKitByDomain(
      tdb.db,
      kitFor('https://dedup-b.example/products/x', new Date('2026-07-11T10:00:00.000Z')),
    );
    const b = await upsertBrandKitByDomain(
      tdb.db,
      kitFor('https://dedup-c.example/products/y', new Date('2026-07-11T10:05:00.000Z')),
    );

    expect(a.reused).toBe(false);
    expect(b.reused).toBe(false);
    expect(a.kit.id).not.toBe(b.kit.id);
  });

  it('kits MANUALES (domain null) quedan EXENTOS del dedup: cada uno es el suyo', async () => {
    // El UNIQUE es PARCIAL (`WHERE domain IS NOT NULL`): N filas manuales conviven.
    const manual = {
      projectId,
      domain: null,
      source: 'manual' as const,
      palette: ['#000000'],
      typography: null,
      toneOfVoice: 'directa',
      aesthetic: 'raw',
      extractedAt: new Date('2026-07-11T11:00:00.000Z'),
    };

    const first = await upsertBrandKitByDomain(tdb.db, manual);
    const second = await upsertBrandKitByDomain(tdb.db, manual);

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(false); // NO reutiliza: cada kit manual es independiente
    expect(second.kit.id).not.toBe(first.kit.id);
    expect(second.kit.domain).toBeNull();
  });

  it('insertBrandKitIfAbsent devuelve undefined en conflicto (reuse-first, sin DO UPDATE)', async () => {
    const kit = kitFor('https://dedup-d.example/p/1', new Date('2026-07-11T12:00:00.000Z'));

    const created = await insertBrandKitIfAbsent(tdb.db, kit);
    expect(created).toBeDefined();

    // Segundo intento con datos DIFERENTES: el ON CONFLICT DO NOTHING no escribe nada.
    const conflicted = await insertBrandKitIfAbsent(tdb.db, {
      ...kit,
      toneOfVoice: 'OTRO tono que NO debe sobrescribir',
      extractedAt: new Date('2026-07-11T20:00:00.000Z'),
    });
    expect(conflicted).toBeUndefined();

    const stored = await findBrandKitByDomain(tdb.db, 'dedup-d.example');
    expect(stored?.id).toBe(created?.id);
    expect(stored?.toneOfVoice).toBe('cercana y experta'); // el original, INTACTO
    expect(stored?.extractedAt).toEqual(new Date('2026-07-11T12:00:00.000Z'));
  });

  it('findBrandKitByDomain devuelve undefined para un dominio nunca analizado', async () => {
    expect(await findBrandKitByDomain(tdb.db, 'jamas-visto.example')).toBeUndefined();
  });
});
