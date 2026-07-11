// Roundtrip del repo de settings (T0.14) contra el clon de Testcontainers. Fija las
// cláusulas OBSERVABLES de la Verificación como tests permanentes (regla de trabajo 8):
//   1) round-trip: cifrar 'x' → persistir jsonb → leer → descifrar = 'x'
//   2) at-rest: el `value` almacenado es un blob {v,iv,tag,ct}, NUNCA la key en claro
//   4) bootstrap idempotente: seedSecretIfAbsent no sobrescribe una key ya presente
//
// El cifrado lo hace core/secrets (AES-256-GCM); db solo persiste el jsonb. El test
// deriva la clave de una master key de test y ejercita el camino completo — es la misma
// combinación (core cifra, db guarda) que corre en producción vía web.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@ugc/test-utils';
import { deriveSecretsKey, encryptSecret, decryptSecret } from '@ugc/core/secrets';
import type { SecretBlob } from '@ugc/core/secrets';
import {
  getSecretBlob,
  setSecretBlob,
  seedSecretIfAbsent,
  getPreferences,
  setPreferences,
  secretKey,
} from '../../src/repos/settings.repo';

const key = deriveSecretsKey('test-master-key-for-settings-repo');

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'settings-repo' });
});
afterAll(async () => {
  await tdb.close();
});
afterEach(async () => {
  await tdb.pool.query('DELETE FROM app_setting');
});

describe('settings repo: secretos cifrados en app_setting (T0.14)', () => {
  it('cláusula 1 — round-trip: cifrar → persistir → leer → descifrar = original', async () => {
    const plaintext = 'fal-live-key-9f8a7b6c5d4e';
    await setSecretBlob(tdb.db, 'fal', encryptSecret(plaintext, key));

    const stored = (await getSecretBlob(tdb.db, 'fal')) as SecretBlob;
    expect(decryptSecret(stored, key)).toBe(plaintext);
  });

  it('cláusula 2 — at-rest: el SELECT crudo devuelve {v,iv,tag,ct}, NUNCA la key en claro', async () => {
    const plaintext = 'anthropic-secret-key-abc123xyz';
    await setSecretBlob(tdb.db, 'anthropic', encryptSecret(plaintext, key));

    // SELECT directo del value (como haría el verifier en psql): es un blob cifrado.
    const { rows } = await tdb.pool.query<{ value: SecretBlob }>(
      `SELECT value FROM app_setting WHERE key = $1`,
      [secretKey('anthropic')],
    );
    expect(rows).toHaveLength(1);
    const value = rows[0]!.value;
    expect(value).toMatchObject({ v: 1 });
    expect(typeof value.iv).toBe('string');
    expect(typeof value.tag).toBe('string');
    expect(typeof value.ct).toBe('string');
    // El plaintext NO aparece en NINGÚN SELECT sobre app_setting (assert del verifier).
    const dump = await tdb.pool.query<{ raw: string }>(
      `SELECT key || ' ' || value::text AS raw FROM app_setting`,
    );
    const serialized = dump.rows.map((r) => r.raw).join('\n');
    expect(serialized).not.toContain(plaintext);
    expect(serialized).not.toContain('anthropic-secret-key');
  });

  it('getSecretBlob devuelve undefined en first boot (proveedor sin key)', async () => {
    expect(await getSecretBlob(tdb.db, 'firecrawl')).toBeUndefined();
  });

  it('setSecretBlob SOBRESCRIBE (edición desde /settings)', async () => {
    await setSecretBlob(tdb.db, 'fal', encryptSecret('key-v1', key));
    await setSecretBlob(tdb.db, 'fal', encryptSecret('key-v2', key));
    const stored = (await getSecretBlob(tdb.db, 'fal')) as SecretBlob;
    expect(decryptSecret(stored, key)).toBe('key-v2');
  });

  it('cláusula 4 — seedSecretIfAbsent es idempotente: no sobrescribe una key ya presente', async () => {
    // Primer arranque: FAL_KEY presente → siembra.
    expect(await seedSecretIfAbsent(tdb.db, 'fal', encryptSecret('bootstrap-key', key))).toBe(true);
    // Segundo arranque (env todavía presente, o distinta): NO sobrescribe.
    expect(await seedSecretIfAbsent(tdb.db, 'fal', encryptSecret('otra-key-distinta', key))).toBe(
      false,
    );
    // La key sembrada la primera vez permanece intacta (la BD es la fuente de verdad).
    const stored = (await getSecretBlob(tdb.db, 'fal')) as SecretBlob;
    expect(decryptSecret(stored, key)).toBe('bootstrap-key');
  });
});

describe('settings repo: preferencias (jsonb plano) (T0.14)', () => {
  it('getPreferences devuelve undefined en first boot', async () => {
    expect(await getPreferences(tdb.db)).toBeUndefined();
  });

  it('set + get hace roundtrip del objeto de preferencias', async () => {
    const prefs = {
      defaultLanguages: ['es', 'en'],
      durationPreset: 'short',
      thresholds: { killHookRate: 0.02, scaleHookRate: 0.04 },
    };
    await setPreferences(tdb.db, prefs);
    expect(await getPreferences(tdb.db)).toEqual(prefs);
  });

  it('setPreferences sobrescribe (upsert)', async () => {
    await setPreferences(tdb.db, { defaultLanguages: ['es'], durationPreset: 'standard' });
    await setPreferences(tdb.db, { defaultLanguages: ['pt-BR'], durationPreset: 'long' });
    expect(await getPreferences(tdb.db)).toEqual({
      defaultLanguages: ['pt-BR'],
      durationPreset: 'long',
    });
  });
});
