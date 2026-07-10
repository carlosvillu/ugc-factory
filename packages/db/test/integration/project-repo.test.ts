// Roundtrip real del repo de project contra el clon de Testcontainers
// (db-integration.md §6): el sistema de tipos no detecta un mapeo
// camelCase↔snake_case roto ni un default que solo existe en la BD — por eso el
// roundtrip se hace contra Postgres, no contra un stub. Y el enum nativo
// `project_status` (db-integration.md §5): su comportamiento observable se fija
// aquí para que un cambio accidental rompa un test, no producción.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, makeProject, type TestDatabase } from '@ugc/test-utils';
import { createProject, ensureDefaultProject, getProject } from '../../src/repos/project.repo';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'project-repo' });
});

afterAll(async () => {
  await tdb.close(); // OBLIGATORIO: sin esto el proceso de vitest no termina.
});

describe('project repo', () => {
  it('create/get hace roundtrip completo (defaults, enum, timestamps)', async () => {
    const created = await createProject(tdb.db, makeProject({ name: 'Demo ES' }));
    const fetched = await getProject(tdb.db, created.id);

    // RETURNING y SELECT devuelven exactamente la misma forma.
    expect(fetched).toEqual(created);
    // Defaults aplicados por la BD, no por el código:
    expect(created.defaultLocale).toBe('es');
    expect(created.status).toBe('active');
    expect(created.notes).toBeNull();
    // PK ULID generada en la app (26 chars) y timestamps poblados.
    expect(created.id).toHaveLength(26);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
  });

  it('respeta los overrides de la fila (name, locale, status, notes)', async () => {
    const created = await createProject(
      tdb.db,
      makeProject({
        name: 'Archivado',
        defaultLocale: 'en',
        status: 'archived',
        notes: 'una nota',
      }),
    );
    expect(created).toMatchObject({
      name: 'Archivado',
      defaultLocale: 'en',
      status: 'archived',
      notes: 'una nota',
    });
  });

  it('getProject devuelve undefined para un id inexistente', async () => {
    // ULID sintáctico válido pero sin fila: el SELECT no encuentra nada.
    expect(await getProject(tdb.db, '00000000000000000000000000')).toBeUndefined();
  });

  it('ensureDefaultProject crea un proyecto si no hay ninguno, y lo reutiliza si ya existe (T1.6)', async () => {
    // BD dedicada: sin filas de los tests de arriba, ensure DEBE crear.
    const fresh = await createTestDatabase({ label: 'project-repo-ensure' });
    try {
      const created = await ensureDefaultProject(fresh.db);
      expect(created.id).toHaveLength(26);
      // Segunda llamada: NO crea otra fila, devuelve la misma (el más antiguo por id).
      const again = await ensureDefaultProject(fresh.db);
      expect(again.id).toBe(created.id);
      const { rows } = await fresh.pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM project',
      );
      expect(rows[0]!.n).toBe(1);
    } finally {
      await fresh.close();
    }
  });

  it('el enum project_status rechaza un valor fuera del dominio', async () => {
    // Contra la BD real: el tipo TS impediría 'deleted' en el código, así que se
    // fuerza vía SQL crudo para probar que la CONSTRAINT del enum nativo existe.
    // Drizzle envuelve el error de pg ("Failed query…") y deja el mensaje real
    // de Postgres en `cause`: se asserta ahí, además del SQLSTATE 22P02.
    const err = await tdb.db
      .execute(
        sql`INSERT INTO project (id, name, status) VALUES ('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'x', 'deleted')`,
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
});
