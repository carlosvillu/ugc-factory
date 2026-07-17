// VERIFIER-SIDE HARNESS (T4.8): conduce el EXECUTOR N7d (`makeN7dExecutor`) STEPLESS contra fal REAL,
// sobre un ad_script de CONVERSIÓN real (hook + 2 body ≤8s + cta), para probar EN VIVO la cláusula
// espina: «para una variante de conversión se generan EXACTAMENTE los clips del presupuesto (2 b-roll)».
// El conteo lo decide el executor (filtra body → planGeneration → cuantiza) ANTES de fal; correrlo por
// el executor (no por el service-smoke, que es 1 clip) es la superficie correcta. Mismo camino de
// producción salvo el cableado al DAG (T4.11). Escribe en el MISMO DATABASE_URL/ASSETS_DIR que sirve
// `pnpm dev`, para poder descargar los clips por GET /api/assets/[id]/download.
//
// RED REAL, GASTA (Veo i2v/r2v = $0,20/s sin audio). Env: DATABASE_URL, ASSETS_DIR, FAL_KEY,
//   BROLL_ENDPOINT (i2v o r2v), IMAGE_ASSET_IDS (coma-separados: keyframe para i2v; refs de producto
//   para r2v), [ASPECT=9:16], [RESOLUTION=720p], [PROMPT].
import { makeLogger } from '@ugc/core/observability';
import {
  createDb,
  makeLocalStorageAdapter,
  createProject,
  createUrlAnalysis,
  createProductBrief,
} from '@ugc/db';
import { makeN7dExecutor } from '../../apps/worker/src/executors/generate-broll';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`drive-n7d: falta ${name}`);
    process.exit(1);
  }
  return v;
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
  const aspect = process.env.ASPECT ?? '9:16';
  const resolution = process.env.RESOLUTION ?? '720p';
  const prompt = process.env.PROMPT ?? 'The serum bottle on a bright marble counter, a hand reaches in';

  const scriptId = requireEnv('SCRIPT_ID');

  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });
  const logger = makeLogger({ name: 'worker', level: 'info' });

  const executor = makeN7dExecutor({ db, storage, falKey, logger });

  let output: unknown;
  console.log(
    `drive-n7d: EXECUTOR N7d sobre script ${scriptId} · endpoint ${brollEndpoint} · ` +
      `${String(imageAssetIds.length)} imagen(es) @${resolution} ${aspect} — RED REAL…\n`,
  );
  await executor({
    stepId: undefined,
    config: {
      scriptId,
      brollEndpoint,
      imageAssetIds,
      aspect,
      resolution,
    },
    collectOutput: (refs: unknown) => {
      output = refs;
    },
    // el resto del ExecutorContext no lo usa N7d (stepless)
  } as never);

  console.log('drive-n7d: OK ✓ output del executor:');
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('drive-n7d: falló', err);
  process.exit(1);
});
