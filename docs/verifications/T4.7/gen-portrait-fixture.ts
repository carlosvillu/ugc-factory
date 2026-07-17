// VERIFIER-SIDE FIXTURE (T4.7): genera UN retrato sintético con fal-ai/flux-2 (text-to-image) para
// usarlo como reference_image de una Persona y poder ejercer el happy path de N7c (los avatares exigen
// una cara reconocible; las imágenes de Persona sembradas son placeholders abstractos por diseño).
// Esto NO entrega T4.12: es el mecanismo de T4.12 usado UNA vez como fixture de test. RED REAL (~1-2¢).
// Env: DATABASE_URL, ASSETS_DIR, FAL_KEY.  Imprime el ASSET_ID del keyframe generado.
import { makeLogger } from '@ugc/core/observability';
import { createDb, getAsset, getModelProfileByEndpoint, makeLocalStorageAdapter } from '@ugc/db';
import { runGenerate } from '@ugc/services';

const FLUX2_ENDPOINT = 'fal-ai/flux-2';
const IMAGE_SIZE = 'portrait_16_9'; // vertical, encuadre de retrato

const PROMPT =
  'professional headshot portrait photo of a friendly young woman, face centered and front-facing, ' +
  'looking at camera, soft studio lighting, plain neutral light-grey background, photorealistic, ' +
  'high detail, sharp focus, natural skin texture, upper body visible';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`gen-portrait: falta ${name}`);
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
    console.error(`gen-portrait: no existe ${FLUX2_ENDPOINT}. pnpm db:seed:gallery`);
    process.exit(1);
  }

  console.log(`gen-portrait: generando retrato con ${FLUX2_ENDPOINT} (RED REAL)…\n  ${PROMPT}\n`);
  const res = await runGenerate(
    { db, storage, falKey, logger },
    {
      modelProfileId: profile.id,
      resolvedPrompt: PROMPT,
      inputs: { image_size: IMAGE_SIZE, num_images: 1, seed: 42 },
    },
  );
  const asset = await getAsset(db, res.assetId);
  console.log(
    `gen-portrait: OK ✓ generation ${res.generation.id} (${res.generation.status}), ` +
      `asset ${res.assetId} (${String(asset?.width)}×${String(asset?.height)}), coste ${String(res.costCents)}¢`,
  );
  console.log(`PORTRAIT_ASSET_ID=${res.assetId}`);
  console.log(`PORTRAIT_STORAGE_KEY=${String(asset?.storageKey)}`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('gen-portrait: falló', err);
  process.exit(1);
});
