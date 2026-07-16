// Verificación de la firma ED25519 de los webhooks de fal (T4.2, §9.6, api.md §5). FUNCIÓN
// PURA de core: `now` y el fetch del JWKS se INYECTAN (patrón de deps inyectadas de T4.1) para
// que la ventana ±5 min y la caché ≤24 h sean deterministas en test. NO toca BD/cola/red por su
// cuenta — el fetch real del JWKS y la persistencia los pone `@ugc/services`.
//
// PRINCIPIO 9 DE TESTING (el discriminador de correctness): dos tests unitarios (firma válida→ok,
// firma forjada→rechazo) pueden pasar AMBOS con un esquema COMPLETAMENTE equivocado, porque
// "válido" es un payload que el propio test firmó con la misma construcción que el verificador
// comprueba (self-consistency, NO conformance). La ÚNICA prueba de que este esquema coincide con
// la REALIDAD de fal es un webhook firmado por fal DE VERDAD verificando verde — eso lo hace el
// verifier vía cloudflared (Verificación de la tarea). Por eso `verifyFalWebhook` es UNA superficie
// (headers + body crudo + deps) que el fixture real capturado puede alimentar sin cambios.
//
// CONSTRUCCIÓN OFICIAL (verificada contra fal.ai/docs/model-endpoints/webhooks, 2026-07-16):
//   · Headers: X-Fal-Webhook-{Request-Id,User-Id,Timestamp,Signature}.
//   · Mensaje firmado = [requestId, userId, timestamp, hex(sha256(body_crudo))].join('\n'), UTF-8.
//   · JWKS: https://rest.fal.ai/.well-known/jwks.json — claves ED25519, `x` = clave pública base64url.
//   · Firma (`X-Fal-Webhook-Signature`) en HEXADECIMAL; timestamp en SEGUNDOS unix; tolerancia ±5 min.
//   · Varias claves posibles en el JWKS → válido si ALGUNA verifica.
import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';

/** Tolerancia de reloj para el timestamp del webhook: ±5 min (300 s) según la doc de fal. */
export const FAL_WEBHOOK_TIMESTAMP_TOLERANCE_S = 300;

/** Una clave ED25519 del JWKS de fal (`kty:'OKP', crv:'Ed25519', x:<base64url>`). El verificador
 *  solo necesita el JWK crudo — construye la `KeyObject` él mismo (`createPublicKey`). */
export interface FalJwk {
  kty?: string;
  crv?: string;
  /** La clave pública ED25519 en base64url (32 bytes). */
  x?: string;
  [k: string]: unknown;
}

/** El JWKS tal cual lo devuelve `https://rest.fal.ai/.well-known/jwks.json`: `{ keys: [...] }`. */
export interface FalJwks {
  keys: FalJwk[];
}

/** Las cuatro cabeceras que fal envía (valores crudos, ya extraídos de los headers HTTP). El
 *  route handler las lee de `X-Fal-Webhook-*`; el verificador NO conoce nombres de header. */
export interface FalWebhookHeaders {
  requestId: string;
  userId: string;
  /** El valor CRUDO del header (segundos unix como string). Se parsea aquí, no en el handler. */
  timestamp: string;
  /** La firma en HEXADECIMAL (el valor crudo del header `X-Fal-Webhook-Signature`). */
  signature: string;
}

/** Deps inyectables del verificador: el reloj (ms, como `Date.now`) y el proveedor del JWKS
 *  (cacheado ≤24 h por el caller — aquí solo se consume). Ambos deterministas en test. */
export interface VerifyFalWebhookDeps {
  /** `Date.now`-like: milisegundos desde epoch. Inyectable para fijar la ventana ±5 min en test. */
  now: () => number;
  /** Devuelve el JWKS (cacheado ≤24 h en producción; un objeto fijo en test). */
  getJwks: () => Promise<FalJwks>;
}

/** El resultado de la verificación: `ok` + el motivo del rechazo (para logs/tests; nunca es
 *  contrato de API — el handler mapea cualquier `ok:false` a un único 401 `invalid_signature`). */
export type FalWebhookVerification =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'missing_headers'
        | 'malformed_timestamp'
        | 'timestamp_out_of_window'
        | 'malformed_signature'
        | 'no_verifying_key';
    };

/**
 * Layout documentado por fal del mensaje firmado: los 4 campos unidos por `\n`, con
 * `hex(sha256(body_crudo))` como cuarto campo. Vive en core y lo comparten el verificador de
 * producción Y los tests (testing/api.md §2.6): dos implementaciones del layout es la receta para
 * validar una y romper la otra. El `body` es el TEXTO CRUDO del cuerpo (los bytes exactos que fal
 * firmó), no un JSON re-serializado — re-serializar perdería los bytes y TODA firma fallaría.
 */
export function buildFalWebhookMessage(p: {
  requestId: string;
  userId: string;
  timestamp: string;
  body: string;
}): Buffer {
  const bodyHash = createHash('sha256').update(p.body, 'utf8').digest('hex');
  return Buffer.from([p.requestId, p.userId, p.timestamp, bodyHash].join('\n'), 'utf8');
}

/**
 * VERIFICA un webhook de fal en el orden ESTRICTO exigido por la higiene de webhooks (api.md §5):
 *   1. headers completos → si falta alguno, `missing_headers` (nunca se toca la BD sin esto).
 *   2. timestamp parseable y dentro de ±5 min → rechazo DETERMINISTA (fal reintenta 10×/2 h: un
 *      rechazo dependiente de estado haría que el mismo webhook a veces pasara y a veces no).
 *   3. firma hex parseable.
 *   4. firma ED25519 válida contra ALGUNA clave del JWKS.
 *
 * Es una FUNCIÓN PURA (salvo el `getJwks` inyectado): mismos inputs → mismo resultado. El caller
 * (route handler) mapea cualquier `ok:false` a un 401 `invalid_signature` SIN tocar la BD.
 */
export async function verifyFalWebhook(
  headers: FalWebhookHeaders,
  rawBody: string,
  deps: VerifyFalWebhookDeps,
): Promise<FalWebhookVerification> {
  // 1) Cabeceras completas. Un valor vacío es tan inválido como ausente (fal siempre las manda).
  if (
    headers.requestId === '' ||
    headers.userId === '' ||
    headers.timestamp === '' ||
    headers.signature === ''
  ) {
    return { ok: false, reason: 'missing_headers' };
  }

  // 2) Timestamp: segundos unix. `Date.now()` es MILISEGUNDOS → se divide antes de comparar.
  const timestampS = Number(headers.timestamp);
  if (!Number.isFinite(timestampS)) return { ok: false, reason: 'malformed_timestamp' };
  const nowS = deps.now() / 1000;
  if (Math.abs(nowS - timestampS) > FAL_WEBHOOK_TIMESTAMP_TOLERANCE_S) {
    return { ok: false, reason: 'timestamp_out_of_window' };
  }

  // 3) Firma: hexadecimal. Un hex malformado (longitud impar, no-hex) da un Buffer que no
  //    corresponde a la firma → se rechaza aquí en vez de dejar que `verify` lo interprete raro.
  const signature = hexToBuffer(headers.signature);
  if (signature === null) return { ok: false, reason: 'malformed_signature' };

  // 4) Mensaje firmado (layout compartido) y verificación contra TODAS las claves del JWKS.
  const message = buildFalWebhookMessage({
    requestId: headers.requestId,
    userId: headers.userId,
    timestamp: headers.timestamp,
    body: rawBody,
  });
  const jwks = await deps.getJwks();
  for (const key of jwks.keys) {
    // Cada clave se prueba de forma AISLADA: una clave malformada del set (JWK inválido, `x`
    // corrupto) lanza en `createPublicKey`/`verify` — se traga POR CLAVE para que no haga DoS de
    // la verificación de las demás (una firma legítima contra otra clave del set debe seguir
    // pasando). `verify` devuelve false (no lanza) si la firma no corresponde a la clave.
    const keyObject = toEd25519KeyObject(key);
    if (keyObject === null) continue;
    try {
      if (cryptoVerify(null, message, keyObject, signature)) return { ok: true };
    } catch {
      // Clave inutilizable para verificar: sigue con la siguiente.
      continue;
    }
  }
  return { ok: false, reason: 'no_verifying_key' };
}

/** Construye una `KeyObject` ED25519 desde un JWK del JWKS de fal, o null si el JWK no es una
 *  clave OKP/Ed25519 utilizable (lo cual NO debe abortar la verificación de las demás claves). */
function toEd25519KeyObject(jwk: FalJwk): KeyObject | null {
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string' || jwk.x === '') {
    return null;
  }
  try {
    return createPublicKey({ key: jwk as Record<string, unknown>, format: 'jwk' });
  } catch {
    return null;
  }
}

/** Parsea un hex string a Buffer de forma ESTRICTA: null si tiene longitud impar o algún dígito
 *  no-hex. `Buffer.from(hex, 'hex')` trunca silenciosamente en el primer byte inválido — eso
 *  convertiría una firma malformada en un Buffer corto que "casi" verifica; lo rechazamos antes. */
function hexToBuffer(hex: string): Buffer | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}
