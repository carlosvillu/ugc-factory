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
/** El tipo de ENTRADA del seed (antes de aplicar defaults): solo los campos requeridos son
 *  obligatorios. Lo usa el cliente al crear un template desde el formulario, que teclea el mínimo
 *  (slug/title/kind/body/language) y deja que el schema rellene el resto. */
export type PromptTemplateSeedInput = z.input<typeof PromptTemplateSeedSchema>;

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

// ── model_profile (§13.1, §12 l.546-548) — T3.4 ────────────────────────────────
//
// El CATÁLOGO de modelos fal.ai que el pipeline invoca (avatares, b-roll, TTS, ASR, shots,
// música, lipsync). Espejo EXACTO de los enums nativos y del jsonb de `model_profile`
// (`packages/db/src/schema/gallery.ts`, T3.1). Estos contratos son la frontera del JSON del
// seed y —clave para T3.4— el shape que `pnpm fal:verify` compara contra lo publicado por fal.

/** `model_kind` (§12 l.546): gobierna qué nodo del grafo puede usar el modelo. Enum nativo en BD. */
export const ModelKindSchema = z.enum([
  't2v',
  'i2v',
  'r2v',
  'avatar',
  'lipsync',
  'tts',
  'image',
  'music',
  'utility',
]);
export type ModelKind = z.infer<typeof ModelKindSchema>;

/** Los `kind` de vídeo que N7d (b-roll) sabe generar: `t2v` (text-to-video), `i2v` (image-to-video
 *  desde keyframe) y `r2v` (reference-to-video del producto). El servicio, el executor y el smoke de
 *  b-roll comparten esta frontera (cada uno con su propio error tipado). */
const BROLL_MODEL_KINDS = ['t2v', 'i2v', 'r2v'] as const;
export function isBrollModelKind(kind: ModelKind): kind is (typeof BROLL_MODEL_KINDS)[number] {
  return (BROLL_MODEL_KINDS as readonly string[]).includes(kind);
}

/** Los `kind` de vídeo que N7c (clip de avatar, T4.7) sabe generar: `avatar` (imagen+audio → clip
 *  hablando) y `lipsync`. Sibling de `isBrollModelKind`. */
const AVATAR_MODEL_KINDS = ['avatar', 'lipsync'] as const;
export function isAvatarModelKind(kind: ModelKind): kind is (typeof AVATAR_MODEL_KINDS)[number] {
  return (AVATAR_MODEL_KINDS as readonly string[]).includes(kind);
}

/**
 * ¿Este `model_kind` produce un ASSET DE VÍDEO? (avatar/lipsync de N7c ∪ t2v/i2v/r2v de N7d). Es el
 * ÚNICO punto de verdad de la taxonomía «esto es vídeo»: lo consumen el sweeper (deadline de cuelgue
 * en minutos, no en segundos), el finalizer de descarga (elige `finalizeVideoDownload`) y quien
 * necesite distinguir vídeo de imagen/audio. ANTES vivía TRIPLICADO —`VIDEO_MODEL_KINDS` en el
 * sweeper, `AVATAR_KINDS`+`BROLL_KINDS` en finalize-download— cosido por un comentario «mantener
 * sincronizados»; T4.11 lo unifica aquí, siguiendo el molde de `isBrollModelKind`.
 */
export function isVideoModelKind(kind: ModelKind): boolean {
  return isAvatarModelKind(kind) || isBrollModelKind(kind);
}

/** El `kind` DE ASSET de vídeo que corresponde a un `model_kind`: avatar/lipsync → `avatar_clip`;
 *  t2v/i2v/r2v → `broll_clip`. `null` si el kind NO produce vídeo (image/tts/music/utility). Un único
 *  punto de derivación para el finalizer de descarga (que antes lo hacía con `AVATAR_KINDS`/`BROLL_KINDS`
 *  locales). */
export function videoAssetKindForModelKind(kind: ModelKind): 'avatar_clip' | 'broll_clip' | null {
  if (isAvatarModelKind(kind)) return 'avatar_clip';
  if (isBrollModelKind(kind)) return 'broll_clip';
  return null;
}

/** El `kind` que N7e (bed musical IA, T4.9) sabe generar: `music` (ace-step, text-to-music por tags).
 *  El servicio y el smoke de música comparten esta frontera (cada uno con su propio error tipado),
 *  igual que `isBrollModelKind` para N7d. */
export function isMusicModelKind(kind: ModelKind): kind is 'music' {
  return kind === 'music';
}

/** `model_status` (§12 l.548): active|deprecated. Enum nativo en BD. `fal:verify` puede pasarlo a `deprecated`. */
export const ModelStatusSchema = z.enum(['active', 'deprecated']);
export type ModelStatus = z.infer<typeof ModelStatusSchema>;

/**
 * La UNIDAD de facturación de un modelo (§13.1 es MULTI-UNIDAD): un t2v/avatar cobra por
 * SEGUNDO, un image por IMAGEN, un tts por 1000 CHARS, un lipsync por VÍDEO o por MINUTO, un
 * FLUX por MEGAPÍXEL. El vocabulario es CONTRATO (el comparador de `fal:verify` reconcilia la
 * unidad del seed contra la unidad leída de fal antes de comparar céntimos), por eso enum.
 *
 * Los strings ESPEJAN literalmente lo que fal escribe en su `llms.txt` normalizado a singular:
 * `per seconds`→second, `per minutes`→minute, `per images`→image, `per 1000 characters`→1k_chars,
 * `per megapixels`→megapixel, `per <vídeo>`→video (sync/latentsync cobran «per video»/«per request»).
 */
export const CostUnitSchema = z.enum([
  'second',
  'minute',
  'image',
  '1k_chars',
  'megapixel',
  'video',
]);
export type CostUnit = z.infer<typeof CostUnitSchema>;

/**
 * `cost` jsonb multi-unidad (§12 l.547). `amountCents` en CÉNTIMOS pero como FLOAT a propósito:
 * §13.1 tiene precios sub-céntimo por unidad ($0,0002/s ace-step = 0,02 céntimos/s; $0,0562/s
 * Kling = 5,62 céntimos/s). El dinero AGREGADO del sistema es entero (`cost_entry.amount_cents`),
 * pero el precio UNITARIO de un modelo necesita la fracción — el estimador la multiplica por
 * segundos/imágenes y redondea al agregar. Positivo salvo modelos de compute-seconds (no sembrados).
 */
export const ModelCostSchema = z.object({
  unit: CostUnitSchema,
  amountCents: z.number().nonnegative(),
  /** MÍNIMO de facturación (en segundos), para modelos que cobran un mínimo aunque el clip sea más corto
   *  (T4.7b: VEED cobra 1 min = 60 s mínimo aunque el clip dure ~8 s). El coste usa `max(duración,
   *  minBilledSeconds)`; la VERDAD granular del ledger (`quantity`) sigue siendo la duración REAL. Ausente
   *  = sin mínimo (se factura la duración exacta). Solo aplica a unidades temporales (`second`/`minute`). */
  minBilledSeconds: z.number().positive().optional(),
});
export type ModelCost = z.infer<typeof ModelCostSchema>;

/**
 * `capabilities` jsonb (§12 l.547): qué puede hacer el modelo. TODO opcional — un tts no tiene
 * `maxDuration` de vídeo, un image no tiene `audio`. El shape es laxo a propósito (los enums
 * exactos de `aspects` son deuda `[verificar]` de §13.1 l.600, no se cierran aquí): se siembra
 * lo que §13.1 da y `unverified` marca lo que aún no se ha contrastado en vivo.
 */
export const ModelCapabilitiesSchema = z.object({
  maxDuration: z.number().positive().optional(),
  refImages: z.number().int().nonnegative().optional(),
  refVideos: z.number().int().nonnegative().optional(),
  refAudios: z.number().int().nonnegative().optional(),
  audio: z.boolean().optional(),
  dialogue: z.boolean().optional(),
  aspects: z.array(z.string()).optional(),
  // ── ENUMS DE DURACIÓN/RESOLUCIÓN DEL MODELO (T4.8, N7d — cierre de deuda §13.1 l.600) ────────────
  // Varios modelos de vídeo de fal NO aceptan duración/resolución libres: exponen un ENUM discreto en
  // su input schema (Veo 3.1 i2v `duration:"4s"|"6s"|"8s"`, R2V fijo `"8s"`; `resolution:"720p"|
  // "1080p"|"4k"`). `durations` guarda esos segundos permitidos (el executor cuantiza el clip contra
  // ellos con `quantizeDurationToEnum`); `resolutions` los presets de resolución. Como `aspects`, son
  // los enums EXACTOS del `model_profile` — el dialecto del modelo vive en el catálogo, no en código.
  /** Duraciones (en SEGUNDOS) que el modelo acepta como enum discreto de entrada. Vacío/ausente = el
   *  modelo toma una duración libre (o no la parametriza). */
  durations: z.array(z.number().positive()).optional(),
  /** Presets de resolución del modelo (`"720p"`, `"1080p"`, `"4k"`), enum exacto de su input schema. */
  resolutions: z.array(z.string()).optional(),
  // ── DIALECTO DE ASPECT DE LA FAMILIA `image-edit` (T4.4b, N7a ruta de referencias) ──────────────
  // Los endpoints edit de fal NO comparten un mismo parámetro de aspect/tamaño de salida:
  //   · seedream v4.5/edit toma `image_size` con un enum de PRESETS (`portrait_16_9` = 9:16 vertical,
  //     misma familia que flux-2);
  //   · nano-banana-2/edit toma `aspect_ratio:"9:16"` (verbatim) + un `resolution` propio.
  // El `imageEditAdapter` NO puede hardcodear ninguno de los dos (rompería el otro) ni ramificar por
  // el string del endpoint (viola `select-adapter`: el dialecto vive en el DATO del catálogo, no en
  // código). Estos dos campos declaran, POR PERFIL, cómo expresa su aspect: `aspectParam` = el nombre
  // de la clave del payload; `aspectValues` = el mapa aspect-canónico (`9:16`) → valor del endpoint
  // (`portrait_16_9`). Ausentes = el perfil no parametriza aspect en el payload (el adapter no lo
  // emite — comportamiento previo a T4.4b, p. ej. nano-banana-pro/edit sin dialecto declarado).
  /** Nombre de la clave del payload que fija el aspect/tamaño de salida (`image_size`, `aspect_ratio`).
   *  Ausente = el modelo no parametriza aspect en el payload (el adapter no lo emite). */
  aspectParam: z.string().optional(),
  /** Mapa aspect-canónico (`"9:16"`) → valor del endpoint (`"portrait_16_9"`). Un aspect declarado en
   *  `aspects` pero ausente aquí se emite VERBATIM (dialecto que usa `9:16` tal cual, p. ej. NB2). */
  aspectValues: z.record(z.string(), z.string()).optional(),
  // ── DIALECTO DEL AVATAR DE LIBRERÍA (T4.7b, N7c ruta VEED) ───────────────────────────────────────
  // `veed/avatars/text-to-video` es text-to-video con AVATAR DE LIBRERÍA: su input exige `avatar_id`
  // (un enum de presets propios de VEED — `emily_vertical_primary`, `marcus_vertical_primary`…), NO la
  // imagen de la Persona. Es un dialecto del modelo (como `aspectValues`): el `avatar_id` a usar vive en
  // el DATO del catálogo, no en código. Ausente = el perfil no es un avatar de librería (Kling/OmniHuman
  // animan una imagen, no llevan `avatar_id`).
  /** El `avatar_id` de librería a usar en el submit (solo modelos avatar text-to-video como VEED). */
  avatarId: z.string().optional(),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

/**
 * Un perfil de modelo del catálogo (§13.1, `model_profile`). Campos REQUERIDOS: `falEndpoint`
 * (clave natural, UNIQUE en BD, target del ON CONFLICT), `kind`, `cost`. `verifiedAt`/`status`
 * NO viven en el seed: los posee `fal:verify` en runtime (mismo criterio que `perf`/`headVersion`
 * de los templates — el seed es la fuente de verdad de lo que el modelo ES; la BD, de cuándo se
 * verificó y si sigue vivo).
 *
 * `unverified` marca los precios/capacidades `[verificar]` de §13.1 l.600 (ace-step, latentsync…):
 * son honestos «no lo hemos contrastado aún», no precisión inventada. `fal:verify` los aclara.
 */
export const ModelProfileSeedSchema = z.object({
  falEndpoint: z.string().min(1),
  kind: ModelKindSchema,
  cost: ModelCostSchema,
  capabilities: ModelCapabilitiesSchema.default({}),
  promptAdapter: z.string().optional(),
  /** `[verificar]` §13.1 l.600: el precio/capacidad declarado es una estimación sin confirmar en vivo. */
  unverified: z.boolean().default(false),
  notes: z.string().optional(),
});
export type ModelProfileSeed = z.infer<typeof ModelProfileSeedSchema>;
