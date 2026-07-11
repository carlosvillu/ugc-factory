// Sesión single-user (api.md §6, PRD §19.2). Stateless: cookie `ugc_session` con
// valor `exp.hmac` firmado con una clave derivada de APP_MASTER_KEY — sobrevive a
// reinicios del contenedor sin tabla de sesiones (single-user no necesita
// revocación por sesión). El password se hashea con scrypt (node:crypto, cero
// deps) y se compara con timingSafeEqual.
//
// Ninguna lectura de env en module scope: `getMasterKey()`/`sessionKey()` son
// accessors lazy (mismo contrato que getDb, testing/api.md §2.1). Importar este
// módulo — y por tanto `withAuth` y las rutas — NO exige APP_MASTER_KEY presente:
// el fail-fast por ausencia vive en el arranque (instrumentation.register()), no
// en import time, para que los tests handler-level puedan importar las rutas.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { deriveSecretsKey } from '@ugc/core/secrets';

export const SESSION_COOKIE = 'ugc_session';

// Duración de sesión: 30 días. La cookie porta su propia expiración (exp.hmac) y
// el Max-Age del navegador se alinea con ella.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let masterKeyCache: string | undefined;
// Clave de firma derivada (scrypt) memoizada: es determinista (master key + salt
// fijo), así que se calcula UNA vez, no en cada request autenticado. Load-bearing:
// se invalida junto a masterKeyCache en setMasterKeyForTests (si no, un test que
// cambie la master key firmaría/verificaría con la clave de sesión anterior).
let sessionKeyCache: Buffer | undefined;
// Clave de CIFRADO de secretos, derivada de la master key con un salt de dominio
// DISTINTO al de sesión (T0.14, §19.2). Memoizada por el mismo motivo que la de sesión
// (scrypt es caro y el resultado es constante para una master key dada). Se invalida
// junto a masterKeyCache en setMasterKeyForTests.
let secretsKeyCache: Buffer | undefined;

/** Clave maestra desde env. Lanza si falta — pero solo cuando se USA (login o
 *  verificación de sesión), nunca en import time. El fail-fast de arranque vive en
 *  instrumentation.register() (chequeo directo de process.env), que revienta antes
 *  de servir requests. */
function getMasterKey(): string {
  masterKeyCache ??= process.env.APP_MASTER_KEY ?? '';
  if (!masterKeyCache) {
    throw new Error(
      'APP_MASTER_KEY no está definida: es la única credencial de cifrado (PRD §19.2)',
    );
  }
  return masterKeyCache;
}

/** Solo para tests: fija (o limpia) la master key sin tocar process.env. Invalida
 *  también la clave de sesión derivada memoizada (si no, un test que cambie la
 *  master key seguiría firmando con la clave derivada de la anterior). */
export function setMasterKeyForTests(key: string | undefined): void {
  masterKeyCache = key;
  sessionKeyCache = undefined;
  secretsKeyCache = undefined;
}

/** Clave de cifrado de credenciales at-rest (T0.14). Derivada de APP_MASTER_KEY con el
 *  salt de dominio `'ugc-secrets-v1'` (core/secrets), SEPARADA de la clave de sesión:
 *  jamás se cifran secretos con la clave que firma cookies. La consume el módulo de
 *  settings (route handler + seeding). El fail-fast por master key ausente vive en
 *  `getMasterKey()`, igual que la sesión. */
export function getSecretsKey(): Buffer {
  secretsKeyCache ??= deriveSecretsKey(getMasterKey());
  return secretsKeyCache;
}

/** Clave de firma de la sesión, derivada de APP_MASTER_KEY con un salt fijo de
 *  dominio (separa este uso de otros usos futuros de la master key). Memoizada:
 *  scrypt es caro y el resultado es constante para una master key dada. */
function sessionKey(): Buffer {
  sessionKeyCache ??= scryptSync(getMasterKey(), 'ugc-session-v1', 32);
  return sessionKeyCache;
}

// ── Password hashing (scrypt) ────────────────────────────────────────────────
// Formato almacenado: `scrypt$<saltHex>$<hashHex>`. El salt es por-hash; el N/r/p
// son los defaults de node scryptSync (coste suficiente para un login humano).
const SCRYPT_KEYLEN = 64;

/** Comparación en tiempo constante con guarda de longitud. El `.length ===` NO es
 *  cosmético: `timingSafeEqual` LANZA si los buffers difieren en longitud, así que
 *  el guard corta antes y devuelve `false` en vez de tirar. */
function equalConstTime(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Comparación en tiempo constante. `false` (no throw) ante un stored malformado. */
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  return equalConstTime(actual, expected);
}

// ── Session cookie (exp.hmac) ────────────────────────────────────────────────
function signExp(exp: number): string {
  return createHmac('sha256', sessionKey()).update(String(exp)).digest('base64url');
}

/** Valor firmado de una sesión que expira en `now + ttl`. */
export function createSessionValue(
  now = Date.now(),
  ttlMs = SESSION_TTL_MS,
): { value: string; exp: number } {
  const exp = now + ttlMs;
  return { value: `${String(exp)}.${signExp(exp)}`, exp };
}

/** `Set-Cookie` de una sesión nueva. `Secure` SIEMPRE (api.md §6 literal:
 *  `HttpOnly; Secure; SameSite=Lax; Path=/`): la cookie es la única credencial de
 *  auth y no debe viajar por http en claro en ningún despliegue. Sobre
 *  http://localhost NO estorba — Chromium trata localhost/127.0.0.1 como
 *  secure-context, así que guarda cookies `Secure` igual (la Verificación de T0.4,
 *  que corre en http://localhost:3000, lo confirma: la cookie sobrevive al
 *  refresh). */
export function createSessionCookie(now = Date.now(), ttlMs = SESSION_TTL_MS): string {
  const { value } = createSessionValue(now, ttlMs);
  const maxAge = Math.floor(ttlMs / 1000);
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${String(maxAge)}`;
}

/** Verificación criptográfica COMPLETA de la cookie del propio Request (api.md
 *  §6): firma HMAC válida + no expirada. Lee la cookie del `Request` (no de
 *  next/headers) para que el 401 sea testeable a nivel handler. */
export function requireSession(req: Request): boolean {
  const value = parseCookieHeader(req.headers.get('cookie'))[SESSION_COOKIE];
  return isValidSessionValue(value);
}

/** Desempaqueta el formato `exp.hmac`: exp numérico finito + firma no vacía, o
 *  `null` si la forma es inválida. SOLO parseo — cada caller aplica su propia
 *  política (el proxy compara expiración sin HMAC; el handler añade la
 *  verificación criptográfica). No arrastra HMAC al camino barato del proxy. */
function parseSessionValue(value: string | undefined): { exp: number; sig: string } | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const exp = Number(value.slice(0, dot));
  const sig = value.slice(dot + 1);
  if (!Number.isFinite(exp) || !sig) return null;
  return { exp, sig };
}

/** Check barato para el proxy edge/nodejs: forma + expiración, SIN HMAC. La
 *  verificación criptográfica la hace requireSession en cada handler (withAuth). */
export function hasUnexpiredSessionShape(value: string | undefined, now = Date.now()): boolean {
  const parsed = parseSessionValue(value);
  return parsed !== null && parsed.exp > now;
}

function isValidSessionValue(value: string | undefined, now = Date.now()): boolean {
  const parsed = parseSessionValue(value);
  if (parsed === null || parsed.exp <= now) return false;
  const expected = Buffer.from(signExp(parsed.exp), 'base64url');
  const given = Buffer.from(parsed.sig, 'base64url');
  return equalConstTime(given, expected);
}

/** Parser mínimo de un header Cookie a mapa nombre→valor. */
export function parseCookieHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (name) out[name] = val;
  }
  return out;
}
