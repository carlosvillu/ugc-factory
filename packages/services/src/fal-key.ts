// Carga de la API key de fal desde `app_setting` (cifrada, §19.2), FUENTE ÚNICA compartida por WEB
// (preview de voz T4.6, thumbnail + probar-template T4.12) y el WORKER (executors N7 + sweeper de
// reconciliación T4.3). Antes el worker leía la key EN CLARO de `process.env.FAL_KEY` mientras web la
// descifraba de la BD: esa asimetría obligaba a recrear el contenedor del worker para rotar la key.
// Ahora ambos la resuelven de aquí → una sola verdad, editable desde Ajustes → fal sin reiniciar nada.
//
// La firma `(db, secretsKey)` espeja a `loadAnthropicKey`/`loadFirecrawlKey` de este mismo paquete: el
// caller inyecta el `secretsKey` (derivado una vez de APP_MASTER_KEY), no se re-deriva por llamada.
// Lanza `AppError('provider_error', …)` ACCIONABLE (nunca un 500 opaco): distingue POR TIPO "no hay key
// configurada" de "la key no descifra" — son diagnósticos OPUESTOS (falta el secreto vs la master key es
// otra), disciplina de taxonomía de errores del proyecto (anti-T1.8).
import { AppError } from '@ugc/core/contracts';
import { decryptSecret, type SecretBlob } from '@ugc/core/secrets';
import { getSecretBlob, type DbClient } from '@ugc/db';

/** La API key de fal EN CLARO desde `app_setting`. Lanza `provider_error` si no hay key o no descifra. */
export async function loadFalKey(db: DbClient, secretsKey: Buffer): Promise<string> {
  const blob = await getSecretBlob(db, 'fal');
  if (blob === undefined || blob === null) {
    throw new AppError('provider_error', 'no hay API key de fal configurada (Ajustes → fal)');
  }
  try {
    return decryptSecret(blob as SecretBlob, secretsKey);
  } catch {
    throw new AppError('provider_error', 'la API key de fal no se pudo descifrar');
  }
}

/**
 * El `falOptions` con el override de base URL cuando el seam E2E `FAL_BASE_URL` está presente
 * (intercepción por-origen del FalClient de core). Compartido por los servidores de web que gastan fal
 * (preview de voz, thumbnail/probar-template, referencias de persona). En producción `FAL_BASE_URL`
 * está ausente → `undefined` → fal real.
 */
export function falOptionsFrom(
  falBaseUrl: string | undefined,
): { baseUrlOverride: string } | undefined {
  return falBaseUrl !== undefined && falBaseUrl !== ''
    ? { baseUrlOverride: falBaseUrl }
    : undefined;
}
