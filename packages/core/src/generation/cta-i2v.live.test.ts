// TIER LIVE (external-apis.md §8) — T5.5a (N7f · clip de CTA): verifica el MONEY-PATH real de la CTA
// animada. La CTA es un product shot animado por i2v (§7.5, opción A del PRD): mecánicamente idéntica al
// b-roll (mismo Veo 3.1 i2v). Este test golpea la RED REAL con la key de fal (.env.test.local), SUBE un
// keyframe COMMITEADO barato (el packshot de la verificación de T4.8, `00-packshot-product.png`
// — NO se encadena una N7a live: eso doblaría el coste y añadiría flakiness), submitea el payload i2v
// EXACTO que produce el executor N7f (`runGenerateBroll` con `generate_audio:false`), y comprueba con
// ffprobe que el output es un clip de vídeo H.264 válido con duración > 0.
//
// Un test live ROJO o SKIPPED no prueba nada (anti-patrón T1.8/principio 9): el coste se declara ANTES
// con `spendBudget()` y, si falta la key, se SALTA con mensaje explícito (no rompe el gate) — pero el
// implementer/verifier DEBE ejecutarlo una vez con la key presente y anotar el coste real. Veo i2v cuesta
// $0,20/s (§13.1, T4.8): el clip MÍNIMO (4s, enum de duración de Veo) ≈ $0,80 (dentro del cap $1
// autorizado por el usuario, 2026-07-22). SIN audio (la voz de la CTA la pone N7b): $0,20/s, no $0,40/s.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spendBudget } from '@ugc/test-utils/live-budget';

import { extractVideoOutput } from './fal-video-output';
import { makeFalClient } from './fal-client';

const FAL_KEY = process.env.FAL_KEY;
const describeLive = FAL_KEY ? describe : describe.skip;

if (!FAL_KEY) {
  console.warn(
    '[live] FAL_KEY ausente: el test live de T5.5a (clip de CTA i2v) se SALTA. Ponla en .env.test.local para ejecutarlo.',
  );
}

// Veo 3.1 i2v: el MISMO endpoint que N7d/N7f usan (la CTA animada es i2v de un keyframe). Enums reales
// (§13.1, T4.8): aspects [auto,9:16,16:9], durations [4,6,8]s, resolutions [720p,1080p,4k]. Se pide el
// clip MÍNIMO (4s, 9:16, 720p) para minimizar el gasto.
const I2V_ENDPOINT = 'fal-ai/veo3.1/image-to-video';
// Keyframe COMMITEADO (packshot real de la verificación de T4.8): frame inicial que Veo anima. NO se
// genera vía N7a live (doble coste + flakiness) — el único gasto fal de este test es la llamada i2v.
const KEYFRAME_PATH = fileURLToPath(
  new URL('../../../../docs/verifications/T4.8/00-packshot-product.png', import.meta.url),
);

let workDir: string;
beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'ugc-cta-live-'));
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describeLive('N7f · clip de CTA — money-path i2v real (LIVE, T5.5a)', () => {
  it('anima el keyframe de product shot → clip de vídeo H.264 válido (ffprobe: vídeo, duración > 0)', async () => {
    // $0,80 (4s × $0,20/s) es el coste esperado del clip mínimo; cota holgada bajo el cap $1 autorizado.
    spendBudget(0.9);
    const fal = makeFalClient({ credentials: FAL_KEY! });

    // 1) SUBIR el keyframe committeado a fal storage (frame inicial del i2v).
    const keyframeBytes = new Uint8Array(readFileSync(KEYFRAME_PATH));
    const imageUrl = await fal.uploadInput(keyframeBytes, {
      mime: 'image/png',
      filename: 'shot.png',
    });
    expect(imageUrl).toMatch(/^https:/);

    // 2) SUBMIT del payload i2v EXACTO de N7f/`runGenerateBroll` (bypass del adapter, como en el
    //    servicio): {prompt, image_url, aspect_ratio, duration:"Ns", generate_audio:false, resolution}.
    const submitted = await fal.submit(I2V_ENDPOINT, {
      prompt: 'The product on a clean surface, subtle camera push-in, call to action end shot.',
      image_url: imageUrl,
      aspect_ratio: '9:16',
      duration: '4s',
      generate_audio: false,
      resolution: '720p',
    });
    expect(submitted.requestId).toMatch(/.+/);
    expect(submitted.statusUrl).toMatch(/^https:/);

    // 3) POLL hasta COMPLETED y validar el output de VÍDEO (misma forma que emite el endpoint real:
    //    `{video:{url}}`) — el contrato que el fake del test de gate replica (principio 9).
    const result = await fal.poll({
      statusUrl: submitted.statusUrl,
      responseUrl: submitted.responseUrl,
    });
    expect(result.status).toBe('COMPLETED');
    const videoOut = extractVideoOutput(result.output);
    expect(videoOut).not.toBeNull();
    expect(videoOut?.video.url).toMatch(/^https:/);

    // 4) DESCARGAR el .mp4 y comprobar con ffprobe que es un clip de vídeo H.264 válido con duración > 0.
    const res = await fal.download(videoOut!.video.url);
    expect(res.body).not.toBeNull();
    const buf = Buffer.from(await res.arrayBuffer());
    const mp4Path = path.join(workDir, 'cta-clip.mp4');
    writeFileSync(mp4Path, buf);

    const probe = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,codec_type:format=duration',
        '-of',
        'json',
        mp4Path,
      ],
      { encoding: 'utf8' },
    );
    const meta = JSON.parse(probe) as {
      streams?: { codec_name?: string; codec_type?: string }[];
      format?: { duration?: string };
    };
    const vStream = meta.streams?.[0];
    expect(vStream?.codec_type).toBe('video');
    expect(vStream?.codec_name).toBe('h264');
    const duration = Number(meta.format?.duration ?? '0');
    expect(duration).toBeGreaterThan(0);

    console.warn(
      `[live] T5.5a clip de CTA i2v OK: codec=${String(vStream?.codec_name)}, duración=${String(duration)}s, coste≈$0,80 (4s×$0,20/s).`,
    );
  }, 600_000);
});
