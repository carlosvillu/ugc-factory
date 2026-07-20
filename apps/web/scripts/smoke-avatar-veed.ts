// Smoke de la Verificación de T4.7b (§7.2 N7c / §7.5): la ruta VEED del clip de avatar (tier Test).
// VEED (`veed/avatars/text-to-video`) es text-to-video con voz de LIBRERÍA propia — le mandas el TEXTO
// del hook y devuelve un clip con la voz embebida. La cadena completa: clip VEED → EXTRAER el audio con
// ffmpeg → ASR (`fal-ai/elevenlabs/speech-to-text`) → word timestamps. Es el MISMO camino de PRODUCCIÓN
// que la ruta VEED del executor N7c (`runGenerateVeedAvatar`), conducido STEPLESS (sin run/DAG — eso es
// T4.11).
//
// ⚠ ESTE SMOKE DEBE CORRERSE EN LA IMAGEN DOCKER DEL WORKER (T5.1), NO en el Mac. La extracción de audio
// usa ffmpeg; el ffmpeg del Mac (Homebrew) es un binario DISTINTO del de la imagen de producción, y
// verificar contra él sería el «arnés más cómodo que la realidad» (principio 9). El verifier corre esto
// DENTRO del contenedor del worker, que es donde ffmpeg vive de verdad y donde correrá en producción.
//
// RED REAL, GASTA DINERO. Aritmética de coste: VEED 35¢/min (mínimo de facturación depende de VEED; un
// clip corto ~10-15 s ≈ 6-9¢ si no hay mínimo de 1 min, ~35¢ si lo hay) + ASR (~1¢ por el audio corto).
// Bajo el cap $0,90. Imprime lo que el verifier presenta al usuario para su JUICIO HUMANO (¿el avatar
// habla el hook con lipsync aceptable?) y lo que comprueba a mano: clip completed, asset avatar_clip
// descargable, asset tts_audio con word timestamps al 100%, cost_entry del clip (no-cero) + del ASR.
//
// Env: DATABASE_URL, ASSETS_DIR, FAL_KEY, [VEED_TEXT (el hook a decir; default abajo)],
//      [ASR_LANGUAGE_CODE=eng|spa (default: autodetect)].
// Turnkey: pnpm --filter @ugc/web smoke:avatar-veed
import { makeLogger } from '@ugc/core/observability';
import { createDb, getAsset, getModelProfileByEndpoint, makeLocalStorageAdapter } from '@ugc/db';
import { runGenerateVeedAvatar } from '@ugc/services';

const VEED_ENDPOINT = 'veed/avatars/text-to-video';
const ASR_ENDPOINT = 'fal-ai/elevenlabs/speech-to-text';
const DEFAULT_TEXT =
  'Tired of ads that feel fake? This one is different — watch what happens next.';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`smoke:avatar-veed: falta ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const assetsDir = requireEnv('ASSETS_DIR');
  const falKey = requireEnv('FAL_KEY');
  const text = process.env.VEED_TEXT ?? DEFAULT_TEXT;
  const asrLanguageCode = process.env.ASR_LANGUAGE_CODE;

  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });
  const logger = makeLogger({ name: 'worker', level: 'info' });

  const [veedProfile, asrProfile] = await Promise.all([
    getModelProfileByEndpoint(db, VEED_ENDPOINT),
    getModelProfileByEndpoint(db, ASR_ENDPOINT),
  ]);
  if (veedProfile === undefined) {
    console.error(
      `smoke:avatar-veed: no existe el model_profile ${VEED_ENDPOINT}. Siembra: pnpm seed:gallery`,
    );
    process.exit(1);
  }
  if (asrProfile === undefined) {
    console.error(
      `smoke:avatar-veed: no existe el model_profile ASR ${ASR_ENDPOINT}. Siembra: pnpm seed:gallery`,
    );
    process.exit(1);
  }

  console.log(
    `smoke:avatar-veed: ${VEED_ENDPOINT} (voz de librería) — texto: "${text}" — RED REAL (extracción ffmpeg en el worker)…\n`,
  );

  const res = await runGenerateVeedAvatar(
    { db, storage, falKey, logger },
    {
      veedModelProfileId: veedProfile.id,
      asrModelProfileId: asrProfile.id,
      text,
      ...(asrLanguageCode !== undefined ? { asrLanguageCode } : {}),
    },
  );

  const [clipAsset, audioAsset] = await Promise.all([
    getAsset(db, res.assetId),
    getAsset(db, res.audioAssetId),
  ]);
  console.log(
    `smoke:avatar-veed: generation ${res.generation.id} (${res.generation.status})\n` +
      `  clip:  asset ${res.assetId} (avatar_clip, ${res.durationSeconds.toFixed(2)}s), coste ${String(res.clipCostCents)}¢\n` +
      `  audio: asset ${res.audioAssetId} (tts_audio, ${String(res.wordCount)} palabras con timestamps), ASR ${String(res.asrCostCents)}¢\n` +
      `  coste total ${String(res.clipCostCents + res.asrCostCents)}¢ (→ /spend)`,
  );

  // Comprobación observable: el audio extraído lleva word timestamps (cobertura 100% la impone el
  // servicio con un throw; aquí solo confirmamos que el asset los tiene sellados).
  if (audioAsset?.wordTimestamps === null || audioAsset?.wordTimestamps === undefined) {
    console.error('smoke:avatar-veed: ✗ el asset de audio NO tiene word timestamps sellados');
    process.exit(1);
  }
  if (clipAsset === undefined) {
    console.error('smoke:avatar-veed: ✗ el asset del clip no existe');
    process.exit(1);
  }
  if (res.warnings.length > 0) {
    console.log(`smoke:avatar-veed:   warnings: ${res.warnings.join('; ')}`);
  }

  console.log(
    `\nsmoke:avatar-veed: OK ✓ — clip VEED generado, audio extraído con ffmpeg, ${String(res.wordCount)} word timestamps sellados. ` +
      `Descarga el clip (GET /api/assets/${res.assetId}/download) y JÚZGALO: ¿el avatar habla el hook con LIPSYNC aceptable?`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('smoke:avatar-veed: falló', err);
  process.exit(1);
});
