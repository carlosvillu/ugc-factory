// Contrato del output de vídeo (avatar image+audio) de fal (T4.7, §7.2 N7c). El shape se DERIVA del
// schema confirmado de Kling AI Avatar Std / OmniHuman v1.5 (WebFetch 2026-07-17): `{video:{url}, duration}`
// con `duration` HERMANA de `video` a nivel raíz. NO hay fixture live-captured (los modelos de avatar
// están prohibidos en la suite live — external-apis §8); el smoke del verifier confirma la forma en vivo.
import { describe, expect, it } from 'vitest';

import { extractVideoOutput } from './fal-video-output';

describe('extractVideoOutput — output de avatar image+audio (T4.7)', () => {
  it('output con {video:{url}, duration} a nivel raíz pasa el schema', () => {
    const out = extractVideoOutput({
      video: { url: 'https://v3.fal.media/files/x/clip.mp4', content_type: 'video/mp4' },
      duration: 4.2,
    });
    expect(out).not.toBeNull();
    expect(out?.video.url).toMatch(/^https:/);
    expect(out?.video.content_type).toBe('video/mp4');
    // La duración es HERMANA de `video` a nivel raíz (NO anidada como en {audio:{url,duration}}).
    expect(out?.duration).toBe(4.2);
  });

  it('la duration es OPCIONAL: un output sin ella valida (el servicio cae al audio de entrada)', () => {
    const out = extractVideoOutput({ video: { url: 'https://v3.fal.media/files/x/clip.mp4' } });
    expect(out).not.toBeNull();
    expect(out?.duration).toBeUndefined();
  });

  it('CONTROL NEGATIVO: un output de AUDIO ({audio:{url}}) o de IMAGEN (images[]) NO valida como vídeo', () => {
    // La barrera contra reusar el finalizer equivocado: el output de un TTS/imagen no encaja como vídeo.
    expect(extractVideoOutput({ audio: { url: 'https://x/y.wav' } })).toBeNull();
    expect(extractVideoOutput({ images: [{ url: 'https://x/y.png' }] })).toBeNull();
    expect(extractVideoOutput({ video: {} })).toBeNull(); // sin url
    expect(extractVideoOutput(null)).toBeNull();
  });
});
