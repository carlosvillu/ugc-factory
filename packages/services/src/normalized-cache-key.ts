// Derivación PURA (sin I/O) de la `normalized_cache_key` de la caché normalize-once del render
// (T5.2, §9.7). Vive en su PROPIO módulo —separado del normalizador que hace spawn de ffmpeg— para que
// su unit test co-locado corra en la suite `services:unit` del gate SIN arrastrar ffmpeg (el gate NO
// corre los tests media). Es CRÍTICO que el gate cubra esta función: es el contrato de la caché, y un
// bug aquí (dos perfiles distintos colapsando a la misma key) envenenaría la caché en silencio y cada
// re-render pagaría encodes completos sin que nadie lo note hasta la factura de tiempo.
//
// LA CLAVE = `checksum-del-asset-ORIGEN + parámetros del perfil de salida`. §9.7 l.407: «un normalizado
// por combinación asset×perfil de salida». Dos perfiles distintos del MISMO origen → DOS keys distintas
// → dos filas `asset` que coexisten (necesario para los renders por plataforma y el preset HQ 1440×2560
// de F8). Por eso el perfil entra ENTERO en la key hoy, aunque solo se siembre el perfil canónico.
import { createHash } from 'node:crypto';

/**
 * VERSIÓN DE LA RECETA de normalización. Constante BUMPEABLE: súbela cuando cambie la SEMÁNTICA del
 * encode (el filtergraph, el preset x264, el mapeo de audio…) de forma que un asset ya normalizado con
 * la receta vieja NO sea equivalente al que produciría la receta nueva. Bumpear invalida la caché de
 * forma limpia (las keys viejas dejan de casar; los normalizados nuevos se crean con la key nueva; los
 * viejos quedan huérfanos, recolectables aparte) SIN tocar checksums ni tablas. Cambiar un PARÁMETRO del
 * perfil (otra resolución/fps/CRF) ya cambia la key por sí solo; la versión cubre los cambios que NO se
 * reflejan en un parámetro (p. ej. reordenar los filtros con el mismo resultado nominal pero distinto
 * output byte a byte).
 */
export const NORMALIZE_RECIPE_VERSION = 1;

/**
 * El PERFIL DE SALIDA de una normalización: todo lo que, junto al origen, determina los bytes del
 * normalizado. Entra ÍNTEGRO en la key. `mediaKind` separa el espacio de keys de vídeo del de audio (un
 * mismo origen con audio embebido produce DOS normalizados —el vídeo `-an` y la voz canónica— y sus keys
 * NO deben colisionar). Los campos de vídeo (`width`/`height`/`fps`/`crf`) son irrelevantes para el
 * perfil de audio, pero se incluyen tal cual: la key es una huella del objeto perfil completo, no una
 * selección condicional (más simple y sin ramas que se puedan desincronizar).
 */
export interface NormalizeProfile {
  /** `video` (encode 1080×1920 `-an`) o `audio` (pista canónica AAC 48k estéreo). Separa los espacios
   *  de key: el vídeo `-an` y la voz extraída del MISMO clip son dos normalizados distintos. */
  readonly mediaKind: 'video' | 'audio';
  /** Ancho del vídeo normalizado (canónico: 1080). */
  readonly width: number;
  /** Alto del vídeo normalizado (canónico: 1920). */
  readonly height: number;
  /** Frame rate del vídeo normalizado (canónico: 30). */
  readonly fps: number;
  /** Códec de vídeo (canónico: `h264`). */
  readonly videoCodec: string;
  /** Constant Rate Factor de x264 (canónico: 23). */
  readonly crf: number;
  /** Códec de audio (canónico: `aac`). */
  readonly audioCodec: string;
  /** Sample rate del audio en Hz (canónico: 48000). */
  readonly audioSampleRate: number;
  /** Canales de audio (canónico: 2 = estéreo). */
  readonly audioChannels: number;
  /** Si el encode aplica autorotación por los metadatos de rotación del origen (§9.7). */
  readonly autorotate: boolean;
}

/** El PERFIL CANÓNICO de salida (Apéndice C del PRD): el máster 1080×1920/30fps/H.264 CRF23 + AAC 48k
 *  estéreo. Es el único perfil sembrado hoy; F8 añadirá perfiles por plataforma/HQ SIN tocar esta
 *  función (solo pasando otro `NormalizeProfile`, que ya produce otra key). El `mediaKind` se sobrescribe
 *  por rama (vídeo vs audio) en el normalizador. */
export const CANONICAL_VIDEO_PROFILE: NormalizeProfile = {
  mediaKind: 'video',
  width: 1080,
  height: 1920,
  fps: 30,
  videoCodec: 'h264',
  crf: 23,
  audioCodec: 'aac',
  audioSampleRate: 48_000,
  audioChannels: 2,
  autorotate: true,
};

/** El perfil canónico para una PISTA DE AUDIO (AAC 48k estéreo): mismo objeto, `mediaKind:'audio'`. */
export const CANONICAL_AUDIO_PROFILE: NormalizeProfile = {
  ...CANONICAL_VIDEO_PROFILE,
  mediaKind: 'audio',
};

/**
 * Computa la `normalized_cache_key` DETERMINISTA de un asset origen bajo un perfil de salida.
 * Determinista: misma entrada → misma key (huella sha256 de una serialización CANÓNICA con las claves
 * ORDENADAS, para que el orden de propiedades del objeto no altere la key). Cambiar CUALQUIER parámetro
 * del perfil —o la versión de receta— cambia la key. `sourceChecksum` es el sha256 del asset ORIGEN (no
 * el del normalizado, que aún no existe): dos assets con el mismo contenido comparten normalizado, que es
 * justo el punto de la caché.
 */
export function computeNormalizedCacheKey(args: {
  sourceChecksum: string;
  profile: NormalizeProfile;
  recipeVersion?: number;
}): string {
  const recipeVersion = args.recipeVersion ?? NORMALIZE_RECIPE_VERSION;
  const p = args.profile;
  // Serialización CANÓNICA: claves en orden fijo y explícito (no `JSON.stringify(objeto)`, cuyo orden
  // depende del orden de inserción de propiedades y podría divergir entre callers). Cada campo del perfil
  // + la versión de receta + el checksum del origen participan en la huella.
  const canonical = JSON.stringify({
    v: recipeVersion,
    src: args.sourceChecksum,
    mediaKind: p.mediaKind,
    width: p.width,
    height: p.height,
    fps: p.fps,
    videoCodec: p.videoCodec,
    crf: p.crf,
    audioCodec: p.audioCodec,
    audioSampleRate: p.audioSampleRate,
    audioChannels: p.audioChannels,
    autorotate: p.autorotate,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
