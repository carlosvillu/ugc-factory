import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@ugc/test-utils';
import {
  guardPack,
  modelProfile,
  promptTemplate,
  promptVersion,
  type NewPromptTemplate,
} from '@ugc/db/schema';

// Fija el comportamiento OBSERVABLE que promete la migración 0015 (db-integration §5):
// UNIQUEs (incl. la de prompt_version compuesta), enums nativos y política ON DELETE.

let tdb: TestDatabase;
beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'gallery.constraints' });
});
afterAll(async () => {
  await tdb.close();
});

/** El error de pg viaja en `cause` del DrizzleQueryError (patrón de batch.constraints). */
interface PgCause {
  code?: string;
  message?: string;
  constraint?: string;
}
async function expectRejection(promise: Promise<unknown>): Promise<PgCause> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeDefined();
  const cause = (err as { cause?: PgCause }).cause;
  expect(cause).toBeDefined();
  return cause ?? {};
}

function makeTemplate(over: Partial<NewPromptTemplate> = {}): NewPromptTemplate {
  return {
    slug: `tpl-${Math.random().toString(36).slice(2)}`,
    title: 'T',
    kind: 'video',
    body: 'body {product.name}',
    language: 'es',
    ...over,
  };
}

describe('prompt_template: UNIQUE slug + enums (T3.1)', () => {
  it('roundtrip completo: defaults, arrays vacíos y enums', async () => {
    const [row] = await tdb.db.insert(promptTemplate).values(makeTemplate()).returning();
    if (!row) throw new Error('template no insertado');
    expect(row.status).toBe('draft'); // default de la BD
    expect(row.headVersion).toBe(0);
    expect(row.usageCount).toBe(0);
    expect(row.formats).toEqual([]); // default '{}'::text[]
    expect(row.featured).toBe(false);
  });

  it('rechaza slug duplicado', async () => {
    await tdb.db.insert(promptTemplate).values(makeTemplate({ slug: 'dup-slug' }));
    const cause = await expectRejection(
      tdb.db.insert(promptTemplate).values(makeTemplate({ slug: 'dup-slug' })),
    );
    expect(cause.code).toBe('23505'); // unique_violation
    expect(cause.constraint).toBe('prompt_template_slug_key');
  });

  it('rechaza un kind fuera del enum', async () => {
    const cause = await expectRejection(
      tdb.db.insert(promptTemplate).values(makeTemplate({ kind: 'gif' as never })),
    );
    expect(cause.message).toMatch(/invalid input value for enum/);
  });
});

describe('prompt_version: UNIQUE(template_id, version) + ON DELETE CASCADE (T3.1)', () => {
  it('acepta la misma version en templates distintos, rechaza el duplicado dentro del mismo', async () => {
    const [t1] = await tdb.db.insert(promptTemplate).values(makeTemplate()).returning();
    const [t2] = await tdb.db.insert(promptTemplate).values(makeTemplate()).returning();
    if (!t1 || !t2) throw new Error('templates no insertados');

    // Misma version=1 en dos templates distintos: OK.
    await tdb.db.insert(promptVersion).values([
      { templateId: t1.id, version: 1, body: 'b1' },
      { templateId: t2.id, version: 1, body: 'b2' },
    ]);

    // version=1 repetida en el MISMO template: rechazada.
    const cause = await expectRejection(
      tdb.db.insert(promptVersion).values({ templateId: t1.id, version: 1, body: 'b1-again' }),
    );
    expect(cause.code).toBe('23505');
    expect(cause.constraint).toBe('prompt_version_template_version_key');
  });

  it('borrar el template CASCADEA sus versiones', async () => {
    const [t] = await tdb.db.insert(promptTemplate).values(makeTemplate()).returning();
    if (!t) throw new Error('template no insertado');
    await tdb.db.insert(promptVersion).values([
      { templateId: t.id, version: 1, body: 'b1' },
      { templateId: t.id, version: 2, body: 'b2' },
    ]);

    await tdb.db.delete(promptTemplate).where(eq(promptTemplate.id, t.id));

    const survivors = await tdb.db
      .select()
      .from(promptVersion)
      .where(eq(promptVersion.templateId, t.id));
    expect(survivors).toHaveLength(0);
  });
});

describe('guard_pack: UNIQUE(key) + enum scope (T3.1)', () => {
  it('rechaza key duplicada', async () => {
    await tdb.db
      .insert(guardPack)
      .values({ key: 'guard.vertical.beauty', scope: 'vertical', vertical: 'beauty' });
    const cause = await expectRejection(
      tdb.db.insert(guardPack).values({ key: 'guard.vertical.beauty', scope: 'vertical' }),
    );
    expect(cause.code).toBe('23505');
    expect(cause.constraint).toBe('guard_pack_key_key');
  });

  it('rechaza un scope fuera del enum', async () => {
    const cause = await expectRejection(
      tdb.db.insert(guardPack).values({ key: 'guard.x', scope: 'weird' as never }),
    );
    expect(cause.message).toMatch(/invalid input value for enum/);
  });
});

describe('model_profile: UNIQUE(fal_endpoint) + enums (T3.1)', () => {
  it('rechaza fal_endpoint duplicado', async () => {
    await tdb.db.insert(modelProfile).values({ falEndpoint: 'fal-ai/veo3', kind: 't2v' });
    const cause = await expectRejection(
      tdb.db.insert(modelProfile).values({ falEndpoint: 'fal-ai/veo3', kind: 'i2v' }),
    );
    expect(cause.code).toBe('23505');
    expect(cause.constraint).toBe('model_profile_fal_endpoint_key');
  });

  it('rechaza un kind fuera del enum y aplica el default de status', async () => {
    const cause = await expectRejection(
      tdb.db.insert(modelProfile).values({ falEndpoint: 'fal-ai/x', kind: 'zzz' as never }),
    );
    expect(cause.message).toMatch(/invalid input value for enum/);

    const [row] = await tdb.db
      .insert(modelProfile)
      .values({ falEndpoint: 'fal-ai/kling', kind: 'i2v' })
      .returning();
    expect(row?.status).toBe('active'); // default de la BD
  });
});
