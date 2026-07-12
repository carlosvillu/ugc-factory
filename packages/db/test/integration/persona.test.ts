// Integración de `persona` contra Postgres real (T2.0; testing/db-integration.md §5–§6).
//
// Qué se fija aquí, y por qué CADA cosa:
//   §5 (lo que la MIGRACIÓN promete): el UNIQUE de `name` (la clave natural que hace idempotente
//      el seed), el enum nativo de género, y —la deuda heredada de T2.1— la FK
//      `ad_variant.persona_id → persona.id` con `ON DELETE set null`: **borrar una persona NO
//      borra los anuncios que ya hizo**. Eso es una decisión de producto y por eso lleva test.
//   §6 (lo que el REPO promete): roundtrip completo (jsonb del voice_map, array de imágenes,
//      camelCase↔snake_case), append de imágenes de referencia, borrado en cascada de los
//      assets, y la idempotencia del upsert por nombre (perf e imágenes NO se pisan).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createTestDatabase,
  makeAdBatch,
  makeAdVariant,
  makeAsset,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import { adBatch, adVariant, asset, productBrief, project, urlAnalysis } from '@ugc/db/schema';
import {
  addReferenceImage,
  countPersonas,
  createPersona,
  getPersona,
  listPersonas,
  removePersona,
  removeReferenceImage,
  updatePersona,
  upsertPersonaByName,
} from '../../src/repos/persona.repo';
import type { NewPersona } from '../../src/schema/gallery';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'persona' });
});

afterAll(async () => {
  await tdb.close();
});

/** Una fila `persona` válida. `name` único por llamada: la suite corre contra UNA base y el
 *  UNIQUE de `name` haría chocar dos tests que usaran el mismo nombre. */
let nameCounter = 0;
function makePersonaRow(overrides: Partial<NewPersona> = {}): NewPersona {
  nameCounter += 1;
  return {
    name: `Persona ${String(nameCounter)}`,
    ageRange: '25-34',
    gender: 'female',
    ethnicity: 'latina',
    style: 'casual',
    descriptor: 'mujer de 29 años, latina, look casual',
    setting: 'baño con luz natural, encimera con productos',
    personality: 'Cercana y directa.',
    wardrobeNotes: 'Camiseta lisa, pelo recogido.',
    voiceMap: {
      es: { provider: 'elevenlabs', voiceId: 'v_es_1' },
      en: { provider: 'minimax', voiceId: 'v_en_1' },
    },
    ...overrides,
  };
}

/** El error de pg viaja en `cause` del DrizzleQueryError (patrón de batch.constraints /
 *  analysis.constraints): el `message` del error de Drizzle es la query, no el error de
 *  Postgres. Se asserta sobre el SQLSTATE, que es el contrato real y no cambia de wording. */
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

/** project → url_analysis → product_brief → ad_batch (mismo encadenado que batch.constraints).
 *  Devuelve el id del lote: es lo único que necesita una `ad_variant`. */
async function seedBatch(): Promise<string> {
  const [p] = await tdb.db.insert(project).values(makeProject()).returning();
  if (!p) throw new Error('project no insertado');
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p.id }))
    .returning();
  if (!ua) throw new Error('url_analysis no insertado');
  const [brief] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua.id }))
    .returning();
  if (!brief) throw new Error('product_brief no insertado');
  const [batch] = await tdb.db
    .insert(adBatch)
    .values(makeAdBatch({ projectId: p.id, briefId: brief.id }))
    .returning();
  if (!batch) throw new Error('ad_batch no insertado');
  return batch.id;
}

describe('persona: constraints de la migración (T2.0)', () => {
  it('rechaza dos personas con el MISMO nombre (clave natural del seed)', async () => {
    await createPersona(tdb.db, makePersonaRow({ name: 'Clon' }));
    const cause = await expectRejection(createPersona(tdb.db, makePersonaRow({ name: 'Clon' })));
    expect(cause.code).toBe('23505'); // unique_violation
    expect(cause.constraint).toBe('persona_name_key');
  });

  it('rechaza un género fuera del enum nativo', async () => {
    const cause = await expectRejection(
      createPersona(tdb.db, makePersonaRow({ gender: 'alien' as never })),
    );
    expect(cause.code).toBe('22P02'); // invalid_text_representation (valor fuera del enum)
  });
});

describe('persona: el repo (CRUD, imágenes, voice_map)', () => {
  it('create/get hace roundtrip completo (voice_map jsonb, defaults, snake_case)', async () => {
    const created = await createPersona(tdb.db, makePersonaRow());
    const fetched = await getPersona(tdb.db, created.id);

    expect(fetched).toEqual(created);
    // El voice_map sobrevive al viaje por jsonb con su PROVEEDOR (§11: el voiceId solo es
    // unívoco dentro de su proveedor — perder el provider haría ambiguo el id).
    expect(fetched?.voiceMap).toEqual({
      es: { provider: 'elevenlabs', voiceId: 'v_es_1' },
      en: { provider: 'minimax', voiceId: 'v_en_1' },
    });
    // Defaults aplicados por la BD, no por el caller.
    expect(fetched?.referenceImageIds).toEqual([]);
    expect(fetched?.perf).toBeNull();
  });

  it('update aplica un patch PARCIAL sin tocar el resto', async () => {
    const created = await createPersona(tdb.db, makePersonaRow({ style: 'casual' }));
    const updated = await updatePersona(tdb.db, created.id, { style: 'elegante' });

    expect(updated?.style).toBe('elegante');
    expect(updated?.personality).toBe(created.personality); // intacto
    expect(updated?.voiceMap).toEqual(created.voiceMap);
  });

  it('update de un id inexistente devuelve undefined (el endpoint lo mapea a 404)', async () => {
    expect(
      await updatePersona(tdb.db, '01ZZZZZZZZZZZZZZZZZZZZZZZZ', { style: 'x' }),
    ).toBeUndefined();
  });

  // EL PATCH VACÍO (code-review de T2.0). `PersonaPatchSchema` es `.partial()`, así que un body
  // `{}` VALIDA y llegaba hasta aquí: `db.update().set({})` lanza **`No values to set`** —un
  // `Error` genérico, no un `AppError`— y el envelope lo rendía como **500**. El camino era el más
  // banal del mundo: abrir la ficha y pulsar «Guardar» sin cambiar nada.
  //
  // Se prueba en el REPO (además de en la API) porque `updatePersona` es exportado: cualquier
  // caller futuro (T2.2, T2.3) tropezaría con la misma mina. Un patch sin columnas es un NO-OP,
  // no un error: devuelve la fila tal cual.
  it('update con un patch VACÍO es un NO-OP: devuelve la fila intacta, no revienta', async () => {
    const created = await createPersona(tdb.db, makePersonaRow({ style: 'casual' }));

    const updated = await updatePersona(tdb.db, created.id, {});

    expect(updated).toEqual(created); // ni una columna distinta…
    expect(updated?.updatedAt).toEqual(created.updatedAt); // …ni siquiera la fecha: no ha pasado nada
  });

  it('update con un patch VACÍO de un id inexistente sigue siendo undefined (404)', async () => {
    // El no-op no puede inventarse una fila: si la persona no existe, el contrato es el mismo.
    expect(await updatePersona(tdb.db, '01ZZZZZZZZZZZZZZZZZZZZZZZZ', {})).toBeUndefined();
  });

  it('addReferenceImage añade EN ORDEN (el primero es el retrato principal)', async () => {
    const p = await createPersona(tdb.db, makePersonaRow());
    const [a1] = await tdb.db
      .insert(asset)
      .values(makeAsset({ kind: 'reference_image' }))
      .returning();
    const [a2] = await tdb.db
      .insert(asset)
      .values(makeAsset({ kind: 'reference_image' }))
      .returning();

    await addReferenceImage(tdb.db, p.id, a1!.id);
    const after = await addReferenceImage(tdb.db, p.id, a2!.id);

    // El orden es el de subida: append, no set. El identity lock usa el primero como principal.
    expect(after?.referenceImageIds).toEqual([a1!.id, a2!.id]);
  });

  it('removeReferenceImage quita el id y BORRA la fila asset (devolviendo su storage_key)', async () => {
    const p = await createPersona(tdb.db, makePersonaRow());
    const [a1] = await tdb.db
      .insert(asset)
      .values(makeAsset({ kind: 'reference_image' }))
      .returning();
    await addReferenceImage(tdb.db, p.id, a1!.id);

    const result = await removeReferenceImage(tdb.db, p.id, a1!.id);

    expect(result?.persona.referenceImageIds).toEqual([]);
    expect(result?.storageKey).toBe(a1!.storageKey); // el caller borra el FICHERO con esta key
    expect(await tdb.db.select().from(asset).where(eq(asset.id, a1!.id))).toHaveLength(0);
  });

  it('listPersonas devuelve la librería ordenada por nombre (orden estable de la lista de /personas)', async () => {
    // Se insertan DESORDENADAS a propósito: si `listPersonas` no ordenara, saldrían en el orden
    // físico de la tabla y este assert se caería. Nombres con prefijo propio para no depender
    // de las personas que hayan creado los tests anteriores en esta misma BD.
    await createPersona(tdb.db, makePersonaRow({ name: 'zzz-orden-C' }));
    await createPersona(tdb.db, makePersonaRow({ name: 'zzz-orden-A' }));
    await createPersona(tdb.db, makePersonaRow({ name: 'zzz-orden-B' }));

    const all = await listPersonas(tdb.db);
    const mine = all.filter((p) => p.name.startsWith('zzz-orden-')).map((p) => p.name);
    expect(mine).toEqual(['zzz-orden-A', 'zzz-orden-B', 'zzz-orden-C']);
    expect(await countPersonas(tdb.db)).toBe(all.length);
  });
});

describe('persona: borrado (la política de §12 que decide T2.0)', () => {
  it('borrar una persona BORRA sus assets de referencia y devuelve sus storage_keys', async () => {
    const p = await createPersona(tdb.db, makePersonaRow());
    const [a1] = await tdb.db
      .insert(asset)
      .values(makeAsset({ kind: 'reference_image' }))
      .returning();
    await addReferenceImage(tdb.db, p.id, a1!.id);

    const keys = await removePersona(tdb.db, p.id);

    expect(keys).toEqual([a1!.storageKey]);
    expect(await getPersona(tdb.db, p.id)).toBeUndefined();
    expect(await tdb.db.select().from(asset).where(eq(asset.id, a1!.id))).toHaveLength(0);
  });

  it('borrar una persona NO borra los anuncios que ya hizo: la FK es ON DELETE set null', async () => {
    // ESTA ES LA DEUDA HEREDADA DE T2.1 (persona_id era texto nullable SIN FK). Ahora hay FK, y
    // su política es una decisión de PRODUCTO: retirar una persona de la librería no puede
    // destruir las variantes generadas con ella (siguen publicadas, siguen midiendo).
    const batchId = await seedBatch();
    const p = await createPersona(tdb.db, makePersonaRow());
    const [variant] = await tdb.db
      .insert(adVariant)
      .values(makeAdVariant({ batchId, personaId: p.id }))
      .returning();

    await removePersona(tdb.db, p.id);

    // La variante SIGUE EXISTIENDO; solo perdió el puntero a la persona.
    const [after] = await tdb.db.select().from(adVariant).where(eq(adVariant.id, variant!.id));
    expect(after).toBeDefined();
    expect(after?.personaId).toBeNull();
  });

  it('la FK RECHAZA una variante que apunte a una persona inexistente', async () => {
    // El otro lado de la FK: antes de T2.0 `persona_id` era texto libre y esto pasaba en
    // silencio (una variante apuntando a la nada). Ahora es un 23503.
    const batchId = await seedBatch();
    const cause = await expectRejection(
      tdb.db
        .insert(adVariant)
        .values(makeAdVariant({ batchId, personaId: '01ZZZZZZZZZZZZZZZZZZZZZZZZ' })),
    );
    expect(cause.code).toBe('23503'); // foreign_key_violation
    expect(cause.constraint).toBe('ad_variant_persona_id_persona_id_fk');
  });
});

describe('persona: seed idempotente por nombre (mismo contrato que la librería de T2.1)', () => {
  it('re-sembrar NO duplica: actualiza los metadatos y respeta perf e imágenes', async () => {
    const seed = makePersonaRow({ name: 'Seed Persona', style: 'casual' });

    const first = await upsertPersonaByName(tdb.db, seed);
    expect(first.created).toBe(true);

    // El usuario le sube una imagen a mano y F7 le acumula rendimiento.
    const [img] = await tdb.db
      .insert(asset)
      .values(makeAsset({ kind: 'reference_image' }))
      .returning();
    await addReferenceImage(tdb.db, first.persona.id, img!.id);
    await updatePersona(tdb.db, first.persona.id, { perf: { uses: 12, ctr: 0.031 } });

    // Se corrige el seed (cambia el estilo) y se vuelve a sembrar.
    const second = await upsertPersonaByName(tdb.db, { ...seed, style: 'elegante' });

    expect(second.created).toBe(false);
    expect(second.persona.id).toBe(first.persona.id); // MISMA fila: las FKs de ad_variant siguen válidas
    expect(second.persona.style).toBe('elegante'); // el METADATO se refresca (el seed manda)
    // …pero la HISTORIA es de la BD: ni el perf acumulado ni las imágenes que subió el usuario
    // se pierden al re-sembrar. Es lo que hace seguro correr `pnpm seed` en cualquier momento.
    expect(second.persona.perf).toEqual({ uses: 12, ctr: 0.031 });
    expect(second.persona.referenceImageIds).toEqual([img!.id]);
  });
});
