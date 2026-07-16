// Smoke de la Verificación de T4.2 (§9.6): dispara una generación de imagen REAL con FLUX.2 VÍA
// WEBHOOK, SIN polling. Somete a fal con `webhookUrl` apuntando al túnel (cloudflared) y SALE — la
// completion la conduce el webhook (`POST /api/webhooks/fal` → verificar firma → encolar
// `output.download` → el worker descarga y liquida). Imprime el `request_id` REAL que fal devolvió,
// que es la clave por la que el webhook encontrará la fila `generation` (`submitted`).
//
// POR QUÉ ESTE SCRIPT ES NECESARIO PARA LA VERIFICACIÓN: fal asigna el `request_id` AL SUBMIT y lo
// manda en el webhook; el handler releela la generación por ese id. La fila NO se puede sembrar a
// mano porque el id no se conoce hasta que el submit responde. Este script deja esa fila `submitted`
// keyed por el id real ANTES de que llegue el webhook — sin él, el handler devolvería
// `unknown_request` y "webhook verified" nunca se loggearía.
//
// CÓMO SE USA (el verifier):
//   1. Levantar web + worker (`pnpm dev`) con la BD sembrada (`pnpm seed:gallery`) y el JWKS real.
//   2. Exponer web con cloudflared: `cloudflared tunnel --url http://localhost:3100` → URL pública.
//   3. `WEBHOOK_URL=https://<túnel>/api/webhooks/fal pnpm --filter @ugc/web smoke:generate:webhook`
//   4. Observar en los logs del WEB: "webhook de fal verificado: descarga de output encolada".
//      En los logs del WORKER: "output.download: ... (webhook verified)" + la generación `completed`.
//      Verificar en /spend el coste y GET /api/assets/:id/download el PNG. Congelar el webhook real
//      (headers + body) como fixture de regresión (hueco preparado en fal-webhook.fixture.test.ts).
//
// Env: DATABASE_URL, FAL_KEY, WEBHOOK_URL (la URL pública del webhook, https). Turnkey:
// `pnpm --filter @ugc/web smoke:generate:webhook`.
import { createDb, getModelProfileByEndpoint } from '@ugc/db';
import { submitGenerationForWebhook } from '@ugc/services';

const FLUX2_ENDPOINT = 'fal-ai/flux-2';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`smoke:generate:webhook: falta ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const falKey = requireEnv('FAL_KEY');
  const webhookUrl = requireEnv('WEBHOOK_URL');
  if (!webhookUrl.startsWith('https://')) {
    console.error(
      `smoke:generate:webhook: WEBHOOK_URL debe ser https público (fal no firma a http/localhost): ${webhookUrl}`,
    );
    process.exit(1);
  }

  const db = createDb(databaseUrl);
  const profile = await getModelProfileByEndpoint(db, FLUX2_ENDPOINT);
  if (profile === undefined) {
    console.error(
      `smoke:generate:webhook: no existe el model_profile ${FLUX2_ENDPOINT}. Siembra la galería: pnpm seed:gallery`,
    );
    process.exit(1);
  }

  console.log(
    `smoke:generate:webhook: sometiendo 1 imagen barata a ${FLUX2_ENDPOINT} con webhook → ${webhookUrl} (RED REAL, SIN polling)…`,
  );
  const gen = await submitGenerationForWebhook(
    { db, falKey, webhookUrl },
    {
      modelProfileId: profile.id,
      resolvedPrompt: 'a red apple on a white table, clean product photography, soft light',
      // square_hd (1024²) para que el coste redondee a ≥1¢ visible en /spend (rareza sub-céntimo de T4.1).
      inputs: { image_size: 'square_hd', num_images: 1 },
    },
  );

  console.log(`smoke:generate:webhook: generation ${gen.id} → ${gen.status} (esperado: submitted)`);
  console.log(`smoke:generate:webhook: fal_request_id = ${gen.falRequestId ?? '?'}`);
  console.log(`smoke:generate:webhook: status_url     = ${gen.statusUrl ?? '?'}`);
  console.log('');
  console.log('smoke:generate:webhook: submit OK. AHORA fal debe llamar al webhook en segundos.');
  console.log('  · WEB logs → "webhook de fal verificado: descarga de output encolada"');
  console.log('  · WORKER logs → "output.download: ... (webhook verified)" + generación completed');
  console.log(
    `  · La generación ${gen.id} debe pasar submitted → in_progress → completed SIN polling.`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('smoke:generate:webhook: falló', err);
  process.exit(1);
});
