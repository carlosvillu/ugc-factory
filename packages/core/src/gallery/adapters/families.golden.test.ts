// GOLDEN PAYLOADS + ASSERTS SEMÁNTICOS de los MODEL ADAPTERS (T3.6, Verificación).
//
// Los goldens comparan el JSON EXACTO enviado a cada endpoint (claves ORDENADAS para diffs
// legibles) carácter a carácter contra un fichero versionado (patrón unit-core.md §2). PERO los
// goldens SOLOS son autorreferenciales (lo dice la Verificación): los acompañan asserts SEMÁNTICOS
// que comprueban la PROPIEDAD, no solo la igualdad byte-a-byte:
//   (a) Kling incluye la imagen de referencia cuando `capabilities.refImages > 0` (+ control
//       negativo: refImages ausente/0 ⇒ SIN ref image);
//   (b) Seedance usa la sintaxis `@image/@video/@audio` (contra un FIXTURE de profile: Seedance da
//       404 en fal HOY y NO está sembrado — T3.4);
//   (c) aspect/duración usan los NOMBRES y ENUMS EXACTOS del `model_profile` (contra el catálogo
//       REAL sembrado: veo3.1 aspects ["9:16","16:9"]);
//   (d) el troceo de escenas §7.5 lo cubre `scene-planner.test.ts` (plan de generación).
//
// Los profiles REALES salen del seed sembrado (T3.4), no de un fixture: los asserts (a)(c) muerden
// contra `capabilities` reales. Regeneración de goldens SOLO con UPDATE_GOLDEN=1.
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';
import { expectGolden } from '@ugc/test-utils';
import { validateGallerySeed, RAW_GALLERY_SEED } from '../index';
import type { ModelProfileSeed } from '../contracts';
import { adaptToPayload } from './select-adapter';
import { avatarAdapter, i2vAdapter, imageEditAdapter, seedanceAdapter } from './families';
import type { AdapterInput, AdapterPayload } from './types';

// ── El catálogo REAL sembrado (T3.4): los asserts (a)(c) muerden contra capabilities reales. ──
function seededProfiles(): ModelProfileSeed[] {
  const validation = validateGallerySeed(RAW_GALLERY_SEED);
  if (!validation.ok || !validation.seed) throw new Error('el seed de galería no valida');
  return validation.seed.modelProfiles;
}
const profiles = seededProfiles();
const byEndpoint = (endpoint: string): ModelProfileSeed => {
  const p = profiles.find((x) => x.falEndpoint === endpoint);
  if (!p) throw new Error(`profile no sembrado: ${endpoint}`);
  return p;
};

// ── FIXTURE de model_profile de la familia SEEDANCE (404 en fal HOY → NO sembrado, T3.4). Es un
// INPUT del transform (en producción viene del catálogo): construirlo a mano es unit testing, no
// un hand-fix (principio 9 de testing: el model_profile es input también en producción). ──
const SEEDANCE_FIXTURE: ModelProfileSeed = {
  falEndpoint: 'fal-ai/bytedance/seedance/v2/text-to-video',
  kind: 'i2v',
  cost: { unit: 'second', amountCents: 10 },
  capabilities: { refImages: 1, refVideos: 1, refAudios: 1, aspects: ['9:16', '16:9'] },
  promptAdapter: 'seedance',
  unverified: true,
  notes: 'FIXTURE de test — Seedance da 404 en fal HOY (T3.4). NO sembrado.',
};

const CANONICAL_PROMPT =
  'A creator in a bright bathroom applies the serum to camera.\n\nFidelity: preserve the product label.';
const PRODUCT_IMG = 'https://fal.storage/uploads/product-ref-01.png';
const PERSONA_IMG = 'https://fal.storage/uploads/persona-ref-01.png';
const VOICE_AUDIO = 'https://fal.storage/uploads/voice-01.wav';

const golden = (name: string): URL => new URL(`./golden/payloads/${name}.json`, import.meta.url);

/**
 * Serializa un payload con claves ORDENADAS recursivamente y lo PASA por Prettier con la config
 * REAL del repo. Es el fixpoint del golden: lo que se escribe con `UPDATE_GOLDEN=1` == lo que el
 * test LEE == lo que `prettier --check` (parte del gate) valida. Sin este paso, `JSON.stringify(…,
 * null, 2)` SIEMPRE expande un array de un elemento a multilínea, pero Prettier lo colapsa
 * (`["x"]`) si cabe en `printWidth` — el golden committeado divergía de `--check` (rompió el gate).
 * Se usa `resolveConfig` (no una config hardcodeada) para que el golden siga a `.prettierrc` sin
 * drift.
 */
async function stableJson(payload: AdapterPayload): Promise<string> {
  const sortDeep = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortDeep);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((k) => [k, sortDeep((value as Record<string, unknown>)[k])]),
      );
    }
    return value;
  };
  const raw = JSON.stringify(sortDeep(payload), null, 2);
  const target = fileURLToPath(golden('avatar-kling-ai-avatar'));
  const config = await resolveConfig(target);
  return format(raw, { ...config, parser: 'json', filepath: target });
}

describe('model adapters — golden payloads (claves ordenadas, carácter a carácter)', () => {
  // (a)+(c): Kling ai-avatar (refImages:1) con imagen de referencia + aspect del profile.
  it('golden avatar-kling-ai-avatar', async () => {
    const profile = byEndpoint('fal-ai/kling-video/ai-avatar/v2/standard');
    const res = avatarAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile,
      aspect: '9:16',
      durationSeconds: 5,
      assets: { refImages: [PERSONA_IMG, PRODUCT_IMG], refAudios: [VOICE_AUDIO] },
    });
    if (!res.ok) throw new Error(JSON.stringify(res.issues));
    await expectGolden(await stableJson(res.payload), golden('avatar-kling-ai-avatar'));
  });

  // (c): OmniHuman (maxDuration:30, sin aspects declaradas) — avatar premium.
  it('golden avatar-omnihuman', async () => {
    const profile = byEndpoint('fal-ai/bytedance/omnihuman/v1.5');
    const res = avatarAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile,
      aspect: '9:16',
      durationSeconds: 8,
      assets: { refAudios: [VOICE_AUDIO] },
    });
    if (!res.ok) throw new Error(JSON.stringify(res.issues));
    await expectGolden(await stableJson(res.payload), golden('avatar-omnihuman'));
  });

  // (c): Veo 3.1 i2v — aspect ["9:16","16:9"] exacto del profile + audio.
  it('golden i2v-veo31', async () => {
    const profile = byEndpoint('fal-ai/veo3.1');
    const res = i2vAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile,
      aspect: '16:9',
      durationSeconds: 6,
      assets: { refImages: [PRODUCT_IMG] },
    });
    if (!res.ok) throw new Error(JSON.stringify(res.issues));
    await expectGolden(await stableJson(res.payload), golden('i2v-veo31'));
  });

  // image-edit: Seedream (refImages:10) — packshots.
  it('golden image-edit-seedream', async () => {
    const profile = byEndpoint('fal-ai/bytedance/seedream/v4.5/edit');
    const res = imageEditAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile,
      aspect: '1:1',
      durationSeconds: 0,
      assets: { refImages: [PRODUCT_IMG, PERSONA_IMG] },
    });
    if (!res.ok) throw new Error(JSON.stringify(res.issues));
    await expectGolden(await stableJson(res.payload), golden('image-edit-seedream'));
  });

  // (b): Seedance @image/@video/@audio contra el FIXTURE.
  it('golden seedance-t2v', async () => {
    const res = seedanceAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile: SEEDANCE_FIXTURE,
      aspect: '9:16',
      durationSeconds: 5,
      assets: {
        refImages: [PRODUCT_IMG],
        refVideos: ['https://fal.storage/uploads/broll.mp4'],
        refAudios: [VOICE_AUDIO],
      },
    });
    if (!res.ok) throw new Error(JSON.stringify(res.issues));
    await expectGolden(await stableJson(res.payload), golden('seedance-t2v'));
  });
});

describe('assert (a) — Kling incluye la ref image cuando capabilities.refImages > 0', () => {
  const profile = () => byEndpoint('fal-ai/kling-video/ai-avatar/v2/standard');

  it('refImages:1 (real) + imagen aportada ⇒ el payload lleva la imagen de referencia', () => {
    const res = avatarAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile: profile(),
      aspect: '9:16',
      durationSeconds: 5,
      assets: { refImages: [PERSONA_IMG] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.image_url).toBe(PERSONA_IMG);
  });

  // CONTROL NEGATIVO 1: el mismo modelo, SIN imagen aportada ⇒ NO hay image_url (que el assert muerda).
  it('refImages:1 pero SIN imagen aportada ⇒ el payload NO lleva image_url', () => {
    const res = avatarAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile: profile(),
      aspect: '9:16',
      durationSeconds: 5,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload).not.toHaveProperty('image_url');
  });

  // CONTROL NEGATIVO 2: un avatar SIN refImages (VEED: text-to-video, refImages ausente) ⇒ aunque se
  // aporten imágenes, NO se inyecta ninguna (el modelo no las acepta). Es el control que el brief exige.
  // OJO: hasta T4.7 este control usaba OmniHuman, pero T4.7 corrigió el seed de OmniHuman (fal exige
  // `image_url` para OmniHuman → `refImages:1`), así que ya NO es un avatar «sin refImages». VEED
  // (`veed/avatars/text-to-video`) es text-to-video puro y no toma imagen de entrada — el vehículo
  // honesto para el mismo control (la PROPIEDAD sigue siendo «sin refImages ⇒ sin image_url»).
  it('avatar sin refImages (VEED text-to-video) + imágenes aportadas ⇒ payload SIN image_url', () => {
    const res = avatarAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile: byEndpoint('veed/avatars/text-to-video'),
      aspect: '9:16',
      durationSeconds: 8,
      assets: { refImages: [PERSONA_IMG, PRODUCT_IMG] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload).not.toHaveProperty('image_url');
  });
});

describe('assert (b) — Seedance usa la sintaxis @image/@video/@audio', () => {
  it('el prompt se prefija con un token @image/@video/@audio por cada ref aceptada', () => {
    const res = seedanceAdapter({
      resolvedPrompt: 'apply the serum',
      profile: SEEDANCE_FIXTURE,
      aspect: '9:16',
      durationSeconds: 5,
      assets: {
        refImages: [PRODUCT_IMG],
        refVideos: ['https://fal.storage/uploads/broll.mp4'],
        refAudios: [VOICE_AUDIO],
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.prompt).toBe('@image @video @audio apply the serum');
    expect(res.payload.reference_images).toEqual([PRODUCT_IMG]);
    expect(res.payload.reference_videos).toEqual(['https://fal.storage/uploads/broll.mp4']);
    expect(res.payload.reference_audios).toEqual([VOICE_AUDIO]);
  });

  // CONTROL NEGATIVO: sin assets ⇒ NO se prefija ningún token (el prompt queda íntegro).
  it('sin refs ⇒ el prompt NO lleva tokens @… y no hay reference_*', () => {
    const res = seedanceAdapter({
      resolvedPrompt: 'apply the serum',
      profile: SEEDANCE_FIXTURE,
      aspect: '9:16',
      durationSeconds: 5,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.prompt).toBe('apply the serum');
    expect(res.payload).not.toHaveProperty('reference_images');
  });
});

describe('assert (c) — aspect/duración con los nombres y enums EXACTOS del model_profile', () => {
  it('veo3.1 acepta "16:9" (está en su aspects) y lo emite tal cual + la duración pedida', () => {
    const res = i2vAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile: byEndpoint('fal-ai/veo3.1'),
      aspect: '16:9',
      durationSeconds: 6,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.aspect_ratio).toBe('16:9');
    expect(res.payload.duration_seconds).toBe(6);
  });

  // CONTROL: un aspect FUERA de capabilities.aspects ⇒ error tipado accionable, NO clamp ni throw.
  it('veo3.1 rechaza "1:1" (no está en aspects) con aspect_unsupported que nombra los válidos', () => {
    const res = i2vAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile: byEndpoint('fal-ai/veo3.1'),
      aspect: '1:1',
      durationSeconds: 6,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues[0]!.code).toBe('aspect_unsupported');
    expect(res.issues[0]!.message).toContain('9:16');
    expect(res.issues[0]!.message).toContain('16:9');
  });

  it('un profile SIN aspects declaradas (Veo i2v-image-to-video) acepta cualquier aspect (el modelo no restringe)', () => {
    // El i2v de Veo `image-to-video` declara `aspects:["auto","9:16","16:9"]` y sí restringe; el que NO
    // restringe es cualquier profile i2v sin `aspects` — pero para preservar la PROPIEDAD «sin aspects ⇒
    // el modelo no restringe» con un vehículo i2v real, se usa el fixture SEEDANCE (kind i2v, sin
    // `aspects` declaradas): resolveAspect deja pasar el aspect tal cual. (El vehículo ANTERIOR era
    // OmniHuman/avatar, pero el adapter avatar ya NO emite `aspect_ratio` — ver el bloque de más abajo.)
    const res = seedanceAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile: { ...SEEDANCE_FIXTURE, capabilities: { refImages: 1 } },
      aspect: '4:5',
      durationSeconds: 8,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.aspect_ratio).toBe('4:5');
  });
});

describe('avatar dialect — NO emite los campos que Kling/OmniHuman rechazan (fix T4.11 de la deuda T4.7)', () => {
  // Kling AI Avatar v2 y OmniHuman v1.5 aceptan SOLO `{prompt, image_url?, audio_url?, resolution?}`;
  // `aspect_ratio`/`duration_seconds`/`enable_audio` los RECHAZAN. El adapter avatar debe emitir el
  // dialecto EXACTO que los servicios construyen a mano (generate-avatar.ts submitInputs). Estos asserts
  // muerden esa propiedad (cláusula determinista → test permanente del gate, regla 8 del planning).
  it('Kling: payload = {audio_url, image_url, prompt} — SIN aspect_ratio/duration_seconds/enable_audio', () => {
    const res = avatarAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile: byEndpoint('fal-ai/kling-video/ai-avatar/v2/standard'),
      aspect: '9:16',
      durationSeconds: 5,
      assets: { refImages: [PERSONA_IMG], refAudios: [VOICE_AUDIO] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload).not.toHaveProperty('aspect_ratio');
    expect(res.payload).not.toHaveProperty('duration_seconds');
    expect(res.payload).not.toHaveProperty('enable_audio');
    expect(res.payload.image_url).toBe(PERSONA_IMG);
    expect(res.payload.audio_url).toBe(VOICE_AUDIO);
    expect(res.payload.prompt).toBe(CANONICAL_PROMPT);
  });

  it('OmniHuman: `resolution` del input se refleja; sin input.resolution ⇒ no aparece', () => {
    const withRes = avatarAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile: byEndpoint('fal-ai/bytedance/omnihuman/v1.5'),
      aspect: '9:16',
      durationSeconds: 8,
      resolution: '1080p',
      assets: { refAudios: [VOICE_AUDIO] },
    });
    expect(withRes.ok).toBe(true);
    if (!withRes.ok) return;
    expect(withRes.payload.resolution).toBe('1080p');
    expect(withRes.payload).not.toHaveProperty('aspect_ratio');

    const withoutRes = avatarAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile: byEndpoint('fal-ai/bytedance/omnihuman/v1.5'),
      aspect: '9:16',
      durationSeconds: 8,
      assets: { refAudios: [VOICE_AUDIO] },
    });
    expect(withoutRes.ok).toBe(true);
    if (!withoutRes.ok) return;
    expect(withoutRes.payload).not.toHaveProperty('resolution');
  });

  // CONTROL NEGATIVO: un avatar con audio/dialogue pero SIN pista aportada ⇒ NO hay audio_url (que el
  // gate del audio muerda). Sin `enable_audio` en ningún caso.
  it('avatar con caps.audio pero sin refAudios aportado ⇒ payload SIN audio_url ni enable_audio', () => {
    const res = avatarAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile: byEndpoint('fal-ai/bytedance/omnihuman/v1.5'),
      aspect: '9:16',
      durationSeconds: 8,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload).not.toHaveProperty('audio_url');
    expect(res.payload).not.toHaveProperty('enable_audio');
  });
});

describe('image-edit dialect — el aspect LLEGA al payload bajo la clave del profile (T4.4b)', () => {
  // La ruta de referencias de N7a (T4.4b) manda 9:16 a seedream/nano-banana edit. Antes de T4.4b el
  // adapter VALIDABA el aspect pero NO lo emitía → el 9:16 se descartaba y fal componía en su default
  // (típicamente 1:1). Estos asserts muerden la PROPIEDAD «el aspect pedido llega al payload bajo el
  // parámetro que el profile declara, traducido al valor del endpoint» (cláusula determinista →
  // test permanente del gate, regla 8 del planning). Los profiles son los REALES sembrados.
  it('seedream: 9:16 se emite como `image_size:portrait_16_9` (aspectParam + aspectValues del profile)', () => {
    const res = imageEditAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile: byEndpoint('fal-ai/bytedance/seedream/v4.5/edit'),
      aspect: '9:16',
      durationSeconds: 0,
      assets: { refImages: [PRODUCT_IMG] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.image_size).toBe('portrait_16_9');
    expect(res.payload).not.toHaveProperty('aspect_ratio');
    expect(res.payload.image_urls).toEqual([PRODUCT_IMG]);
  });

  it('nano-banana-2 (fallback): 9:16 se emite como `aspect_ratio:"9:16"` VERBATIM (sin aspectValues)', () => {
    const res = imageEditAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile: byEndpoint('fal-ai/nano-banana-2/edit'),
      aspect: '9:16',
      durationSeconds: 0,
      assets: { refImages: [PRODUCT_IMG] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.aspect_ratio).toBe('9:16');
    expect(res.payload).not.toHaveProperty('image_size');
  });

  // CONTROL NEGATIVO: un profile image-edit SIN `aspectParam` (nano-banana-pro/edit, capabilities:{})
  // NO emite aspect en el payload (comportamiento previo a T4.4b, sin ramificar por endpoint).
  it('nano-banana-pro (sin aspectParam) ⇒ el payload NO lleva image_size ni aspect_ratio', () => {
    const res = imageEditAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile: byEndpoint('fal-ai/nano-banana-pro/edit'),
      aspect: '9:16',
      durationSeconds: 0,
      assets: { refImages: [PRODUCT_IMG] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload).not.toHaveProperty('image_size');
    expect(res.payload).not.toHaveProperty('aspect_ratio');
  });

  // CONTROL: un aspect FUERA de capabilities.aspects ⇒ error tipado accionable, NO clamp ni emisión.
  it('seedream rechaza "4:5" (no está en aspects) con aspect_unsupported', () => {
    const res = imageEditAdapter({
      resolvedPrompt: CANONICAL_PROMPT,
      profile: byEndpoint('fal-ai/bytedance/seedream/v4.5/edit'),
      aspect: '4:5',
      durationSeconds: 0,
      assets: { refImages: [PRODUCT_IMG] },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues[0]!.code).toBe('aspect_unsupported');
  });
});

describe('dispatch por promptAdapter (NO por prefijo de endpoint)', () => {
  it('cada profile sembrado despacha al adapter de su familia y produce un payload', () => {
    const seededWithAdapter = profiles.filter((p) => p.promptAdapter !== undefined);
    expect(seededWithAdapter.length).toBeGreaterThan(0);
    for (const profile of seededWithAdapter) {
      const input: AdapterInput = {
        resolvedPrompt: CANONICAL_PROMPT,
        profile,
        aspect: (profile.capabilities.aspects ?? ['9:16'])[0]!,
        durationSeconds: 5,
      };
      const res = adaptToPayload(input);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.payload.prompt).toBe(CANONICAL_PROMPT);
    }
  });

  it('promptAdapter ausente ⇒ missing_prompt_adapter que nombra el endpoint', () => {
    const profile: ModelProfileSeed = { ...SEEDANCE_FIXTURE, promptAdapter: undefined };
    const res = adaptToPayload({
      resolvedPrompt: CANONICAL_PROMPT,
      profile,
      aspect: '9:16',
      durationSeconds: 5,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues[0]!.code).toBe('missing_prompt_adapter');
    expect(res.issues[0]!.message).toContain(profile.falEndpoint);
  });

  it('promptAdapter desconocido ⇒ unknown_prompt_adapter que nombra el endpoint', () => {
    const profile: ModelProfileSeed = { ...SEEDANCE_FIXTURE, promptAdapter: 'wormhole' };
    const res = adaptToPayload({
      resolvedPrompt: CANONICAL_PROMPT,
      profile,
      aspect: '9:16',
      durationSeconds: 5,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues[0]!.code).toBe('unknown_prompt_adapter');
    expect(res.issues[0]!.message).toContain(profile.falEndpoint);
  });
});
