// El CONTRATO DEL RENDERER (T5.3, §9.7): `CompositionSpec` describe QUÉ ensamblar en el máster de una
// variante — los segmentos hook/body/cta (vídeo + voz por segmento), el bed musical y su mezcla
// (volumen, ducking, fade-out), y el perfil de salida. Es lo que persiste `ad_variant.composition_spec`
// (§12, jsonb) y lo que el módulo de composición (`@ugc/services` → `compose-master`) consume para el
// concat + la mezcla de audio.
//
// POR QUÉ VIVE EN CORE (patrón step-outputs): `composition_spec` es una INTERFAZ PÚBLICA. La escribe el
// orquestador de render (T5.5), la lee el módulo de composición (`@ugc/services`) y la relee el panel de
// la UI — y `apps/web` NO puede importar de `apps/worker` (composition roots hermanos). Un contrato Zod
// en core es la ÚNICA verdad de su forma; la columna jsonb es opaca hasta que este schema la parsea.
//
// REFERENCIAS A ASSETS POR `assetId` (ULID), no por storageKey: es la convención de los otros artefactos
// cross-node (`N7aShotRef.assetId`, `N7bClipRef.assetId`). El spec es la forma DURABLE que se persiste;
// la resolución `assetId → storageKey` es I/O de la BD y la hace el caller (T5.5) — el módulo de
// composición la recibe inyectada, no la codifica.
//
// ALCANCE DE T5.3 (decisión de la tarea): `segments` + `music` + `output`. `captions` se DIFIERE a T5.4
// (su autor posee el generador ASS que lo consume y conoce su shape real; el PRD lo deja subespecificado).
// Añadir `captions` luego es ADITIVO (es null/ausente en el máster intermedio de T5.3). Los campos
// `voWords`/`overlayText` de cada segmento SÍ viajan ya (los alimenta T5.4), pero laxos: T5.3 no los
// consume, solo los transporta.
import { z } from 'zod';

import { AdSegmentSchema } from './batch-plan';
import { UlidSchema } from './ids';
// El shape REAL de los word timestamps (T4.5). T5.4 es su consumidor (generador ASS karaoke) → se estrecha
// aquí `voWords` de laxo a este schema. Import DIRECTO del módulo (no del barrel `@ugc/core/generation`)
// para no arrastrar el FalClient/red a un contrato puro (mismo criterio que evita ciclos en core).
import { WordTimestampsSchema } from '../generation/word-timestamps';

/**
 * UN segmento del máster: su clip de vídeo (YA normalizado por T5.2 → el `-c copy` del concat es válido) y
 * su voz. `voWords`/`overlayText` viajan para T5.4 (subtítulos karaoke + overlay), que es su consumidor;
 * T5.3 solo concatena vídeo + mezcla voz, así que ambos son OPCIONALES y LAXOS aquí (no se validan contra
 * un shape que aún no existe — lo fijará T5.4 cuando tenga el generador ASS).
 */
export const CompositionSegmentSchema = z.object({
  /** hook | body | cta (§9.7). Reusa `AdSegmentSchema` (la MISMA verdad del dominio que usan el
   *  estimador y el script-writer) — un segundo enum del mismo triple podría divergir. El orden del
   *  array es el orden temporal del concat. */
  type: AdSegmentSchema,
  /** El asset del CLIP DE VÍDEO normalizado de este segmento (ULID). Se concatena con `-c copy`. */
  videoAsset: UlidSchema,
  /** El asset del VOICEOVER de este segmento (ULID). Se mezcla como pista de voz. */
  voAudio: UlidSchema,
  /** Word timestamps del voiceover (T4.5) — los consume T5.4 (generador ASS karaoke). ESTRECHADO a
   *  `WordTimestampsSchema` ahora que T5.4 (su consumidor) fija el shape: el generador filtra `type:'word'`
   *  y convierte los tiempos (segundos → centisegundos) para los tags `\k`. Opcional: una variante sin
   *  captions no lo lleva. */
  voWords: WordTimestampsSchema.optional(),
  /** Texto de overlay del segmento — lo consume T5.4. No se quema en T5.3 (máster intermedio sin burn-in). */
  overlayText: z.string().optional(),
});
export type CompositionSegment = z.infer<typeof CompositionSegmentSchema>;

/** El VOLUMEN del bed musical bajo la voz (§9.7: 0,2–0,3). Fuera de ese rango el bed tapa la voz o es
 *  inaudible; el rango es un invariante de mezcla, no una preferencia libre. */
export const MUSIC_VOLUME_MIN = 0.2;
export const MUSIC_VOLUME_MAX = 0.3;

/**
 * El BED MUSICAL y su mezcla (§9.7): `asset` (ULID del bed, o `null` si la variante no lleva música),
 * `volume` en [0,2 – 0,3], `ducking` (aplicar `sidechaincompress` para hundir el bed bajo la voz) y
 * `fadeOutS` (segundos de `afade` out al final). Es NULLABLE entero: una variante sin bed pasa `music:null`
 * y el máster sale solo con voz.
 */
export const CompositionMusicSchema = z.object({
  /** El asset del bed musical (ULID), o `null` si la variante no lleva música. */
  asset: UlidSchema.nullable(),
  /** Volumen del bed bajo la voz, en [0,2 – 0,3] (§9.7). */
  volume: z.number().min(MUSIC_VOLUME_MIN).max(MUSIC_VOLUME_MAX),
  /** ¿Aplicar ducking (`sidechaincompress`) para hundir el bed cuando entra la voz? */
  ducking: z.boolean(),
  /** Segundos de fade-out (`afade`) al final del bed. 0 = sin fade. */
  fadeOutS: z.number().min(0),
});
export type CompositionMusic = z.infer<typeof CompositionMusicSchema>;

/** El PERFIL DE SALIDA del máster (§9.7 / Apéndice C): 1080×1920, 30 fps. `maxDurationS` es el techo de
 *  duración de la variante (el QA de T5.5 lo valida). Los valores canónicos son literales fijos (TikTok/
 *  Meta rechazan desviaciones) con default. */
export const CompositionOutputSchema = z.object({
  width: z.literal(1080).default(1080),
  height: z.literal(1920).default(1920),
  fps: z.literal(30).default(30),
  /** Duración máxima permitida del máster (segundos). Positivo. */
  maxDurationS: z.number().positive(),
});
export type CompositionOutput = z.infer<typeof CompositionOutputSchema>;

/** El PRESET de subtítulos (§9.7): `karaoke` (1–4 palabras/página, word-highlight `\k`) o `subtitle`
 *  (3–7 palabras/2 líneas, sin karaoke). Lo consume el generador ASS de T5.4. */
export const CaptionStyleSchema = z.enum(['karaoke', 'subtitle']);
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

/** La PLATAFORMA que decide el ESTILO visual (no la safe zone, que en T5.4 es siempre la universal):
 *  `universal`/`tiktok` → contorno; `reels` → caja opaca (`BorderStyle=3`, §9.7). Las safe zones por
 *  plataforma son T8.3. */
export const CaptionPlatformSchema = z.enum(['universal', 'tiktok', 'reels']);
export type CaptionPlatform = z.infer<typeof CaptionPlatformSchema>;

/**
 * LOS SUBTÍTULOS del máster (§9.7 / Apéndice C) — sub-schema AÑADIDO por T5.4 (su autor posee el generador
 * ASS que lo consume). Es OPCIONAL/nullable en el spec: el máster intermedio de T5.3 no lleva captions.
 * `position` es un CONSTRAINT de layout dentro de la safe zone: hoy solo `safe_zone` (el generador ancla
 * el texto en la safe zone universal); se deja como enum para admitir presets por plataforma en T8.3 sin
 * romper el contrato.
 */
export const CompositionCaptionsSchema = z.object({
  /** Preset de subtítulos: karaoke | subtitle (§9.7). */
  style: CaptionStyleSchema,
  /** Máx. de palabras por página. Se clampa al rango del preset en el generador (karaoke 1–4, subtitle
   *  3–7). Positivo entero. */
  maxWordsPerPage: z.number().int().positive(),
  /** La plataforma que fija el estilo (contorno vs caja opaca). Default universal. */
  platform: CaptionPlatformSchema.default('universal'),
  /** Constraint de posición: `safe_zone` = anclar dentro del área útil universal (§9.7, Apéndice C). */
  position: z.enum(['safe_zone']).default('safe_zone'),
});
export type CompositionCaptions = z.infer<typeof CompositionCaptionsSchema>;

/**
 * EL CONTRATO DEL RENDERER (§9.7): lo que se ensambla en el máster de una variante. `segments` NO puede
 * estar vacío (un máster sin segmentos no es un máster). `captions` es ADITIVO (T5.4): opcional/nullable,
 * el máster intermedio de T5.3 lo deja ausente. Se persiste en `ad_variant.composition_spec` (jsonb).
 */
export const CompositionSpecSchema = z.object({
  segments: z.array(CompositionSegmentSchema).min(1),
  /** El bed musical + su mezcla, o `null` si la variante no lleva música. */
  music: CompositionMusicSchema.nullable(),
  output: CompositionOutputSchema,
  /** Los subtítulos, o `null`/ausente si la variante no lleva captions (máster intermedio de T5.3). */
  captions: CompositionCaptionsSchema.nullable().optional(),
});
export type CompositionSpec = z.infer<typeof CompositionSpecSchema>;
