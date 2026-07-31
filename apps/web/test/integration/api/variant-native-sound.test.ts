// Integración handler-level de `GET|POST /api/variants/:id/native-sound` (T6.6, §14 pt 1-2) contra Postgres
// real (api.md §2, nivel 1) + msw para Creative Center (mismo proceso: intercepta el fetch del handler).
//
// Lo que se prueba:
//   · GET · lista trending sounds con el FILTRO COMERCIAL según el destino del lote (§14 pt 2): organic ⇒
//           todos con flag; paid/both ⇒ solo CML. La ley en DOS destinos (principio 9 «punto fijo»).
//   · GET · el `commercial` de cada item sale del `if_cml` REAL del catálogo (no de conveniencia).
//   · POST· elegir un sonido nativo marca `audio_source='native_trending'` Y limpia el puntero de bed propio
//           (invariante T6.2b: puntero non-null ⟺ own_license — native_trending NO puede coexistir con puntero).
//   · POST· GUARD 409: sin aprobar / sin máster compuesto (donde N7e aún podría pisar la marca).
//   · auth 401, 404.
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newUlid } from '@ugc/core/contracts';
import { planBatch } from '@ugc/core/strategy';
import { SEED_LIBRARY, validateSeeds } from '@ugc/core/library';
import {
  createAsset,
  createBatchWithVariants,
  getVariant,
  listBatchVariants,
  listPlanningInputs,
  seedLibrary,
  setVariantOwnMusicBed,
} from '@ugc/db';
import { productBrief, project as projectTable, urlAnalysis } from '@ugc/db/schema';
import {
  createTestDatabase,
  makeBrief,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
  server,
  type TestDatabase,
} from '@ugc/test-utils';
import {
  CREATIVE_CENTER_POPULAR_MUSIC,
  type CreativeCenterRawSound,
} from '@ugc/test-utils/fixtures/creative-center';
import { setDbForTests } from '@/server/db';
import { createSessionValue, setMasterKeyForTests, SESSION_COOKIE } from '@/server/session';
import { GET, POST } from '@/app/api/variants/[id]/native-sound/route';

const TEST_MASTER_KEY = 'test-master-key-for-variant-native-sound';
const CC_LIST = 'https://ads.tiktok.com/creative_radar_api/v1/popular_trend/sound/list';

let tdb: TestDatabase;

const RAW_BY_ID = new Map<string, CreativeCenterRawSound>(
  CREATIVE_CENTER_POPULAR_MUSIC.data.sounds.map((s) => [s.song_id, s]),
);

function cookie(): string {
  return `${SESSION_COOKIE}=${createSessionValue().value}`;
}

function callGet(id: string, opts: { auth: boolean } = { auth: true }): Promise<Response> {
  return GET(
    new Request(`http://test.local/api/variants/${id}/native-sound`, {
      headers: opts.auth ? { cookie: cookie() } : {},
    }),
    { params: Promise.resolve({ id }) },
  );
}

function callPost(
  id: string,
  body: unknown,
  opts: { auth: boolean } = { auth: true },
): Promise<Response> {
  return POST(
    new Request(`http://test.local/api/variants/${id}/native-sound`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.auth ? { cookie: cookie() } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

/** Marca una variante como aprobada + compuesta (crea un máster y lo apunta). Es el estado sobre el que el
 *  Advisor opera (§9.7 N10: variantes aprobadas). */
async function markApprovedComposed(variantId: string): Promise<string> {
  const master = await createAsset(tdb.db, {
    kind: 'final_video',
    storageKey: `masters/${variantId}/master.mp4`,
    mime: 'video/mp4',
    bytes: 1024,
    checksum: 'c'.repeat(64),
  });
  await tdb.pool.query(
    `UPDATE ad_variant SET status = 'approved', master_asset_id = $1 WHERE id = $2`,
    [master.id, variantId],
  );
  return master.id;
}

async function seedVariant(destination: 'organic' | 'paid' | 'both' = 'organic'): Promise<string> {
  const db = tdb.db;
  const [p] = await db.insert(projectTable).values(makeProject()).returning();
  const [ua] = await db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p!.id }))
    .returning();
  const brief = makeBrief();
  const [briefRow] = await db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: brief }))
    .returning();
  const { libraryHooks, personas, recipe } = await listPlanningInputs(db, 'test');
  // `destination` NO vive en BatchConfig — vive en el jsonb `matrix` del lote (default 'organic'). Se fuerza
  // abajo con jsonb_set para probar la ley del filtro comercial en cada destino.
  const config = {
    angleIndices: [0],
    hooksPerAngle: 1,
    objective: 'hook_test' as const,
    tier: 'test' as const,
    languages: ['es'],
    personaMode: 'rotate' as const,
  };
  const args = { brief, config, libraryHooks, personas, recipe: recipe! };
  const preview = planBatch(args);
  const created = await createBatchWithVariants(db, {
    projectId: p!.id,
    briefId: briefRow!.id,
    tier: 'test',
    objective: 'hook_test',
    languages: ['es'],
    costEstimatedCents: preview.estimate.total.maxCents,
    composePlan: (batchId) => planBatch({ ...args, batchDiscriminator: batchId }).plan,
  });
  // El destino vive en el jsonb `matrix` del lote; lo forzamos explícito para la ley del filtro.
  await tdb.pool.query(
    `UPDATE ad_batch SET matrix = jsonb_set(matrix, '{destination}', to_jsonb($1::text)) WHERE id = $2`,
    [destination, created.batch.id],
  );
  const [variant] = await listBatchVariants(db, created.batch.id);
  return variant!.id;
}

beforeAll(async () => {
  setMasterKeyForTests(TEST_MASTER_KEY);
  tdb = await createTestDatabase({ label: 'web:variant-native-sound' });
  setDbForTests(tdb.db);
  const validation = validateSeeds(SEED_LIBRARY);
  if (!validation.library) throw new Error('la librería real no valida');
  await seedLibrary(tdb.db, validation.library);
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(async () => {
  server.resetHandlers();
  await tdb.pool.query(
    'TRUNCATE ad_script, ad_variant, ad_batch, asset, product_brief, url_analysis, project CASCADE',
  );
});

afterAll(async () => {
  server.close();
  setDbForTests(undefined);
  setMasterKeyForTests(undefined);
  await tdb.close();
});

describe('GET /api/variants/:id/native-sound (T6.6 · Advisor)', () => {
  it('ORGÁNICO: lista todos los sonidos con su flag; commercial sale del if_cml REAL', async () => {
    server.use(http.get(CC_LIST, () => HttpResponse.json(CREATIVE_CENTER_POPULAR_MUSIC)));
    const variantId = await seedVariant('organic');
    await markApprovedComposed(variantId);

    const res = await callGet(variantId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sounds: { id: string; commercial: boolean; moods: string[] }[];
      commercialOnly: boolean;
      sourceOk: boolean;
    };
    expect(body.commercialOnly).toBe(false);
    // La fuente (fake) respondió 200 → sourceOk=true. En producción sin sesión sería false (unit lo cubre).
    expect(body.sourceOk).toBe(true);
    expect(body.sounds.length).toBe(CREATIVE_CENTER_POPULAR_MUSIC.data.sounds.length);
    // El flag sale del dato real, no de conveniencia.
    for (const s of body.sounds) {
      expect(s.commercial).toBe(RAW_BY_ID.get(s.id)!.if_cml);
    }
    // Ambos lados presentes en orgánico.
    expect(body.sounds.some((s) => s.commercial)).toBe(true);
    expect(body.sounds.some((s) => !s.commercial)).toBe(true);
  });

  // LA LEY EN DOS DESTINOS (§14 pt 2): paid Y both restringen a CML. Un solo destino sería el punto fijo.
  it.each(['paid', 'both'] as const)(
    '%s (paid/Spark): filtra a solo CML y envía commercialMusic=true a la fuente',
    async (destination) => {
      let sentCommercial: string | null = null;
      server.use(
        http.get(CC_LIST, ({ request }) => {
          sentCommercial = new URL(request.url).searchParams.get('commercialMusic');
          return HttpResponse.json(CREATIVE_CENTER_POPULAR_MUSIC);
        }),
      );
      const variantId = await seedVariant(destination);
      await markApprovedComposed(variantId);

      const res = await callGet(variantId);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        sounds: { commercial: boolean }[];
        commercialOnly: boolean;
      };
      expect(body.commercialOnly).toBe(true);
      expect(sentCommercial).toBe('true');
      expect(body.sounds.length).toBeGreaterThan(0);
      expect(body.sounds.every((s) => s.commercial)).toBe(true);
      expect(body.sounds.length).toBeLessThan(CREATIVE_CENTER_POPULAR_MUSIC.data.sounds.length);
    },
  );

  // BUG 1 en el LÍMITE REAL: la fuente cuela un track que VIOLA el contrato de salida (duration→0). El route
  // hace `TrendingSoundListSchema.parse(...)`; antes ese track emitido reventaba el parse → 500 opaco para TODA
  // la lista. Con el descarte en el cliente, el route responde 200 sirviendo solo los tracks válidos.
  it('BUG1: un track contract-inválido de la fuente NO produce 500; el route sirve el resto (200)', async () => {
    server.use(
      http.get(CC_LIST, () =>
        HttpResponse.json({
          data: {
            sounds: [
              {
                song_id: 'bad',
                title: 'Bad',
                author: 'X',
                cover: 'https://x/c.jpg',
                link: 'https://x/l',
                duration: 0.3,
                rank: 1,
                if_cml: true,
              },
              CREATIVE_CENTER_POPULAR_MUSIC.data.sounds[0],
            ],
          },
        }),
      ),
    );
    const variantId = await seedVariant('organic');
    await markApprovedComposed(variantId);
    const res = await callGet(variantId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sounds: { durationSeconds: number }[]; sourceOk: boolean };
    expect(body.sounds.length).toBe(1);
    expect(body.sounds.every((s) => s.durationSeconds > 0)).toBe(true);
    expect(body.sourceOk).toBe(true);
  });

  // BUG 2 en el LÍMITE REAL: 2xx con forma inesperada (data.sounds no-array). Antes: TypeError escapaba → 500.
  // Ahora degrada honestamente: 200 con sourceOk=false, lista vacía (la UI avisa «fuente caída», no «sin sonidos»).
  it('BUG2: 2xx con forma inesperada NO produce 500; el route responde 200 con sourceOk=false', async () => {
    server.use(http.get(CC_LIST, () => HttpResponse.json({ data: { sounds: { nope: 1 } } })));
    const variantId = await seedVariant('organic');
    await markApprovedComposed(variantId);
    const res = await callGet(variantId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sounds: unknown[]; sourceOk: boolean };
    expect(body.sounds).toEqual([]);
    expect(body.sourceOk).toBe(false);
  });

  it('variante NO aprobada → 409 invalid_transition', async () => {
    const variantId = await seedVariant('organic'); // sin markApprovedComposed → status scripted
    const res = await callGet(variantId);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_transition');
  });

  it('variante inexistente → 404', async () => {
    const res = await callGet(newUlid());
    expect(res.status).toBe(404);
  });

  it('sin sesión → 401', async () => {
    const res = await callGet(newUlid(), { auth: false });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/variants/:id/native-sound (T6.6 · elegir sonido nativo)', () => {
  it('elegir un sonido → audio_source=native_trending persistido', async () => {
    const variantId = await seedVariant('organic');
    await markApprovedComposed(variantId);

    const res = await callPost(variantId, { soundId: 'cc-sound-0001' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { variantId: string; audioSource: string };
    expect(body.audioSource).toBe('native_trending');

    const after = await getVariant(tdb.db, variantId);
    expect(after?.audioSource).toBe('native_trending');
  });

  it('INVARIANTE T6.2b: elegir sonido nativo LIMPIA el puntero de bed propio', async () => {
    // Una variante con bed propio (own_license) que luego elige un sonido nativo: el puntero DEBE quedar NULL
    // (puntero non-null ⟺ own_license; native_trending no puede coexistir con puntero, o N8 compondría el bed
    // propio contradiciendo «no se compone»).
    const variantId = await seedVariant('organic');
    const bed = await createAsset(tdb.db, {
      kind: 'music_bed',
      storageKey: `music/${newUlid()}.mp3`,
      mime: 'audio/mpeg',
      bytes: 4096,
      checksum: 'a'.repeat(64),
    });
    await setVariantOwnMusicBed(tdb.db, variantId, bed.id);
    // Bed propio atado ANTES de componer; luego se compone y aprueba.
    await markApprovedComposed(variantId);
    const before = await getVariant(tdb.db, variantId);
    expect(before?.ownMusicBedAssetId).toBe(bed.id);
    expect(before?.audioSource).toBe('own_license');

    const res = await callPost(variantId, { soundId: 'cc-sound-0001' });
    expect(res.status).toBe(200);

    const after = await getVariant(tdb.db, variantId);
    expect(after?.audioSource).toBe('native_trending');
    expect(after?.ownMusicBedAssetId).toBeNull(); // el puntero se limpió (biconditional preservada)
  });

  it('GUARD 409: variante SIN máster compuesto (donde N7e podría pisar la marca) → invalid_transition', async () => {
    const variantId = await seedVariant('organic');
    // aprobada pero SIN máster: forzamos status approved dejando master_asset_id NULL.
    await tdb.pool.query(`UPDATE ad_variant SET status = 'approved' WHERE id = $1`, [variantId]);

    const res = await callPost(variantId, { soundId: 'cc-sound-0001' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_transition');

    const after = await getVariant(tdb.db, variantId);
    expect(after?.audioSource).not.toBe('native_trending'); // NO se marcó
  });

  it('GUARD 409: variante no aprobada → invalid_transition', async () => {
    const variantId = await seedVariant('organic');
    await markApprovedComposed(variantId);
    await tdb.pool.query(`UPDATE ad_variant SET status = 'scripted' WHERE id = $1`, [variantId]);
    const res = await callPost(variantId, { soundId: 'cc-sound-0001' });
    expect(res.status).toBe(409);
  });

  it('body sin soundId → 400 validation_error', async () => {
    const variantId = await seedVariant('organic');
    await markApprovedComposed(variantId);
    const res = await callPost(variantId, {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');
  });

  it('variante inexistente → 404', async () => {
    const res = await callPost(newUlid(), { soundId: 'cc-sound-0001' });
    expect(res.status).toBe(404);
  });

  it('sin sesión → 401', async () => {
    const res = await callPost(newUlid(), { soundId: 'x' }, { auth: false });
    expect(res.status).toBe(401);
  });
});
