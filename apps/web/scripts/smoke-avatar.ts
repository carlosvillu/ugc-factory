// Smoke de la Verificación de T4.7 (§7.2 N7c): anima una IMAGEN de la Persona con el AUDIO de un hook
// (voiceover TTS de N7b) para producir un clip del avatar hablando con lipsync, en un tier image+audio
// (Kling AI Avatar Std / OmniHuman v1.5 Premium). Es el MISMO camino de PRODUCCIÓN que el executor N7c
// (`getModelProfileByEndpoint` → guard ≤maxDuration → `runGenerateAvatar`), conducido STEPLESS (sin
// run/DAG — eso es T4.11). Imprime lo que el verifier presenta al usuario para su JUICIO HUMANO (¿la
// Persona habla el hook con lipsync aceptable?) y lo que comprueba a mano: generation completed, asset
// `avatar_clip` descargable, duración ≈ audio, cost_entry por segundo.
//
// La Verificación pide un clip real en Std y Premium, es y en → se corre CUATRO VECES con distinta
// config (AVATAR_ENDPOINT + IMAGE_ASSET_ID + AUDIO_ASSET_ID por idioma). RED REAL, GASTA DINERO (los
// modelos de avatar están prohibidos en la suite live — external-apis §8; este smoke es verificación de
// tarea con coste anotado). ARITMÉTICA DE COSTE (hook corto ~4 s, decisión 5 del brief):
//   · Kling Std     5,62¢/s × ~4 s ≈ 22¢/clip  → es+en ≈ 44¢
//   · OmniHuman Pro   16¢/s × ~4 s ≈ 64¢/clip  → es+en ≈ $1,28
//   Total ≈ $1,72 por los 4 clips (bajo el cap). USA UN HOOK CORTO REAL, nunca uno de longitud máxima.
//
// Env: DATABASE_URL, ASSETS_DIR, FAL_KEY, AVATAR_ENDPOINT, IMAGE_ASSET_ID, AUDIO_ASSET_ID,
//      [RESOLUTION=720p|1080p (OmniHuman)], [PROMPT].
// Turnkey (Kling Std, en): AVATAR_ENDPOINT=fal-ai/kling-video/ai-avatar/v2/standard \
//   IMAGE_ASSET_ID=<persona-ref-image> AUDIO_ASSET_ID=<hook-en-audio> pnpm --filter @ugc/web smoke:avatar
// Turnkey (OmniHuman Pro, es): AVATAR_ENDPOINT=fal-ai/bytedance/omnihuman/v1.5 RESOLUTION=1080p \
//   IMAGE_ASSET_ID=<persona-ref-image> AUDIO_ASSET_ID=<hook-es-audio> pnpm --filter @ugc/web smoke:avatar
import { spawnSync } from 'node:child_process';
import { makeLogger } from '@ugc/core/observability';
import { ModelCapabilitiesSchema, ModelCostSchema } from '@ugc/core/gallery';
import { createDb, getAsset, getModelProfileByEndpoint, makeLocalStorageAdapter } from '@ugc/db';
import { runGenerateAvatar } from '@ugc/services';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`smoke:avatar: falta ${name}`);
    process.exit(1);
  }
  return v;
}

/** Mide la duración del clip descargado con ffprobe si está disponible; si no, avisa y no falla (el
 *  verifier corre esto en la imagen Docker del worker, que sí trae ffmpeg/ffprobe). Devuelve segundos o
 *  null. */
function probeDurationS(filePath: string): number | null {
  const res = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { encoding: 'utf8' },
  );
  if (res.error !== undefined || res.status !== 0) {
    console.log(
      'smoke:avatar:   (ffprobe no disponible en local — se salta la medición de duración; el verifier la hace en el worker)',
    );
    return null;
  }
  const parsed = Number.parseFloat(res.stdout.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const assetsDir = requireEnv('ASSETS_DIR');
  const falKey = requireEnv('FAL_KEY');
  const avatarEndpoint = requireEnv('AVATAR_ENDPOINT');
  const imageAssetId = requireEnv('IMAGE_ASSET_ID');
  const audioAssetId = requireEnv('AUDIO_ASSET_ID');
  const resolution = process.env.RESOLUTION as '720p' | '1080p' | undefined;
  const prompt = process.env.PROMPT;

  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });
  const logger = makeLogger({ name: 'worker', level: 'info' });

  const profile = await getModelProfileByEndpoint(db, avatarEndpoint);
  if (profile === undefined) {
    console.error(
      `smoke:avatar: no existe el model_profile de avatar ${avatarEndpoint}. Siembra: pnpm seed:gallery`,
    );
    process.exit(1);
  }
  if (profile.kind !== 'avatar') {
    console.error(`smoke:avatar: ${avatarEndpoint} es kind '${profile.kind}', no 'avatar'`);
    process.exit(1);
  }

  const [imageAsset, audioAsset] = await Promise.all([
    getAsset(db, imageAssetId),
    getAsset(db, audioAssetId),
  ]);
  if (imageAsset === undefined) {
    console.error(`smoke:avatar: el asset de imagen ${imageAssetId} no existe`);
    process.exit(1);
  }
  if (audioAsset === undefined) {
    console.error(`smoke:avatar: el asset de audio ${audioAssetId} no existe`);
    process.exit(1);
  }

  // GUARD ≤maxDuration (mismo que el executor N7c): no gastar en una request que fal rechazará.
  // `capabilities`/`cost` son jsonb OPACO → se validan en la frontera (patrón del executor).
  const caps = ModelCapabilitiesSchema.parse(profile.capabilities);
  const cost = ModelCostSchema.parse(profile.cost);
  const maxDuration = caps.maxDuration;
  const audioDurationS = audioAsset.durationS;
  if (maxDuration !== undefined && audioDurationS !== null && audioDurationS > maxDuration) {
    console.error(
      `smoke:avatar: el audio dura ${audioDurationS.toFixed(2)}s pero ${avatarEndpoint} admite ` +
        `≤${String(maxDuration)}s — no se gasta (usa un hook más corto).`,
    );
    process.exit(1);
  }

  console.log(
    `smoke:avatar: ${avatarEndpoint} (${String(cost.amountCents)}¢/s) — imagen ${imageAssetId} + ` +
      `audio ${audioAssetId} (${audioDurationS?.toFixed(2) ?? '?'}s)${resolution ? ` @${resolution}` : ''} — RED REAL…\n`,
  );

  const res = await runGenerateAvatar(
    { db, storage, falKey, logger },
    {
      avatarModelProfileId: profile.id,
      imageAssetId,
      audioAssetId,
      ...(prompt !== undefined ? { prompt } : {}),
      ...(resolution !== undefined ? { resolution } : {}),
    },
  );

  const asset = await getAsset(db, res.assetId);
  console.log(
    `smoke:avatar: generation ${res.generation.id} (${res.generation.status}), ` +
      `asset ${res.assetId} (avatar_clip, ${res.durationSeconds.toFixed(2)}s), ` +
      `coste ${String(res.costCents)}¢ (→ /spend) — GET /api/assets/${res.assetId}/download`,
  );

  // Medición de duración ≈ audio ±0,3 s (Verificación). El fichero vive en NUESTRO storage local.
  if (asset !== undefined) {
    const filePath = `${assetsDir}/${asset.storageKey}`;
    const probed = probeDurationS(filePath);
    if (probed !== null && audioDurationS !== null) {
      const delta = Math.abs(probed - audioDurationS);
      console.log(
        `smoke:avatar:   duración clip=${probed.toFixed(2)}s vs audio=${audioDurationS.toFixed(2)}s → Δ=${delta.toFixed(2)}s ` +
          (delta <= 0.3 ? 'OK ✓ (±0,3s)' : 'FUERA DE TOLERANCIA ✗ (>±0,3s)'),
      );
    }
  }
  if (res.warnings.length > 0) {
    console.log(`smoke:avatar:   warnings: ${res.warnings.join('; ')}`);
  }

  console.log(
    `\nsmoke:avatar: OK ✓ — clip generado, coste ${String(res.costCents)}¢. ` +
      `Descarga el clip y JÚZGALO: ¿la Persona habla el hook con LIPSYNC aceptable? ¿en el idioma esperado?`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('smoke:avatar: falló', err);
  process.exit(1);
});
