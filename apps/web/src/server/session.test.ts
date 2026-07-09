// Unit de session (T0.4): hash scrypt + comparación timing-safe, y la firma/
// expiración de la cookie de sesión. Puro (node:crypto), sin BD — inyecta la
// master key con setMasterKeyForTests.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE,
  createSessionCookie,
  createSessionValue,
  hasUnexpiredSessionShape,
  hashPassword,
  parseCookieHeader,
  requireSession,
  setMasterKeyForTests,
  verifyPassword,
} from './session';

beforeEach(() => {
  setMasterKeyForTests('unit-test-master-key');
});
afterEach(() => {
  setMasterKeyForTests(undefined);
});

function reqWithCookie(value: string | undefined): Request {
  return new Request('http://test.local/', {
    headers: value ? { cookie: `${SESSION_COOKIE}=${value}` } : {},
  });
}

describe('password hashing (scrypt)', () => {
  it('verifica el password correcto y rechaza el incorrecto', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(verifyPassword('wrong password', stored)).toBe(false);
  });

  it('produce un salt distinto por hash (dos hashes del mismo password difieren)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('no lanza ante un stored malformado: devuelve false', () => {
    expect(verifyPassword('x', 'no-es-un-hash')).toBe(false);
    expect(verifyPassword('x', 'scrypt$deadbeef')).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
  });
});

describe('session cookie (exp.hmac)', () => {
  it('requireSession acepta una cookie recién firmada', () => {
    const { value } = createSessionValue();
    expect(requireSession(reqWithCookie(value))).toBe(true);
  });

  it('rechaza sin cookie', () => {
    expect(requireSession(reqWithCookie(undefined))).toBe(false);
  });

  it('rechaza una cookie expirada (exp en el pasado)', () => {
    const { value } = createSessionValue(Date.now() - 10_000, 1_000); // ya expiró
    expect(requireSession(reqWithCookie(value))).toBe(false);
  });

  it('rechaza una firma manipulada (mismo exp, sig cambiada)', () => {
    const { value } = createSessionValue();
    const exp = value.split('.')[0] ?? '';
    const tampered = `${exp}.${Buffer.from('forged').toString('base64url')}`;
    expect(requireSession(reqWithCookie(tampered))).toBe(false);
  });

  it('rechaza una cookie firmada con OTRA master key', () => {
    const { value } = createSessionValue();
    setMasterKeyForTests('a-different-master-key');
    expect(requireSession(reqWithCookie(value))).toBe(false);
  });

  it('createSessionCookie marca los cuatro flags de api.md §6: HttpOnly; Secure; SameSite=Lax; Path=/', () => {
    const header = createSessionCookie();
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Secure/i); // incondicional (spec-literal): localhost es secure-context en Chromium
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Path=\//i);
  });
});

describe('hasUnexpiredSessionShape (check barato del proxy)', () => {
  it('true para una forma con exp futuro, false para expirada/vacía/malformada', () => {
    expect(hasUnexpiredSessionShape(`${String(Date.now() + 10_000)}.sig`)).toBe(true);
    expect(hasUnexpiredSessionShape(`${String(Date.now() - 10_000)}.sig`)).toBe(false);
    expect(hasUnexpiredSessionShape(undefined)).toBe(false);
    expect(hasUnexpiredSessionShape('sinpunto')).toBe(false);
  });
});

describe('parseCookieHeader', () => {
  it('parsea varias cookies y tolera espacios', () => {
    expect(parseCookieHeader('a=1; b=2;c=3')).toEqual({ a: '1', b: '2', c: '3' });
    expect(parseCookieHeader(null)).toEqual({});
  });
});
