// EL ÚNICO LOADER del seed de galería (T3.2).
//
// Importa los BYTES REALES de `packages/core/gallery-seed/*.json` — los mismos ficheros que
// `pnpm seed:gallery` inserta de verdad — y los expone como una `RawGallerySeed`. Es una sola
// puerta: el test del gate y el script de seed leen de AQUÍ, de modo que "romper un fixture →
// `pnpm gate` rojo" es VERDAD (rompe un slot en el JSON real → el test del validador se pone
// rojo). No hay fixture de juguete que el seed nunca ejercite.
//
// LOS DATOS ENTRAN COMO `unknown` A PROPÓSITO: el JSON es la frontera sin tipar. Si tipáramos
// el import con el shape inferido de Zod, un "campo requerido ausente" en el JSON sería un
// error de COMPILACIÓN en vez de un `schema_invalid` en RUNTIME — y la Verificación pide que
// el validador MUERDA en runtime, no que el fixture ni siquiera compile. Por eso el cast a
// `unknown[]`: el validador es quien decide si la forma es válida.
import guardPacksJson from '../../gallery-seed/guard-packs.json';
import promptTemplatesJson from '../../gallery-seed/prompt-templates.json';

/** El seed SIN TIPAR, tal cual sale de los `.json`. El validador es la frontera. */
export interface RawGallerySeed {
  templates: unknown[];
  guardPacks: unknown[];
}

// Sin `as`: el tipo inferido del JSON ya es asignable a `unknown[]` (la frontera). El shape
// concreto lo decide `validateGallerySeed` en runtime, no el compilador — que es justo lo que
// mantiene a Zod load-bearing (un campo ausente en el JSON es `schema_invalid`, no un error de
// compilación).
export const RAW_GALLERY_SEED: RawGallerySeed = {
  templates: promptTemplatesJson,
  guardPacks: guardPacksJson,
};
