// Versionado del `product_brief` (T1.10b, CP1) contra Postgres REAL (db-integration.md §6).
//
// POR QUÉ CONTRA POSTGRES Y NO CONTRA UN MOCK: lo que se prueba aquí es una propiedad de la BD,
// no de la aplicación. El bump de versión es `MAX(version)+1` calculado EN SQL, y su ATOMICIDAD
// la garantiza el UNIQUE `(url_analysis_id, version)` — dos ediciones concurrentes leen el mismo
// MAX bajo READ COMMITTED, las dos intentan insertar el mismo número, la segunda choca 23505 y
// el repo reintenta. Un mock no tiene READ COMMITTED, ni 23505, ni índices: pasaría el test con
// la barrera QUITADA. Solo el motor real puede decir si la carrera está cerrada.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, makeProject, type TestDatabase } from '@ugc/test-utils';

import { createProject } from '../../src/repos/project.repo';
import { createUrlAnalysis } from '../../src/repos/url-analysis.repo';
import {
  approveBrief,
  createBriefVersion,
  getBrief,
  getLatestBriefByAnalysis,
} from '../../src/repos/brief.repo';

let tdb: TestDatabase;
let projectId: string;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'brief-repo' });
  const project = await createProject(tdb.db, makeProject({ name: 'CP1 T1.10b' }));
  projectId = project.id;
});

afterAll(async () => {
  await tdb.close(); // OBLIGATORIO: sin esto el proceso de vitest no termina.
});

/** Un `url_analysis` nuevo por test: el versionado es POR análisis, así que cada caso necesita
 *  su propio contador para no contaminar al siguiente. */
async function newAnalysis(): Promise<string> {
  const row = await createUrlAnalysis(tdb.db, {
    projectId,
    platform: 'shopify',
    urlNormalized: `https://tienda.example/p/${crypto.randomUUID()}`,
    contentHash: crypto.randomUUID(),
    rawContent: { source: 'url', markdown: 'x', images: [] },
  });
  return row.id;
}

/** Un brief mínimo (la columna `data` es jsonb OPACO: la BD no valida su shape — lo valida Zod
 *  en la capa de aplicación). Aquí solo interesa el VERSIONADO, no el contenido. */
const data = (marker: string) => ({ product: { name: marker } });

describe('versionado del product_brief (T1.10b)', () => {
  it('v1 → v2 → v3: el contador sube por url_analysis_id, y `data`/`edited_by_user` viajan', async () => {
    const analysisId = await newAnalysis();

    // v1: lo escribe N3 (la IA). draft, NO editado por el usuario.
    const v1 = await createBriefVersion(tdb.db, {
      urlAnalysisId: analysisId,
      data: data('ia'),
      language: 'es',
      editedByUser: false,
      status: 'draft',
    });
    expect(v1.version).toBe(1);
    expect(v1.editedByUser).toBe(false);
    expect(v1.status).toBe('draft');

    // v2: la edición de CP1 (dentro del run). Fila NUEVA — el v1 NO se sobrescribe: el linaje
    // IA→humano es el punto (§19.1 mide cuánto corrige el humano a la IA).
    const v2 = await createBriefVersion(tdb.db, {
      urlAnalysisId: analysisId,
      data: data('editado en CP1'),
      language: 'es',
      editedByUser: true,
      status: 'approved',
    });
    expect(v2.version).toBe(2);
    expect(v2.editedByUser).toBe(true);

    // v3: la edición STANDALONE (`PATCH /api/briefs/:id`, sin run activo). Mismo contador.
    const v3 = await createBriefVersion(tdb.db, {
      urlAnalysisId: analysisId,
      data: data('editado sin run'),
      language: 'es',
      editedByUser: true,
      status: 'approved',
    });
    expect(v3.version).toBe(3);

    // El v1 sigue AHÍ, intacto: versionar no es sobrescribir.
    const stillV1 = await getBrief(tdb.db, v1.id);
    expect(stillV1?.data).toEqual(data('ia'));
    expect(stillV1?.version).toBe(1);

    // "El brief actual" = la última versión.
    const latest = await getLatestBriefByAnalysis(tdb.db, analysisId);
    expect(latest?.id).toBe(v3.id);
    expect(latest?.version).toBe(3);
    expect(latest?.data).toEqual(data('editado sin run'));
  });

  it('el contador es POR análisis: dos análisis distintos empiezan los dos en v1', async () => {
    const a = await newAnalysis();
    const b = await newAnalysis();

    const briefA = await createBriefVersion(tdb.db, {
      urlAnalysisId: a,
      data: data('a'),
      language: 'es',
      editedByUser: false,
      status: 'draft',
    });
    const briefB = await createBriefVersion(tdb.db, {
      urlAnalysisId: b,
      data: data('b'),
      language: 'es',
      editedByUser: false,
      status: 'draft',
    });

    // Si el contador fuese global (o el UNIQUE cubriese solo `version`), el segundo saldría v2.
    expect(briefA.version).toBe(1);
    expect(briefB.version).toBe(1);
  });

  it('BUMP ATÓMICO: N ediciones CONCURRENTES producen N versiones consecutivas, sin duplicados', async () => {
    const analysisId = await newAnalysis();
    await createBriefVersion(tdb.db, {
      urlAnalysisId: analysisId,
      data: data('ia'),
      language: 'es',
      editedByUser: false,
      status: 'draft',
    });

    // LA CARRERA: 5 ediciones a la vez sobre el MISMO análisis. Sin serializar, las 5 leerían
    // `MAX(version) = 1` bajo READ COMMITTED y las 5 calcularían `version = 2`: cinco filas con
    // el MISMO número y ninguna forma de saber cuál es "el brief actual". `createBriefVersion`
    // las pone EN COLA con un advisory lock por `url_analysis_id`, así que cada una lee un MAX
    // ya actualizado → versiones 2,3,4,5,6, cada una exactamente una vez.
    //
    // (Este test ya cazó una implementación anterior basada en reintentar el 23505 del UNIQUE:
    // pasaba casi siempre y fallaba de vez en cuando — los perdedores volvían a chocar ENTRE
    // ELLOS. "Casi siempre" no es una invariante.)
    const results = await Promise.all(
      Array.from({ length: 5 }, (_unused, i) =>
        createBriefVersion(tdb.db, {
          urlAnalysisId: analysisId,
          data: data(`concurrente-${String(i)}`),
          language: 'es',
          editedByUser: true,
          status: 'approved',
        }),
      ),
    );

    const versions = results.map((r) => r.version).sort((x, y) => x - y);
    // Consecutivas y SIN duplicados (un Set del mismo tamaño): la propiedad que el UNIQUE
    // garantiza y que un `MAX+1` en JS no garantizaría.
    expect(versions).toEqual([2, 3, 4, 5, 6]);
    expect(new Set(versions).size).toBe(5);

    // Y ninguna escritura se perdió: la última versión es la 6.
    const latest = await getLatestBriefByAnalysis(tdb.db, analysisId);
    expect(latest?.version).toBe(6);
  });

  it('approveBrief: draft → approved SIN crear versión nueva (aprobar no es editar)', async () => {
    const analysisId = await newAnalysis();
    const v1 = await createBriefVersion(tdb.db, {
      urlAnalysisId: analysisId,
      data: data('ia'),
      language: 'es',
      editedByUser: false,
      status: 'draft',
    });

    const approved = await approveBrief(tdb.db, v1.id);
    expect(approved?.status).toBe('approved');
    expect(approved?.version).toBe(1);
    // NO crea v2: un v2 idéntico al v1 pero con `edited_by_user:true` mentiría sobre quién
    // escribió el contenido — y ese campo existe justo para medir cuánto corrige el humano.
    expect(approved?.editedByUser).toBe(false);
    const latest = await getLatestBriefByAnalysis(tdb.db, analysisId);
    expect(latest?.version).toBe(1);
  });
});
