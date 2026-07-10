// Coerciones de tipo compartidas por los parsers del fast path (JSON-LD, Shopify).
// El JSON-LD y el `{handle}.json` de Shopify llegan CAÓTICOS (HEADLINE 2): los mismos
// campos vienen como string o como number según la tienda. Estos helpers normalizan a
// la forma canónica del contrato (`RawContentPartial`). Puros, sin red.
//
// Helper interno del módulo `ingest`: se importan directo (import relativo) desde los
// parsers, NO salen al barrel `ingest/index.ts` (no hay consumidor externo — un export
// de barrel sin importador de fuera lo cazaría knip como over-export).

/** Un valor string no vacío (trim) o `null`. Descarta strings en blanco. */
export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Convierte un valor de precio (string o number, o ausente) a string canónico o
 *  null. Las tiendas sirven `"29.99"` (string) O `29.99` (number): no asumimos una. */
export function priceToString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}
