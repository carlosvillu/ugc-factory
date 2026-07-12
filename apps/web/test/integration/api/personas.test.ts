// Integración handler-level de la API de PERSONAS (T2.0) contra Postgres real + un
// StorageAdapter sobre tmpdir (api.md §2, nivel 1).
//
// Fija como regresión permanente las TRES cláusulas de la Verificación de T2.0 que son
// deterministas y gratuitas (regla de trabajo 8 del planning: van dentro de `pnpm gate`):
//
//   1. CRUD + voice_map es/en: crear una persona con su voice_map de dos idiomas y recuperarla
//      con el mismo shape (el `provider` incluido — §11).
//   2. EL GUARD ≥2K, POR EL CAMINO REAL: se generan PNGs de VERDAD (sharp) y se suben por el
//      endpoint real. Uno de 2048 px pasa; uno de 512 px es RECHAZADO con `validation_error` y
//      un mensaje que dice cuánto mide. El test NO fabrica `{width: 2048}` ni reimplementa la
//      regla: pregunta al código de producción (principio 9 de la skill testing).
//   3. CANDIDATAS: un `avatar_hint` compatible devuelve la persona correcta; uno incompatible,
//      NINGUNA.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, makeTestPng, type TestDatabase } from '@ugc/test-utils';
import { getAsset, getPersona, makeLocalStorageAdapter } from '@ugc/db';
import { MIN_REFERENCE_LONG_EDGE_PX, type Persona } from '@ugc/core/persona';
import { setDbForTests } from '@/server/db';
import { setStorageForTests } from '@/server/storage';
import { createSessionValue, setMasterKeyForTests, SESSION_COOKIE } from '@/server/session';
import { GET as listPersonasRoute, POST as createPersonaRoute } from '@/app/api/personas/route';
import {
  DELETE as deletePersonaRoute,
  GET as getPersonaRoute,
  PATCH as patchPersonaRoute,
} from '@/app/api/personas/[id]/route';
import { GET as candidatesRoute } from '@/app/api/personas/candidates/route';
import { POST as uploadReferenceRoute } from '@/app/api/personas/[id]/reference-images/route';
import { DELETE as deleteReferenceRoute } from '@/app/api/personas/[id]/reference-images/[assetId]/route';

const TEST_MASTER_KEY = 'test-master-key-for-personas';
function cookie(): string {
  return `${SESSION_COOKIE}=${createSessionValue().value}`;
}

let tdb: TestDatabase;
let storageRoot: string;

/** El cuerpo de una persona válida (el body de `POST /api/personas`). */
function personaBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Lucía',
    ageRange: '25-34',
    gender: 'female',
    ethnicity: 'latina',
    style: 'casual',
    descriptor: 'mujer de 29 años, latina, look casual',
    setting: 'baño con luz natural, encimera con dos productos',
    personality: 'Cercana y directa, habla como una amiga.',
    wardrobeNotes: 'Camiseta lisa; misma ropa en todos los CUTs.',
    voiceMap: {
      es: { provider: 'elevenlabs', voiceId: 'v_es_lucia', label: 'ElevenLabs Turbo' },
      en: { provider: 'minimax', voiceId: 'v_en_lucia' },
    },
    ...overrides,
  };
}

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { cookie: cookie(), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Crea una persona por el endpoint REAL y devuelve la respuesta parseada. */
async function createPersona(body: Record<string, unknown> = personaBody()): Promise<Persona> {
  const res = await createPersonaRoute(
    jsonRequest('http://test.local/api/personas', 'POST', body),
    { params: Promise.resolve({}) },
  );
  expect(res.status).toBe(201);
  return (await res.json()) as Persona;
}

/** Un PNG REAL de w×h px (fixture compartido de @ugc/test-utils). Es la pieza clave del
 *  principio 9: el guard del endpoint leerá SUS dimensiones del fichero — nadie se las dice. */
const png = makeTestPng;

/** Sube una imagen por el endpoint REAL de referencias (multipart, igual que el navegador). */
function uploadReference(
  personaId: string,
  bytes: Uint8Array,
  mime = 'image/png',
): Promise<Response> {
  const form = new FormData();
  form.append('file', new File([bytes as BlobPart], 'ref.png', { type: mime }));
  return uploadReferenceRoute(
    new Request(`http://test.local/api/personas/${personaId}/reference-images`, {
      method: 'POST',
      headers: { cookie: cookie() },
      body: form,
    }),
    { params: Promise.resolve({ id: personaId }) },
  );
}

beforeAll(async () => {
  setMasterKeyForTests(TEST_MASTER_KEY);
  tdb = await createTestDatabase({ label: 'web:personas' });
  storageRoot = await mkdtemp(path.join(tmpdir(), 'ugc-personas-'));
  setDbForTests(tdb.db);
  setStorageForTests(makeLocalStorageAdapter({ root: storageRoot }));
});

afterAll(async () => {
  setDbForTests(undefined);
  setStorageForTests(undefined);
  setMasterKeyForTests(undefined);
  await rm(storageRoot, { recursive: true, force: true });
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE persona, asset CASCADE');
});

describe('CRUD de /api/personas (T2.0)', () => {
  it('sin sesión ⇒ 401 antes de tocar nada', async () => {
    const res = await listPersonasRoute(new Request('http://test.local/api/personas'), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('unauthorized');
  });

  it('POST crea la persona con su voice_map es/en (con PROVEEDOR) y GET la devuelve igual', async () => {
    const created = await createPersona();

    // El voice_map viaja COMPLETO: locale → {provider, voiceId}. Perder el `provider` haría
    // ambiguo el voiceId (§11: solo es unívoco DENTRO de su proveedor).
    expect(created.voiceMap.es).toEqual({
      provider: 'elevenlabs',
      voiceId: 'v_es_lucia',
      label: 'ElevenLabs Turbo',
    });
    expect(created.voiceMap.en).toEqual({ provider: 'minimax', voiceId: 'v_en_lucia' });
    expect(created.referenceImageIds).toEqual([]);

    const res = await getPersonaRoute(
      new Request(`http://test.local/api/personas/${created.id}`, {
        headers: { cookie: cookie() },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(created);
  });

  it('POST con un voice_map de forma inválida (voiceId sin provider) ⇒ 400 validation_error', async () => {
    // El contrato Zod es la frontera: la BD guarda jsonb OPACO, así que si esto pasara, se
    // persistiría un voice_map que ningún nodo de TTS podría usar.
    const res = await createPersonaRoute(
      jsonRequest(
        'http://test.local/api/personas',
        'POST',
        personaBody({ voiceMap: { es: { voiceId: 'v_es' } } }),
      ),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');
  });

  it('POST con un nombre que ya existe ⇒ 400 anclado al campo `name` (no un 500)', async () => {
    await createPersona();
    const res = await createPersonaRoute(
      jsonRequest('http://test.local/api/personas', 'POST', personaBody()),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code: string;
      details: { fieldErrors: Record<string, string[]> };
    };
    expect(body.code).toBe('validation_error');
    expect(body.details.fieldErrors.name).toBeDefined();
  });

  it('PATCH edita parcialmente (y no toca lo que no viene)', async () => {
    const created = await createPersona();
    const res = await patchPersonaRoute(
      jsonRequest(`http://test.local/api/personas/${created.id}`, 'PATCH', {
        style: 'elegante',
        wardrobeNotes: 'Blusa de seda.',
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Persona;
    expect(updated.style).toBe('elegante');
    expect(updated.wardrobeNotes).toBe('Blusa de seda.');
    expect(updated.personality).toBe(created.personality); // intacto
    expect(updated.voiceMap).toEqual(created.voiceMap); // intacto
  });

  // EL BUG DEL 500 (code-review de T2.0). `PersonaPatchSchema` es `.partial()` ⇒ `{}` VALIDA, y
  // `readJson` también devuelve `{}` para un body vacío. Eso llegaba a Drizzle como `.set({})`,
  // que lanza `No values to set` — un `Error` pelado, no un `AppError` ⇒ **500**. Y el camino no
  // era exótico: abrir la ficha y pulsar «Guardar» sin tocar nada (el formulario manda solo lo que
  // cambió). Un PATCH sin cambios es un NO-OP legítimo: 200 con la fila intacta.
  it.each([
    ['un body vacío', {}],
    ['un body con SOLO claves desconocidas (Zod las descarta ⇒ {})', { foo: 1 }],
  ])('PATCH con %s ⇒ 200 no-op (no un 500)', async (_label, body) => {
    const created = await createPersona();

    const res = await patchPersonaRoute(
      jsonRequest(`http://test.local/api/personas/${created.id}`, 'PATCH', body),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(res.status).toBe(200); // el bug daba 500
    expect(await res.json()).toEqual(created); // y la persona sigue exactamente igual
  });

  it('GET/PATCH/DELETE de una persona inexistente ⇒ 404', async () => {
    const missing = '01ZZZZZZZZZZZZZZZZZZZZZZZZ';
    const res = await getPersonaRoute(
      new Request(`http://test.local/api/personas/${missing}`, { headers: { cookie: cookie() } }),
      { params: Promise.resolve({ id: missing }) },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('not_found');
  });

  it('DELETE borra la persona, sus filas asset y sus FICHEROS del almacén', async () => {
    const created = await createPersona();
    const up = await uploadReference(created.id, await png(1638, MIN_REFERENCE_LONG_EDGE_PX));
    const { image } = (await up.json()) as { image: { id: string } };

    const storage = makeLocalStorageAdapter({ root: storageRoot });
    const assetRow = await getAsset(tdb.db, image.id);
    expect(await storage.stat(assetRow!.storageKey)).not.toBeNull(); // el fichero está

    const res = await deletePersonaRoute(
      new Request(`http://test.local/api/personas/${created.id}`, {
        method: 'DELETE',
        headers: { cookie: cookie() },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(res.status).toBe(200);

    expect(await getPersona(tdb.db, created.id)).toBeUndefined();
    expect(await getAsset(tdb.db, image.id)).toBeUndefined();
    expect(await storage.stat(assetRow!.storageKey)).toBeNull(); // …y ya no está
  });
});

describe('upload de imágenes de referencia: EL GUARD ≥2K (§11 identity lock)', () => {
  it('una imagen con el lado largo ≥2K se ACEPTA: 201, fila asset, fichero, y la persona la lista', async () => {
    const created = await createPersona();
    const bytes = await png(1638, MIN_REFERENCE_LONG_EDGE_PX);

    const res = await uploadReference(created.id, bytes);

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      persona: Persona;
      image: { id: string; url: string; width: number; height: number };
    };
    // Las dimensiones que devuelve las LEYÓ el servidor del fichero (no se las mandó el cliente).
    expect(body.image.height).toBe(MIN_REFERENCE_LONG_EDGE_PX);
    expect(body.image.width).toBe(1638);
    // El download proxificado de T0.5, reutilizado sin cambios.
    expect(body.image.url).toBe(`/api/assets/${body.image.id}/download`);
    // La persona ya la lista (la ficha se repinta sin un segundo GET).
    expect(body.persona.referenceImageIds).toEqual([body.image.id]);

    const row = await getAsset(tdb.db, body.image.id);
    expect(row!.kind).toBe('reference_image');
    expect(row!.storageKey).toContain(`personas/${created.id}/`);
  });

  it('una imagen <2K es RECHAZADA con un mensaje claro, y NO deja ni fila ni fichero', async () => {
    // ESTA ES LA CLÁUSULA LITERAL DE LA VERIFICACIÓN. El PNG es REAL (512×640) y pasa por el
    // MISMO camino que un upload del navegador: fichero → el servidor lee sus dimensiones con
    // sharp → las compara con el umbral. Nadie le dice al servidor cuánto mide la imagen.
    const created = await createPersona();

    const res = await uploadReference(created.id, await png(512, 640));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string; details: unknown };
    expect(body.code).toBe('validation_error');
    // El mensaje dice CUÁNTO mide y CUÁNTO hace falta (es lo que la UI pinta).
    expect(body.message).toContain('512');
    expect(body.message).toContain(String(MIN_REFERENCE_LONG_EDGE_PX));

    // Nada tocó la BD ni el almacén: una imagen rechazada no deja rastro.
    const { rows } = await tdb.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM asset');
    expect(rows[0]!.n).toBe(0);
    const after = await getPersona(tdb.db, created.id);
    expect(after!.referenceImageIds).toEqual([]);
  });

  it('un fichero que NO es una imagen ⇒ 400 (no un 500)', async () => {
    const created = await createPersona();
    // Mime permitido pero bytes basura: el guard intenta decodificar y falla limpio.
    const res = await uploadReference(created.id, new TextEncoder().encode('no soy un png'));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');
  });

  it('mime fuera de la allowlist ⇒ 400 sin llegar a decodificar', async () => {
    const created = await createPersona();
    const res = await uploadReference(created.id, new Uint8Array([1, 2, 3]), 'application/pdf');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');
  });

  it('dos imágenes ≥2K se acumulan EN ORDEN (§11: 2–3 encuadres del mismo sujeto)', async () => {
    const created = await createPersona();
    const first = (await (await uploadReference(created.id, await png(1638, 2048))).json()) as {
      image: { id: string };
    };
    const second = (await (await uploadReference(created.id, await png(2048, 1638))).json()) as {
      persona: Persona;
      image: { id: string };
    };
    expect(second.persona.referenceImageIds).toEqual([first.image.id, second.image.id]);
  });

  it('DELETE de una imagen la quita de la persona y borra su fichero', async () => {
    const created = await createPersona();
    const up = (await (await uploadReference(created.id, await png(1638, 2048))).json()) as {
      image: { id: string };
    };
    const storage = makeLocalStorageAdapter({ root: storageRoot });
    const key = (await getAsset(tdb.db, up.image.id))!.storageKey;

    const res = await deleteReferenceRoute(
      new Request(`http://test.local/api/personas/${created.id}/reference-images/${up.image.id}`, {
        method: 'DELETE',
        headers: { cookie: cookie() },
      }),
      { params: Promise.resolve({ id: created.id, assetId: up.image.id }) },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).referenceImageIds).toEqual([]);
    expect(await getAsset(tdb.db, up.image.id)).toBeUndefined();
    expect(await storage.stat(key)).toBeNull();
  });
});

describe('GET /api/personas/candidates?avatar_hint= (§11: N4 sugiere personas compatibles)', () => {
  function candidates(hint: string): Promise<Response> {
    const url = `http://test.local/api/personas/candidates?avatar_hint=${encodeURIComponent(hint)}`;
    return candidatesRoute(new Request(url, { headers: { cookie: cookie() } }), {
      params: Promise.resolve({}),
    });
  }

  it('devuelve la persona CORRECTA para un avatar_hint compatible', async () => {
    const lucia = await createPersona();
    await createPersona(
      personaBody({
        name: 'Marcus',
        ageRange: '35-44',
        gender: 'male',
        ethnicity: 'black',
        style: 'sporty',
        descriptor: 'man in his late 30s, black, sporty look',
      }),
    );

    const res = await candidates('mujer 25-35, latina, estilo casual');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      candidates: { persona: Persona; score: number; matched: string[] }[];
    };
    expect(body.candidates.map((c) => c.persona.id)).toEqual([lucia.id]);
    // La recomendación viene EXPLICADA (el porqué): la UI de T2.2 lo va a enseñar.
    expect(body.candidates[0]!.matched).toContain('latina');
    expect(body.candidates[0]!.score).toBeGreaterThan(0);
  });

  it('devuelve NINGUNA para un avatar_hint incompatible', async () => {
    await createPersona();
    const res = await candidates('hombre 55-64, asiático, estilo elegante');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { candidates: unknown[] }).candidates).toEqual([]);
  });

  it('sin avatar_hint ⇒ 400 (pedir candidatas «para nada» no significa nada)', async () => {
    const res = await candidatesRoute(
      new Request('http://test.local/api/personas/candidates', { headers: { cookie: cookie() } }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');
  });
});
