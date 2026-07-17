// Smoke de la Verificación de T4.8 (§7.2 N7d): genera UN clip de b-roll contra fal REAL — i2v desde un
// keyframe (`fal-ai/veo3.1/image-to-video`) o R2V del producto (`fal-ai/veo3.1/reference-to-video`).
// Es el MISMO camino de PRODUCCIÓN que el executor N7d (`getModelProfileByEndpoint` → guard de catálogo
// → `runGenerateBroll`), conducido STEPLESS (sin run/DAG — eso es T4.11). Imprime lo que el verifier
// comprueba: generation completed, asset `broll_clip` descargable, duración = el enum enviado, cost_entry
// por segundo, y —a JUICIO HUMANO— si el clip es un b-roll 9:16 720p+ coherente (y, en R2V, si el
// PRODUCTO es fiel a las referencias).
//
// La Verificación pide una VARIANTE de conversión (1 avatar + 2 b-roll) 9:16 720p+ con producto fiel en
// R2V. El CONTEO exacto (2 clips de body) es determinista → lo fija el test de integración del executor
// (`n7d-broll.test.ts`, gate permanente); este smoke prueba en VIVO el eslabón que gasta: que Veo i2v/R2V
// generan un clip real 9:16 con el keyframe/referencias. Se corre por CLIP (i2v y r2v).
//
// RED REAL, GASTA DINERO (Veo 3.1 = $0,20/s sin audio; un clip de 8s ≈ $1,60). B-roll SILENCIOSO
// (`generate_audio:false`, y $0,20/s vs $0,40/s con audio). Los modelos de vídeo están prohibidos en la
// suite live — este smoke es verificación de tarea con coste anotado.
//
// Env: DATABASE_URL, ASSETS_DIR, FAL_KEY, BROLL_ENDPOINT, IMAGE_ASSET_IDS (coma-separados),
//      [DURATION=8], [ASPECT=9:16], [RESOLUTION=720p], [PROMPT].
// Turnkey (i2v desde keyframe): BROLL_ENDPOINT=fal-ai/veo3.1/image-to-video \
//   IMAGE_ASSET_IDS=<keyframe-asset-id> PROMPT="A creator applies the serum" pnpm --filter @ugc/web smoke:broll
// Turnkey (R2V del producto): BROLL_ENDPOINT=fal-ai/veo3.1/reference-to-video \
//   IMAGE_ASSET_IDS=<ref1>,<ref2> PROMPT="The product on a bright counter, hand reaches in" \
//   pnpm --filter @ugc/web smoke:broll
import { spawnSync } from 'node:child_process';
import { makeLogger } from '@ugc/core/observability';
import {
  isBrollModelKind,
  ModelCapabilitiesSchema,
  ModelCostSchema,
  quantizeDurationToEnum,
} from '@ugc/core/gallery';
import { createDb, getAsset, getModelProfileByEndpoint, makeLocalStorageAdapter } from '@ugc/db';
import { runGenerateBroll } from '@ugc/services';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`smoke:broll: falta ${name}`);
    process.exit(1);
  }
  return v;
}

/** Mide la duración del clip con ffprobe si está disponible (el verifier corre esto en la imagen Docker
 *  del worker, que sí trae ffprobe). Devuelve segundos o null. */
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
      'smoke:broll:   (ffprobe no disponible en local — se salta la medición; el verifier la hace)',
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
  const brollEndpoint = requireEnv('BROLL_ENDPOINT');
  const imageAssetIds = requireEnv('IMAGE_ASSET_IDS')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const requestedDuration = Number.parseFloat(process.env.DURATION ?? '8');
  const aspect = process.env.ASPECT ?? '9:16';
  const resolution = process.env.RESOLUTION ?? '720p';
  const prompt = process.env.PROMPT;

  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });
  const logger = makeLogger({ name: 'worker', level: 'info' });

  const profile = await getModelProfileByEndpoint(db, brollEndpoint);
  if (profile === undefined) {
    console.error(
      `smoke:broll: no existe el model_profile ${brollEndpoint}. Siembra: pnpm seed:gallery`,
    );
    process.exit(1);
  }
  if (!isBrollModelKind(profile.kind)) {
    console.error(
      `smoke:broll: ${brollEndpoint} es kind '${profile.kind}', no un modelo de b-roll (i2v/r2v/t2v)`,
    );
    process.exit(1);
  }

  // Guard de catálogo + cuantización de la duración al enum del modelo (mismo que el executor N7d).
  const caps = ModelCapabilitiesSchema.parse(profile.capabilities);
  const cost = ModelCostSchema.parse(profile.cost);
  if (caps.aspects !== undefined && !caps.aspects.includes(aspect)) {
    console.error(
      `smoke:broll: aspect '${aspect}' no está en [${caps.aspects.join(', ')}] de ${brollEndpoint}`,
    );
    process.exit(1);
  }
  if (caps.resolutions !== undefined && !caps.resolutions.includes(resolution)) {
    console.error(
      `smoke:broll: resolución '${resolution}' no está en [${caps.resolutions.join(', ')}]`,
    );
    process.exit(1);
  }
  if (caps.durations === undefined || caps.durations.length === 0) {
    console.error(`smoke:broll: ${brollEndpoint} no declara capabilities.durations`);
    process.exit(1);
  }
  const durationSeconds = quantizeDurationToEnum(requestedDuration, caps.durations);

  console.log(
    `smoke:broll: ${brollEndpoint} (kind ${profile.kind}, ${String(cost.amountCents)}¢/s) — ` +
      `${String(imageAssetIds.length)} imagen(es), duración ${String(durationSeconds)}s @${resolution} ${aspect} — RED REAL…\n`,
  );

  const res = await runGenerateBroll(
    { db, storage, falKey, logger },
    {
      brollModelProfileId: profile.id,
      imageAssetIds,
      durationSeconds,
      aspectRatio: aspect,
      resolution,
      ...(prompt !== undefined ? { prompt } : {}),
    },
  );

  const asset = await getAsset(db, res.assetId);
  console.log(
    `smoke:broll: generation ${res.generation.id} (${res.generation.status}), ` +
      `asset ${res.assetId} (broll_clip, ${res.durationSeconds.toFixed(2)}s), ` +
      `coste ${String(res.costCents)}¢ (→ /spend) — GET /api/assets/${res.assetId}/download`,
  );

  if (asset !== undefined) {
    const filePath = `${assetsDir}/${asset.storageKey}`;
    const probed = probeDurationS(filePath);
    if (probed !== null) {
      const delta = Math.abs(probed - res.durationSeconds);
      console.log(
        `smoke:broll:   duración clip=${probed.toFixed(2)}s vs enviado=${String(res.durationSeconds)}s → Δ=${delta.toFixed(2)}s ` +
          (delta <= 0.6 ? 'OK ✓' : 'REVISAR (Δ>0,6s — Veo puede cuantizar internamente)'),
      );
    }
  }
  if (res.warnings.length > 0) {
    console.log(`smoke:broll:   warnings: ${res.warnings.join('; ')}`);
  }

  console.log(
    `\nsmoke:broll: OK ✓ — clip generado, coste ${String(res.costCents)}¢. ` +
      `Descárgalo y JÚZGALO: ¿es un b-roll 9:16 720p+ coherente con el prompt?` +
      (profile.kind === 'r2v' ? ' ¿El PRODUCTO es fiel a las referencias?' : ''),
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('smoke:broll: falló', err);
  process.exit(1);
});
