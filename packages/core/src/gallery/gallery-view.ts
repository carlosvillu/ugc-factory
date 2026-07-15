// LOS CONTRATOS DE LA VISTA de galería (T3.8) — las respuestas de la API REST de `/gallery` y las
// funciones PURAS que la UI usa para resaltar slots, validar en vivo y renderizar el diff v2↔v1.
//
// Por qué viven en core y no ad-hoc en el componente (frontend §7, backend api.md §1): los
// SHAPES de respuesta son la frontera de tipos entre el route handler (que los emite) y el
// api-client (que los re-valida) y el componente (que los consume). Un shape ad-hoc en el
// componente serían DOS verdades derivando. El seed schema (`PromptTemplateSeed`) NO sirve: la
// FILA de la BD tiene `id`, `headVersion`, `usageCount`, `perf`, timestamps que el seed no
// declara — la vista es la fila leída, no el seed insertado.
//
// Las funciones puras (`splitBodySlots`, `validateBodySlots`, `diffLines`) son DETERMINISTAS y
// GRATUITAS: reusan `extractSlots`/`isCanonicalSlot` (§10.4, T3.5), corren en el navegador sin un
// fetch (la validación de slot es instantánea; solo la PERSISTENCIA de v2 va por REST) y su test
// vive en `pnpm gate` (implementer regla 3). Sin librería de diff externa (prohibidas en web, y
// aquí innecesarias: el diff por líneas es un LCS trivial).
import { z } from 'zod';
import {
  BeatSeedSchema,
  PromptKindSchema,
  PromptStatusSchema,
  VariableSpecSeedSchema,
  AssetSlotSeedSchema,
  type PromptStatus,
} from './contracts';
import { extractSlots, isCanonicalSlot } from './canonical-variables';

// ── Respuesta de un template (fila leída, no seed) ──────────────────────────────
//
// Espejo de `PromptTemplate` (`$inferSelect`) con las fechas serializadas a ISO (el JSON no lleva
// `Date`). Los jsonb opacos (`beats`, `variables`, `assetSlots`) se validan con su contrato de
// core en la frontera — una fila con un beat mal formado es un contrato roto, no algo que pintar.
export const TemplateSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  kind: PromptKindSchema,
  status: PromptStatusSchema,
  language: z.string(),
  // Las cinco facetas ortogonales (§10.1) + los tags libres.
  formats: z.array(z.string()),
  hookAngles: z.array(z.string()),
  verticals: z.array(z.string()),
  platforms: z.array(z.string()),
  aesthetics: z.array(z.string()),
  freeTags: z.array(z.string()),
  defaultDurationS: z.number().int().nullable(),
  defaultAspect: z.string().nullable(),
  featured: z.boolean(),
  headVersion: z.number().int(),
  usageCount: z.number().int(),
  // `perf` opaco (§12): el flywheel de F7 lo escribe; la tarjeta enseña `hr` si existe. `null`
  // en un template nuevo.
  perf: z.unknown().nullable(),
});
export type TemplateSummary = z.infer<typeof TemplateSummarySchema>;

// El detalle añade lo que la ficha necesita y la tarjeta no: `body` (con slots), `beats`,
// `guardPackKeys` autoradas.
export const TemplateDetailSchema = TemplateSummarySchema.extend({
  body: z.string(),
  beats: z.array(BeatSeedSchema),
  variables: z.array(VariableSpecSeedSchema),
  assetSlots: z.array(AssetSlotSeedSchema),
  guardPackKeys: z.array(z.string()),
});
export type TemplateDetail = z.infer<typeof TemplateDetailSchema>;

// Una versión materializada (`prompt_version`): el snapshot inmutable del body/beats.
export const TemplateVersionSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  body: z.string(),
  beats: z.array(BeatSeedSchema),
  guardPackKeys: z.array(z.string()),
  changelog: z.string().nullable(),
  createdAt: z.string(),
});
export type TemplateVersion = z.infer<typeof TemplateVersionSchema>;

// Un guard pack que APLICA a la ficha (§9.5): el compilador lo inyectaría. Se resuelve en el
// servidor con `resolveGuardPacks` sobre el seed real de guard packs.
export const AppliedGuardPackSchema = z.object({
  key: z.string(),
  scope: z.enum(['general', 'vertical', 'fidelity', 'platform']),
  vertical: z.string().nullable(),
  platform: z.string().nullable(),
  lines: z.array(z.string()),
});
export type AppliedGuardPack = z.infer<typeof AppliedGuardPackSchema>;

// La respuesta de la FICHA (`GET /api/templates/:id`): el template + sus versiones (más nueva
// primero) + los guard packs que aplican. Todo lo que la ficha pinta en UNA respuesta.
export const TemplateWithVersionsSchema = z.object({
  template: TemplateDetailSchema,
  versions: z.array(TemplateVersionSchema),
  appliedGuards: z.array(AppliedGuardPackSchema),
});
export type TemplateWithVersions = z.infer<typeof TemplateWithVersionsSchema>;

// El conteo de una faceta (`beauty · 12`): lo que pinta el rail izquierdo del mockup 5a.
export const FacetCountSchema = z.object({ value: z.string(), count: z.number().int() });
export type FacetCount = z.infer<typeof FacetCountSchema>;

// La respuesta de la LISTA facetada (`GET /api/templates?...`): las tarjetas que casan los
// filtros + los conteos por valor de cada faceta para el rail. Los conteos son GLOBALES (por
// valor sobre TODO el catálogo), no combinatorios: el rail enseña "cuántos hay de cada valor",
// no "cuántos quedarían si además filtro por esto" — un motor de drill-down combinatorio sería
// sobre-ingeniería para 56 filas y no lo pide la Verificación.
export const TemplateListSchema = z.object({
  templates: z.array(TemplateSummarySchema),
  facets: z.object({
    formats: z.array(FacetCountSchema),
    hookAngles: z.array(FacetCountSchema),
    verticals: z.array(FacetCountSchema),
    platforms: z.array(FacetCountSchema),
    aesthetics: z.array(FacetCountSchema),
  }),
  statusCounts: z.array(FacetCountSchema),
  total: z.number().int(),
});
export type TemplateList = z.infer<typeof TemplateListSchema>;

// El filtro facetado tal como lo maneja el cliente (un subconjunto de valores por faceta + estado).
// Se serializa a querystring con `templateFilterToQuery` (CSV por faceta). PURO y compartido para
// que el cliente y el test construyan la MISMA URL que el endpoint parsea.
export interface TemplateFilterQuery {
  formats?: string[];
  hookAngles?: string[];
  verticals?: string[];
  platforms?: string[];
  aesthetics?: string[];
  status?: PromptStatus;
}

const FILTER_FACETS = ['formats', 'hookAngles', 'verticals', 'platforms', 'aesthetics'] as const;

/** Serializa un filtro facetado a querystring: cada faceta con valores va como CSV en UNA clave
 *  (`?formats=grwm,pov&verticals=beauty`) — la forma que `GET /api/templates` parsea. Facetas
 *  vacías se omiten. Devuelve `''` si no hay filtro (sin `?`). */
export function templateFilterToQuery(filter: TemplateFilterQuery): string {
  const params = new URLSearchParams();
  for (const facet of FILTER_FACETS) {
    const values = filter[facet];
    if (values && values.length > 0) params.set(facet, values.join(','));
  }
  if (filter.status) params.set('status', filter.status);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// ── Funciones PURAS de la UI (deterministas, sin red) ───────────────────────────

/**
 * Un segmento del body para el resaltado: o texto plano, o un slot `{...}` con su validez §10.4.
 * La UI pinta los `slot` con un color (verde si `valid`, rojo si no) y deja el `text` tal cual.
 */
export type BodySegment =
  { kind: 'text'; value: string } | { kind: 'slot'; token: string; valid: boolean };

/**
 * Trocea el `body` en segmentos texto/slot para el resaltado. Un slot es todo lo que va entre
 * `{` y `}` (misma sintaxis que `extractSlots`, §10.4); su validez la decide `isCanonicalSlot`.
 * PURA: no toca red — el resaltado es instantáneo en el navegador mientras el usuario escribe.
 */
export function splitBodySlots(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  const re = /\{([^}]*)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) segments.push({ kind: 'text', value: body.slice(last, m.index) });
    const token = m[1] ?? '';
    segments.push({ kind: 'slot', token, valid: isCanonicalSlot(token) });
    last = m.index + m[0].length;
  }
  if (last < body.length) segments.push({ kind: 'text', value: body.slice(last) });
  return segments;
}

/**
 * Los slots INVÁLIDOS del body (los `{token}` que no son §10.4). Vacío ⇒ el body es válido. Es lo
 * que el editor usa para el feedback EN VIVO: reusa `extractSlots`/`isCanonicalSlot` (T3.5), la
 * MISMA regla que el validador del seed y el compilador — no hay una segunda copia que derive.
 */
export function invalidBodySlots(body: string): string[] {
  return extractSlots(body).filter((t) => !isCanonicalSlot(t));
}

// ── El DIFF por líneas v2 vs v1 (LCS clásico, sin librería) ──────────────────────

/** Una línea del diff: sin cambio, añadida (solo en v2) o quitada (solo en v1). */
export type DiffLine =
  { op: 'same'; text: string } | { op: 'add'; text: string } | { op: 'del'; text: string };

/**
 * Diff por líneas entre `before` (v1) y `after` (v2) con la subsecuencia común más larga (LCS).
 * PURA y sin dependencias: un diff por líneas es una tabla LCS trivial, y las librerías de diff
 * están prohibidas en web (traen iconos/CSS). Determinista → su test vive en `pnpm gate`.
 *
 * Emite las líneas en orden de lectura: las comunes intercaladas con los bloques quitados (del,
 * de v1) y añadidos (add, de v2). El renderer las pinta con `-`/`+` y color.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const mLen = b.length;
  // Tabla LCS (n+1)×(m+1). Indexado con un helper `at(i,j)` que devuelve 0 fuera de rango, para
  // no depender de aserciones non-null (prohibidas) ni de `noUncheckedIndexedAccess` incómodo.
  const flat = new Array<number>((n + 1) * (mLen + 1)).fill(0);
  const idx = (i: number, j: number): number => i * (mLen + 1) + j;
  const at = (i: number, j: number): number => flat[idx(i, j)] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = mLen - 1; j >= 0; j--) {
      flat[idx(i, j)] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < mLen) {
    const ai = a[i] ?? '';
    const bj = b[j] ?? '';
    if (ai === bj) {
      out.push({ op: 'same', text: ai });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      out.push({ op: 'del', text: ai });
      i++;
    } else {
      out.push({ op: 'add', text: bj });
      j++;
    }
  }
  while (i < n) out.push({ op: 'del', text: a[i++] ?? '' });
  while (j < mLen) out.push({ op: 'add', text: b[j++] ?? '' });
  return out;
}

// ── El cuerpo de la EDICIÓN (crea v2) ────────────────────────────────────────────
//
// Lo que el editor manda a `PATCH /api/templates/:id` para persistir una edición. `body` es lo
// único obligatorio (la edición de la Verificación cambia el body); `changelog` es opcional (la
// nota de la versión). El servidor RECHAZA un body con un slot inválido §10.4 (la misma regla
// que el editor aplicó en vivo, ahora en la frontera del servidor — el cliente no es la
// autoridad). `.strict()`: una clave desconocida es un contrato roto.
export const TemplateEditSchema = z
  .object({
    body: z.string().min(1),
    beats: z.array(BeatSeedSchema).optional(),
    guardPackKeys: z.array(z.string()).optional(),
    changelog: z.string().optional(),
  })
  .strict();
export type TemplateEdit = z.infer<typeof TemplateEditSchema>;

/**
 * La respuesta de `PATCH /api/templates/:id` (guardar una edición): el template en su nueva
 * cabeza + el PAR de versiones a comparar (la anterior y la recién creada). El cliente renderiza
 * el diff con `diffLines(previous.body, created.body)` — el servidor devuelve ambas, el cliente
 * pinta (menos superficie de contrato nueva, §diff decisión T3.8).
 */
export const TemplateEditResultSchema = z.object({
  template: TemplateDetailSchema,
  previous: TemplateVersionSchema,
  created: TemplateVersionSchema,
});
export type TemplateEditResult = z.infer<typeof TemplateEditResultSchema>;

/** El cambio de estado (`PATCH /api/templates/:id/status`): draft→review→published (§10.2). */
export const TemplateStatusChangeSchema = z.object({ status: PromptStatusSchema }).strict();
export type TemplateStatusChange = z.infer<typeof TemplateStatusChangeSchema>;
