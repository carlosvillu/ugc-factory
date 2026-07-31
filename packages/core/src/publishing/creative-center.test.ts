// Unit del cliente de Creative Center · Popular Music (T6.6): msw intercepta el `fetch` global a nivel de
// red. PROHIBIDA la red real (skill testing): `onUnhandledRequest: 'error'` revienta cualquier fuga. El
// fixture reproduce el shape documentado (no una grabación — la fuente está tras login, ver el fixture).
//
// EL CHEQUEO CLAVE (principio 9 testing): `commercial` sale de `if_cml` REAL, NO de un booleano de
// conveniencia. Los tests cruzan cada `commercial` proyectado contra el `if_cml` del fixture crudo — si el
// parser dejara de leer `if_cml` (o el fixture lo fijara a mano), esta comparación se rompe.
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { server } from '@ugc/test-utils';
import {
  CREATIVE_CENTER_POPULAR_MUSIC,
  type CreativeCenterRawSound,
} from '@ugc/test-utils/fixtures/creative-center';

import { makeCreativeCenterClient } from './creative-center';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const BASE = 'https://ads.tiktok.com/creative_radar_api/v1';
const LIST = `${BASE}/popular_trend/sound/list`;

const client = makeCreativeCenterClient();

/** Índice `song_id → if_cml` del FIXTURE CRUDO. La verdad contra la que se cruza `commercial`. */
const RAW_BY_ID = new Map<string, CreativeCenterRawSound>(
  CREATIVE_CENTER_POPULAR_MUSIC.data.sounds.map((s) => [s.song_id, s]),
);

describe('cliente Creative Center — proyección y flag comercial', () => {
  it('proyecta el catálogo y DERIVA `commercial` del `if_cml` REAL de cada track', async () => {
    server.use(http.get(LIST, () => HttpResponse.json(CREATIVE_CENTER_POPULAR_MUSIC)));

    const { sounds, commercialOnly, sourceOk } = await client.fetchTrendingSounds({
      destination: 'organic',
    });

    expect(commercialOnly).toBe(false);
    expect(sourceOk).toBe(true);
    expect(sounds.length).toBe(CREATIVE_CENTER_POPULAR_MUSIC.data.sounds.length);
    // EL CRUCE: cada `commercial` proyectado === `if_cml` del fixture crudo. Si el parser dejara de leer
    // `if_cml`, o el fixture lo hubiera fijado a mano desalineado, esto falla.
    for (const s of sounds) {
      const raw = RAW_BY_ID.get(s.id);
      expect(raw).toBeDefined();
      expect(s.commercial).toBe(raw!.if_cml);
    }
    // El fixture tiene AMBOS lados (CML y no-CML) — sin eso el filtro no probaría nada.
    expect(sounds.some((s) => s.commercial)).toBe(true);
    expect(sounds.some((s) => !s.commercial)).toBe(true);
  });

  it('para destino ORGÁNICO no restringe: muestra CML y no-CML con su flag (§14 pt 1)', async () => {
    server.use(http.get(LIST, () => HttpResponse.json(CREATIVE_CENTER_POPULAR_MUSIC)));
    const { sounds, commercialOnly } = await client.fetchTrendingSounds({ destination: 'organic' });
    expect(commercialOnly).toBe(false);
    const expectedTotal = CREATIVE_CENTER_POPULAR_MUSIC.data.sounds.length;
    expect(sounds.length).toBe(expectedTotal);
  });

  // LA LEY EN DOS PUNTOS (§14 pt 2, principio 9 «punto fijo»): paid Y both restringen a CML; organic no. Un
  // solo destino no probaría la ley.
  it.each(['paid', 'both'] as const)(
    'para destino %s (paid/Spark) restringe a la CML: solo sonidos comerciales (§14 pt 2)',
    async (destination) => {
      // El handler VERIFICA además que se envió `commercialMusic=true` a la fuente (el filtro de origen).
      let sentCommercialMusic: string | null = null;
      server.use(
        http.get(LIST, ({ request }) => {
          sentCommercialMusic = new URL(request.url).searchParams.get('commercialMusic');
          return HttpResponse.json(CREATIVE_CENTER_POPULAR_MUSIC);
        }),
      );

      const { sounds, commercialOnly } = await client.fetchTrendingSounds({ destination });

      expect(commercialOnly).toBe(true);
      expect(sentCommercialMusic).toBe('true');
      // Defensa en profundidad: todos los devueltos son CML (aunque la fuente hubiera colado no-CML).
      expect(sounds.length).toBeGreaterThan(0);
      expect(sounds.every((s) => s.commercial)).toBe(true);
      // Y NO están todos — el fixture tenía no-CML que se filtraron.
      expect(sounds.length).toBeLessThan(CREATIVE_CENTER_POPULAR_MUSIC.data.sounds.length);
    },
  );

  it('defensa en profundidad: si la fuente cuela un no-CML pese al filtro, se DESCARTA en paid', async () => {
    // La fuente MIENTE: devuelve el catálogo completo (con no-CML) aunque se pidió commercialMusic=true.
    server.use(http.get(LIST, () => HttpResponse.json(CREATIVE_CENTER_POPULAR_MUSIC)));
    const { sounds } = await client.fetchTrendingSounds({ destination: 'paid' });
    // El cliente NO confía en la fuente: re-filtra por el flag de cada item.
    expect(sounds.every((s) => s.commercial)).toBe(true);
  });
});

describe('cliente Creative Center — degradación (nunca lanza)', () => {
  it('HTTP 500 → lista vacía + warning + sourceOk=false, sin lanzar', async () => {
    server.use(http.get(LIST, () => new HttpResponse(null, { status: 500 })));
    const res = await client.fetchTrendingSounds({ destination: 'organic' });
    expect(res.sounds).toEqual([]);
    expect(res.sourceOk).toBe(false);
    expect(res.warnings).toContain('creative_center_status_500');
  });

  // EL 404 DE PRODUCCIÓN (§14): sin sesión de TikTok, la fuente real da 404. `sourceOk=false` es lo que deja a
  // la UI avisar «la fuente no responde» en vez de fingir un catálogo vacío. Este es el caso que verá el
  // verifier al abrir el Advisor en el sistema real, donde CREATIVE_CENTER_BASE_URL está ausente.
  it('HTTP 404 (sin sesión, el caso de producción) → sourceOk=false', async () => {
    server.use(http.get(LIST, () => new HttpResponse(null, { status: 404 })));
    const res = await client.fetchTrendingSounds({ destination: 'organic' });
    expect(res.sounds).toEqual([]);
    expect(res.sourceOk).toBe(false);
    expect(res.warnings).toContain('creative_center_status_404');
  });

  it('cuerpo no-JSON → lista vacía + warning + sourceOk=false', async () => {
    server.use(http.get(LIST, () => new HttpResponse('<html>login</html>', { status: 200 })));
    const res = await client.fetchTrendingSounds({ destination: 'organic' });
    expect(res.sounds).toEqual([]);
    expect(res.sourceOk).toBe(false);
    expect(res.warnings).toContain('creative_center_body_not_json');
  });

  // LA DISTINCIÓN QUE JUSTIFICA `sourceOk` (principio 9): la fuente RESPONDIÓ (2xx + JSON válido) pero el filtro
  // comercial vació la lista. Eso NO es una caída → `sourceOk=true` aunque `sounds` esté vacío. Sin este campo,
  // la UI no podría separar «fuente caída» de «filtro sin resultados».
  it('fuente OK pero filtro comercial vacía la lista → sourceOk=true, sounds=[]', async () => {
    // Catálogo con SOLO no-CML; en destino paid, el filtro los descarta todos.
    const onlyNonCml = {
      data: {
        sounds: CREATIVE_CENTER_POPULAR_MUSIC.data.sounds
          .filter((s) => !s.if_cml)
          .map((s) => ({ ...s })),
      },
    };
    expect(onlyNonCml.data.sounds.length).toBeGreaterThan(0);
    server.use(http.get(LIST, () => HttpResponse.json(onlyNonCml)));
    const res = await client.fetchTrendingSounds({ destination: 'paid' });
    expect(res.sounds).toEqual([]);
    expect(res.sourceOk).toBe(true);
  });

  it('un track a medias (sin song_id) se DESCARTA, no rompe la lista', async () => {
    server.use(
      http.get(LIST, () =>
        HttpResponse.json({
          data: {
            sounds: [
              { title: 'Sin id', author: 'X', duration: 10, rank: 1, if_cml: true },
              CREATIVE_CENTER_POPULAR_MUSIC.data.sounds[0],
            ],
          },
        }),
      ),
    );
    const res = await client.fetchTrendingSounds({ destination: 'organic' });
    expect(res.sounds.length).toBe(1);
    expect(res.warnings).toContain('creative_center_sound_skipped');
  });

  // BUG 1 (garantía de forma de salida): un track cuya `duration` redondea a 0 VIOLA `int().positive()` del
  // contrato de salida. Antes pasaba el guard `> 0` y se emitía → `TrendingSoundListSchema.parse` en el route
  // reventaba con un 500 opaco para TODA la lista. Debe DESCARTARSE aquí, sirviéndose el resto OK.
  it('track con duration que redondea a 0 (0.3) se DESCARTA; el resto de la lista se sirve OK', async () => {
    server.use(
      http.get(LIST, () =>
        HttpResponse.json({
          data: {
            sounds: [
              {
                song_id: 'bad-duration',
                title: 'Casi cero',
                author: 'X',
                cover: 'https://x/c.jpg',
                link: 'https://x/l',
                duration: 0.3, // Math.round(0.3) === 0 → no positivo → rechazado por el contrato
                rank: 1,
                if_cml: true,
              },
              CREATIVE_CENTER_POPULAR_MUSIC.data.sounds[0],
            ],
          },
        }),
      ),
    );
    const res = await client.fetchTrendingSounds({ destination: 'organic' });
    expect(res.sounds.length).toBe(1);
    expect(res.sounds.every((s) => s.durationSeconds > 0)).toBe(true);
    expect(res.warnings).toContain('creative_center_sound_skipped');
  });

  // BUG 1 (garantía de forma de salida): `cover`/`link` ausentes NO se degradan a `''` (que `string().min(1)`
  // rechazaría → 500 aguas abajo). El track se descarta; el resto de la lista se sirve, y ningún sonido
  // proyectado tiene cover/link vacíos.
  it('track sin cover/link se DESCARTA (no se degrada a cadena vacía); el resto se sirve OK', async () => {
    server.use(
      http.get(LIST, () =>
        HttpResponse.json({
          data: {
            sounds: [
              {
                song_id: 'no-cover',
                title: 'Sin portada',
                author: 'X',
                duration: 10,
                rank: 1,
                if_cml: true,
              },
              CREATIVE_CENTER_POPULAR_MUSIC.data.sounds[0],
            ],
          },
        }),
      ),
    );
    const res = await client.fetchTrendingSounds({ destination: 'organic' });
    expect(res.sounds.length).toBe(1);
    expect(res.sounds.every((s) => s.coverUrl.length > 0 && s.link.length > 0)).toBe(true);
    expect(res.warnings).toContain('creative_center_sound_skipped');
  });

  // BUG 2 (forma runtime del cuerpo): un 2xx con `data.sounds` NO-array. Antes: `for (const raw of ...)`
  // lanzaba un TypeError NO capturado → escapaba (viola «NUNCA lanza»). Debe degradar a sourceOk=false.
  it('2xx con `data.sounds` no-array (objeto) → sourceOk=false, sin lanzar', async () => {
    server.use(http.get(LIST, () => HttpResponse.json({ data: { sounds: { nope: 1 } } })));
    const res = await client.fetchTrendingSounds({ destination: 'organic' });
    expect(res.sounds).toEqual([]);
    expect(res.sourceOk).toBe(false);
    expect(res.warnings).toContain('creative_center_body_shape_unexpected');
  });

  // BUG 2 (conflación fuente-caída vs filtro-vacío): un 2xx con JSON válido pero SIN `data` no es «no hay
  // sonidos»; es la fuente respondiendo mal → sourceOk=false (no el silencioso sourceOk:true + []).
  it('2xx con forma inesperada (sin `data`) → sourceOk=false, NO conflación con lista vacía', async () => {
    server.use(http.get(LIST, () => HttpResponse.json({ unexpected: true })));
    const res = await client.fetchTrendingSounds({ destination: 'organic' });
    expect(res.sounds).toEqual([]);
    expect(res.sourceOk).toBe(false);
    expect(res.warnings).toContain('creative_center_body_shape_unexpected');
  });

  it('base URL overridable (el E2E la apunta al fake)', async () => {
    const fakeBase = 'https://fake.local/cc';
    let hit = false;
    server.use(
      http.get(`${fakeBase}/popular_trend/sound/list`, () => {
        hit = true;
        return HttpResponse.json(CREATIVE_CENTER_POPULAR_MUSIC);
      }),
    );
    const overridden = makeCreativeCenterClient({ baseUrl: fakeBase });
    await overridden.fetchTrendingSounds({ destination: 'organic' });
    expect(hit).toBe(true);
  });
});
