import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveSecretsKey, encryptSecret, decryptSecret } from './crypto';

const MASTER = 'test-master-key-not-a-secret';
const key = deriveSecretsKey(MASTER);

describe('secrets/crypto (AES-256-GCM, T0.14)', () => {
  it('round-trip: cifrar → descifrar devuelve el valor original', () => {
    const plaintext = 'fal-key-abcdef123456';
    const blob = encryptSecret(plaintext, key);
    expect(decryptSecret(blob, key)).toBe(plaintext);
  });

  it('el blob tiene forma {v,iv,tag,ct} y el ct NO es el plaintext (at-rest)', () => {
    const plaintext = 'super-secret-value';
    const blob = encryptSecret(plaintext, key);
    expect(blob.v).toBe(1);
    expect(blob.iv).toMatch(/^[0-9a-f]{24}$/); // 12 bytes hex
    expect(blob.tag).toMatch(/^[0-9a-f]{32}$/); // 16 bytes hex
    expect(blob.ct).toMatch(/^[0-9a-f]+$/);
    // El plaintext no aparece en NINGÚN campo del blob (assert que espeja el del verifier).
    const serialized = JSON.stringify(blob);
    expect(serialized).not.toContain(plaintext);
    expect(serialized).not.toContain('super-secret');
  });

  it('usa un IV nuevo por cada cifrado (nunca reusa IV bajo la misma clave)', () => {
    const a = encryptSecret('same-value', key);
    const b = encryptSecret('same-value', key);
    // IV aleatorio ⇒ dos cifrados del MISMO valor producen iv/ct distintos.
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    // …pero ambos descifran al mismo plaintext.
    expect(decryptSecret(a, key)).toBe('same-value');
    expect(decryptSecret(b, key)).toBe('same-value');
  });

  it('LANZA si el ciphertext ha sido manipulado (tag mismatch)', () => {
    const blob = encryptSecret('tamper-me', key);
    // Muta un byte del ct: el auth tag ya no cuadra → decipher.final() lanza.
    const tampered = { ...blob, ct: flipFirstHexByte(blob.ct) };
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('LANZA si el auth tag ha sido manipulado', () => {
    const blob = encryptSecret('tamper-tag', key);
    const tampered = { ...blob, tag: flipFirstHexByte(blob.tag) };
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('LANZA al descifrar con una clave distinta (master key distinta)', () => {
    const blob = encryptSecret('cross-key', key);
    const otherKey = deriveSecretsKey('a-different-master-key');
    expect(() => decryptSecret(blob, otherKey)).toThrow();
  });

  it('deriveSecretsKey es determinista (misma master key ⇒ misma clave de 32 bytes)', () => {
    const k1 = deriveSecretsKey(MASTER);
    const k2 = deriveSecretsKey(MASTER);
    expect(k1.equals(k2)).toBe(true);
    expect(k1.length).toBe(32);
  });

  it('la clave de secretos DIFIERE de una derivada con el salt de sesión', () => {
    // Separación de dominio (§19.2): no debe coincidir con scrypt(master, 'ugc-session-v1').
    // Replicamos la derivación de sesión inline para comparar los salts de dominio.
    const sessionLike = scryptSync(MASTER, 'ugc-session-v1', 32);
    const secretsKey = deriveSecretsKey(MASTER);
    expect(secretsKey.equals(sessionLike)).toBe(false);
  });

  it('LANZA ante una master key vacía', () => {
    expect(() => deriveSecretsKey('')).toThrow();
  });

  it('LANZA ante un blob de versión no soportada', () => {
    const blob = encryptSecret('v-check', key);
    expect(() => decryptSecret({ ...blob, v: 99 }, key)).toThrow(/versión/);
  });
});

function flipFirstHexByte(hex: string): string {
  const first = hex.slice(0, 2);
  const flipped = (parseInt(first, 16) ^ 0xff).toString(16).padStart(2, '0');
  return flipped + hex.slice(2);
}
