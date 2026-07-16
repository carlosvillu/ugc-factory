// VERIFIER script (T4.3) — submit-SIN-poll-inline vía submitGenerationForWebhook, con una webhookUrl
// que NADIE sirve (webhooks DESHABILITADOS): fal intentará POSTear a esa URL muerta, nada llegará, y
// la ÚNICA vía de completion será el SWEEPER del worker polleando el status_url guardado.
//
// Deja la fila `generation` en `submitted` con fal_request_id/status_url DURABLES en BD y SALE (no
// pollea). Imprime el generation_id y el fal_request_id REALES — las anclas de idempotencia que el
// verifier comprueba tras matar/reiniciar el worker.
//
// Uso: DATABASE_URL=... FAL_KEY=... npx tsx docs/verifications/T4.3/submit-no-webhook.ts
import { createDb, getModelProfileByEndpoint } from '@ugc/db';
import { submitGenerationForWebhook } from '@ugc/services';

const FLUX2_ENDPOINT = 'fal-ai/flux-2';
// webhookUrl que NADIE sirve: dominio inexistente. fal aceptará el submit igual (valida el formato,
// no la reachability) y sus POST de webhook fallarán en el vacío → completion SOLO por el sweeper.
const DEAD_WEBHOOK_URL = 'https://webhooks-disabled.invalid.example/api/webhooks/fal';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`submit-no-webhook: falta ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const falKey = requireEnv('FAL_KEY');
  const prompt = process.env.PROMPT ?? 'a green glass bottle on a wooden table, product photography, soft daylight';

  const db = createDb(databaseUrl);
  const profile = await getModelProfileByEndpoint(db, FLUX2_ENDPOINT);
  if (profile === undefined) {
    console.error(`submit-no-webhook: no existe model_profile ${FLUX2_ENDPOINT}`);
    process.exit(1);
  }

  console.log(`submit-no-webhook: sometiendo 1 imagen FLUX.2 dev (square_hd) con webhook MUERTO ${DEAD_WEBHOOK_URL} (RED REAL, SIN polling)…`);
  const gen = await submitGenerationForWebhook(
    { db, falKey, webhookUrl: DEAD_WEBHOOK_URL },
    {
      modelProfileId: profile.id,
      resolvedPrompt: prompt,
      inputs: { image_size: 'square_hd', num_images: 1 },
    },
  );

  console.log('---VERIFIER-MARKERS---');
  console.log(`GENERATION_ID=${gen.id}`);
  console.log(`FAL_REQUEST_ID=${gen.falRequestId ?? '?'}`);
  console.log(`STATUS=${gen.status}`);
  console.log(`STATUS_URL=${gen.statusUrl ?? '?'}`);
  console.log(`CONTENT_HASH=${gen.contentHash ?? '?'}`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('submit-no-webhook: falló', err);
  process.exit(1);
});
