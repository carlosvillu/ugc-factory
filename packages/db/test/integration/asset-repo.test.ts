// Roundtrip real del repo de asset contra el clon de Testcontainers
// (db-integration.md §6): el sistema de tipos no detecta un mapeo
// camelCase↔snake_case roto (storageKey↔storage_key) ni un default que solo
// existe en la BD — por eso el roundtrip se hace contra Postgres. Y el enum nativo
// `asset_kind` (db-integration.md §5): su comportamiento observable se fija aquí
// para que un cambio accidental de la lista de §12 rompa un test, no producción.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, makeAsset, type TestDatabase } from '@ugc/test-utils';
import { createAsset, getAsset } from '../../src/repos/asset.repo';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'asset-repo' });
});

afterAll(async () => {
  await tdb.close(); // OBLIGATORIO: sin esto el proceso de vitest no termina.
});

describe('asset repo (T0.5)', () => {
  it('create/get hace roundtrip completo (subset mínimo, timestamps, PK ULID)', async () => {
    const created = await createAsset(
      tdb.db,
      makeAsset({
        kind: 'final_video',
        storageKey: 'runs/abc/master.mp4',
        mime: 'video/mp4',
        bytes: 123_456,
        checksum: 'a'.repeat(64),
      }),
    );
    const fetched = await getAsset(tdb.db, created.id);

    // RETURNING y SELECT devuelven exactamente la misma forma (mapeo camel↔snake ok).
    expect(fetched).toEqual(created);
    expect(created.kind).toBe('final_video');
    expect(created.storageKey).toBe('runs/abc/master.mp4');
    expect(created.mime).toBe('video/mp4');
    expect(created.bytes).toBe(123_456);
    expect(created.checksum).toBe('a'.repeat(64));
    // PK ULID (26 chars) y timestamps poblados por la BD.
    expect(created.id).toHaveLength(26);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
  });

  it('bytes vuelve como number, no string (integer, no bigint)', async () => {
    const created = await createAsset(tdb.db, makeAsset({ bytes: 987_654 }));
    const fetched = await getAsset(tdb.db, created.id);
    expect(typeof fetched?.bytes).toBe('number');
    expect(fetched?.bytes).toBe(987_654);
  });

  it('getAsset devuelve undefined para un id inexistente', async () => {
    expect(await getAsset(tdb.db, '00000000000000000000000000')).toBeUndefined();
  });

  it('el enum asset_kind rechaza un valor fuera de §12', async () => {
    // Contra la BD real: el tipo TS impediría 'bogus' en el código, así que se
    // fuerza vía SQL crudo para probar que la CONSTRAINT del enum nativo existe.
    const err = await tdb.db
      .execute(
        sql`INSERT INTO asset (id, kind, storage_key, mime, bytes, checksum)
            VALUES ('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'bogus', 'k', 'text/plain', 1, 'x')`,
      )
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeDefined();
    const cause = (err as { cause?: { message?: string; code?: string } }).cause;
    expect(cause?.message).toMatch(/invalid input value for enum/);
    expect(cause?.code).toBe('22P02'); // invalid_text_representation
  });

  it('acepta todos los valores de §12 del enum asset_kind', async () => {
    const kinds = [
      'product_image',
      'reference_image',
      'keyframe',
      'tts_audio',
      'avatar_clip',
      'broll_clip',
      'music_bed',
      'final_video',
      'thumbnail',
      'screenshot',
      'font',
      'other',
    ] as const;
    for (const kind of kinds) {
      const created = await createAsset(tdb.db, makeAsset({ kind }));
      expect(created.kind).toBe(kind);
    }
  });
});
