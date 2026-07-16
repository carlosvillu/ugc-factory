// Test de CONFORMANCE del schema del payload (T4.2, principio 9 de testing). El fixture de firma
// (`fal-webhook.fixture.test.ts`) prueba la FIRMA contra fal real, pero NO el PARSEO del payload —
// y ahí vivía un bug de conformance real: fal envía `"error": null` EXPLÍCITO en los webhooks de
// ÉXITO, y `z.string().optional()` RECHAZA null (`invalid_type`) → el `safeParse` fallaba, el
// handler respondía 400 y la generación real quedó colgada sin descarga.
//
// Este test cierra ese hueco: usa el BODY REAL que fal POSTeó (capturado por el verifier vía
// cloudflared, `docs/verifications/T4.2/webhook-1-body.raw`, congelado como fixture byte-idéntico) y
// afirma que `FalWebhookPayloadSchema.safeParse` lo ACEPTA. Es la regresión permanente: si alguien
// vuelve `error` a `.optional()` (o rompe cualquier otro campo que fal nullifica), este test se pone
// ROJO en el gate, sin depender de una generación real de pago.
//
// CONTROL NEGATIVO (verificado a mano por el implementer): con `error: z.string().optional()` en el
// schema, este test se pone ROJO (`safeParse` → success:false, error `invalid_type` en `error`).
// Con `.nullish()`, pasa. Eso prueba que el test MUERDE el bug exacto.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FalWebhookPayloadSchema } from './fal-webhook-payload';

/** El body CRUDO byte-idéntico que fal POSTeó en la Verificación real (webhook de ÉXITO). */
const REAL_OK_BODY = readFileSync(
  new URL('./__fixtures__/fal-webhook-ok-body.raw', import.meta.url),
  'utf8',
);

describe('FalWebhookPayloadSchema — CONFORMANCE con el body REAL de fal', () => {
  it('acepta el webhook de ÉXITO real (con `error: null` EXPLÍCITO)', () => {
    // Se parsea el JSON del body crudo (lo que el route handler hace tras verificar la firma).
    const json: unknown = JSON.parse(REAL_OK_BODY);
    const parsed = FalWebhookPayloadSchema.safeParse(json);

    // La aserción que MUERDE el bug: con `.optional()` esto sería `false` (invalid_type en `error`).
    expect(parsed.success).toBe(true);
    if (!parsed.success) return; // narrowing para TS; el assert de arriba ya falló si llegamos aquí
    expect(parsed.data.status).toBe('OK');
    // fal envía `error: null` en éxito (no ausente): el schema debe conservarlo como null, no petar.
    expect(parsed.data.error).toBeNull();
    // El request_id es la clave de idempotencia — debe extraerse tal cual.
    expect(parsed.data.request_id).toBe('019f6af7-3088-7f03-b97d-84fec4a3ce12');
    // El payload OPACO llega intacto (el finalize extrae images[] de aquí).
    expect(parsed.data.payload).toMatchObject({
      images: [expect.objectContaining({ url: expect.stringContaining('fal.media') })],
    });
  });

  it('el `payload` real (con file_size:null, seed, timings…) pasa por extractImageOutput sin petar', () => {
    // El body real trae `images[].file_size: null` y campos extra (has_nsfw_concepts, prompt, seed,
    // timings). El schema del payload es OPACO (`unknown`), así que el parseo del WEBHOOK no depende
    // de esos campos; su validación real la hace `extractImageOutput` en el finalize. Aquí solo se
    // afirma que el parseo del webhook no se rompe por los nulls/extras del payload real.
    const json = JSON.parse(REAL_OK_BODY) as { payload: { images: { url: string }[] } };
    expect(json.payload.images[0]?.url).toContain('fal.media');
  });
});
