// DEDUPLICACIÓN DE GENERACIÓN end-to-end (T4.10, §9.6, regla de trabajo 8): la economía Hook×Body×CTA.
// Ejercita `runGenerate` (imagen: el camino más simple, sin uploads de input) contra fal MOCKEADO (msw —
// CERO red, CERO gasto) y fija las cuatro cláusulas de dinero+concurrencia de la Verificación:
//  (a) HIT: una 2ª generación IDÉNTICA reutiliza el asset de la 1ª — 0 submits nuevos, 0 cost_entry nuevo,
//      `reused=true` (el ahorro visible en /spend = MENOS filas de coste, aquí como total invariante).
//  (b) MISS: inputs distintos (otro prompt) → hash distinto → SÍ genera (submit + cost_entry nuevos).
//  (c) CARRERA: dos generaciones idénticas CONCURRENTES → solo UNA submitea/paga; la otra reutiliza o
//      reintenta (nunca dos submits, nunca dos cost_entry).
//  (d) RETRY DE FAILED: una generación `failed` con el mismo hash NO bloquea un reintento (el índice
//      parcial excluye `failed`) — el retry submitea y completa.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getModelProfileByEndpoint,
  getSpendSummary,
  listGenerationsByStatus,
  makeLocalStorageAdapter,
  seedGallery,
  updateGeneration,
  type ModelProfile,
} from '@ugc/db';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { createTestDatabase, server, type TestDatabase } from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { runGenerate } from '../../src/generate';

const ENDPOINT = 'fal-ai/flux-2';
const SUBMIT_URL = `https://queue.fal.run/${ENDPOINT}`;
const OUTPUT_URL = 'https://fal.media/files/out-flux2.png';
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const RESPONSE_BODY = {
  images: [{ url: OUTPUT_URL, width: 1024, height: 1024, content_type: 'image/png' }],
  seed: 7,
};

/** Registra el camino feliz CONTANDO los submits y emitiendo un `request_id` ÚNICO por submit (la columna
 *  `fal_request_id` es UNIQUE: dos submits con el mismo id colisionarían y enmascararían el test). Devuelve
 *  un contador de submits — el corazón de la aserción "una sola generación paga". */
function countingHappyPath(): { submitCount: () => number } {
  let n = 0;
  server.use(
    http.post(SUBMIT_URL, () => {
      n += 1;
      const req = `DEDUP-req-${String(n)}`;
      return HttpResponse.json({
        request_id: req,
        status_url: `${SUBMIT_URL}/requests/${req}/status`,
        response_url: `${SUBMIT_URL}/requests/${req}`,
        status: 'IN_QUEUE',
      });
    }),
    http.get(`${SUBMIT_URL}/requests/:req/status`, ({ params }) =>
      HttpResponse.json({ status: 'COMPLETED', request_id: params.req }),
    ),
    http.get(`${SUBMIT_URL}/requests/:req`, () => HttpResponse.json(RESPONSE_BODY)),
    http.get(OUTPUT_URL, () =>
      HttpResponse.arrayBuffer(PNG_BYTES.buffer, { headers: { 'content-type': 'image/png' } }),
    ),
  );
  return { submitCount: () => n };
}

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
let fluxProfile: ModelProfile;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'services:generate-dedup' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-dedup-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  const profile = await getModelProfileByEndpoint(tdb.db, ENDPOINT);
  if (profile === undefined) throw new Error(`model_profile ${ENDPOINT} no sembrado`);
  fluxProfile = profile;
});

beforeEach(async () => {
  // BD limpia por test: el dedup es sensible al estado (una generación completed previa cambiaría el
  // resultado). TRUNCATE aísla cada caso sin re-clonar la BD. Vía `pool` crudo para no importar
  // `drizzle-orm` (no es dependencia directa de @ugc/services).
  await tdb.pool.query('TRUNCATE TABLE generation, asset, cost_entry CASCADE');
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await tdb.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

function deps() {
  return {
    db: tdb.db,
    storage,
    falKey: 'fal-test-key-not-a-secret',
    sleep: () => Promise.resolve(),
    falOptions: { pollIntervalMs: 0 },
  };
}

const PROMPT = 'A serum bottle on a marble table, soft light';

async function falTotalCents(): Promise<number> {
  const summary = await getSpendSummary(tdb.db);
  return summary.byProvider.find((p) => p.provider === 'fal')?.amountCents ?? 0;
}

describe('deduplicación de generación (Verificación T4.10)', () => {
  it('(a) HIT: una 2ª generación IDÉNTICA reutiliza el asset — 0 submits, 0 cost_entry, reused=true', async () => {
    const { submitCount } = countingHappyPath();

    const first = await runGenerate(deps(), {
      modelProfileId: fluxProfile.id,
      resolvedPrompt: PROMPT,
    });
    expect(first.reused).toBe(false);
    expect(submitCount()).toBe(1);
    const totalAfter1 = await falTotalCents();
    expect(totalAfter1).toBeGreaterThan(0);

    const second = await runGenerate(deps(), {
      modelProfileId: fluxProfile.id,
      resolvedPrompt: PROMPT,
    });
    // Se reutiliza el MISMO asset de la 1ª: cero submits nuevos, cero coste nuevo.
    expect(second.reused).toBe(true);
    expect(second.assetId).toBe(first.assetId);
    expect(second.costCents).toBe(0);
    expect(submitCount()).toBe(1); // NO hubo un 2º submit
    expect(await falTotalCents()).toBe(totalAfter1); // el total de /spend NO subió

    // Una sola generación completed (la 1ª); no se creó una 2ª fila.
    const completed = await listGenerationsByStatus(tdb.db, 'completed');
    expect(completed).toHaveLength(1);
  });

  it('(b) MISS: un prompt DISTINTO → hash distinto → SÍ genera (nuevo submit y nuevo cost_entry)', async () => {
    const { submitCount } = countingHappyPath();

    await runGenerate(deps(), { modelProfileId: fluxProfile.id, resolvedPrompt: PROMPT });
    const totalAfter1 = await falTotalCents();

    const other = await runGenerate(deps(), {
      modelProfileId: fluxProfile.id,
      resolvedPrompt: 'A DIFFERENT prompt entirely, neon lighting',
    });
    expect(other.reused).toBe(false);
    expect(submitCount()).toBe(2); // dos submits: son generaciones distintas
    expect(await falTotalCents()).toBeGreaterThan(totalAfter1); // el coste subió
    expect(await listGenerationsByStatus(tdb.db, 'completed')).toHaveLength(2);
  });

  it('(c) CARRERA: dos generaciones IDÉNTICAS concurrentes → un solo submit y un solo cost_entry', async () => {
    const { submitCount } = countingHappyPath();

    // Lanzadas A LA VEZ: ambas hacen MISS del lookup optimista y compiten en el INSERT `submitting`. El
    // índice único parcial serializa: solo UNA crea la fila y submitea; la otra choca (ON CONFLICT →
    // undefined), re-lee y —según el timing— reutiliza el asset o lanza "reintenta". NUNCA dos submits.
    const results = await Promise.allSettled([
      runGenerate(deps(), { modelProfileId: fluxProfile.id, resolvedPrompt: PROMPT }),
      runGenerate(deps(), { modelProfileId: fluxProfile.id, resolvedPrompt: PROMPT }),
    ]);

    // La invariante de DINERO: exactamente UN submit y UN cost_entry, pase lo que pase con el timing.
    expect(submitCount()).toBe(1);
    const costs = await tdb.db.query.costEntry.findMany({
      where: (c, { eq }) => eq(c.provider, 'fal'),
    });
    expect(costs).toHaveLength(1);
    // Como mucho UNA generación completed (la ganadora); jamás dos.
    expect(await listGenerationsByStatus(tdb.db, 'completed')).toHaveLength(1);
    // Al menos una de las dos llamadas resolvió con éxito (la ganadora). La perdedora, o reutilizó el
    // asset (fulfilled reused=true) o lanzó "reintenta" (rejected) — ambos son correctos, nunca un 2º pago.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
  });

  it('(d) RETRY DE FAILED: una failed con el mismo hash NO bloquea el reintento (índice excluye failed)', async () => {
    const { submitCount } = countingHappyPath();

    // 1ª generación completa OK.
    const first = await runGenerate(deps(), {
      modelProfileId: fluxProfile.id,
      resolvedPrompt: PROMPT,
    });
    // La degradamos manualmente a `failed` (simula un fallo de producción de esa generación). Ahora hay
    // una `failed` con el hash — un índice único GLOBAL bloquearía el retry; el nuestro (parcial) NO.
    await updateGeneration(tdb.db, first.generation.id, { status: 'failed' });

    // El retry: mismo prompt → mismo hash. NO hay `completed` viva (la degradamos), así que el lookup MISS
    // y el insert-if-absent NO choca (la failed está fuera del predicado) → submitea y completa.
    const retry = await runGenerate(deps(), {
      modelProfileId: fluxProfile.id,
      resolvedPrompt: PROMPT,
    });
    expect(retry.reused).toBe(false);
    expect(retry.generation.id).not.toBe(first.generation.id); // fila nueva
    expect(submitCount()).toBe(2); // el retry SÍ submiteó
    expect(await listGenerationsByStatus(tdb.db, 'completed')).toHaveLength(1);
    expect(await listGenerationsByStatus(tdb.db, 'failed')).toHaveLength(1);

    // Y AHORA el dedup vuelve a morder: una 3ª idéntica reutiliza la del retry (no re-genera).
    const third = await runGenerate(deps(), {
      modelProfileId: fluxProfile.id,
      resolvedPrompt: PROMPT,
    });
    expect(third.reused).toBe(true);
    expect(third.assetId).toBe(retry.assetId);
    expect(submitCount()).toBe(2); // sin submits nuevos
  });

  it('(e) VERIFICACIÓN LITERAL: 3 variantes del MISMO ángulo → body y CTA se generan UNA sola vez (no 3× todo)', async () => {
    // La cláusula central de T4.10 (economía Hook×Body×CTA): un lote de 3 variantes del mismo ángulo tiene
    // HOOKS distintos (3 generaciones) pero comparte BODY y CTA (1 cada uno, reutilizado por las variantes
    // 2 y 3). nº de generations = 3 hooks + 1 body + 1 CTA = 5, NO 3×3=9. El ahorro se ve en /spend: el
    // total fal = 5 generaciones, no 9. (Aquí cada "generación" es un `runGenerate` de imagen; en el DAG
    // real de T4.11 son los nodos N7, pero la MECÁNICA de dedup —lo que T4.10 aporta— es EXACTAMENTE esta.)
    const { submitCount } = countingHappyPath();
    const BODY = 'BODY: the product demo scene, shared across the angle';
    const CTA = 'CTA: tap the link below, shared across the angle';

    // 3 variantes: hook único por variante (prompt distinto → 3 hashes → 3 generaciones), body+CTA idénticos.
    // Se recogen los resultados y se assertan FUERA del bucle (evita `expect` condicional).
    const hooks: boolean[] = []; // reused? por hook
    const bodies: { reused: boolean; costCents: number }[] = [];
    const ctas: { reused: boolean; costCents: number }[] = [];
    for (let v = 1; v <= 3; v++) {
      const hook = await runGenerate(deps(), {
        modelProfileId: fluxProfile.id,
        resolvedPrompt: `HOOK variante ${String(v)}: un gancho distinto por variante`,
      });
      hooks.push(hook.reused);
      const body = await runGenerate(deps(), {
        modelProfileId: fluxProfile.id,
        resolvedPrompt: BODY,
      });
      bodies.push({ reused: body.reused, costCents: body.costCents });
      const cta = await runGenerate(deps(), {
        modelProfileId: fluxProfile.id,
        resolvedPrompt: CTA,
      });
      ctas.push({ reused: cta.reused, costCents: cta.costCents });
    }

    // Cada HOOK es único → ninguno se reutiliza (3 generaciones de hook).
    expect(hooks).toEqual([false, false, false]);
    // BODY y CTA: la 1ª variante los genera, la 2ª y la 3ª los REUTILIZAN (0 coste).
    expect(bodies.map((b) => b.reused)).toEqual([false, true, true]);
    expect(ctas.map((c) => c.reused)).toEqual([false, true, true]);
    expect(bodies.slice(1).every((b) => b.costCents === 0)).toBe(true);
    expect(ctas.slice(1).every((c) => c.costCents === 0)).toBe(true);

    // nº de submits (= llamadas de PAGO a fal) = 3 hooks + 1 body + 1 CTA = 5, NO 9.
    expect(submitCount()).toBe(5);
    // nº de generaciones completed = 5 (una por submit; los reuses NO crean fila).
    expect(await listGenerationsByStatus(tdb.db, 'completed')).toHaveLength(5);
    // AHORRO VISIBLE EN /spend: exactamente 5 cost_entry de fal, no 9 — el mismo cálculo que sirve la
    // página /spend (`getSpendSummary`). El ahorro (4 generaciones no pagadas) es implícito: menos filas.
    const summary = await getSpendSummary(tdb.db);
    const falLine = summary.byProvider.find((p) => p.provider === 'fal');
    const { rows: costRows } = await tdb.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM cost_entry WHERE provider = 'fal'",
    );
    expect(costRows[0]?.n).toBe(5);
    // El total de /spend es el de 5 generaciones (no 9): cada imagen cuesta lo mismo, así que 5/9 del gasto.
    expect(falLine?.amountCents).toBeGreaterThan(0);
  });
});
