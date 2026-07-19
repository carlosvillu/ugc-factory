// Carga de la API key de fal desde `app_setting` (cifrada, §19.2), compartida por los servidores de
// web que gastan fal (preview de voz T4.6, thumbnail + probar-template T4.12). Lanza
// `provider_error` accionable si no hay key configurada o no se puede descifrar — nunca un 500 opaco.
import { AppError } from '@ugc/core/contracts';
import { getSecretsKeyFromEnv, decryptSecret, type SecretBlob } from '@ugc/core/secrets';
import { getSecretBlob, type DbClient } from '@ugc/db';

/** La API key de fal EN CLARO desde `app_setting`. Lanza `provider_error` si no hay key o no descifra. */
export async function loadFalKey(db: DbClient): Promise<string> {
  const blob = await getSecretBlob(db, 'fal');
  if (blob === undefined || blob === null) {
    throw new AppError('provider_error', 'no hay API key de fal configurada (Ajustes → fal)');
  }
  try {
    return decryptSecret(blob as SecretBlob, getSecretsKeyFromEnv());
  } catch {
    throw new AppError('provider_error', 'la API key de fal no se pudo descifrar');
  }
}
