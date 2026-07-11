// Cadena COMPLETA de la Verificación de T1.4 (regla de trabajo 8): el ingester N2
// scrapea (HTTP mockeado con msw — CERO red real, cero gasto) → el servicio persiste el
// screenshot como `asset`, los créditos en `cost_entry` y el RawContent en `url_analysis`
// → se relee de la BD. Cierra el seam servicio→persistencia que el unit de core (para en
// FirecrawlIngestResult) no cubre. Codifica las cláusulas DETERMINISTAS observables:
//  #1 RawContent con markdown/≥3 imágenes/branding.palette/product persistido.
//  #2 screenshot descargado → asset (kind='screenshot'), screenshotRef = su storage_key,
//     y los bytes recuperables por el StorageAdapter con el checksum correcto.
//  #3 fallback Firecrawl 401 → Jina produce al menos markdown; RawContent válido.
//  #4 cost_entry provider='firecrawl' con quantity/unit='credits'.
// Además blinda FIX 2 (dinero): el cost_entry se registra ANTES de las escrituras falibles,
// así que un fallo posterior de storage/análisis NO pierde el gasto real ya facturado.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createProject, makeLocalStorageAdapter, recordCost, setSecretBlob } from '@ugc/db';
import { deriveSecretsKey, encryptSecret } from '@ugc/core/secrets';
import { createTestDatabase, makeProject, server, type TestDatabase } from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';
import {
  FIRECRAWL_SCRAPE_RICH,
  FIRECRAWL_SCREENSHOT_BYTES,
  FIRECRAWL_SCREENSHOT_URL,
  JINA_MARKDOWN,
  JINA_MARKDOWN_BODY,
} from '@ugc/test-utils/fixtures/firecrawl';

import { runFirecrawlIngest } from '@/server/firecrawl-ingest';

const FIRECRAWL_SCRAPE = 'https://api.firecrawl.dev/v2/scrape';
const JINA_WILDCARD = 'https://r.jina.ai/*';
const TARGET_URL = 'https://glow.example/products/serum';
const MASTER_KEY = 'test-master-key-for-firecrawl-ingest-suite';

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
let secretsKey: Buffer;

async function seedProject(): Promise<string> {
  const project = await createProject(tdb.db, makeProject({ name: 'Chain T1.4' }));
  return project.id;
}

/** Lee todos los bytes de un ReadableStream del StorageAdapter (para verificar #2). */
async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'web:firecrawl-ingest' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-firecrawl-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  secretsKey = deriveSecretsKey(MASTER_KEY);
  // Siembra la API key de Firecrawl CIFRADA (T0.14): el servicio la descifra y la inyecta
  // al ingester. Sin key, el servicio lanza (el fallback Jina es para key INVÁLIDA, no
  // ausente) — aquí siempre hay key porque msw decide feliz-vs-401.
  await setSecretBlob(tdb.db, 'firecrawl', encryptSecret('fc-test-key', secretsKey));
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await tdb.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

describe('cadena ingester N2 → persistencia (Verificación T1.4)', () => {
  it('scrape feliz → url_analysis + asset del screenshot + cost_entry firecrawl', async () => {
    const projectId = await seedProject();
    server.use(
      http.post(FIRECRAWL_SCRAPE, () => HttpResponse.json(FIRECRAWL_SCRAPE_RICH)),
      http.get(FIRECRAWL_SCREENSHOT_URL, () =>
        HttpResponse.arrayBuffer(FIRECRAWL_SCREENSHOT_BYTES.buffer, {
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );

    const result = await runFirecrawlIngest(
      { db: tdb.db, storage, secretsKey },
      {
        projectId,
        url: TARGET_URL,
      },
    );

    expect(result.provider).toBe('firecrawl');

    // #1 — RawContent PERSISTIDO (releído de la BD) con la sustancia de la Verificación.
    const { rows: analyses } = await tdb.pool.query<{
      status: string;
      source: string;
      raw_content: {
        markdown: string;
        images: unknown[];
        branding?: { palette?: string[] } | null;
        product?: { title?: string } | null;
        screenshotRef?: string | null;
      };
    }>(`SELECT status, source, raw_content FROM url_analysis WHERE id = $1`, [result.analysis.id]);
    expect(analyses).toHaveLength(1);
    const raw = analyses[0]!.raw_content;
    expect(analyses[0]!.status).toBe('done');
    expect(analyses[0]!.source).toBe('url');
    expect(raw.markdown).toContain('GlowSerum');
    expect(raw.images.length).toBeGreaterThanOrEqual(3);
    // Paleta desde el BrandingProfile.colors REAL (objeto de roles → Object.values).
    expect(raw.branding?.palette).toEqual([
      '#0EA5A4',
      '#F8FAFC',
      '#F59E0B',
      '#FFFFFF',
      '#0F172A',
      '#475569',
    ]);
    expect(raw.product?.title).toBe('GlowSerum Ácido Hialurónico');

    // #2 — screenshot: fila asset (kind='screenshot'), screenshotRef = su storage_key,
    // y los bytes recuperables por el StorageAdapter con el checksum correcto.
    expect(result.screenshotAssetId).not.toBeNull();
    const { rows: assets } = await tdb.pool.query<{
      kind: string;
      storage_key: string;
      mime: string;
      bytes: number;
    }>(`SELECT kind, storage_key, mime, bytes FROM asset WHERE id = $1`, [
      result.screenshotAssetId,
    ]);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.kind).toBe('screenshot');
    expect(assets[0]!.mime).toBe('image/png');
    // El screenshotRef del RawContent APUNTA al storage_key del asset (Verificación #2).
    expect(raw.screenshotRef).toBe(assets[0]!.storage_key);
    // Los bytes persistidos coinciden con los del fixture (roundtrip por el adaptador).
    const persisted = await drain(await storage.get(assets[0]!.storage_key));
    expect(persisted).toEqual(FIRECRAWL_SCREENSHOT_BYTES);

    // #4 — cost_entry provider='firecrawl' con quantity/unit (créditos por defecto = 1).
    const { rows: costs } = await tdb.pool.query<{
      provider: string;
      amount_cents: number;
      quantity: string;
      unit: string;
    }>(`SELECT provider, amount_cents, quantity, unit FROM cost_entry WHERE project_id = $1`, [
      projectId,
    ]);
    expect(costs).toHaveLength(1);
    expect(costs[0]!.provider).toBe('firecrawl');
    expect(costs[0]!.unit).toBe('credits');
    // T1.5: el ingest emite DOS scrapes del landing — el rico (1 crédito por defecto) + el de
    // descubrimiento de páginas internas full-page (este handler devuelve el mismo fixture rich
    // sin `links` → +1 crédito, mini-crawl skipped). El cost_entry AGREGA ambos → quantity=2.
    expect(Number(costs[0]!.quantity)).toBe(2);
    // Sub-céntimo → amount_cents entero = 0 (2 × 0,083 = 0,166 → round 0; la verdad vive en quantity).
    expect(costs[0]!.amount_cents).toBe(0);
    expect(result.credits).toBe(2);
  });

  it('fallback: Firecrawl 401 → Jina persiste al menos el markdown, sin screenshot ni coste', async () => {
    const projectId = await seedProject();
    server.use(
      http.post(FIRECRAWL_SCRAPE, () => new HttpResponse(null, { status: 401 })),
      http.get(JINA_WILDCARD, () => HttpResponse.text(JINA_MARKDOWN)),
    );

    const result = await runFirecrawlIngest(
      { db: tdb.db, storage, secretsKey },
      {
        projectId,
        url: TARGET_URL,
      },
    );

    expect(result.provider).toBe('jina');
    expect(result.screenshotAssetId).toBeNull();

    const { rows: analyses } = await tdb.pool.query<{ raw_content: { markdown: string } }>(
      `SELECT raw_content FROM url_analysis WHERE id = $1`,
      [result.analysis.id],
    );
    expect(analyses[0]!.raw_content.markdown).toContain(JINA_MARKDOWN_BODY);

    // El fallback Jina NO factura por scrape → sin fila cost_entry firecrawl.
    const { rows: costs } = await tdb.pool.query(`SELECT 1 FROM cost_entry WHERE project_id = $1`, [
      projectId,
    ]);
    expect(costs).toHaveLength(0);
  });

  it('cost_entry se PRESERVA si falla una escritura posterior (dinero ya gastado, FIX 2)', async () => {
    // Firecrawl factura EN EL SCRAPE: si `storage.put`/`createAsset`/`createUrlAnalysis`
    // falla DESPUÉS, el dinero se gastó igual → el cost_entry DEBE existir (el peor bug de
    // un ledger es perder gasto real). Simulamos un fallo del StorageAdapter (put lanza)
    // tras un scrape con screenshot: el servicio ya grabó el coste ANTES de tocar storage.
    const projectId = await seedProject();
    server.use(
      http.post(FIRECRAWL_SCRAPE, () => HttpResponse.json(FIRECRAWL_SCRAPE_RICH)),
      http.get(FIRECRAWL_SCREENSHOT_URL, () =>
        HttpResponse.arrayBuffer(FIRECRAWL_SCREENSHOT_BYTES.buffer, {
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );
    // Storage que revienta en `put` — el resto delega en el real (no se usa aquí).
    const failingStorage: StorageAdapter = {
      ...storage,
      put: () => Promise.reject(new Error('disco lleno (simulado)')),
    };

    await expect(
      runFirecrawlIngest(
        { db: tdb.db, storage: failingStorage, secretsKey },
        {
          projectId,
          url: TARGET_URL,
        },
      ),
    ).rejects.toThrow('disco lleno');

    // El cost_entry SÍ existe pese al fallo posterior (contabilidad correcta: se gastó).
    const { rows: costs } = await tdb.pool.query<{ provider: string; quantity: string }>(
      `SELECT provider, quantity FROM cost_entry WHERE project_id = $1`,
      [projectId],
    );
    expect(costs).toHaveLength(1);
    expect(costs[0]!.provider).toBe('firecrawl');
    // T1.5: 1 (landing rico) + 1 (scrape de descubrimiento, ambos antes del fallo del put) = 2.
    expect(Number(costs[0]!.quantity)).toBe(2);
    // Y NO se creó url_analysis (la escritura del análisis nunca se alcanzó).
    const { rows: analyses } = await tdb.pool.query(
      `SELECT 1 FROM url_analysis WHERE project_id = $1`,
      [projectId],
    );
    expect(analyses).toHaveLength(0);
  });

  it('la fila firecrawl aparece en el resumen /spend (Verificación #4)', async () => {
    // Registra un coste firecrawl directo (equivalente al que graba el servicio) y
    // comprueba que el agregado por proveedor lo lista — el mismo dato que pinta /spend.
    const projectId = await seedProject();
    await recordCost(tdb.db, {
      provider: 'firecrawl',
      amountCents: 0,
      quantity: 5,
      unit: 'credits',
      projectId,
    });
    const { rows } = await tdb.pool.query<{ provider: string; quantity: string }>(
      `SELECT provider, sum(quantity)::bigint AS quantity FROM cost_entry WHERE provider = 'firecrawl' GROUP BY provider`,
    );
    const firecrawlRow = rows.find((r) => r.provider === 'firecrawl');
    expect(firecrawlRow).toBeDefined();
    expect(Number(firecrawlRow!.quantity)).toBeGreaterThanOrEqual(5);
  });
});
