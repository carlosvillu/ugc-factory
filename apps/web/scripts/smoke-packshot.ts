// Smoke de la Verificación de T4.4 (§7.2 N7a, ruta packshot-IA): genera 2–3 PACKSHOTS 9:16 REALES
// del producto con `fal-ai/flux-2` (text-to-image) end-to-end contra fal, descarga los PNG a NUESTRO
// storage y marca cada generación `synthetic_product=true`. Imprime lo que el verifier presenta al
// usuario para su JUICIO HUMANO ("packshots 9:16 razonables") y lo que comprueba a mano: N
// generaciones `completed`, cada asset 9:16 en storage (descargable por GET /api/assets/:id/download),
// el flag `synthetic_product=true` persistido, y el coste real (→ /spend).
//
// STEPLESS (Entrega T4.4): NO hay `step_run_id`. Conduce la ruta `ai_packshot` por la MISMA lógica
// que el executor N7a usa (`buildPackshotPrompt` de core + bucle de `runGenerate` con
// `image_size: portrait_16_9`, `num_images: 1`, `seed` por shot, `syntheticProduct: true`) — sin
// necesitar un run ni cablear el DAG (eso es T4.11). Molde: `smoke-generate.ts` de T4.1.
//
// Corre contra una BD YA LEVANTADA con la galería SEMBRADA (`pnpm seed:gallery` — el model_profile
// flux-2 debe existir) y con RED REAL. Env: DATABASE_URL, ASSETS_DIR, FAL_KEY, BRIEF_ID. Turnkey:
// `BRIEF_ID=<id> pnpm --filter @ugc/web smoke:packshot`.
//
// El BRIEF viene de la BD (`BRIEF_ID`): un brief REAL de un análisis previo (F1). Así el juicio
// humano es sobre un producto concreto y el prompt de packshot se construye desde su descripción
// real — la MISMA ruta que el executor N7a (que también lee el brief por id). Un brief sin fotos es
// exactamente el caso `ai_packshot` de CP1 (§7.2 N3).
import { makeLogger } from '@ugc/core/observability';
import { buildPackshotPrompt } from '@ugc/core/generation';
import { ProductBriefSchema, type ProductBrief } from '@ugc/core/contracts';
import {
  createDb,
  getAsset,
  getBrief,
  getModelProfileByEndpoint,
  makeLocalStorageAdapter,
} from '@ugc/db';
import { runGenerate } from '@ugc/services';

const FLUX2_ENDPOINT = 'fal-ai/flux-2';
const IMAGE_SIZE_9_16 = 'portrait_16_9'; // 9:16 vertical (confirmado vs fal.ai/models/fal-ai/flux-2)
const NUM_SHOTS = 2;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`smoke:packshot: falta ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const assetsDir = requireEnv('ASSETS_DIR');
  const falKey = requireEnv('FAL_KEY');
  const briefId = requireEnv('BRIEF_ID');

  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });
  const logger = makeLogger({ name: 'worker', level: 'info' });

  const profile = await getModelProfileByEndpoint(db, FLUX2_ENDPOINT);
  if (profile === undefined) {
    console.error(
      `smoke:packshot: no existe el model_profile ${FLUX2_ENDPOINT}. Siembra la galería: pnpm seed:gallery`,
    );
    process.exit(1);
  }

  // El brief real de la BD. La ruta `ai_packshot` construye el prompt DESDE su descripción — lógica
  // pura de core, la misma que el executor N7a (que también lee el brief por id).
  const row = await getBrief(db, briefId);
  if (row === undefined) {
    console.error(`smoke:packshot: el brief ${briefId} no existe`);
    process.exit(1);
  }
  const brief: ProductBrief = ProductBriefSchema.parse(row.data);

  const resolvedPrompt = buildPackshotPrompt(brief);
  console.log(`smoke:packshot: prompt de packshot →\n  ${resolvedPrompt}\n`);
  console.log(
    `smoke:packshot: generando ${String(NUM_SHOTS)} packshots 9:16 (${IMAGE_SIZE_9_16}) con ${FLUX2_ENDPOINT} (RED REAL)…`,
  );

  let totalCents = 0;
  for (let i = 0; i < NUM_SHOTS; i++) {
    const res = await runGenerate(
      { db, storage, falKey, logger },
      {
        modelProfileId: profile.id,
        resolvedPrompt,
        inputs: { image_size: IMAGE_SIZE_9_16, num_images: 1, seed: i },
        syntheticProduct: true,
      },
    );
    totalCents += res.costCents;
    const asset = await getAsset(db, res.assetId);
    const w = asset?.width ?? 0;
    const h = asset?.height ?? 0;
    const shotNum = i + 1;
    console.log(
      `smoke:packshot: shot ${String(shotNum)}/${String(NUM_SHOTS)} → generation ${res.generation.id} (${res.generation.status}), ` +
        `synthetic_product=${String(res.generation.syntheticProduct)}, ` +
        `asset ${res.assetId} ${String(w)}×${String(h)} ` +
        `(9:16 ⇒ height>width: ${h > w ? 'OK ✓' : 'REVISAR ✗'}), ` +
        `${String(res.costCents)}¢ — GET /api/assets/${res.assetId}/download`,
    );
    if (res.warnings.length > 0)
      console.log(`smoke:packshot:   warnings = ${res.warnings.join('; ')}`);
  }

  console.log(
    `\nsmoke:packshot: OK ✓ — ${String(NUM_SHOTS)} packshots generados, coste total ${String(totalCents)}¢ (→ /spend). ` +
      `Descarga los assets y JÚZGALOS: ¿son packshots 9:16 razonables del producto?`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('smoke:packshot: falló', err);
  process.exit(1);
});
