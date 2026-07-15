// VALIDADOR DEL SEED DE GALERÍA (T3.2). Función PURA, determinista y gratuita: recibe el seed
// que `pnpm seed:gallery` va a insertar (templates + guard packs) y devuelve los problemas
// ENCONTRADOS, con el slug/índice y el dato exactos. Sin red, sin BD, sin LLM.
//
// Vive en el GATE (`pnpm gate` → `pnpm test` → el test unitario de este módulo valida el seed
// REAL, no un fixture de juguete): un template con un slot inexistente, un slug duplicado o un
// enum inválido NO puede llegar a la BD ni sobrevivir a un commit. Espejo EXACTO de las 3
// decisiones de `library/seed-validator.ts` (T2.1):
//   1. función PURA que NO lanza y devuelve TODOS los issues de una pasada, cada uno con
//      código tipado, entidad, `where` (slug/índice) y mensaje que nombra el dato exacto;
//   2. cableado al gate vía test unitario sobre el seed REAL (`RAW_GALLERY_SEED`);
//   3. contratos Zod para el shape; `safeParse` → `schema_invalid` con el primer mensaje.
//
// Los checks que la Entrega y la Verificación de T3.2 nombran EXPLÍCITAMENTE:
//   - campos requeridos / enums     → `schema_invalid` (Zod)
//   - slugs únicos                  → `duplicate_slug` (chocarían con `prompt_template_slug_key`)
//   - slots resolubles contra §10.4 → `unknown_slot` (el EJE: contrato en `canonical-variables.ts`)
//   - `guardPackKeys` existentes    → `unknown_guard_pack` (integridad referencial en el seed)
import { extractSlots, isCanonicalSlot } from './canonical-variables';
import {
  GuardPackSeedSchema,
  ModelProfileSeedSchema,
  PromptTemplateSeedSchema,
  type GuardPackSeed,
  type ModelProfileSeed,
  type PromptTemplateSeed,
} from './contracts';

export type GallerySeedIssueCode =
  /** El objeto no cumple el contrato Zod (campo requerido ausente, enum inválido, rango de beat…). */
  | 'schema_invalid'
  /** Dos templates con el mismo `slug` (chocarían con el UNIQUE `prompt_template_slug_key`). */
  | 'duplicate_slug'
  /** El `body` lleva un `{namespace.field}` que §10.4 no define (typo/inexistente): llegaría sin resolver. */
  | 'unknown_slot'
  /** El template referencia una `guardPackKey` que el seed de guard packs no define. */
  | 'unknown_guard_pack'
  /** Dos guard packs con la misma `key` (chocarían con el UNIQUE `guard_pack_key_key`). */
  | 'duplicate_guard_pack'
  /** Dos model_profile con el mismo `falEndpoint` (chocarían con el UNIQUE `model_profile_fal_endpoint_key`). */
  | 'duplicate_fal_endpoint';

export interface GallerySeedIssue {
  code: GallerySeedIssueCode;
  entity: 'prompt_template' | 'guard_pack' | 'model_profile';
  /** El slug/key/falEndpoint (clave natural), o el índice si aún no se pudo leer la clave. */
  where: string;
  message: string;
}

export interface GallerySeed {
  templates: PromptTemplateSeed[];
  guardPacks: GuardPackSeed[];
  modelProfiles: ModelProfileSeed[];
}

/** Entrada SIN TIPAR a propósito: el validador es la frontera del JSON. `modelProfiles` es
 *  opcional en el TIPO (no en la realidad: el seed real siempre lo trae) para que los fixtures de
 *  test que solo ejercitan templates/guardPacks no tengan que arrastrar un array vacío. */
export interface RawGallerySeedInput {
  templates: unknown[];
  guardPacks: unknown[];
  modelProfiles?: unknown[];
}

export interface ValidateGallerySeedResult {
  ok: boolean;
  issues: GallerySeedIssue[];
  /** El seed YA PARSEADO (solo cuando `ok`): lo que `seed:gallery` puede insertar. */
  seed?: GallerySeed;
}

function firstZodMessage(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  if (!issue) return 'inválido';
  const path = issue.path.map(String).join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Valida el seed de galería completo. NO lanza: devuelve todos los problemas de una pasada. El
 * llamante (el test del gate, el script de seed) decide qué hacer con `ok`.
 */
export function validateGallerySeed(raw: RawGallerySeedInput): ValidateGallerySeedResult {
  const issues: GallerySeedIssue[] = [];
  const templates: PromptTemplateSeed[] = [];
  const guardPacks: GuardPackSeed[] = [];
  const modelProfiles: ModelProfileSeed[] = [];

  // ── Guard packs primero: los templates comprueban integridad referencial CONTRA ellos. ──
  raw.guardPacks.forEach((candidate, index) => {
    const parsed = GuardPackSeedSchema.safeParse(candidate);
    if (!parsed.success) {
      const key = (candidate as { key?: unknown } | null)?.key;
      issues.push({
        code: 'schema_invalid',
        entity: 'guard_pack',
        where: typeof key === 'string' ? key : `guardPacks[${String(index)}]`,
        message: firstZodMessage(parsed.error),
      });
      return;
    }
    guardPacks.push(parsed.data);
  });

  // Duplicados de key (la BD tiene UNIQUE `guard_pack_key_key`: un duplicado insertaría N-1).
  const seenKeys = new Map<string, number>();
  guardPacks.forEach((pack, index) => {
    const first = seenKeys.get(pack.key);
    if (first !== undefined) {
      issues.push({
        code: 'duplicate_guard_pack',
        entity: 'guard_pack',
        where: pack.key,
        message: `guard pack duplicado "${pack.key}" (también en guardPacks[${String(first)}])`,
      });
      return;
    }
    seenKeys.set(pack.key, index);
  });
  const knownGuardPackKeys = new Set(guardPacks.map((p) => p.key));

  // ── Templates ────────────────────────────────────────────────────────────────
  raw.templates.forEach((candidate, index) => {
    const parsed = PromptTemplateSeedSchema.safeParse(candidate);
    if (!parsed.success) {
      const slug = (candidate as { slug?: unknown } | null)?.slug;
      issues.push({
        code: 'schema_invalid',
        entity: 'prompt_template',
        where: typeof slug === 'string' ? slug : `templates[${String(index)}]`,
        message: firstZodMessage(parsed.error),
      });
      return;
    }
    const template = parsed.data;

    // SLOTS RESOLUBLES CONTRA §10.4 (el eje). Cada `{namespace.field}` del body debe estar en
    // el conjunto canónico. Un `{producto.nombre}` (typo/inexistente) → issue que NOMBRA el
    // slot malo y el template (slug) donde aparece — exactamente lo que la Verificación rompe.
    const unknownSlots = [...new Set(extractSlots(template.body))].filter(
      (slot) => !isCanonicalSlot(slot),
    );
    for (const slot of unknownSlots) {
      issues.push({
        code: 'unknown_slot',
        entity: 'prompt_template',
        where: template.slug,
        message: `slot desconocido {${slot}} en el template "${template.slug}" (no está en las variables canónicas §10.4)`,
      });
    }

    // GUARD PACKS EXISTENTES: integridad referencial DENTRO del seed (estático, sin BD). Una
    // key que no exista en el seed de guard packs → issue. En T3.2 los templates de prueba las
    // llevan vacías; el check muerde igual (ver el fixture negativo del test).
    for (const key of template.guardPackKeys) {
      if (!knownGuardPackKeys.has(key)) {
        issues.push({
          code: 'unknown_guard_pack',
          entity: 'prompt_template',
          where: template.slug,
          message: `el template "${template.slug}" referencia el guard pack "${key}", que no existe en el seed`,
        });
      }
    }

    templates.push(template);
  });

  // SLUGS ÚNICOS: dos templates con el mismo slug chocarían con `prompt_template_slug_key`.
  const seenSlugs = new Map<string, number>();
  templates.forEach((template, index) => {
    const first = seenSlugs.get(template.slug);
    if (first !== undefined) {
      issues.push({
        code: 'duplicate_slug',
        entity: 'prompt_template',
        where: template.slug,
        message: `slug duplicado "${template.slug}" (también en templates[${String(first)}])`,
      });
      return;
    }
    seenSlugs.set(template.slug, index);
  });

  // ── model_profile (§13.1) ──────────────────────────────────────────────────────
  // Shape (Zod) + duplicados de `falEndpoint`. La clave natural es el endpoint fal: dos
  // filas con el mismo endpoint chocarían con `model_profile_fal_endpoint_key` (una insertaría
  // N-1). NO se valida aquí que el endpoint EXISTA en fal — eso es I/O de red y lo hace
  // `pnpm fal:verify` (que además marca `verifiedAt`); el validador es puro/offline (gate).
  (raw.modelProfiles ?? []).forEach((candidate, index) => {
    const parsed = ModelProfileSeedSchema.safeParse(candidate);
    if (!parsed.success) {
      const endpoint = (candidate as { falEndpoint?: unknown } | null)?.falEndpoint;
      issues.push({
        code: 'schema_invalid',
        entity: 'model_profile',
        where: typeof endpoint === 'string' ? endpoint : `modelProfiles[${String(index)}]`,
        message: firstZodMessage(parsed.error),
      });
      return;
    }
    modelProfiles.push(parsed.data);
  });

  const seenEndpoints = new Map<string, number>();
  modelProfiles.forEach((profile, index) => {
    const first = seenEndpoints.get(profile.falEndpoint);
    if (first !== undefined) {
      issues.push({
        code: 'duplicate_fal_endpoint',
        entity: 'model_profile',
        where: profile.falEndpoint,
        message: `model_profile duplicado "${profile.falEndpoint}" (también en modelProfiles[${String(first)}])`,
      });
      return;
    }
    seenEndpoints.set(profile.falEndpoint, index);
  });

  const ok = issues.length === 0;
  return ok ? { ok, issues, seed: { templates, guardPacks, modelProfiles } } : { ok, issues };
}

/** Formatea los problemas para un fallo ruidoso (lo usa `pnpm seed:gallery` antes de tocar la BD). */
export function formatGallerySeedIssues(issues: GallerySeedIssue[]): string {
  return issues.map((i) => `  [${i.code}] ${i.entity} ${i.where} — ${i.message}`).join('\n');
}
