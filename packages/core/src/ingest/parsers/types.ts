// Tipo intermedio que emiten los parsers del fast path (Shopify `.json`, JSON-LD,
// OpenGraph) y consume `mergeRawContent`. NO es un contrato de frontera del
// pipeline (ese es `RawContent`, T1.1): es la pieza interna del módulo `ingest`.
// Cada parser rellena solo lo que su fuente aporta; TODO es opcional porque cada
// fuente puede estar ausente (HEADLINE 1: fuente ausente = downgrade silencioso,
// nunca un throw).
import type { RawImage } from '../../contracts/raw-content';

/** Nombre de la fuente que produjo un parcial (para precedencia y trazabilidad). */
export type RawSource = 'shopify' | 'json-ld' | 'opengraph';

/** Extracción parcial de una fuente del fast path. Campos deterministas del §7.2 N1
 *  (facetas 1/6/8/9 de research §2). Todos opcionales/nullable: la ausencia de un
 *  campo es normal y significa "esta fuente no lo trae". */
export interface RawContentPartial {
  /** Qué fuente lo produjo — fija la precedencia en el merge. */
  source: RawSource;
  title?: string | null;
  description?: string | null;
  /** Precio como STRING SIEMPRE (research §1.5: `offers.price` llega como number o
   *  string en el mundo real; lo normalizamos a string para el contrato). */
  price?: string | null;
  currency?: string | null;
  availability?: string | null;
  brand?: string | null;
  variants?: string[];
  images?: RawImage[];
  /** Rating agregado (JSON-LD `AggregateRating`) — extractivo, faceta 6. */
  rating?: number | null;
  reviewCount?: number | null;
}
