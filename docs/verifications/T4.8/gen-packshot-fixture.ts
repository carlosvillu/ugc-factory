// VERIFIER-SIDE FIXTURE (T4.8): genera UN packshot de producto sintético con fal-ai/flux-2
// (text-to-image) para usarlo como (a) keyframe de la ruta i2v y (b) referencia de producto de la
// ruta r2v de N7d. La galería sembrada no trae un packshot real usable, así que se genera uno (mismo
// mecanismo que N7a AI-packshot / T4.7 gen-portrait). RED REAL (~1-2¢). NO entrega ninguna tarea.
// Env: DATABASE_URL, ASSETS_DIR, FAL_KEY. Imprime el ASSET_ID del packshot generado.
import { makeLogger } from '@ugc/core/observability';
import { createDb, getAsset, getModelProfileByEndpoint, makeLocalStorageAdapter } from '@ugc/db';
import { runGenerate } from '@ugc/services';

const FLUX2_ENDPOINT = 'fal-ai/flux-2';
const IMAGE_SIZE = 'portrait_16_9'; // vertical, encuadre 9:16-friendly

const PROMPT =
  'professional product packshot photo of a sleek amber glass skincare serum bottle with a black ' +
  'dropper cap and a minimalist white label reading "GLOW", centered on a clean bright studio ' +
  'background, soft diffused lighting, photorealistic, high detail, sharp focus, commercial e-commerce style';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`gen-packshot: falta ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const assetsDir = requireEnv('ASSETS_DIR');
  const falKey = requireEnv('FAL_KEY');

  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });
  const logger = makeLogger({ name: 'worker', level: 'info' });

  const profile = await getModelProfileByEndpoint(db, FLUX2_ENDPOINT);
  if (profile === undefined) {
    console.error(`gen-packshot: no existe ${FLUX2_ENDPOINT}. pnpm db:seed:gallery`);
    process.exit(1);
  }

  console.log(`gen-packshot: generando packshot con ${FLUX2_ENDPOINT} (RED REAL)…\n  ${PROMPT}\n`);
  const res = await runGenerate(
    { db, storage, falKey, logger },
    {
      modelProfileId: profile.id,
      resolvedPrompt: PROMPT,
      inputs: { image_size: IMAGE_SIZE, num_images: 1, seed: 7 },
    },
  );
  const asset = await getAsset(db, res.assetId);
  console.log(
    `gen-packshot: OK ✓ generation ${res.generation.id} (${res.generation.status}), ` +
      `asset ${res.assetId} (${String(asset?.width)}×${String(asset?.height)}), coste ${String(res.costCents)}¢`,
  );
  console.log(`PACKSHOT_ASSET_ID=${res.assetId}`);
  console.log(`PACKSHOT_STORAGE_KEY=${String(asset?.storageKey)}`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('gen-packshot: falló', err);
  process.exit(1);
});
