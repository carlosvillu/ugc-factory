// Repo de escritura mínimo del agregado `url_analysis` (T1.3; db.md §4: funciones por
// caso de uso con el executor como PRIMER argumento, patrón asset.repo/spend.repo).
// El fast path (core `ingest`) produce un `RawContent` + campos derivados; este repo
// persiste esa fila con `raw_content` jsonb, `platform`, `url_normalized`,
// `content_hash` y `status`. NO es la capa de repo completa: list/update llegan con
// sus consumidores (el endpoint de N1 es una tarea posterior).
import { eq } from 'drizzle-orm';
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
