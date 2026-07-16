// Verifier-owned re-run (NO edita el smoke del implementer): fuerza un output de ~1 MP
// (image_size='square_hd' = 1024² en FLUX.2) para que "coste real en /spend" reciba una
// prueba justa. Con 512² el redondeo de céntimos enteros deja amount_cents=0 (invariante,
// no bug). Con 1024² = 1,05 MP × 1,2¢ = 1,26¢ → Math.round → 1¢.
//
// Env: DATABASE_URL, ASSETS_DIR, FAL_KEY. Ejecutar con tsx --env-file-if-exists=../../.env
// desde apps/web (para reutilizar sus deps), o con env explícito.
import {
  createDb,
  getAsset,
  getModelProfileByEndpoint,
  makeLocalStorageAdapter,
} from '@ugc/db';
import { runGenerate } from '@ugc/services';

const FLUX2 = 'fal-ai/flux-2';

function req(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`rerun-1mp: falta ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const db = createDb(req('DATABASE_URL'));
  const storage = makeLocalStorageAdapter({ root: req('ASSETS_DIR') });
  const falKey = req('FAL_KEY');

  const profile = await getModelProfileByEndpoint(db, FLUX2);
  if (profile === undefined) {
    console.error('rerun-1mp: sin model_profile FLUX.2 (pnpm seed:gallery)');
    process.exit(1);
  }

  console.log('rerun-1mp: generando 1 imagen ~1MP (square_hd) con FLUX.2 (RED REAL)…');
  const res = await runGenerate(
    { db, storage, falKey },
    {
      modelProfileId: profile.id,
      resolvedPrompt: 'a blue ceramic mug on a wooden table, product photography, soft light',
      inputs: { image_size: 'square_hd', num_images: 1 },
    },
  );

  const asset = await getAsset(db, res.assetId);
  console.log(`rerun-1mp: generation ${res.generation.id} → ${res.generation.status}`);
  console.log(`rerun-1mp: fal_request_id = ${res.generation.falRequestId ?? '?'}`);
  console.log(`rerun-1mp: status_url     = ${res.generation.statusUrl ?? '?'}`);
  console.log(`rerun-1mp: asset dims     = ${asset?.width ?? '?'}x${asset?.height ?? '?'}`);
  console.log(`rerun-1mp: asset bytes    = ${asset?.bytes ?? '?'}`);
  console.log(`rerun-1mp: cost           = ${String(res.costCents)} céntimos (→ /spend)`);
  console.log(`rerun-1mp: assetId        = ${res.assetId}`);
  if (res.warnings.length > 0) console.log(`rerun-1mp: warnings = ${res.warnings.join('; ')}`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('rerun-1mp: falló', err);
  process.exit(1);
});
