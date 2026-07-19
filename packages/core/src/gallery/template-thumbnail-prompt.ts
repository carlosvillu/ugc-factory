// Constructor del PROMPT text-to-image de un TEMPLATE (T4.12): de un `prompt_template` → el prompt que
// va a `fal-ai/flux-2` para producir DOS artefactos-imagen del mismo template:
//   · su THUMBNAIL de galería (la miniatura que §10.2 regla 2 exige para publicar), y
//   · la IMAGEN DE PRUEBA del botón «Probar template» de la ficha.
// Ambos comparten prompt A PROPÓSITO: la miniatura ES una prueba representativa del template, así que
// una sola función determinista los alinea (y el `content_hash` de la prueba coincide con el de su
// thumbnail cuando el modelo/inputs coinciden — reúso natural, no dos imágenes distintas).
//
// Lógica PURA (determinista, sin red): se testea sin levantar nada, igual que `buildPackshotPrompt`.
//
// POR QUÉ EL BODY CON LOS SLOTS DESNUDOS Y NO EL PROMPT COMPILADO. El body canónico lleva slots
// `{namespace.field}` (§10.1) que solo un run real resuelve (brief+persona+guion). Para una MINIATURA
// representativa —no un anuncio final— no hace falta resolverlos: se DESNUDAN las llaves (el texto del
// slot queda como palabra descriptiva, p.ej. `{product.name}` → `product name`) para que el modelo
// componga una escena representativa sin inventar un producto concreto. Es «lo más simple que produce
// una imagen representativa» (alcance T4.12 pase A), no el compilador de F3.
import { trimForPrompt } from '../generation/prompt-text';

/** Desnuda los slots `{namespace.field}` del body a palabras planas: `{product.name}` → `product name`.
 *  Determinista y sin dependencias del compilador (§10.4): para una miniatura basta con que el texto
 *  del slot informe la composición, no con resolverlo a un valor real. */
function stripSlots(body: string): string {
  return body
    .replace(/\{([^}]*)\}/g, (_m, inner: string) => inner.replace(/[._]/g, ' ').trim())
    .replace(/\s+/g, ' ')
    .trim();
}

/** El shape mínimo del template que este builder necesita (estructural, sin acoplar al row de db:
 *  core no importa `@ugc/db`). La fila `prompt_template` lo satisface por estructura. */
export interface TemplateThumbnailInput {
  title: string;
  description: string | null;
  body: string;
}

/**
 * Construye el prompt text-to-image (flux-2) de la miniatura/prueba de un template. Toma el `title`
 * (identidad), la `description` (contexto) y el `body` con los slots desnudos (la escena), y añade una
 * cola de estilo UGC vertical. Determinista: mismo template → mismo prompt (base del `content_hash`, de
 * modo que thumbnail y prueba del mismo template con el mismo modelo colapsan a una sola generación).
 */
export function buildTemplateThumbnailPrompt(template: TemplateThumbnailInput): string {
  const scene = stripSlots(template.body);
  const parts = [
    `UGC-style ad thumbnail for the template "${template.title.trim()}"`,
    template.description ? trimForPrompt(template.description, 160) : '',
    scene ? `Scene: ${trimForPrompt(scene, 320)}` : '',
    'Candid vertical 9:16 user-generated-content look, natural lighting, authentic and relatable, ' +
      'realistic, no text overlays, no watermarks, no logos',
  ].filter((s) => s.length > 0);
  return parts.join('. ');
}
