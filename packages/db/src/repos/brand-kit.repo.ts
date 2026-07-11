// Repo del agregado `brand_kit` (T1.9; db.md §4: funciones por caso de uso con el executor
// como PRIMER argumento). Implementa la semántica de §9.1: "el upsert de `brand_kit` POR
// DOMINIO … análisis posteriores del mismo dominio REUTILIZAN el BrandKit sin re-extraer".
//
// "Reutilizar sin re-extraer" ⇒ el upsert es REUSE-FIRST: `ON CONFLICT DO NOTHING`, NUNCA un
// `DO UPDATE`. Un `DO UPDATE` machacaría el kit existente (y su `extracted_at`) en cada
// análisis del mismo dominio, que es exactamente la re-extracción que el PRD prohíbe.
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { brandKit, type BrandKit, type NewBrandKit } from '../schema/project';

/** Campos con los que se materializa un `brand_kit`. `domain` null ⇒ modo manual (exento del
 *  dedup: el UNIQUE de dominio es PARCIAL, N kits sin dominio conviven). `source` es el enum
 *  `extracted|manual` de `brand_kit` — NO el `url|manual` de `url_analysis`. */
export interface UpsertBrandKitInput {
  projectId?: string | null;
  domain: string | null;
  source: NewBrandKit['source'];
  logoAssetId?: string | null;
  palette: unknown;
  typography?: string | null;
  toneOfVoice: string;
  aesthetic: string;
  extractedAt: Date;
}

/**
 * Inserta el kit SI NO EXISTE ya uno para ese dominio — escritura ATÓMICA del dedup de §9.1
 * contra el UNIQUE PARCIAL `brand_kit_domain_key`. Retorno:
 *   - la fila creada, si ESTE insert ganó (kit nuevo, `extracted_at` = ahora);
 *   - `undefined`, si ya había kit para ese dominio (el caller lo REUTILIZA con
 *     `findBrandKitByDomain`, conservando su `extracted_at` original).
 * Con `domain = null` (manual) el índice parcial no aplica: cada llamada crea SU fila.
 */
export async function insertBrandKitIfAbsent(
  db: Db,
  input: UpsertBrandKitInput,
): Promise<BrandKit | undefined> {
  const [row] = await db
    .insert(brandKit)
    .values({
      projectId: input.projectId ?? null,
      domain: input.domain,
      source: input.source,
      logoAssetId: input.logoAssetId ?? null,
      palette: input.palette,
      typography: input.typography ?? null,
      toneOfVoice: input.toneOfVoice,
      aesthetic: input.aesthetic,
      extractedAt: input.extractedAt,
    })
    // Target del UNIQUE PARCIAL: columna + el MISMO predicado que el índice, para que Postgres
    // infiera el arbiter (sin el `where` sería un 42P10: no hay UNIQUE total sobre `domain`).
    // A diferencia de `url_analysis_manual_cache_key`, el predicado es `IS NOT NULL` — sin
    // literales de enum, así que no hace falta cast alguno.
    .onConflictDoNothing({
      target: brandKit.domain,
      where: sql`${brandKit.domain} IS NOT NULL`,
    })
    .returning();
  // `undefined` cuando hubo conflicto (ya había kit de ese dominio): NO es un error — es el
  // camino feliz de la reutilización.
  return row;
}

/** Busca el kit YA EXTRAÍDO de un dominio (§9.1: la reutilización). `undefined` si es la
 *  primera vez que vemos ese dominio. El UNIQUE parcial garantiza ≤1 fila. */
export async function findBrandKitByDomain(db: Db, domain: string): Promise<BrandKit | undefined> {
  const [row] = await db.select().from(brandKit).where(eq(brandKit.domain, domain)).limit(1);
  return row;
}

/**
 * Caso de uso completo de §9.1 (lo que llama la capa servicio tras N2): reutiliza el kit del
 * dominio si existe; si no, lo extrae (inserta). `reused: true` ⇒ NO se re-extrajo — el
 * `extractedAt` devuelto es el del PRIMER análisis, no el de ahora.
 *
 * Insert-first (no lookup-then-insert): el `ON CONFLICT DO NOTHING` es la barrera atómica, así
 * que dos análisis CONCURRENTES del mismo dominio no crean dos kits — el perdedor de la carrera
 * cae en el `find` de después y reutiliza. Con `domain = null` (manual) no hay dedup posible:
 * el insert siempre gana y el kit es nuevo por definición.
 */
export async function upsertBrandKitByDomain(
  db: Db,
  input: UpsertBrandKitInput,
): Promise<{ kit: BrandKit; reused: boolean }> {
  const inserted = await insertBrandKitIfAbsent(db, input);
  if (inserted) return { kit: inserted, reused: false };

  // Conflicto ⇒ el dominio no puede ser null (el índice parcial solo cubre dominios no nulos).
  if (input.domain === null) {
    throw new Error('upsertBrandKitByDomain: el INSERT sin dominio no devolvió fila');
  }
  const existing = await findBrandKitByDomain(db, input.domain);
  if (!existing) {
    // Solo alcanzable si otra transacción borró el kit entre el INSERT y este SELECT.
    throw new Error(
      `upsertBrandKitByDomain: conflicto en '${input.domain}' pero el kit ya no existe`,
    );
  }
  return { kit: existing, reused: true };
}
