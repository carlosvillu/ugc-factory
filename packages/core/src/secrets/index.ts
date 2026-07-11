// API pública del módulo `secrets` (§19.2, T0.14): cifrado at-rest de credenciales con
// AES-256-GCM (node:crypto, cero deps). Lógica PURA — la clave se recibe como parámetro;
// web deriva de la master key de env y db persiste el blob. Subpath `@ugc/core/secrets`.
export { deriveSecretsKey, encryptSecret, decryptSecret, type SecretBlob } from './crypto';
