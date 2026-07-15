// Contratos de la GALERÍA sembrada (T3.2): los templates de prompt y los guard packs que
// `packages/core/gallery-seed/*.json` versiona en git y que `pnpm seed:gallery` inserta.
//
// Por qué el contrato vive en core y no en db: es lógica PURA (§ architecture.md §1). El
// consumidor real de los templates es el COMPILADOR de prompts de T3.5 (N6), que también vive
// en core; db solo persiste lo que este contrato declara válido. Espejo de `library/contracts.ts`.
//
// El shape refleja las columnas de `prompt_template`/`guard_pack` (§10.1, §12 l.537-542,
// `packages/db/src/schema/gallery.ts`). Los enums NATIVOS de la BD (`prompt_kind`,
// `prompt_status`, `guard_scope`) se espejan aquí como `z.enum` — el "enumValues para enums"
// que la Entrega de T3.2 nombra: un `kind`/`status`/`scope` fuera del vocabulario es
// `schema_invalid` ANTES de tocar la BD (donde chocaría con el enum nativo).
import { z } from 'zod';

/** `prompt_kind` (§10.1): gobierna qué compilador/modelo consume el template. Enum nativo en BD. */
export const PromptKindSchema = z.enum(['video', 'image', 'script', 'voiceover']);
export type PromptKind = z.infer<typeof PromptKindSchema>;

/** `prompt_status` (§10.1): la máquina de estados de publicación. Enum nativo en BD. */
export const PromptStatusSchema = z.enum(['draft', 'review', 'published', 'deprecated']);
export type PromptStatus = z.infer<typeof PromptStatusSchema>;

/** `guard_scope` (§12 l.541): el ámbito del guard pack. Enum nativo en BD. */
export const GuardScopeSchema = z.enum(['general', 'vertical', 'fidelity', 'platform']);
export type GuardScope = z.infer<typeof GuardScopeSchema>;

/**
 * Un beat temporizado (§10.1: tStart, tEnd, action, dialogue, camera). jsonb OPACO en la BD;
 * su shape lo valida ESTE contrato en la frontera, no un CHECK. Laxo a propósito en los
 * campos de texto (son prosa curada); lo que importa es que `tStart <= tEnd`.
 */
export const BeatSeedSchema = z
  .object({
    tStart: z.number().nonnegative(),
    tEnd: z.number().nonnegative(),
    action: z.string().min(1),
    dialogue: z.string().default(''),
    camera: z.string().default(''),
  })
  .refine((b) => b.tStart <= b.tEnd, {
    message: 'tStart debe ser <= tEnd',
    path: ['tEnd'],
  });
export type BeatSeed = z.infer<typeof BeatSeedSchema>;

/**
 * Un `VariableSpec` (§10.1): la declaración de un slot que el template usa. `enumValues` es
 * opcional (solo los slots de tipo enum lo fijan). NOTA de alcance (T3.2): el validador NO
 * cruza estas declaraciones contra los slots del `body` — eso es refinamiento del compilador
 * (T3.5). Aquí solo se valida el SHAPE.
 */
export const VariableSpecSeedSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean().default(true),
  source: z.string().optional(),
  enumValues: z.array(z.string()).optional(),
  example: z.string().optional(),
});
export type VariableSpecSeed = z.infer<typeof VariableSpecSeedSchema>;

/** Un asset slot del template (@product/@character/@background/@style/@camera_motion/@audio). */
export const AssetSlotSeedSchema = z.object({
  slot: z.string().min(1),
  required: z.boolean().default(true),
});
export type AssetSlotSeed = z.infer<typeof AssetSlotSeedSchema>;

/**
 * Un template de la galería (§10.1, `prompt_template`). Campos REQUERIDOS: `slug` (clave
 * natural, UNIQUE en BD), `title`, `kind`, `body` (con slots §10.4), `language`. El resto tiene
 * default (arrays vacíos = agnóstico de esa faceta), espejo de los defaults de la BD.
 *
 * `guardPackKeys`: las CLAVES semánticas de guard pack que el compilador inyecta. En T3.2 los
 * templates de prueba las llevan VACÍAS (el contenido de guard packs es T3.3); el validador
 * comprueba la integridad referencial contra el seed de guard packs de todos modos, de modo
 * que referenciar una key inexistente es `unknown_guard_pack`.
 */
export const PromptTemplateSeedSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  kind: PromptKindSchema,
  body: z.string().min(1),
  language: z.string().min(1),
  status: PromptStatusSchema.default('draft'),
  beats: z.array(BeatSeedSchema).default([]),
  variables: z.array(VariableSpecSeedSchema).default([]),
  assetSlots: z.array(AssetSlotSeedSchema).default([]),
  guardPackKeys: z.array(z.string().min(1)).default([]),
  defaultDurationS: z.number().int().positive().optional(),
  defaultAspect: z.string().optional(),
  formats: z.array(z.string()).default([]),
  hookAngles: z.array(z.string()).default([]),
  verticals: z.array(z.string()).default([]),
  platforms: z.array(z.string()).default([]),
  aesthetics: z.array(z.string()).default([]),
  freeTags: z.array(z.string()).default([]),
  featured: z.boolean().default(false),
  license: z.string().optional(),
  author: z.string().optional(),
  attribution: z.string().optional(),
  translations: z.record(z.string(), z.string()).default({}),
  compliance: z.record(z.string(), z.unknown()).optional(),
});
export type PromptTemplateSeed = z.infer<typeof PromptTemplateSeedSchema>;

/**
 * Un guard pack (§12 l.540-542). `key` es la clave semántica UNIQUE (`guard.vertical.beauty`).
 * `vertical`/`platform` son opcionales (solo los scopes vertical/platform los fijan).
 */
export const GuardPackSeedSchema = z.object({
  key: z.string().min(1),
  scope: GuardScopeSchema,
  vertical: z.string().optional(),
  platform: z.string().optional(),
  lines: z.array(z.string().min(1)).default([]),
});
export type GuardPackSeed = z.infer<typeof GuardPackSeedSchema>;
