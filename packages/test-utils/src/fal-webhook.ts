// Helpers de test para el webhook de fal (T4.2, testing/api.md §2.6). Generan un par ED25519 de
// test y FIRMAN un webhook con el MISMO builder de mensaje que usa el verificador de producción
// (`buildFalWebhookMessage` de @ugc/core) — REGLA DE ORO: NO reimplementar el layout del mensaje en
// el test, o se acaba validando dos implementaciones distintas (una self-signed y otra real). Que
// el layout coincida con el de fal REAL lo demuestra la Verificación de T4.2 (webhook real vía
// cloudflared), NO esta suite: aquí solo se prueba self-consistency + los negativos de seguridad.
//
// HUECO DEL FIXTURE REAL: `signFalWebhook` devuelve exactamente el shape de headers que el route
// handler lee (`x-fal-webhook-*`). Cuando el verifier capture un webhook firmado por fal DE VERDAD,
// puede congelar `{ headers, rawBody }` como fixture y alimentarlo al MISMO `verifyFalWebhook` sin
// cambiar nada — la función es una única superficie (headers + body crudo + deps inyectadas).
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { buildFalWebhookMessage, type FalJwks } from '@ugc/core/generation';

/** Un JWK público ED25519 (la forma que va en el JWKS de fal: `{ kty:'OKP', crv:'Ed25519', x }`). */
export type FalTestJwk = FalJwks['keys'][number];

export interface FalTestKeypair {
  privateKey: KeyObject;
  /** El JWK público para servir en el JWKS de test (msw). */
  jwk: FalTestJwk;
}

/** Genera un par ED25519 de test y su JWK público (el que iría en el JWKS de fal). */
export function makeFalKeypair(): FalTestKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { privateKey, jwk: publicKey.export({ format: 'jwk' }) };
}

/**
 * Firma un webhook con la clave dada usando el MISMO layout que el verificador de producción y
 * devuelve las cuatro cabeceras `x-fal-webhook-*` (firma en hex, timestamp en segundos como string)
 * tal cual las lee el route handler. El `body` debe ser el TEXTO CRUDO que se enviará como cuerpo:
 * la firma cubre esos bytes exactos.
 */
export function signFalWebhook(
  privateKey: KeyObject,
  p: { requestId: string; userId: string; timestamp: number; body: string },
): Record<string, string> {
  const timestamp = String(p.timestamp);
  const message = buildFalWebhookMessage({
    requestId: p.requestId,
    userId: p.userId,
    timestamp,
    body: p.body,
  });
  return {
    'x-fal-webhook-request-id': p.requestId,
    'x-fal-webhook-user-id': p.userId,
    'x-fal-webhook-timestamp': timestamp,
    'x-fal-webhook-signature': sign(null, message, privateKey).toString('hex'),
  };
}

/** Timestamp unix en SEGUNDOS del momento actual (lo que fal pone en `x-fal-webhook-timestamp`). */
export function nowFalTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}
