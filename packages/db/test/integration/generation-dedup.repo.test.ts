// Integración de la DEDUP GLOBAL de producción (T4.10, §9.6) contra Postgres real. El sistema de tipos NO
// detecta si el PREDICADO del índice único parcial `generation_production_content_hash_key` está mal, y
// ese predicado es DINERO + CONCURRENCIA + CORRECTNESS: debe imponer unicidad de `content_hash` entre las
// generaciones de producción VIVAS-O-EXITOSAS (`voice_preview = false` AND status NOT IN
// ('failed','cancelled')) — ni menos (una carrera de dos `submitting` idénticos submitearía dos veces y
// pagaría dos veces) ni más (un índice global rompería los retries de una `failed`). Estos tests fijan
// el predicado EXACTO para que un cambio accidental rompa un test, no producción.
//
// Los tres tests discriminantes de abajo (submitting/submitting choca, failed/submitting PASA,
// completed/submitting choca) distinguen este índice del `= 'completed'` ingenuo y del global — son la
// regresión permanente de la frontera. Los tests de los repos (`getCompletedGenerationByContentHash`,
// `insertProductionGenerationIfAbsent`) fijan el roundtrip y el `ON CONFLICT DO NOTHING`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@ugc/test-utils';
import {
  createGeneration,
  getCompletedGenerationByContentHash,
  insertProductionGenerationIfAbsent,
} from '../../src/repos/generation.repo';
import type { Generation } from '../../src/schema/generation';

const HASH = 'a'.repeat(64); // sha256 hex de mentira, pero con la forma real

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'generation-dedup' });
});
afterAll(async () => {
  await tdb.close();
});
beforeEach(async () => {
  await tdb.db.execute(sql`TRUNCATE TABLE generation CASCADE`);
  await tdb.db.execute(sql`TRUNCATE TABLE asset CASCADE`);
});

async function seed(status: Generation['status'], overrides: Partial<Generation> = {}) {
  return createGeneration(tdb.db, {
    modelProfileId: 'mp-flux',
    contentHash: HASH,
    status,
    ...overrides,
  });
}

/** Ejecuta un INSERT que se espera que VIOLE el índice de dedup de producción y devuelve el `cause` del
 *  driver pg (donde viaja el SQLSTATE 23505 + el nombre de la constraint). Assertar el nombre distingue
 *  ESTE índice de cualquier otro UNIQUE de la tabla (un match genérico de mensaje lo satisfaría). */
async function expectDedupConflict(insert: Promise<unknown>): Promise<void> {
  const err = await insert.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeDefined();
  const cause = (err as { cause?: { code?: string; constraint?: string } }).cause;
  expect(cause?.code).toBe('23505');
  expect(cause?.constraint).toBe('generation_production_content_hash_key');
}

describe('índice único parcial de dedup de producción (T4.10)', () => {
  it('RECHAZA una 2ª fila submitting con el mismo content_hash (la carrera se serializa en el INSERT)', async () => {
    await seed('submitting');
    // Insert crudo (no el repo con ON CONFLICT): debe VIOLAR el índice — es lo que hace que el repo
    // devuelva `undefined` en vez de crear un duplicado.
    await expectDedupConflict(seed('submitting'));
  });

  it('RECHAZA submitting cuando ya hay una completed con el mismo hash (backstop del dedup)', async () => {
    await seed('completed');
    await expectDedupConflict(seed('submitting'));
  });

  it('RECHAZA submitting cuando hay otra en vuelo (submitted/in_queue/in_progress)', async () => {
    for (const live of ['submitted', 'in_queue', 'in_progress'] as const) {
      await tdb.db.execute(sql`TRUNCATE TABLE generation CASCADE`);
      await seed(live);
      await expectDedupConflict(seed('submitting'));
    }
  });

  it('ADMITE submitting cuando la fila previa del mismo hash está FAILED (retry de producción)', async () => {
    // La CLAVE de por qué el predicado NO es global: una generación `failed` conserva su hash; su retry
    // DEBE poder insertar una nueva `submitting`. `failed` queda FUERA del predicado del índice.
    await seed('failed');
    const retry = await seed('submitting');
    expect(retry.status).toBe('submitting');
    // Coexisten: una failed + una submitting con el mismo hash.
    const rows = await tdb.db.query.generation.findMany({
      where: (g, { eq }) => eq(g.contentHash, HASH),
    });
    expect(rows).toHaveLength(2);
  });

  it('ADMITE submitting cuando la fila previa del mismo hash está CANCELLED', async () => {
    await seed('cancelled');
    const retry = await seed('submitting');
    expect(retry.status).toBe('submitting');
  });

  it('NO colisiona con una MUESTRA de preview del mismo hash (índices disjuntos: voice_preview=false vs true)', async () => {
    // El índice de previews (`voice_preview=true`) y el de producción (`=false`) son DISJUNTOS. Una fila
    // preview completed y una producción submitting con el MISMO hash conviven — cada una en su índice.
    await seed('completed', { voicePreview: true });
    const prod = await seed('submitting', { voicePreview: false });
    expect(prod.status).toBe('submitting');
  });
});

describe('insertProductionGenerationIfAbsent (T4.10)', () => {
  it('inserta la fila si no hay conflicto y devuelve la fila creada (voice_preview forzado a false)', async () => {
    const row = await insertProductionGenerationIfAbsent(tdb.db, {
      modelProfileId: 'mp-flux',
      contentHash: HASH,
      status: 'submitting',
      voicePreview: true, // se DEBE forzar a false (es el scope del índice de producción)
    });
    expect(row).toBeDefined();
    expect(row?.voicePreview).toBe(false);
    expect(row?.status).toBe('submitting');
  });

  it('devuelve undefined (no crea fila) si ya hay una viva-o-completed con ese hash — ON CONFLICT DO NOTHING', async () => {
    await seed('submitting');
    const second = await insertProductionGenerationIfAbsent(tdb.db, {
      modelProfileId: 'mp-flux',
      contentHash: HASH,
      status: 'submitting',
    });
    expect(second).toBeUndefined();
    // Sigue habiendo UNA sola fila (la primera), no dos.
    const rows = await tdb.db.query.generation.findMany({
      where: (g, { eq }) => eq(g.contentHash, HASH),
    });
    expect(rows).toHaveLength(1);
  });

  it('SÍ crea fila si la previa del mismo hash está failed (retry no bloqueado por el ON CONFLICT)', async () => {
    await seed('failed');
    const retry = await insertProductionGenerationIfAbsent(tdb.db, {
      modelProfileId: 'mp-flux',
      contentHash: HASH,
      status: 'submitting',
    });
    expect(retry).toBeDefined();
    expect(retry?.status).toBe('submitting');
  });
});

describe('getCompletedGenerationByContentHash (T4.10)', () => {
  it('devuelve la generación completed de producción con ese hash', async () => {
    const gen = await seed('completed');
    const hit = await getCompletedGenerationByContentHash(tdb.db, HASH);
    expect(hit?.id).toBe(gen.id);
  });

  it('NO devuelve una fila submitting/failed (solo completed sirve para reutilizar)', async () => {
    await seed('submitting');
    expect(await getCompletedGenerationByContentHash(tdb.db, HASH)).toBeUndefined();
    await tdb.db.execute(sql`TRUNCATE TABLE generation CASCADE`);
    await seed('failed');
    expect(await getCompletedGenerationByContentHash(tdb.db, HASH)).toBeUndefined();
  });

  it('NO devuelve una MUESTRA de preview completed (voice_preview=true): no es un asset de producción', async () => {
    await seed('completed', { voicePreview: true });
    expect(await getCompletedGenerationByContentHash(tdb.db, HASH)).toBeUndefined();
  });

  it('devuelve undefined si no hay ninguna fila con ese hash', async () => {
    expect(await getCompletedGenerationByContentHash(tdb.db, 'b'.repeat(64))).toBeUndefined();
  });
});
