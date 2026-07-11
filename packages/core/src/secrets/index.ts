// API pública del módulo `secrets` (§19.2, T0.14): cifrado at-rest de credenciales con
// AES-256-GCM (node:crypto, cero deps). Lógica PURA — la clave se recibe como parámetro;
// web deriva de la master key de env y db persiste el blob. Subpath `@ugc/core/secrets`.
export { deriveSecretsKey, encryptSecret, decryptSecret, type SecretBlob } from './crypto';
// La clave derivada del ENTORNO (APP_MASTER_KEY), memoizada y perezosa. La comparten los dos
// composition roots (web: session.ts; worker: boss.ts) — antes cada uno tenía su clon.
export { getSecretsKeyFromEnv, resetSecretsKeyCache } from './env';
