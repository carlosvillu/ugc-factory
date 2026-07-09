// Repo de `app_setting` para la auth single-user (T0.4). La tabla es un key-value
// (§12); aquí solo la clave `auth.password_hash`. El hash lo produce web (scrypt,
// node:crypto); db solo lo persiste/lee — no conoce el algoritmo.
import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { appSetting } from '../schema/ops';

const AUTH_PASSWORD_HASH_KEY = 'auth.password_hash';

/** Lee el hash de password sembrado, o `undefined` si aún no existe (first boot). */
export async function getPasswordHash(db: Db): Promise<string | undefined> {
  const [row] = await db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(eq(appSetting.key, AUTH_PASSWORD_HASH_KEY));
  if (!row) return undefined;
  // `value` es jsonb; el hash se guarda como string JSON.
  return typeof row.value === 'string' ? row.value : undefined;
}

/**
 * Siembra el hash SOLO si la clave no existe (insert-if-absent, idempotente).
 * `ON CONFLICT DO NOTHING`: JAMÁS sobrescribe un hash ya sembrado — cambiar el
 * password no es re-seeding desde env. Devuelve `true` si insertó, `false` si ya
 * existía.
 */
export async function seedPasswordHashIfAbsent(db: Db, hash: string): Promise<boolean> {
  const inserted = await db
    .insert(appSetting)
    .values({ key: AUTH_PASSWORD_HASH_KEY, value: hash })
    .onConflictDoNothing({ target: appSetting.key })
    .returning({ key: appSetting.key });
  return inserted.length > 0;
}
