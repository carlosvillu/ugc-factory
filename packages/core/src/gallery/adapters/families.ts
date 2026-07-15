// LOS ADAPTERS POR FAMILIA (T3.6). Cada función transforma el prompt canónico + assets al dialecto
// del endpoint, respetando `capabilities`. Puras, deterministas, sin red, no lanzan.
//
// LAS FAMILIAS (valor de `model_profile.promptAdapter`, dispatch en `select-adapter.ts`):
//   - `avatar`     → avatares parlantes con identity lock por imagen de referencia + voice control
//                    (Kling ai-avatar, OmniHuman, VEED). El de Kling incluye la imagen de
//                    referencia cuando `capabilities.refImages > 0`.
//   - `i2v`        → image-to-video / b-roll con audio (Veo 3.1; Wan comparte dialecto — 404 en fal
//                    HOY, no sembrado, cubierto por el mismo adapter cuando F4 lo integre).
//   - `seedance`   → familia Seedance con la sintaxis `@image/@video/@audio` en el prompt (404 en
//                    fal HOY, no sembrado: se testea con un FIXTURE de model_profile).
//   - `image-edit` → edición de imagen con referencias (Seedream v4.5 edit, Nano-Banana 2 edit).
//
// Todos usan `resolveAspect` (aspect ∈ capabilities.aspects) y recortan los refs a la capacidad
// declarada. El aspect/duración usan los NOMBRES y ENUMS EXACTOS del `model_profile` (assert (c)).
import type { AdapterInput, AdapterIssue, AdapterPayload, AdapterResult } from './types';

/** Valida el aspect contra `capabilities.aspects`. Si el profile declara `aspects` y el pedido no
 *  está, es `aspect_unsupported` (accionable, NO clamp silencioso). Si el profile no declara
 *  `aspects`, cualquier aspect pasa (el modelo no restringe). Devuelve el aspect EXACTO tal cual lo
 *  declara el model_profile (assert (c): "los nombres y enums exactos del model_profile"). */
function resolveAspect(input: AdapterInput): { aspect: string } | { issue: AdapterIssue } {
  const declared = input.profile.capabilities.aspects;
  if (declared === undefined || declared.length === 0) {
    return { aspect: input.aspect };
  }
  if (!declared.includes(input.aspect)) {
    return {
      issue: {
        code: 'aspect_unsupported',
        message: `El aspect "${input.aspect}" no está soportado por ${input.profile.falEndpoint}: aspects válidos = [${declared.join(', ')}].`,
      },
    };
  }
  return { aspect: input.aspect };
}

/** Los primeros `max` refs (o [] si max es 0/undefined). El corte a la CAPACIDAD del modelo es la
 *  regla dura: un modelo con refImages:1 usa la primera imagen; refImages:0/ausente, ninguna. */
function takeRefs(refs: string[] | undefined, max: number | undefined): string[] {
  if (refs === undefined || max === undefined || max <= 0) return [];
  return refs.slice(0, max);
}

/**
 * ADAPTER `avatar` (Kling ai-avatar, OmniHuman, VEED). Avatar parlante: prompt + imagen de
 * referencia (identity lock) cuando `capabilities.refImages > 0` (assert (a)) + voice control
 * cuando el modelo lleva audio/dialogue. El aspect usa el enum exacto del profile.
 */
export function avatarAdapter(input: AdapterInput): AdapterResult {
  const aspectRes = resolveAspect(input);
  if ('issue' in aspectRes) return { ok: false, issues: [aspectRes.issue] };

  const caps = input.profile.capabilities;
  const refImages = takeRefs(input.assets?.refImages, caps.refImages);
  const refAudios = takeRefs(input.assets?.refAudios, caps.refAudios);

  const payload: AdapterPayload = {
    prompt: input.resolvedPrompt,
    aspect_ratio: aspectRes.aspect,
    duration_seconds: input.durationSeconds,
  };
  // Identity lock: SOLO cuando el modelo declara refImages > 0 Y hay una imagen (assert (a) +
  // control negativo: refImages:0/ausente ⇒ sin `image_url`).
  if (refImages.length > 0) {
    payload.image_url = refImages[0];
  }
  // Voice control: los avatares con audio/dialogue reciben la pista de voz (lipsync a la narración).
  if (caps.audio === true || caps.dialogue === true) {
    payload.enable_audio = true;
    if (refAudios.length > 0) {
      payload.audio_url = refAudios[0];
    }
  }
  return { ok: true, payload };
}

/**
 * ADAPTER `i2v` (Veo 3.1; Wan comparte dialecto). Image-to-video / b-roll: prompt + imagen inicial
 * (keyframe) cuando el modelo acepta refImages, aspect y duración exactos, audio si lo declara.
 */
export function i2vAdapter(input: AdapterInput): AdapterResult {
  const aspectRes = resolveAspect(input);
  if ('issue' in aspectRes) return { ok: false, issues: [aspectRes.issue] };

  const caps = input.profile.capabilities;
  // Veo3.1 no declara refImages en el catálogo; si un profile i2v lo declara, se inyecta la
  // keyframe inicial. Con refImages ausente/0, i2v corre como t2v (solo prompt).
  const refImages = takeRefs(input.assets?.refImages, caps.refImages);

  const payload: AdapterPayload = {
    prompt: input.resolvedPrompt,
    aspect_ratio: aspectRes.aspect,
    duration_seconds: input.durationSeconds,
  };
  if (refImages.length > 0) {
    payload.image_url = refImages[0];
  }
  if (caps.audio === true) {
    payload.generate_audio = true;
  }
  return { ok: true, payload };
}

/**
 * ADAPTER `seedance` (familia Seedance 2.0). Su dialecto usa la sintaxis `@image/@video/@audio`
 * EN el texto del prompt para referenciar los assets posicionalmente (assert (b)). El adapter
 * PREFIJA el prompt canónico con los tokens `@image`/`@video`/`@audio` por cada ref que el modelo
 * acepta (`capabilities.refImages/refVideos/refAudios`) y pasa las URLs en un array paralelo.
 *
 * ⚠ Seedance da 404 en fal HOY (T3.4): NO está sembrado. Se testea con un FIXTURE de model_profile
 * de la familia — el model_profile es INPUT del transform también en producción (viene del catálogo).
 */
export function seedanceAdapter(input: AdapterInput): AdapterResult {
  const aspectRes = resolveAspect(input);
  if ('issue' in aspectRes) return { ok: false, issues: [aspectRes.issue] };

  const caps = input.profile.capabilities;
  const refImages = takeRefs(input.assets?.refImages, caps.refImages);
  const refVideos = takeRefs(input.assets?.refVideos, caps.refVideos);
  const refAudios = takeRefs(input.assets?.refAudios, caps.refAudios);

  // La sintaxis Seedance: cada asset se referencia con su token `@image`/`@video`/`@audio` al
  // frente del prompt, en orden de tipo. Las URLs viajan en `reference_*` paralelos.
  const tokens: string[] = [
    ...refImages.map(() => '@image'),
    ...refVideos.map(() => '@video'),
    ...refAudios.map(() => '@audio'),
  ];
  const prompt =
    tokens.length > 0 ? `${tokens.join(' ')} ${input.resolvedPrompt}` : input.resolvedPrompt;

  const payload: AdapterPayload = {
    prompt,
    aspect_ratio: aspectRes.aspect,
    duration_seconds: input.durationSeconds,
  };
  if (refImages.length > 0) payload.reference_images = refImages;
  if (refVideos.length > 0) payload.reference_videos = refVideos;
  if (refAudios.length > 0) payload.reference_audios = refAudios;
  return { ok: true, payload };
}

/**
 * ADAPTER `image-edit` (Seedream v4.5 edit, Nano-Banana 2 edit). Edición de imagen guiada por
 * referencias (packshots del producto): prompt + hasta `capabilities.refImages` imágenes de
 * referencia. No lleva duración/aspect de vídeo; el aspect (si el modelo lo declara) fija el ratio
 * de salida. Es `kind: image`, no vídeo.
 */
export function imageEditAdapter(input: AdapterInput): AdapterResult {
  const aspectRes = resolveAspect(input);
  if ('issue' in aspectRes) return { ok: false, issues: [aspectRes.issue] };

  const caps = input.profile.capabilities;
  const refImages = takeRefs(input.assets?.refImages, caps.refImages);

  const payload: AdapterPayload = {
    prompt: input.resolvedPrompt,
  };
  if (refImages.length > 0) {
    payload.image_urls = refImages;
  }
  return { ok: true, payload };
}
