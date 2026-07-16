// TIER LIVE (external-apis.md §8) — T4.1: verifica que el CONTRATO real de fal sigue siendo el
// que los mocks asumen (submit devuelve request_id/status_url/response_url; el output de imagen
// trae images[].url + dimensiones). Golpea la RED REAL con la key de fal (.env.test.local), gasta
// dinero de verdad (<$0,05: UNA imagen barata con FLUX.2 dev) y NUNCA corre en CI.
//
// Un test live ROJO o SKIPPED no prueba nada (anti-patrón T1.8/principio 9): por eso se declara el
// coste ANTES de la llamada con `spendBudget()` (guard de presupuesto) y, si falta la key, se SALTA
// con mensaje explícito (no falla el gate) — pero el implementer/verifier debe EJECUTARLO de verdad
// una vez con la key presente y anotar el coste real.
import { describe, expect, it } from 'vitest';
import { spendBudget } from '@ugc/test-utils/live-budget';

import { extractImageOutput } from './fal-image-output';
import { makeFalClient } from './fal-client';

const FAL_KEY = process.env.FAL_KEY;
const describeLive = FAL_KEY ? describe : describe.skip;

if (!FAL_KEY) {
  console.warn(
    '[live] FAL_KEY ausente: los tests live de T4.1 se SALTAN. Ponla en .env.test.local para ejecutarlos.',
  );
}

// El modelo MÁS BARATO text-to-image (FLUX.2 dev, ~$0,012/MP). SIN loops de generación.
const ENDPOINT = 'fal-ai/flux-2';

describeLive('FalClient — contrato real de fal (LIVE, T4.1)', () => {
  it('FLUX.2 dev responde con el contrato grabado (submit → poll → output de imagen)', async () => {
    spendBudget(0.05); // ~1 imagen barata: cota superior holgada del coste real (~$0,012)
    const fal = makeFalClient({ credentials: FAL_KEY! });

    // SUBMIT: fal DEBE devolver request_id + status_url + response_url (la sustancia del §9.6).
    const submitted = await fal.submit(ENDPOINT, {
      prompt: 'a red apple on a white table, product photography',
      image_size: 'square',
      num_images: 1,
    });
    expect(submitted.requestId).toMatch(/.+/);
    expect(submitted.statusUrl).toMatch(/^https:/);
    expect(submitted.responseUrl).toMatch(/^https:/);

    // POLL sobre la status_url DEVUELTA hasta COMPLETED, luego lee el output.
    const result = await fal.poll({
      statusUrl: submitted.statusUrl,
      responseUrl: submitted.responseUrl,
    });
    expect(result.status).toBe('COMPLETED');

    // El output de imagen tiene la forma que los mocks asumen.
    const output = extractImageOutput(result.output);
    expect(output).not.toBeNull();
    expect(output?.images[0]?.url).toMatch(/^https:/);
  }, 300_000);
});
