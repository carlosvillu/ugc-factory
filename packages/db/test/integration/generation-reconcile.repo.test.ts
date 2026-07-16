// Integración de `listReconcilableGenerations` (T4.3, §9.6) contra Postgres real. El sistema de tipos
// no detecta que el filtro `inArray(status, [...])` esté MAL (incluir `in_progress` dispararía el
// re-encolado por tick = descarga desperdiciada / doble cobro potencial) ni el orden por id — por eso
// se prueba contra la BD. Es la regla load-bearing de idempotencia del enqueue: `in_progress` (=
// descarga ya encolada) y los terminales NO deben listarse. Regresión permanente de esa frontera.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@ugc/test-utils';
import {
  claimGenerationForReconcile,
  createGeneration,
  getGeneration,
  listReconcilableGenerations,
} from '../../src/repos/generation.repo';
import type { Generation } from '../../src/schema/generation';

const RECONCILABLE = ['submitting', 'submitted', 'in_queue'] as const;

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'generation-reconcile' });
});
afterAll(async () => {
  await tdb.close();
});
beforeEach(async () => {
  await tdb.db.execute(sql`TRUNCATE TABLE generation CASCADE`);
});

async function seed(status: Generation['status'], overrides: Partial<Generation> = {}) {
  return createGeneration(tdb.db, {
    modelProfileId: 'mp-flux',
    status,
    ...overrides,
  });
}

describe('listReconcilableGenerations (T4.3)', () => {
  it('INCLUYE submitting/submitted/in_queue/in_progress y EXCLUYE los terminales completed/failed/cancelled', async () => {
    const submitting = await seed('submitting');
    const submitted = await seed('submitted', { falRequestId: 'r-1' });
    const inQueue = await seed('in_queue', { falRequestId: 'r-2' });
    // `in_progress` SÍ se lista (T4.3 fix): la descarga encolada puede haberse perdido → recuperable.
    const inProgress = await seed('in_progress', { falRequestId: 'r-3' });
    // Los TERMINALES no se listan:
    await seed('completed', { falRequestId: 'r-4' });
    await seed('failed', { falRequestId: 'r-5' });
    await seed('cancelled', { falRequestId: 'r-6' });

    const rows = await listReconcilableGenerations(tdb.db);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([submitting.id, submitted.id, inQueue.id, inProgress.id].sort());
    // NINGÚN terminal aparece.
    for (const r of rows) {
      expect(['submitting', 'submitted', 'in_queue', 'in_progress']).toContain(r.status);
    }
  });

  it('in_progress SÍ se lista (T4.3 fix): una descarga que pudo perderse debe poder recuperarse', async () => {
    // Antes del fix `in_progress` se excluía y era un agujero negro. Ahora se re-lista para que el
    // sweeper pueda re-encolar la descarga si se perdió (la sub-lógica por deadline vive en core).
    const inProgress = await seed('in_progress', { falRequestId: 'r-only' });
    const rows = await listReconcilableGenerations(tdb.db);
    expect(rows.map((r) => r.id)).toEqual([inProgress.id]);
  });

  it('devuelve las filas ordenadas por id (orden de lock determinista, como el sweep de steps)', async () => {
    // Inserta en orden arbitrario; el listado las devuelve por id ascendente.
    await seed('submitted', { falRequestId: 'a' });
    await seed('submitting');
    await seed('in_queue', { falRequestId: 'b' });
    const rows = await listReconcilableGenerations(tdb.db);
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('sin filas reconciliables → lista vacía', async () => {
    await seed('completed', { falRequestId: 'done' });
    expect(await listReconcilableGenerations(tdb.db)).toEqual([]);
  });
});

describe('claimGenerationForReconcile (T4.3) — la revalidación condicional anti-doble-cobro', () => {
  it('aplica el patch y devuelve true cuando la fila SIGUE reconciliable', async () => {
    const gen = await seed('submitted', { falRequestId: 'r-1' });
    const claimed = await claimGenerationForReconcile(
      tdb.db,
      gen.id,
      { status: 'in_progress' },
      RECONCILABLE,
    );
    expect(claimed).toBe(true);
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('in_progress');
  });

  it('NO toca la fila y devuelve false si ya salió de los estados reconciliables (carrera)', async () => {
    // Simula el actor concurrente: la fila YA está `completed` (webhook + descarga la liquidaron y
    // escribieron su cost_entry). El claim del sweeper NO debe regresarla a `in_progress`.
    const gen = await seed('completed', { falRequestId: 'r-2', costActual: 1 });
    const claimed = await claimGenerationForReconcile(
      tdb.db,
      gen.id,
      { status: 'in_progress' },
      RECONCILABLE,
    );
    expect(claimed).toBe(false);
    // La fila queda INTACTA en completed (no regresada) — la barrera anti-doble-cobro.
    const after = await getGeneration(tdb.db, gen.id);
    expect(after?.status).toBe('completed');
    expect(after?.costActual).toBe(1);
  });

  it('CONTROL NEGATIVO del guard: un UPDATE incondicional (sin el WHERE de estado) SÍ regresaría el completed', async () => {
    // Prueba que el filtro de estado es lo que muerde: sin él, la fila completed se regresaría. Se hace
    // el UPDATE incondicional a mano y se confirma que regresa (por eso el guard es load-bearing).
    const gen = await seed('completed', { falRequestId: 'r-3' });
    await tdb.db.execute(sql`UPDATE generation SET status = 'in_progress' WHERE id = ${gen.id}`);
    // Sin el WHERE de estado, la fila completed FUE regresada — justo lo que el claim condicional evita.
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('in_progress');
  });
});
