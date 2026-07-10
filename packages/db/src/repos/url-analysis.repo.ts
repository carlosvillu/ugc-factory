// Repo de escritura mínimo del agregado `url_analysis` (T1.3; db.md §4: funciones por
// caso de uso con el executor como PRIMER argumento, patrón asset.repo/spend.repo).
// El fast path (core `ingest`) produce un `RawContent` + campos derivados; este repo
// persiste esa fila con `raw_content` jsonb, `platform`, `url_normalized`,
// `content_hash` y `status`. NO es la capa de repo completa: list/update llegan con
// sus consumidores (el endpoint de N1 es una tarea posterior).
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { urlAnalysis, type NewUrlAnalysis, type UrlAnalysis } from '../schema/project';

/** Datos con los que el fast path materializa la fila. `rawContent` es el
 *  `RawContent` de T1.1 (jsonb opaco en BD; su shape lo valida Zod en core, no la BD).
 *  `status` default `'done'`: el fast path completó su extracción determinista (no hay
 *  scraping/síntesis pendiente en T1.3). `warnings` default `[]`. */
export interface CreateUrlAnalysisInput {
  projectId: string;
  platform: NewUrlAnalysis['platform'];
  urlNormalized: string;
  contentHash: string;
  rawContent: unknown;
  status?: NewUrlAnalysis['status'];
  warnings?: string[];
}

/**
 * Inserta una fila `url_analysis` y devuelve la fila completa (`RETURNING`:
 * defaults e id de la BD aplicados). Una sola fila, consistente con su RawContent.
 */
export async function createUrlAnalysis(
  db: Db,
  input: CreateUrlAnalysisInput,
): Promise<UrlAnalysis> {
  const [row] = await db
    .insert(urlAnalysis)
    .values({
      projectId: input.projectId,
      source: 'url',
      platform: input.platform,
      urlNormalized: input.urlNormalized,
      contentHash: input.contentHash,
      rawContent: input.rawContent,
      status: input.status ?? 'done',
      warnings: input.warnings ?? [],
    })
    .returning();
  if (!row) throw new Error('createUrlAnalysis: el INSERT no devolvió fila');
  return row;
}

/** Lee un análisis por id; `undefined` si no existe. */
export async function getUrlAnalysis(db: Db, id: string): Promise<UrlAnalysis | undefined> {
  const [row] = await db.select().from(urlAnalysis).where(eq(urlAnalysis.id, id));
  return row;
}

// ── Modo MANUAL (T1.6, §7.4) ─────────────────────────────────────────────────
// El intake por texto libre persiste un `url_analysis` sintético con `source='manual'`,
// `url_normalized=null`, `content_hash = contentHash(texto)` y `status='done'` (no hay
// scraping/síntesis pendiente: el short-circuit lo completa de inmediato).

/** Datos con los que se materializa una fila `url_analysis` en modo manual. */
export interface CreateManualUrlAnalysisInput {
  projectId: string;
  /** `contentHash(texto)` de T1.3 (§7.4: el hash cubre SOLO el texto). */
  contentHash: string;
  /** El `RawContent` sintético (source='manual'); jsonb opaco en BD. */
  rawContent: unknown;
  warnings?: string[];
}

/**
 * Inserta una fila `url_analysis` en modo manual SI NO EXISTE ya una con el mismo
 * `(project_id, content_hash)` — `ON CONFLICT DO NOTHING` contra el UNIQUE parcial
 * `url_analysis_manual_cache_key`. Es la escritura ATÓMICA de la caché (§7.4): dos
 * requests concurrentes con el mismo texto NO crean dos filas — la segunda choca y el
 * INSERT no devuelve fila. Retorno:
 *  - la fila creada, si ESTE insert ganó la carrera (created);
 *  - `undefined`, si otra transacción ya la insertó (el caller re-SELECTa y reutiliza).
 */
export async function insertManualUrlAnalysisIfAbsent(
  db: Db,
  input: CreateManualUrlAnalysisInput,
): Promise<UrlAnalysis | undefined> {
  const [row] = await db
    .insert(urlAnalysis)
    .values({
      projectId: input.projectId,
      source: 'manual',
      platform: 'manual',
      urlNormalized: null,
      contentHash: input.contentHash,
      rawContent: input.rawContent,
      // El modo manual no scrapea ni sintetiza: la fila nace `done`.
      status: 'done',
      warnings: input.warnings ?? [],
    })
    // Target del UNIQUE parcial: columnas + el MISMO predicado que el índice. DEBE ser
    // un literal (no un parámetro `$1`): la inferencia del arbiter de Postgres compara
    // el predicado del ON CONFLICT con el del índice y un parámetro no casa (42P10) —
    // por eso `sql` con el literal exacto de `url_analysis_manual_cache_key`.
    .onConflictDoNothing({
      target: [urlAnalysis.projectId, urlAnalysis.contentHash],
      // `where` (no `targetWhere`, que en drizzle 0.44 solo aplica a onConflictDoUpdate):
      // el predicado del índice PARCIAL, para que el arbiter lo infiera. El cast explícito
      // al enum (`::url_analysis_source`) es OBLIGATORIO: Postgres almacena el predicado
      // como `(source = 'manual'::url_analysis_source)` y la inferencia exige match
      // estructural — sin el cast (o con un parámetro `$1`) falla 42P10.
      where: sql`${urlAnalysis.source} = 'manual'::url_analysis_source`,
    })
    .returning();
  // `undefined` cuando hubo conflicto (otra tx insertó primero): NO es un error.
  return row;
}

/**
 * Lookup de la caché del modo manual (§7.4): busca un análisis manual PREVIO del
 * MISMO proyecto con el MISMO `content_hash`. La caché es lookup-then-insert a nivel
 * de aplicación (NO un constraint de BD): el servicio llama a esto ANTES de insertar
 * y, si hay fila, la reutiliza. Gateado por `(project_id, content_hash, source='manual')`
 * — `source='manual'` evita colisionar con un análisis de URL que comparta hash.
 * `undefined` si no hay caché (es un análisis nuevo).
 */
export async function findManualUrlAnalysisByHash(
  db: Db,
  projectId: string,
  contentHash: string,
): Promise<UrlAnalysis | undefined> {
  const [row] = await db
    .select()
    .from(urlAnalysis)
    .where(
      and(
        eq(urlAnalysis.projectId, projectId),
        eq(urlAnalysis.contentHash, contentHash),
        eq(urlAnalysis.source, 'manual'),
      ),
    )
    // El UNIQUE parcial garantiza ≤1 fila; `limit(1)` por higiene (determinista).
    .limit(1);
  return row;
}
