// Unit del verificador de firma de webhooks de fal (T4.2). PRINCIPIO 9 DE TESTING: estos tests
// firman con el MISMO builder que el verificador usa en producción (`buildFalWebhookMessage`), así
// que un "válido" que pasa demuestra SELF-CONSISTENCY, no CONFORMANCE con fal real. La conformance
// la aporta el fixture de un webhook firmado por fal DE VERDAD (ver `fal-webhook.fixture.test.ts`,
// hueco que el verifier rellena vía cloudflared). Por eso el valor real está en los NEGATIVOS DE
// SEGURIDAD con significado —otra clave, body manipulado, timestamp fuera de ventana, header
// ausente— cada uno con su CONTROL NEGATIVO explícito (el caso positivo gemelo demuestra que el
// rechazo se debe al defecto inyectado, no a otra cosa).
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildFalWebhookMessage,
  verifyFalWebhook,
  type FalJwks,
  type FalWebhookHeaders,
} from './fal-webhook';

/** Genera un par ED25519 de test y su JWK público (el que iría en el JWKS de fal). */
function makeKeypair(): { privateKey: KeyObject; jwk: FalJwks['keys'][number] } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { privateKey, jwk: publicKey.export({ format: 'jwk' }) };
}

/** Firma un body con la clave dada usando el MISMO layout que el verificador. Devuelve headers. */
function signWebhook(
  privateKey: KeyObject,
  p: { requestId: string; userId: string; timestamp: string; body: string },
): FalWebhookHeaders {
  const message = buildFalWebhookMessage(p);
  return {
    requestId: p.requestId,
    userId: p.userId,
    timestamp: p.timestamp,
    signature: sign(null, message, privateKey).toString('hex'),
  };
}

const NOW_MS = 1_700_000_000_000; // reloj fijo (ms)
const NOW_S = Math.floor(NOW_MS / 1000);
const BODY = JSON.stringify({ request_id: 'req-1', status: 'OK', payload: { images: [] } });

function depsWith(jwk: FalJwks['keys'][number], now = NOW_MS) {
  return { now: () => now, getJwks: (): Promise<FalJwks> => Promise.resolve({ keys: [jwk] }) };
}

describe('verifyFalWebhook — firma ED25519 (self-consistency)', () => {
  it('firma válida contra la clave del JWKS → ok', async () => {
    const { privateKey, jwk } = makeKeypair();
    const headers = signWebhook(privateKey, {
      requestId: 'req-1',
      userId: 'user-1',
      timestamp: String(NOW_S),
      body: BODY,
    });
    const res = await verifyFalWebhook(headers, BODY, depsWith(jwk));
    expect(res.ok).toBe(true);
  });

  it('válido cuando el JWKS trae VARIAS claves y solo una verifica (fal rota claves)', async () => {
    const signer = makeKeypair();
    const other = makeKeypair();
    const headers = signWebhook(signer.privateKey, {
      requestId: 'req-1',
      userId: 'user-1',
      timestamp: String(NOW_S),
      body: BODY,
    });
    // El JWKS trae la clave AJENA primero y la del firmante después: debe iterar y encontrarla.
    const jwks: FalJwks = { keys: [other.jwk, signer.jwk] };
    const res = await verifyFalWebhook(headers, BODY, {
      now: () => NOW_MS,
      getJwks: () => Promise.resolve(jwks),
    });
    expect(res.ok).toBe(true);
  });

  it('una clave MALFORMADA en el set no impide verificar contra la buena (sin DoS)', async () => {
    const signer = makeKeypair();
    const headers = signWebhook(signer.privateKey, {
      requestId: 'req-1',
      userId: 'user-1',
      timestamp: String(NOW_S),
      body: BODY,
    });
    // Una clave basura (x corrupto) delante de la buena: se traga por clave, no aborta la verificación.
    const junk = { kty: 'OKP', crv: 'Ed25519', x: '!!!not-base64url!!!' };
    const jwks: FalJwks = { keys: [junk, signer.jwk] };
    const res = await verifyFalWebhook(headers, BODY, {
      now: () => NOW_MS,
      getJwks: () => Promise.resolve(jwks),
    });
    expect(res.ok).toBe(true);
  });
});

describe('verifyFalWebhook — negativos de seguridad (cada uno con su control negativo)', () => {
  it('firma de OTRA clave (no en el JWKS) → rechazo; misma firma con SU clave → ok', async () => {
    const signer = makeKeypair();
    const attacker = makeKeypair();
    const p = { requestId: 'req-1', userId: 'user-1', timestamp: String(NOW_S), body: BODY };

    // Firmada por el atacante, verificada contra el JWKS del firmante legítimo → rechazo.
    const forged = signWebhook(attacker.privateKey, p);
    const bad = await verifyFalWebhook(forged, BODY, depsWith(signer.jwk));
    expect(bad).toEqual({ ok: false, reason: 'no_verifying_key' });

    // CONTROL NEGATIVO: la MISMA construcción firmada por la clave correcta pasa. Prueba que el
    // rechazo se debe a la clave equivocada, no a un defecto del layout/deps.
    const legit = signWebhook(signer.privateKey, p);
    expect((await verifyFalWebhook(legit, BODY, depsWith(signer.jwk))).ok).toBe(true);
  });

  it('body MANIPULADO tras firmar (1 byte distinto) → rechazo; body intacto → ok', async () => {
    const { privateKey, jwk } = makeKeypair();
    const headers = signWebhook(privateKey, {
      requestId: 'req-1',
      userId: 'user-1',
      timestamp: String(NOW_S),
      body: BODY,
    });

    // Se firmó BODY pero se verifica un body con un byte cambiado → sha256 distinto → firma no casa.
    const tampered = BODY.replace('OK', 'Ok');
    expect(tampered).not.toBe(BODY);
    const bad = await verifyFalWebhook(headers, tampered, depsWith(jwk));
    expect(bad).toEqual({ ok: false, reason: 'no_verifying_key' });

    // CONTROL NEGATIVO: el body ORIGINAL (el que se firmó) verifica. Prueba que el rechazo se
    // debe al byte manipulado, no a otra cosa — y que la firma cubre los bytes EXACTOS del cuerpo.
    expect((await verifyFalWebhook(headers, BODY, depsWith(jwk))).ok).toBe(true);
  });

  it('timestamp fuera de ±5 min (pasado y futuro) → rechazo; dentro de ventana → ok', async () => {
    const { privateKey, jwk } = makeKeypair();
    // Un timestamp de hace 6 min: la firma es VÁLIDA sobre ese timestamp, pero está fuera de ventana.
    const old = String(NOW_S - 360);
    const headersOld = signWebhook(privateKey, {
      requestId: 'req-1',
      userId: 'user-1',
      timestamp: old,
      body: BODY,
    });
    expect(await verifyFalWebhook(headersOld, BODY, depsWith(jwk))).toEqual({
      ok: false,
      reason: 'timestamp_out_of_window',
    });

    // Simétrico en el futuro (clock skew hacia adelante).
    const future = String(NOW_S + 360);
    const headersFuture = signWebhook(privateKey, {
      requestId: 'req-1',
      userId: 'user-1',
      timestamp: future,
      body: BODY,
    });
    expect(await verifyFalWebhook(headersFuture, BODY, depsWith(jwk))).toEqual({
      ok: false,
      reason: 'timestamp_out_of_window',
    });

    // CONTROL NEGATIVO: justo dentro de la ventana (299 s) con firma válida → ok. Prueba que el
    // rechazo es por la VENTANA, no por la firma, y fija el borde ±300 s.
    const edge = String(NOW_S - 299);
    const headersEdge = signWebhook(privateKey, {
      requestId: 'req-1',
      userId: 'user-1',
      timestamp: edge,
      body: BODY,
    });
    expect((await verifyFalWebhook(headersEdge, BODY, depsWith(jwk))).ok).toBe(true);
  });

  it('timestamp en SEGUNDOS vs now en MS: un now mal escalado (sin /1000) rechazaría lo válido', async () => {
    // CONFORMANCE de unidades: fal manda SEGUNDOS, `now()` da MS. Con la conversión correcta,
    // now=NOW_MS y timestamp=NOW_S casan. Este test MUERE si alguien compara now() (ms) con
    // timestamp (s) sin dividir — la diferencia sería ~1,7e12, muy fuera de ±300.
    const { privateKey, jwk } = makeKeypair();
    const headers = signWebhook(privateKey, {
      requestId: 'req-1',
      userId: 'user-1',
      timestamp: String(NOW_S),
      body: BODY,
    });
    expect((await verifyFalWebhook(headers, BODY, depsWith(jwk, NOW_MS))).ok).toBe(true);
  });

  it('header de firma ausente/vacío → missing_headers; presente → ok', async () => {
    const { privateKey, jwk } = makeKeypair();
    const p = { requestId: 'req-1', userId: 'user-1', timestamp: String(NOW_S), body: BODY };
    const headers = signWebhook(privateKey, p);

    // Firma vacía (header ausente en el handler): rechazo ANTES de tocar crypto.
    const noSig = { ...headers, signature: '' };
    expect(await verifyFalWebhook(noSig, BODY, depsWith(jwk))).toEqual({
      ok: false,
      reason: 'missing_headers',
    });
    // requestId vacío también.
    expect(await verifyFalWebhook({ ...headers, requestId: '' }, BODY, depsWith(jwk))).toEqual({
      ok: false,
      reason: 'missing_headers',
    });

    // CONTROL NEGATIVO: con todos los headers presentes, pasa.
    expect((await verifyFalWebhook(headers, BODY, depsWith(jwk))).ok).toBe(true);
  });

  it('firma malformada (no-hex / longitud impar) → malformed_signature', async () => {
    const { jwk } = makeKeypair();
    const base = { requestId: 'req-1', userId: 'user-1', timestamp: String(NOW_S) };
    expect(await verifyFalWebhook({ ...base, signature: 'zzzz' }, BODY, depsWith(jwk))).toEqual({
      ok: false,
      reason: 'malformed_signature',
    });
    expect(await verifyFalWebhook({ ...base, signature: 'abc' }, BODY, depsWith(jwk))).toEqual({
      ok: false,
      reason: 'malformed_signature',
    });
  });

  it('timestamp no numérico → malformed_timestamp', async () => {
    const { jwk } = makeKeypair();
    const headers = {
      requestId: 'req-1',
      userId: 'user-1',
      timestamp: 'not-a-number',
      signature: 'ab'.repeat(32),
    };
    expect(await verifyFalWebhook(headers, BODY, depsWith(jwk))).toEqual({
      ok: false,
      reason: 'malformed_timestamp',
    });
  });
});
