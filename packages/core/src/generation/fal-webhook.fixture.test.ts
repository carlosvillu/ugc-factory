// HUECO DEL FIXTURE REAL DE FAL (T4.2, principio 9 de testing) — el test de CONFORMANCE.
//
// `fal-webhook.test.ts` prueba SELF-CONSISTENCY: firma con nuestro propio builder y verifica con
// nuestro propio verificador. Eso NO demuestra que nuestro esquema coincida con el de fal REAL —
// dos implementaciones equivocadas del layout serían mutuamente consistentes. La ÚNICA prueba de
// conformance es un webhook firmado por fal DE VERDAD verificando verde.
//
// CÓMO SE RELLENA (el verifier, tras correr `smoke:generate:webhook` sobre cloudflared):
//   1. Capturar el webhook REAL que fal POSTeó (headers + body CRUDO exacto). El route handler ya
//      lo tiene delante; se puede loggear temporalmente `rawBody` + los 4 headers `x-fal-webhook-*`,
//      o inspeccionarlo en el túnel/logs.
//   2. Capturar el JWKS REAL que había en ese momento: `curl https://rest.fal.ai/.well-known/jwks.json`.
//   3. Pegar AMBOS abajo (sin secretos: el JWKS es público y el body no lleva credenciales) y quitar
//      el `.skip`. El test debe pasar → prueba que nuestro `verifyFalWebhook` acepta la firma REAL de
//      fal con el layout REAL. Congelado, es la regresión permanente: si alguien rompe el layout del
//      mensaje o el manejo del JWKS, ESTE test (no la Verificación manual) se pone rojo.
//
// La función bajo test es UNA superficie: `verifyFalWebhook(headers, rawBody, { now, getJwks })`.
// Alimentarla con el fixture real no requiere tocar nada más — por eso el verificador se diseñó así.
import { describe, it, expect } from 'vitest';
import { verifyFalWebhook, type FalJwks } from './fal-webhook';

// ── FIXTURE REAL DE FAL, congelado por el verifier durante la Verificación de T4.2 (2026-07-16) ──
// Capturado con un proxy de ingreso (docs/verifications/T4.2/capture-proxy.mjs) que registró los
// BYTES EXACTOS del POST que fal envió a la URL del túnel cloudflared, más los 4 headers
// `x-fal-webhook-*`. El JWKS es el que `https://rest.fal.ai/.well-known/jwks.json` devolvía en ese
// momento. Evidencia cruda: docs/verifications/T4.2/webhook-1-{body.raw,headers.json}, jwks-real.json.
// Generación real fal-ai/flux-2 (request_id 019f6af7-3088-7f03-b97d-84fec4a3ce12).
const REAL_HEADERS = {
  requestId: '019f6af7-3088-7f03-b97d-84fec4a3ce12',
  userId: 'github|179462',
  timestamp: '1784206014', // segundos unix
  signature:
    '7fea10d1dceca3517f08d4ceca8d12a674c38ac759f356d18a23832c5005c94aececff738eff54b613f3dd4eb92e4a1a6b27e14b3875972313ded9077e9d3804', // hex
};

// Los BYTES CRUDOS exactos del POST de fal (564 bytes, ASCII). NO re-serializar: la firma cubre
// estos bytes literales (incluye el `"error": null` de fal en un payload de éxito, los espacios tras
// `:` y `,`, y el orden de campos de fal). Cualquier re-serialización rompería la firma.
const REAL_RAW_BODY =
  '{"error": null, "gateway_request_id": "019f6af7-3088-7f03-b97d-84fec4a3ce12", "payload": {"has_nsfw_concepts": [false], "images": [{"content_type": "image/png", "file_name": "OsiM012ybgyaMyimaZtHJ_UJCN47Sp.png", "file_size": null, "height": 1024, "url": "https://v3b.fal.media/files/b/0aa27b79/OsiM012ybgyaMyimaZtHJ_UJCN47Sp.png", "width": 1024}], "prompt": "a red apple on a white table, clean product photography, soft light", "seed": 427063521, "timings": {"inference": 1.3716533930000878}}, "request_id": "019f6af7-3088-7f03-b97d-84fec4a3ce12", "status": "OK"}';

const REAL_JWKS: FalJwks = {
  keys: [
    {
      kty: 'OKP',
      crv: 'Ed25519',
      kid: 'Eyv1ENn6NyZnEorJHsWnEDHRQ45-hnGqP0Lb-yX7Itw',
      x: 'Cghs6Ge6h5B3_vMIurJPYmN23Yk-VcTk-juiIEQ6zuY=',
      use: 'sig',
    },
    {
      kty: 'OKP',
      crv: 'Ed25519',
      kid: 'q_RdVYvPKoXPwp5YOM4bhSvtWynZeoAWGOyxQiXgsmQ',
      x: 'TZE-E0LB1iT29Ai1LbAh9bam1YQJkK7fEGWAmmkRm_I=',
      use: 'sig',
    },
  ],
};

describe('verifyFalWebhook — CONFORMANCE con fal real (fixture congelado por el verifier)', () => {
  it('un webhook firmado por fal REAL verifica verde con el layout de producción', async () => {
    // `now` se FIJA al timestamp del fixture para que la ventana ±5 min no lo rechace por antigüedad
    // — el fixture se congela una vez y no debe caducar con el reloj real.
    const now = (): number => Number(REAL_HEADERS.timestamp) * 1000;
    const res = await verifyFalWebhook(REAL_HEADERS, REAL_RAW_BODY, {
      now,
      getJwks: () => Promise.resolve(REAL_JWKS),
    });
    expect(res).toEqual({ ok: true });
  });
});
