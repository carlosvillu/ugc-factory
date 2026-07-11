// Cifrado at-rest de credenciales (§19.2, T0.14). AEAD simétrico AES-256-GCM vía
// `node:crypto` — CERO dependencias de crypto (misma disciplina que T0.4, que hashea
// passwords con scrypt de node). El PRD §19.2 decía "libsodium sealed box" en el
// borrador; reconciliado el 2026-07-11 a AES-256-GCM porque un sealed box es cifrado
// ASIMÉTRICO e incompatible con el invariante "la master key simétrica es la ÚNICA
// credencial en env".
//
// LÓGICA PURA (por eso vive en core, no en web ni db): la clave se recibe como
// parámetro. Quien la deriva de la master key de env (`getSecretsKey()` en web) y quien
// persiste el blob (repo de db) son capas de arriba. Así este módulo se testea como
// unit puro y no importa `process.env` ni el pool de la BD.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// Salt de dominio para la derivación scrypt. DEBE ser distinto del de sesión
// (`'ugc-session-v1'`, session.ts): NUNCA se cifran secretos con la misma clave que
// firma las cookies de sesión. Separación de dominio criptográfico (§19.2).
const SECRETS_KEY_SALT = 'ugc-secrets-v1';

// AES-256 ⇒ clave de 32 bytes; GCM ⇒ IV de 12 bytes (el tamaño recomendado por NIST
// para GCM) y auth tag de 16 bytes.
const KEY_LEN = 32;
const IV_LEN = 12;

/** Versión del formato del blob. Un cambio de esquema (rotación de clave, otro cipher)
 *  incrementa esto y el descifrado ramifica por `v`. Hoy solo existe la v1. */
const BLOB_VERSION = 1;

/**
 * Forma persistida en `app_setting.value` (jsonb, no bytea — la columna es jsonb, PRD
 * §12). Espeja la convención `scrypt$salt$hash` de T0.4 pero como objeto jsonb. El
 * assert del verifier "no aparece la key en claro en ningún SELECT" corre contra esta
 * forma: `ct` es el ciphertext cifrado, nunca el plaintext.
 */
export interface SecretBlob {
  v: number; // versión del formato
  iv: string; // hex, 12 bytes aleatorios — nuevo por cada cifrado (nunca reusar bajo la misma clave)
  tag: string; // hex, 16 bytes — auth tag de GCM; su verificación es lo que hace fallar el tampering
  ct: string; // hex — el ciphertext
}

/**
 * Deriva la clave AES-256 de la master key con scrypt y el salt de dominio de secretos.
 * Determinista para una master key dada (misma master key ⇒ misma clave ⇒ los blobs
 * cifrados antes de un reinicio siguen descifrando después). Reusa el patrón de
 * `sessionKey()` de T0.4 (scryptSync(masterKey, salt, 32)) con un salt DISTINTO.
 */
export function deriveSecretsKey(masterKey: string): Buffer {
  if (!masterKey) {
    // Defensa en profundidad: el fail-fast de env vive en web, pero derivar con clave
    // vacía produciría una clave predecible — reventar es correcto.
    throw new Error('deriveSecretsKey: master key vacía (§19.2)');
  }
  return scryptSync(masterKey, SECRETS_KEY_SALT, KEY_LEN);
}

/**
 * Cifra `plaintext` con AES-256-GCM. IV ALEATORIO fresco por llamada (nunca se reusa un
 * IV bajo la misma clave — reusarlo rompe la seguridad de GCM). Devuelve el blob jsonb
 * `{v,iv,tag,ct}` listo para persistir.
 */
export function encryptSecret(plaintext: string, key: Buffer): SecretBlob {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: BLOB_VERSION,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ct: ct.toString('hex'),
  };
}

/**
 * Descifra un `SecretBlob` a su plaintext original. Verifica el auth tag: si el `ct` o
 * el `tag` han sido manipulados, `decipher.final()` LANZA (no devuelve basura) — esa
 * excepción NO se traga: un tag inválido DEBE fallar el descifrado (integridad, §19.2).
 * Lanza también ante un blob con forma/versión inválida.
 */
export function decryptSecret(blob: SecretBlob, key: Buffer): string {
  if (blob.v !== BLOB_VERSION) {
    throw new Error(`decryptSecret: versión de blob no soportada (${String(blob.v)})`);
  }
  const iv = Buffer.from(blob.iv, 'hex');
  const tag = Buffer.from(blob.tag, 'hex');
  const ct = Buffer.from(blob.ct, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  // Si el tag no cuadra (tampering en ct/tag/iv), `final()` lanza aquí: se propaga.
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plaintext.toString('utf8');
}
