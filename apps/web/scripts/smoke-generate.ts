// Smoke de la Verificación de T4.1 (§9.6): genera una imagen barata REAL con FLUX.2 dev
// end-to-end contra fal (submit → polling → completion), descarga el PNG a NUESTRO storage y
// registra el coste. Imprime lo que el verifier comprueba a mano: la generación `completed`, el
// coste real (→ /spend), el asset del PNG (descargable por GET /api/assets/:id/download) y la
// prueba de la CACHÉ de upload (segunda subida del mismo input = cache-hit, sin re-subir).
//
// Es un DEMO runnable para el verifier (que puede usarlo o reescribirlo); el rigor permanente
// (regresión del gate) vive en los tests: unit del FalClient con msw (rate limiter, 429, errores
// tipados, status_url canaria) + integración servicio→persistencia con Testcontainers
// (`packages/services/test/integration/generate.test.ts`) + live del contrato real.
//
// Corre contra una BD YA LEVANTADA con la galería SEMBRADA (el model_profile FLUX.2 debe existir:
// `pnpm seed:gallery`) y con RED REAL. Env: DATABASE_URL, ASSETS_DIR, FAL_KEY. Turnkey:
// `pnpm --filter @ugc/web smoke:generate`.
import { makeLogger } from '@ugc/core/observability';
import {
  createAsset,
  createDb,
  getAsset,
  getModelProfileByEndpoint,
  makeLocalStorageAdapter,
} from '@ugc/db';

import { runGenerate, uploadInputCached } from '@ugc/services';

const FLUX2_ENDPOINT = 'fal-ai/flux-2';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`smoke:generate: falta ${name}`);
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

  const profile = await getModelProfileByEndpoint(db, FLUX2_ENDPOINT);
  if (profile === undefined) {
    console.error(
      `smoke:generate: no existe el model_profile ${FLUX2_ENDPOINT}. Siembra la galería: pnpm seed:gallery`,
    );
    process.exit(1);
  }

  console.log(`smoke:generate: generando 1 imagen barata con ${FLUX2_ENDPOINT} (RED REAL)…`);
  const res = await runGenerate(
    { db, storage, falKey },
    {
      modelProfileId: profile.id,
      resolvedPrompt: 'a red apple on a white table, clean product photography, soft light',
      inputs: { image_size: 'square', num_images: 1 },
    },
  );

  console.log(`smoke:generate: generation ${res.generation.id} → ${res.generation.status}`);
  console.log(`smoke:generate: fal_request_id = ${res.generation.falRequestId ?? '?'}`);
  console.log(`smoke:generate: status_url     = ${res.generation.statusUrl ?? '?'}`);
  console.log(`smoke:generate: content_hash   = ${res.generation.contentHash ?? '?'}`);
  console.log(`smoke:generate: cost           = ${String(res.costCents)} céntimos (→ /spend)`);
  console.log(`smoke:generate: output (fal)   = ${res.falOutputUrl}`);
  console.log(
    `smoke:generate: asset ${res.assetId} — descárgalo con GET /api/assets/${res.assetId}/download`,
  );
  if (res.warnings.length > 0) console.log(`smoke:generate: warnings = ${res.warnings.join('; ')}`);

  // Prueba de la CACHÉ de upload (§9.6, Verificación #2): registra el PNG recién generado como un
  // asset de INPUT y súbelo a fal storage dos veces. La 1ª sube (fal_uploaded_at se estampa); la 2ª
  // es cache-hit (no re-sube, la marca no cambia). Se observa en los logs `fal_input_upload` vs
  // `fal_input_cache_hit` que el StructuredLogger emite.
  const outputAsset = await getAsset(db, res.assetId);
  if (outputAsset === undefined) {
    console.error('smoke:generate: no se encontró el asset del output recién creado');
    process.exit(1);
  }
  const inputAsset = await createAsset(db, {
    kind: 'reference_image',
    storageKey: outputAsset.storageKey,
    mime: 'image/png',
    bytes: outputAsset.bytes,
    checksum: outputAsset.checksum,
  });
  const logger = makeLogger({ name: 'worker', level: 'info' });
  const uploadDeps = { db, storage, falKey, logger };
  const before = await getAsset(db, inputAsset.id);
  const first = await uploadInputCached(uploadDeps, {
    assetId: inputAsset.id,
    storageKey: inputAsset.storageKey,
    falUrl: before?.falUrl ?? null,
    mime: 'image/png',
  });
  const afterFirst = await getAsset(db, inputAsset.id);
  const second = await uploadInputCached(uploadDeps, {
    assetId: inputAsset.id,
    storageKey: inputAsset.storageKey,
    falUrl: afterFirst?.falUrl ?? null,
    mime: 'image/png',
  });
  console.log(
    `smoke:generate: upload#1 cacheHit=${String(first.cacheHit)} · upload#2 cacheHit=${String(second.cacheHit)} ` +
      `(esperado: false, true)`,
  );
  console.log(
    `smoke:generate: fal_uploaded_at NO cambió entre pasadas: ${
      afterFirst?.falUploadedAt?.getTime() ===
      (await getAsset(db, inputAsset.id))?.falUploadedAt?.getTime()
        ? 'OK ✓'
        : 'FALLÓ ✗'
    }`,
  );

  console.log('smoke:generate: OK ✓ — inspecciona la generación, /spend y el asset descargado');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('smoke:generate: falló', err);
  process.exit(1);
});
