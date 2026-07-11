// Servicio de settings del lado servidor (T0.14): traduce entre los blobs cifrados de
// `app_setting` (db) y las vistas del contrato de core, cifrando/descifrando con la
// clave derivada de la master key (getSecretsKey). El route handler queda fino
// (api.md §1): parsea → delega aquí → serializa.
//
// Por qué aquí y no en el handler: el descifrado para calcular `last4` y el cifrado del
// PATCH son la ÚNICA lógica no trivial de la ruta; aislarla la hace testeable por
// separado y mantiene el handler como passthrough.
import type { DbClient } from '@ugc/db';
import { getSecretBlob, setSecretBlob, getPreferences, setPreferences } from '@ugc/db';
import { decryptSecret, encryptSecret, type SecretBlob } from '@ugc/core/secrets';
import {
  DEFAULT_SETTINGS_PREFERENCES,
  SECRET_PROVIDERS,
  SettingsPreferencesSchema,
  type MaskedSecret,
  type SettingsPatch,
  type SettingsPreferences,
  type SettingsView,
} from '@ugc/core/contracts';

/**
 * Enmascara el blob de un proveedor: `set` (¿hay key?) + `last4` (últimos 4 chars).
 * DESCIFRA el valor real para derivar `last4` — esto ejercita el round-trip de
 * descifrado en producción (la clave "sigue funcionando" = descifra al original) y NO
 * expone el valor: solo salen 4 chars. Si el descifrado falla (blob corrupto o master
 * key cambiada), degrada a `set:true, last4:null` — la key existe pero no es legible;
 * nunca revienta el GET entero por una credencial ilegible.
 */
function maskSecret(blob: unknown, key: Buffer): MaskedSecret {
  if (blob === undefined || blob === null) return { set: false, last4: null };
  try {
    const plaintext = decryptSecret(blob as SecretBlob, key);
    const last4 = plaintext.length >= 4 ? plaintext.slice(-4) : null;
    return { set: true, last4 };
  } catch {
    return { set: true, last4: null };
  }
}

/** Lee las preferencias guardadas y cae al default de fábrica si faltan o son inválidas
 *  (first boot, o un jsonb legado con otra forma). */
async function readPreferences(db: DbClient): Promise<SettingsPreferences> {
  const raw = await getPreferences(db);
  if (raw === undefined) return DEFAULT_SETTINGS_PREFERENCES;
  const parsed = SettingsPreferencesSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS_PREFERENCES;
}

/** Vista completa de /settings: cada credencial ENMASCARADA + las preferencias. Nunca
 *  incluye una key en claro (forms.md §6). */
export async function getSettingsView(db: DbClient, key: Buffer): Promise<SettingsView> {
  // Reads independientes → en paralelo (un round-trip por credencial + preferencias serían
  // 4 latencias en serie). Seguro porque todo caller pasa el pool client (getDb): NO portar
  // esto a un caller con DbTx — queries concurrentes sobre UNA transacción pg serializan/rompen.
  const [blobs, preferences] = await Promise.all([
    Promise.all(SECRET_PROVIDERS.map((provider) => getSecretBlob(db, provider))),
    readPreferences(db),
  ]);
  const secrets: SettingsView['secrets'] = {};
  SECRET_PROVIDERS.forEach((provider, i) => {
    secrets[provider] = maskSecret(blobs[i], key);
  });
  return { secrets, preferences };
}

/**
 * Aplica un PATCH: cifra y persiste cada key PRESENTE (write-only — el schema ya rechazó
 * las vacías; una key ausente simplemente no se toca, forms.md §6) y upserta las
 * preferencias si vienen. Devuelve la vista enmascarada resultante (para que el cliente
 * confirme sin re-renderizar la key).
 */
export async function applySettingsPatch(
  db: DbClient,
  key: Buffer,
  patch: SettingsPatch,
): Promise<SettingsView> {
  if (patch.secrets) {
    for (const provider of SECRET_PROVIDERS) {
      const value = patch.secrets[provider];
      // Solo se persiste la key si el usuario mandó un valor nuevo (no machaca la real).
      if (value !== undefined) {
        await setSecretBlob(db, provider, encryptSecret(value, key));
      }
    }
  }
  if (patch.preferences) {
    await setPreferences(db, patch.preferences);
  }
  return getSettingsView(db, key);
}
