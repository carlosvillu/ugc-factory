// Integración handler-level de `GET/PATCH /api/settings` (T0.14, api.md §2.5). Los route
// handlers exportados invocados en proceso con `new Request()` contra Postgres real; la
// master key inyectada con setMasterKeyForTests (deriva la clave de cifrado). Cubre las
// cláusulas OBSERVABLES de la Verificación por su camino real (HTTP + psql):
//   · GET devuelve la vista ENMASCARADA (nunca la key en claro; last4 derivado por
//     descifrado — la key "sigue funcionando")
//   · PATCH cifra y PERSISTE; un GET posterior sirve el last4 correcto (round-trip)
//   · at-rest: SELECT crudo de app_setting devuelve {v,iv,tag,ct}, NUNCA el plaintext
//   · write-only: un PATCH sin la key no machaca la guardada
//   · sin sesión → 401 (withAuth)
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { setDbForTests } from '@/server/db';
import { setMasterKeyForTests, SESSION_COOKIE, createSessionValue } from '@/server/session';
import { GET as getSettings, PATCH as patchSettings } from '@/app/api/settings/route';

const TEST_MASTER_KEY = 'settings-suite-master-key';
const FAL_KEY = 'fal-live-key-9a8b7c6d5e4f';

// Shape del cuerpo de la vista con los proveedores explícitos (no un Record indexado,
// que bajo noUncheckedIndexedAccess haría `.fal` posiblemente undefined en los asserts).
interface MaskedSecret {
  set: boolean;
  last4: string | null;
}
interface SettingsBody {
  secrets: { fal: MaskedSecret; anthropic: MaskedSecret; firecrawl: MaskedSecret };
  preferences: { defaultLanguages: string[]; durationPreset: string };
}

let tdb: TestDatabase;

// Cookie de sesión válida (firmada con la master key de la suite) para pasar withAuth.
function authCookie(): string {
  const { value } = createSessionValue();
  return `${SESSION_COOKIE}=${value}`;
}

function getReq(withAuth = true): Promise<Response> {
  return getSettings(
    new Request('http://test.local/api/settings', {
      headers: withAuth ? { cookie: authCookie() } : {},
    }),
    { params: Promise.resolve({}) },
  );
}

function patchReq(body: unknown, withAuth = true): Promise<Response> {
  return patchSettings(
    new Request('http://test.local/api/settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...(withAuth ? { cookie: authCookie() } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
}

beforeAll(async () => {
  setMasterKeyForTests(TEST_MASTER_KEY);
  tdb = await createTestDatabase({ label: 'web:settings' });
  setDbForTests(tdb.db);
});
afterAll(async () => {
  setMasterKeyForTests(undefined);
  setDbForTests(undefined);
  await tdb.close();
});
afterEach(async () => {
  await tdb.pool.query('DELETE FROM app_setting');
});

describe('GET/PATCH /api/settings (T0.14)', () => {
  it('sin sesión → 401 (withAuth), no toca la BD', async () => {
    const res = await getReq(false);
    expect(res.status).toBe(401);
    const patchRes = await patchReq({ secrets: { fal: 'x' } }, false);
    expect(patchRes.status).toBe(401);
  });

  it('GET en first boot: todos los proveedores set:false, preferencias por defecto', async () => {
    const res = await getReq();
    expect(res.status).toBe(200);
    const body = (await res.json()) as SettingsBody;
    expect(body.secrets.fal).toEqual({ set: false, last4: null });
    expect(body.secrets.anthropic).toEqual({ set: false, last4: null });
    expect(body.secrets.firecrawl).toEqual({ set: false, last4: null });
    expect(body.preferences.defaultLanguages).toEqual(['es']);
  });

  it('PATCH cifra + persiste; GET sirve el last4 correcto (round-trip vía HTTP)', async () => {
    const patchRes = await patchReq({ secrets: { fal: FAL_KEY } });
    expect(patchRes.status).toBe(200);

    const res = await getReq();
    const body = (await res.json()) as SettingsBody;
    // set:true y last4 = últimos 4 chars del plaintext ORIGINAL (descifra al valor real).
    expect(body.secrets.fal.set).toBe(true);
    expect(body.secrets.fal.last4).toBe(FAL_KEY.slice(-4));
  });

  it('at-rest: el SELECT crudo devuelve {v,iv,tag,ct}, NUNCA la key en claro', async () => {
    await patchReq({ secrets: { fal: FAL_KEY, anthropic: 'anthropic-key-zzz9' } });

    // psql-style: el valor almacenado es un blob cifrado.
    const { rows } = await tdb.pool.query<{ key: string; value: { v: number } }>(
      `SELECT key, value FROM app_setting WHERE key LIKE 'secret.%'`,
    );
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.value).toMatchObject({ v: 1 });
      expect(row.value).toHaveProperty('iv');
      expect(row.value).toHaveProperty('tag');
      expect(row.value).toHaveProperty('ct');
    }
    // El plaintext NO aparece en NINGÚN dump de app_setting.
    const dump = await tdb.pool.query<{ raw: string }>(
      `SELECT value::text AS raw FROM app_setting`,
    );
    const serialized = dump.rows.map((r) => r.raw).join('\n');
    expect(serialized).not.toContain(FAL_KEY);
    expect(serialized).not.toContain('anthropic-key-zzz9');
  });

  it('write-only: un PATCH que no incluye fal NO machaca la key de fal guardada', async () => {
    await patchReq({ secrets: { fal: FAL_KEY } });
    // Segundo PATCH: solo anthropic. fal NO debe cambiar.
    await patchReq({ secrets: { anthropic: 'anthropic-new-key-4321' } });

    const res = await getReq();
    const body = (await res.json()) as SettingsBody;
    expect(body.secrets.fal.last4).toBe(FAL_KEY.slice(-4)); // intacta
    expect(body.secrets.anthropic.set).toBe(true);
  });

  it('PATCH de preferencias persiste y las sirve el GET', async () => {
    await patchReq({
      preferences: {
        defaultLanguages: ['es', 'en'],
        durationPreset: 'short',
        thresholds: { killHookRate: 0.02, scaleHookRate: 0.05 },
      },
    });
    const res = await getReq();
    const body = (await res.json()) as SettingsBody;
    expect(body.preferences.defaultLanguages).toEqual(['es', 'en']);
    expect(body.preferences.durationPreset).toBe('short');
  });

  it('un PATCH vacío → 400 validation_error', async () => {
    const res = await patchReq({});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('validation_error');
  });

  it('reemplazar la key de fal (edición): el last4 cambia al nuevo valor', async () => {
    await patchReq({ secrets: { fal: FAL_KEY } });
    await patchReq({ secrets: { fal: 'fal-rotated-key-wxyz' } });
    const res = await getReq();
    const body = (await res.json()) as SettingsBody;
    expect(body.secrets.fal.last4).toBe('wxyz');
  });
});
