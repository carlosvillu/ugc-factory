// Servicio de ingesta N2 (T1.4): la superficie INVOCABLE que persiste una scrape de
// Firecrawl/Jina. Orquesta core (`makeFirecrawlIngester` — solo red) + la capa db/storage
// (asset del screenshot, cost_entry de los créditos, url_analysis). Vive en `@ugc/services`
// (T1.10a): cablea, no contiene lógica de negocio — el ingester N2 y el mapeo a RawContent
// viven en core. Lo consumen el smoke del verifier (`smoke-firecrawl.ts`) y el executor del
// nodo N1 del worker (T1.10a). NACIÓ en la capa server de web (T1.4) y se MOVIÓ aquí cuando
// el worker necesitó el mismo servicio: apps/web y apps/worker son composition roots
// hermanos y ninguno importa del otro (architecture.md §1), así que lo que comparten vive en
// un paquete.
//
// Por qué la persistencia está aquí y no en core: escribir en la BD y en el StorageAdapter
// es I/O de datos (la frontera prohibida de core, architecture §1). El screenshot de
// Firecrawl EXPIRA ~24h → el ingester ya descargó los bytes; aquí se materializan como
// `asset` (kind='screenshot') y su storage_key se estampa en `RawContent.screenshotRef`.
import type { StorageAdapter } from '@ugc/core';
import { makeFirecrawlIngester, FIRECRAWL_CENTS_PER_CREDIT } from '@ugc/core/ingest';
import { newUlid, type RawContent } from '@ugc/core/contracts';
import { decryptSecret, type SecretBlob } from '@ugc/core/secrets';
import {
  createAsset,
  createUrlAnalysis,
  getSecretBlob,
  recordCost,
  type DbClient,
  type UrlAnalysis,
} from '@ugc/db';

/** Deps de la ingesta N2. Todo inyectable para tests (BD real de Testcontainers,
 *  storage sobre tmpdir, fetch mockeado con msw). `fetch` se pasa AL ingester de core. */
export interface FirecrawlIngestDeps {
  db: DbClient;
  storage: StorageAdapter;
  /** Clave descifrante de secretos (T0.14) — derivada de la master key en el caller. */
  secretsKey: Buffer;
  /** `fetch` inyectable (msw en tests); default global en producción. */
  fetch?: typeof globalThis.fetch;
  /** Timeout por request del ingester (ms). Default del ingester si se omite. */
  timeoutMs?: number;
  /** Override del base URL de Firecrawl (tests legibles con msw). */
  firecrawlBaseUrl?: string;
  jinaBaseUrl?: string;
}

export interface FirecrawlIngestInput {
  projectId: string;
  url: string;
  /** El step que originó el gasto (T1.10b): atribuye el `cost_entry` a `step_run_id`. OPCIONAL
   *  — el servicio también se invoca fuera de un run (ahí la columna queda NULL, correcto). */
  stepRunId?: string;
}

export interface FirecrawlIngestServiceResult {
  analysis: UrlAnalysis;
  /** Camino usado: 'firecrawl' (feliz) o 'jina' (fallback). Observable en logs/tests. */
  provider: 'firecrawl' | 'jina';
  /** Id del asset del screenshot persistido, o `null` si no hubo screenshot. */
  screenshotAssetId: string | null;
  /** Créditos Firecrawl facturados (0 en el fallback Jina). */
  credits: number;
}

/** Lee y descifra la API key de Firecrawl del módulo de secretos (T0.14). Lanza si no
 *  hay key configurada — sin key no hay ingesta N2 (el fallback Jina es para cuando la
 *  key es INVÁLIDA, no para cuando falta). */
async function loadFirecrawlKey(db: DbClient, secretsKey: Buffer): Promise<string> {
  const blob = await getSecretBlob(db, 'firecrawl');
  if (blob === undefined || blob === null) {
    throw new Error('firecrawl-ingest: no hay API key de Firecrawl configurada (T0.14)');
  }
  return decryptSecret(blob as SecretBlob, secretsKey);
}

/**
 * Ejecuta la ingesta N2 y la persiste: scrape (Firecrawl → fallback Jina) → screenshot
 * como `asset` → `cost_entry` de los créditos → `url_analysis` con el RawContent.
 * SIEMPRE persiste una fila válida (el ingester nunca devuelve un RawContent inválido).
 */
export async function runFirecrawlIngest(
  deps: FirecrawlIngestDeps,
  input: FirecrawlIngestInput,
): Promise<FirecrawlIngestServiceResult> {
  const { db, storage, secretsKey } = deps;

  // La key de Jina es opcional y NO es un proveedor de secretos de T0.14 (el fallback usa
  // el tier gratis de r.jina.ai — suficiente para el único scrape del verifier con la key
  // de Firecrawl inválida). Si más adelante se quiere subir el rate limit, se añade 'jina'
  // al enum de secretos en su propia tarea.
  const apiKey = await loadFirecrawlKey(db, secretsKey);

  const ingester = makeFirecrawlIngester({
    apiKey,
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs,
    firecrawlBaseUrl: deps.firecrawlBaseUrl,
    jinaBaseUrl: deps.jinaBaseUrl,
  });

  const result = await ingester.ingest(input.url);

  // 1) cost_entry PRIMERO — Firecrawl factura EN EL MOMENTO del scrape: el dinero se
  //    gastó pase lo que pase después. Registrarlo ANTES de las escrituras falibles
  //    (asset/análisis) garantiza que un fallo posterior NO pierda el registro de gasto
  //    real (el peor bug de un ledger). `cost_entry` se ata a `project_id`, sin FK a
  //    `url_analysis`, así que registrarlo antes es limpio. NO se envuelve en una tx que
  //    lo borre si falla el análisis: un cost_entry sin análisis es CONTABILIDAD CORRECTA
  //    (gastaste el dinero), no inflación. (0 en el fallback Jina → no factura por scrape.)
  //    `quantity` lleva la VERDAD de los créditos (unit='credits'); `amount_cents` es
  //    entero (sub-céntimo → 0).
  if (result.provider === 'firecrawl' && result.credits > 0) {
    await recordCost(db, {
      provider: 'firecrawl',
      amountCents: Math.round(result.credits * FIRECRAWL_CENTS_PER_CREDIT),
      quantity: result.credits,
      unit: 'credits',
      projectId: input.projectId,
      // T1.10b: el step que originó el gasto (NULL fuera de un run).
      stepRunId: input.stepRunId,
    });
  }

  // 2) Screenshot → asset (los bytes ya vienen descargados del ingester; el StorageAdapter
  //    los persiste y devuelve bytes+checksum canónicos). El storage_key es de CONFIANZA
  //    (lo generamos aquí con un ULID), nunca input del cliente (§19.2). Un orphan del
  //    asset (fichero+fila sin análisis, si falla el paso 3) es un problema menor y
  //    aparte — NO justifica una tx alrededor del coste.
  let screenshotAssetId: string | null = null;
  const raw: RawContent = result.raw;
  if (result.screenshot) {
    const storageKey = `screenshots/${newUlid()}.png`;
    const put = await storage.put(storageKey, result.screenshot.data, {
      mime: result.screenshot.mime,
    });
    const asset = await createAsset(db, {
      kind: 'screenshot',
      storageKey,
      mime: result.screenshot.mime,
      bytes: put.bytes,
      checksum: put.checksum,
    });
    screenshotAssetId = asset.id;
    // El screenshotRef apunta al storage_key del asset (§12). El download por
    // GET /api/assets/:id/download (T0.5) resuelve :id → storage_key → adapter.get.
    raw.screenshotRef = storageKey;
  }

  // 3) url_analysis con el RawContent (screenshotRef ya estampado). status='done':
  //    la scrape N2 completó su extracción; la síntesis LLM es un paso posterior.
  const analysis = await createUrlAnalysis(db, {
    projectId: input.projectId,
    platform: result.platform,
    urlNormalized: result.urlNormalized,
    contentHash: result.contentHash,
    rawContent: raw,
    warnings: result.warnings,
  });

  return {
    analysis,
    provider: result.provider,
    screenshotAssetId,
    credits: result.credits,
  };
}
