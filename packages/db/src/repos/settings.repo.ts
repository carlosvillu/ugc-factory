// Repo de `app_setting` para el módulo de settings (T0.14). La tabla es un key-value
// jsonb (§12); este repo la lee/escribe por clave SIN conocer el cifrado: los blobs de
// credenciales llegan ya cifrados desde web (core/secrets deriva la clave de la master
// key de env y produce `{v,iv,tag,ct}`). db solo persiste el jsonb — misma división que
// el hash de password de T0.4 (web hashea con scrypt; db solo guarda el string).
//
// Claves usadas (namespaced, coherentes con `auth.password_hash` de T0.4):
//   secret.<provider>    → blob cifrado de la API key (jsonb {v,iv,tag,ct})
//   defaults.preferences → preferencias de lote (jsonb plano, NO cifrado)
import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { appSetting } from '../schema/ops';

const SECRET_KEY_PREFIX = 'secret.';
const PREFERENCES_KEY = 'defaults.preferences';

/** Clave de `app_setting` para el blob cifrado de un proveedor. */
export function secretKey(provider: string): string {
  return `${SECRET_KEY_PREFIX}${provider}`;
}

// ── Lectura/escritura genérica de una clave jsonb ──────────────────────────────
/** Lee el `value` jsonb de una clave, o `undefined` si no existe. El caller conoce su
 *  forma (blob cifrado, objeto de preferencias…) y la valida. Interno: los consumidores
 *  externos usan los helpers tipados por dominio de abajo. */
async function getSetting(db: Db, key: string): Promise<unknown> {
  const [row] = await db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(eq(appSetting.key, key));
  return row?.value;
}

/**
 * Upsert de una clave: inserta o SOBRESCRIBE el `value` jsonb. Es el camino de
 * edición desde /settings (guardar una key nueva machaca la anterior a propósito —
 * distinto del seed idempotente de abajo). `ON CONFLICT DO UPDATE`.
 */
async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db
    .insert(appSetting)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSetting.key, set: { value } });
}

/**
 * Siembra una clave SOLO si no existe (insert-if-absent, idempotente). `ON CONFLICT DO
 * NOTHING`: JAMÁS sobrescribe un valor ya presente. Devuelve `true` si sembró. Es el
 * primitivo genérico del que cuelgan los seeds tipados por dominio (`seedSecretIfAbsent`).
 */
async function seedSettingIfAbsent(db: Db, key: string, value: unknown): Promise<boolean> {
  const inserted = await db
    .insert(appSetting)
    .values({ key, value })
    .onConflictDoNothing({ target: appSetting.key })
    .returning({ key: appSetting.key });
  return inserted.length > 0;
}

// ── Secretos por proveedor (blob cifrado) ──────────────────────────────────────
/** Lee el blob cifrado de un proveedor, o `undefined` si aún no hay key guardada. */
export async function getSecretBlob(db: Db, provider: string): Promise<unknown> {
  return getSetting(db, secretKey(provider));
}

/** Escribe (upsert) el blob cifrado de un proveedor — la edición desde /settings. */
export async function setSecretBlob(db: Db, provider: string, blob: unknown): Promise<void> {
  await setSetting(db, secretKey(provider), blob);
}

/**
 * Siembra el blob de un proveedor SOLO si su clave no existe (insert-if-absent,
 * idempotente). `ON CONFLICT DO NOTHING`: JAMÁS sobrescribe una key ya presente en BD
 * — el bootstrap desde env (`FAL_KEY`) siembra la primera vez; después la BD es la
 * fuente de verdad y una env presente NO la pisa (mismo criterio que el hash de
 * password y el presupuesto de T0.4/T0.12). Devuelve `true` si sembró, `false` si ya
 * existía.
 */
export async function seedSecretIfAbsent(
  db: Db,
  provider: string,
  blob: unknown,
): Promise<boolean> {
  return seedSettingIfAbsent(db, secretKey(provider), blob);
}

// ── Preferencias (jsonb plano) ─────────────────────────────────────────────────
/** Lee el objeto de preferencias, o `undefined` si aún no se guardó (first boot). El
 *  caller lo valida con `SettingsPreferencesSchema` y cae al default si falta. */
export async function getPreferences(db: Db): Promise<unknown> {
  return getSetting(db, PREFERENCES_KEY);
}

/** Upsert de las preferencias — la edición desde /settings. */
export async function setPreferences(db: Db, preferences: unknown): Promise<void> {
  await setSetting(db, PREFERENCES_KEY, preferences);
}
