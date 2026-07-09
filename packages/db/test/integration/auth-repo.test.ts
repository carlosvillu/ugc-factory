// Roundtrip del repo de auth (T0.4) contra el clon de Testcontainers: el hash de
// password vive en `app_setting` (key-value jsonb). El contrato crítico es la
// IDEMPOTENCIA del seed — `seedPasswordHashIfAbsent` inserta si falta y JAMÁS
// sobrescribe (cambiar el password no es re-seeding desde env). Se fija aquí para
// que una regresión rompa un test, no producción.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@ugc/test-utils';
import { getPasswordHash, seedPasswordHashIfAbsent } from '../../src/repos/auth.repo';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'auth-repo' });
});
afterAll(async () => {
  await tdb.close();
});
afterEach(async () => {
  await tdb.pool.query('DELETE FROM app_setting');
});

describe('auth repo (app_setting: auth.password_hash)', () => {
  it('getPasswordHash devuelve undefined en first boot (clave ausente)', async () => {
    expect(await getPasswordHash(tdb.db)).toBeUndefined();
  });

  it('seed + read hace roundtrip del hash', async () => {
    const inserted = await seedPasswordHashIfAbsent(tdb.db, 'scrypt$aa$bb');
    expect(inserted).toBe(true);
    expect(await getPasswordHash(tdb.db)).toBe('scrypt$aa$bb');
  });

  it('seed es idempotente: NUNCA sobrescribe un hash ya sembrado', async () => {
    expect(await seedPasswordHashIfAbsent(tdb.db, 'primer-hash')).toBe(true);
    // Segundo seed con OTRO hash: no inserta y el original permanece intacto.
    expect(await seedPasswordHashIfAbsent(tdb.db, 'hash-distinto')).toBe(false);
    expect(await getPasswordHash(tdb.db)).toBe('primer-hash');
  });

  it('un valor jsonb no-string devuelve undefined (no revienta)', async () => {
    await tdb.pool.query(
      `INSERT INTO app_setting (key, value) VALUES ('auth.password_hash', '123'::jsonb)`,
    );
    expect(await getPasswordHash(tdb.db)).toBeUndefined();
  });
});
