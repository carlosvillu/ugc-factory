// EL CONTRATO DEL EXPORT BUNDLE (T5.7, §9.7 N10 / PRD l.414, §15.4). Un bundle es lo que se DESCARGA
// por variante aprobada: el MP4 del máster + un JSON de metadatos de compliance. Este fichero define la
// forma de ESE JSON — la parte que el validador de la Verificación re-ejecuta LITERAL: `ad_caption`
// (≤100 chars, SIN @/#/links), `brand_name` (≤20), hook/ángulo/duración/objetivo/plataforma, flags AIGC
// (C2PA + disclosure por plataforma), `audio_source` y el checklist §15.4.
//
// POR QUÉ VIVE EN CORE: es una INTERFAZ PÚBLICA de export. La construye la ruta de bundle de `apps/web`
// (T5.7), y su JSON viaja FUERA de la BD (dentro del ZIP que el usuario descarga y sube a Ads Manager) —
// un contrato Zod es la única verdad de su forma. Se valida en el borde (la ruta hace `parse` antes de
// serializar) para que un caption fuera de límites sea un fallo TIPADO, no un JSON roto en el ZIP.
//
// LÍMITES CON MORDIENTE (regla del arnés, principio 9 / anti-happy-path): `ad_caption` y `brand_name` NO
// son `z.string()` a secas — TikTok/Meta rechazan un caption con @/#/links en un ad, y el brand_name tiene
// tope de campo. Los refinements RECHAZAN (no avisan): su test los ejerce en NEGATIVO (@ / # / link / 101
// chars / 21 chars → parse falla), que es lo que hace que el validador verifique algo.
import { z } from 'zod';

import { BatchDestinationSchema, type BatchDestination } from './batch-plan';
import { UlidSchema } from './ids';

/** Tope de `ad_caption` (§9.7 N10 / PRD l.414): ≤100 caracteres. */
export const AD_CAPTION_MAX_LENGTH = 100;
/** Tope de `brand_name` (§9.7 N10 / PRD l.414): ≤20 caracteres. */
export const BRAND_NAME_MAX_LENGTH = 20;

/**
 * Detecta un LINK dentro del caption. «Link» se define CONCRETAMENTE (no una intuición): un esquema
 * `http://`/`https://`, un prefijo `www.`, o un dominio con TLD seguido de `/` o fin (`acme.com/x`,
 * `acme.io`). Deliberadamente conservador — un ad caption no lleva URLs (van en el destino del ad, no en
 * el copy), así que preferimos rechazar de más a colar un link que dispare el rechazo de la plataforma.
 */
const LINK_PATTERN =
  /(https?:\/\/)|(\bwww\.)|(\b[a-z0-9-]+\.(com|net|org|io|co|app|shop|store|link|xyz|me|tv)\b)/i;

/**
 * La forma GLOBAL del patrón de link, para BORRAR todos los links en la derivación provisional (el de
 * validación es non-global: `.test` solo necesita un match). Además de disparar el link, la derivación se
 * come lo que le sigue hasta un espacio (una URL con path: `nuvela.com/oferta` se borra entera, no deja
 * `/oferta`). Se construye a partir del mismo `source` para que validación y borrado NO diverjan. */
const LINK_STRIP_PATTERN = new RegExp(`(?:${LINK_PATTERN.source})\\S*`, 'gi');

/**
 * `ad_caption`: el copy del anuncio (§9.7 N10). ≤100 chars y SIN `@` (menciones), `#` (hashtags) ni links.
 * Regla de plataforma: en un AD, menciones/hashtags/links en el caption disparan rechazo o no se permiten;
 * el copy es texto plano. Los refinements MUERDEN — su control negativo (test) mete `@`/`#`/un link y
 * comprueba que el parse FALLA. `.trim()` no se aplica: 100 es el límite del campo tal cual se publica.
 */
export const AdCaptionSchema = z
  .string()
  .min(1, 'el caption no puede estar vacío')
  .max(AD_CAPTION_MAX_LENGTH, `el caption supera ${String(AD_CAPTION_MAX_LENGTH)} caracteres`)
  .refine((s) => !s.includes('@'), { message: 'el caption no puede contener menciones (@)' })
  .refine((s) => !s.includes('#'), { message: 'el caption no puede contener hashtags (#)' })
  .refine((s) => !LINK_PATTERN.test(s), { message: 'el caption no puede contener enlaces' });
export type AdCaption = z.infer<typeof AdCaptionSchema>;

/** `brand_name`: la marca del anuncio (§9.7 N10). ≤20 chars, no vacío. Sin restricción de caracteres
 *  (una marca puede llevar cualquier símbolo); solo el tope de campo. */
export const BrandNameSchema = z
  .string()
  .min(1, 'la marca no puede estar vacía')
  .max(BRAND_NAME_MAX_LENGTH, `la marca supera ${String(BRAND_NAME_MAX_LENGTH)} caracteres`);
export type BrandName = z.infer<typeof BrandNameSchema>;

/**
 * De dónde sale la pista de audio de fondo de la variante exportada (§14 / §12 `publication.audio_source`).
 * Espeja el enum `audio_source` de la BD (`ai_bed` | `own_license` | `native_trending`) + `none` (variante
 * sin bed, p. ej. la versión SIN bed del export dual). El bundle lo LEE de la variante (columna
 * `ad_variant.audio_source`) para el checklist de compliance; en la versión sin bed del dual es `none`.
 */
export const BundleAudioSourceSchema = z.enum(['none', 'ai_bed', 'own_license', 'native_trending']);
export type BundleAudioSource = z.infer<typeof BundleAudioSourceSchema>;

/**
 * Las FLAGS AIGC del export (§15.3/§15.4): `aigc_disclosure` SIEMPRE `true` (todo lo que produce este
 * pipeline es AIGC — el toggle de TikTok es obligatorio, irreversible tras submit); `c2pa_signed` (el
 * máster lleva el manifest C2PA `trainedAlgorithmicMedia` de T5.5); `meta_ai_label` (la etiqueta «AI info»
 * de Meta — detección automática desde jun-2026 + declaración manual).
 */
export const AigcFlagsSchema = z.object({
  /** §15.4: TikTok `aigc_disclosure: true` — obligatorio e irreversible. Siempre true en este pipeline. */
  aigc_disclosure: z.literal(true),
  /** El máster lleva firma C2PA (`trainedAlgorithmicMedia`, T5.5). */
  c2pa_signed: z.boolean(),
  /** La etiqueta «AI info» de Meta aplica a este export. */
  meta_ai_label: z.literal(true),
});
export type AigcFlags = z.infer<typeof AigcFlagsSchema>;

/**
 * UN ítem del CHECKLIST de compliance por plataforma (§15.4 / PRD l.414: «checklist interactivo por
 * plataforma»). `id` es una clave estable (el bundle y una futura UI de publicación lo referencian);
 * `label` es el paso legible; `platform` acota a qué plataforma aplica (`all` = ambas); `required` marca
 * los pasos innegociables antes del submit (p. ej. activar el toggle AIGC en Ads Manager). NO lleva estado
 * `done`: el bundle EMITE la lista de pasos; marcarlos es de la UI de publicación (F6).
 */
export const ComplianceChecklistItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  platform: z.enum(['all', 'tiktok', 'meta']),
  required: z.boolean(),
});
export type ComplianceChecklistItem = z.infer<typeof ComplianceChecklistItemSchema>;

/**
 * EL JSON DEL EXPORT BUNDLE (§9.7 N10 / PRD l.414, §15.4). Lo que acompaña al MP4 en el bundle descargable.
 * `variant_id`/`filename_code` identifican; `ad_caption`/`brand_name` son los campos CON LÍMITES; el resto
 * es la ficha de compliance (hook/ángulo/duración/objetivo/plataforma, flags AIGC, audio_source, checklist).
 * `audio_version` distingue las dos salidas del export dual (§14): `with_bed` (orgánico) y `no_bed` (paid).
 */
export const ExportBundleMetadataSchema = z.object({
  variant_id: UlidSchema,
  filename_code: z.string().min(1),
  ad_caption: AdCaptionSchema,
  brand_name: BrandNameSchema,
  /** Etiqueta del hook (§9.7 N10: «hook label»). El texto del hook line que protagoniza la variante. */
  hook: z.string().min(1),
  /** El ángulo (`ad_variant.angle_name`). */
  angle: z.string().min(1),
  /** Duración objetivo en segundos (`ad_variant.duration_target`). */
  duration_seconds: z.number().int().positive(),
  /** El objetivo del lote (`ad_batch.objective`). */
  objective: z.enum(['hook_test', 'conversion', 'story']),
  /** Las plataformas de destino de la variante (`ad_variant.platform_targets`). */
  platforms: z.array(z.string().min(1)),
  /** El destino del lote (§14): decide la(s) versión(es) de audio del export dual. */
  destination: BatchDestinationSchema,
  /** Cuál de las dos salidas del export dual es este JSON: con bed (orgánico) o sin bed (paid). */
  audio_version: z.enum(['with_bed', 'no_bed']),
  /** De dónde sale el audio de fondo de ESTA versión (`none` en la versión sin bed). */
  audio_source: BundleAudioSourceSchema,
  aigc: AigcFlagsSchema,
  checklist: z.array(ComplianceChecklistItemSchema),
});
export type ExportBundleMetadata = z.infer<typeof ExportBundleMetadataSchema>;

/**
 * CONSTRUYE el checklist de compliance por plataforma (§15.4). PURA y determinista: de las plataformas de
 * destino + el `audio_source` sale la lista de pasos. Los pasos base (AIGC + C2PA) aplican a todo export;
 * los específicos se añaden según plataforma (TikTok: toggle AIGC en Ads Manager + re-verificar en
 * duplicados, §15.4; Meta: etiqueta «AI info») y según audio (`native_trending` en paid es un BLOQUEO de
 * §14 — un Spark Ad no admite audio nativo/trending; el paso lo marca `required` para que la UI lo enfrente).
 *
 * Los `id` son claves ESTABLES (una futura UI de publicación referencia por id, no por texto). El bundle
 * EMITE los pasos; marcarlos «hechos» es de F6. `platforms` se normaliza a minúsculas para el match.
 */
export function buildComplianceChecklist(args: {
  platforms: readonly string[];
  audioSource: BundleAudioSource;
  destination: BatchDestination;
}): ComplianceChecklistItem[] {
  const platforms = args.platforms.map((p) => p.toLowerCase());
  const hasTikTok = platforms.some((p) => p.includes('tiktok'));
  const hasMeta = platforms.some((p) => p.includes('meta') || p.includes('instagram'));
  const items: ComplianceChecklistItem[] = [];

  // Base: aplica a todo export (§15.3/§15.4).
  items.push({
    id: 'aigc_disclosure',
    label: 'Declarar el contenido como generado por IA (disclosure AIGC obligatorio)',
    platform: 'all',
    required: true,
  });
  items.push({
    id: 'c2pa_present',
    label: 'Verificar la firma C2PA (trainedAlgorithmicMedia) en el máster antes de subir',
    platform: 'all',
    required: true,
  });

  if (hasTikTok) {
    // §15.4: el toggle AIGC de TikTok es obligatorio e irreversible tras submit, y DUPLICAR una campaña
    // lo RESETEA → re-verificar en cada ad duplicado.
    items.push({
      id: 'tiktok_aigc_toggle',
      label: 'Activar el toggle «Contenido generado por IA» en TikTok Ads Manager antes del submit',
      platform: 'tiktok',
      required: true,
    });
    items.push({
      id: 'tiktok_duplicate_recheck',
      label: 'Al duplicar una campaña en TikTok, RE-VERIFICAR el toggle AIGC (duplicar lo resetea)',
      platform: 'tiktok',
      required: true,
    });
  }

  if (hasMeta) {
    items.push({
      id: 'meta_ai_info_label',
      label: 'Declarar la etiqueta «AI info» en Meta antes de publicar el ad',
      platform: 'meta',
      required: true,
    });
  }

  // §14: audio según destino. Un Spark Ad / ad pagado NO admite audio nativo/trending.
  if (args.destination !== 'organic' && args.audioSource === 'native_trending') {
    items.push({
      id: 'paid_native_audio_block',
      label:
        'BLOQUEO: el audio nativo/trending no está permitido en ads pagados (§14) — usar la versión sin bed o música con licencia comercial',
      platform: 'all',
      required: true,
    });
  }

  return items;
}

/**
 * DERIVA un `ad_caption` PROVISIONAL desde el texto del hook (T5.7, desviación menor regla 6). ⚠ HOY NO
 * EXISTE un generador de copy de anuncio: N10/publicación es F6 y `ad_caption` no tiene productor. Para que
 * el bundle emita un caption VÁLIDO (dentro de límites, sin @/#/links) mientras tanto, se deriva del hook —
 * que es de donde nace el copy de un ad. La derivación:
 *   1. quita `@`/`#` (menciones/hashtags no van en el caption de un ad) y colapsa espacios;
 *   2. quita cualquier link (mismo patrón que `AdCaptionSchema` rechaza);
 *   3. TRUNCA a `AD_CAPTION_MAX_LENGTH` (cortando en el último espacio para no partir una palabra).
 * El resultado PASA `AdCaptionSchema` por construcción — NO es un happy-path que evade el validador: la ruta
 * lo `parse`a igual, así que si esta derivación alguna vez produjera algo inválido, el borde lo caza.
 *
 * Cuando F6 cablee el generador de copy real, `ad_caption` vendrá de ÉL y esta derivación desaparecerá.
 */
export function deriveProvisionalCaption(hookText: string): string {
  let s = hookText
    .replace(LINK_STRIP_PATTERN, ' ') // links PRIMERO (antes de tocar @/#, que pueden formar parte de una URL)
    .replace(/[@#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > AD_CAPTION_MAX_LENGTH) {
    const cut = s.slice(0, AD_CAPTION_MAX_LENGTH);
    const lastSpace = cut.lastIndexOf(' ');
    s = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
  }
  // Garantía mínima: si tras limpiar quedó vacío (hook todo símbolos), un placeholder no vacío y válido.
  return s.length > 0 ? s : 'Anuncio generado con IA';
}

/**
 * DERIVA un `brand_name` desde el brief (T5.7): `product_brief.brand_name` o, si es null, `product_brief.name`
 * (una variante siempre tiene nombre de producto). TRUNCA a `BRAND_NAME_MAX_LENGTH`. PASA `BrandNameSchema`
 * por construcción. `brand_name` SÍ tiene productor real (el brief), a diferencia del caption — pero la
 * truncación al tope de campo se centraliza aquí para no repetirla en la ruta.
 */
export function deriveBrandName(brief: { brand_name?: string | null; name: string }): string {
  const raw = (brief.brand_name ?? brief.name).trim();
  const truncated = raw.slice(0, BRAND_NAME_MAX_LENGTH).trim();
  return truncated.length > 0 ? truncated : 'Marca';
}

/** La `audio_version` del export dual (§14): `with_bed` (orgánico) | `no_bed` (paid). */
export type AudioVersion = 'with_bed' | 'no_bed';

/**
 * ENSAMBLA el JSON del bundle (§9.7 N10 / §15.4) desde el linaje de la variante + el brief + la versión de
 * audio, y lo VALIDA con `ExportBundleMetadataSchema`. Centraliza el mapeo (linaje→metadata) y la derivación
 * de caption/brand_name para que la ruta de apps/web no lo re-implemente. LANZA (vía `parse`) si algo quedara
 * fuera de contrato — el borde muerde igual, la derivación no lo evade.
 *
 * `audioSourceForVersion`: en `no_bed` el audio de fondo es `none` (sin bed); en `with_bed` es el
 * `audio_source` real de la variante (o `none` si no lo tiene). El caller pasa el `audioSource` de la variante.
 */
export function buildExportBundleMetadata(input: {
  variantId: string;
  filenameCode: string;
  hookText: string;
  angleName: string;
  durationSeconds: number;
  objective: 'hook_test' | 'conversion' | 'story';
  platforms: readonly string[];
  destination: BatchDestination;
  audioVersion: AudioVersion;
  /** El `audio_source` de la variante (`ai_bed`/`own_license`/`native_trending`) o null. */
  variantAudioSource: BundleAudioSource | null;
  c2paSigned: boolean;
  brief: { brand_name?: string | null; name: string };
}): ExportBundleMetadata {
  // En la versión sin bed no hay audio de fondo → `none`. En la con bed, el de la variante (o `none`).
  const audioSource: BundleAudioSource =
    input.audioVersion === 'no_bed' ? 'none' : (input.variantAudioSource ?? 'none');

  const metadata: ExportBundleMetadata = {
    variant_id: input.variantId,
    filename_code: input.filenameCode,
    ad_caption: deriveProvisionalCaption(input.hookText),
    brand_name: deriveBrandName(input.brief),
    hook: input.hookText,
    angle: input.angleName,
    duration_seconds: input.durationSeconds,
    objective: input.objective,
    platforms: [...input.platforms],
    destination: input.destination,
    audio_version: input.audioVersion,
    audio_source: audioSource,
    aigc: { aigc_disclosure: true, c2pa_signed: input.c2paSigned, meta_ai_label: true },
    checklist: buildComplianceChecklist({
      platforms: input.platforms,
      audioSource,
      destination: input.destination,
    }),
  };
  // `parse` (no `safeParse`): si la derivación produjera algo inválido (nunca, por construcción), es un BUG
  // que debe explotar, no un JSON roto en el ZIP.
  return ExportBundleMetadataSchema.parse(metadata);
}
