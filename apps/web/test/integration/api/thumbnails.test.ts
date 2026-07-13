// Integración handler-level de `GET /api/thumbnails` (T1.18) contra Postgres real + msw para el
// CDN remoto (api.md §2, nivel 1). Es donde vive la ASERCIÓN DE SEGURIDAD de la tarea (la
// allowlist por datos) y el veredicto que CP1 necesita («esta candidata no la puede bajar ni el
// servidor»), fijados como regresión permanente del gate.
//
// Principio 9: el fixture tiene una URL que de verdad NO se puede bajar (msw responde 403, que es
// EXACTAMENTE lo que hace es.stayforlong.com con sus `/_next/image?url=…` a cualquier fetch de
// fuera) y otra que sí (PNG real generado con sharp, decodificable de verdad). Un mock que
// devolviera 200 con bytes inventados no probaría nada: el proxy DECODIFICA la imagen.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, passthrough } from 'msw';
import { newUlid } from '@ugc/core/contracts';
import {
  createTestDatabase,
  makeBrief,
  makeTestPng,
  useHttpMocks,
  type TestDatabase,
} from '@ugc/test-utils';
import { createBriefVersion, createProject, createUrlAnalysis } from '@ugc/db';
import { setDbForTests } from '@/server/db';
import { createSessionValue, setMasterKeyForTests, SESSION_COOKIE } from '@/server/session';
import { GET } from '@/app/api/thumbnails/route';

const TEST_MASTER_KEY = 'test-master-key-for-thumbnails';

// Las dos candidatas del brief: una que el CDN sirve y otra que responde 403 a todo el mundo
// menos a su propia web (el caso REAL de stayforlong). Las DOS están en `assets.images` — o sea,
// las dos pasan la allowlist: lo que las distingue es si se pueden BAJAR, que es justo la
// propiedad que el sistema no conocía.
const OK_URL = 'https://cdn.example/hero.jpg';
const FORBIDDEN_URL = 'https://es.example/_next/image?url=%2Fhero.jpg&w=1080&q=75';
// Una URL que NO está en el brief: el intento de SSRF. Es una imagen perfectamente válida y su
// host respondería 200 — la única razón para rechazarla es que el pipeline nunca la escribió.
const NOT_IN_BRIEF_URL = 'http://169.254.169.254/latest/meta-data/';
// Una URL allowlistada que REDIRIGE a un host interno: el ataque que la allowlist sola no para.
const REDIRECT_URL = 'https://cdn.example/redirect.jpg';
// ── EL TECHO DE BYTES (review de seguridad de T1.18) ────────────────────────────────────────
// Sin techo, `arrayBuffer()` materializa el cuerpo ENTERO en memoria y tumba el proceso ANTES de
// que sharp pueda defenderse. Dos capas, dos casos: un upstream que DECLARA su tamaño
// (`Content-Length`) y otro que NO (chunked).
//
// ESTOS DOS NO VAN POR MSW, y es deliberado: msw INTERCEPTA y re-materializa la respuesta (tira
// del stream él mismo antes de que el handler lo vea), así que un contador de bytes montado sobre
// un handler de msw mediría el consumo de MSW, no el del código bajo test — y el discriminador
// sería una ficción. Aquí el upstream es un servidor `node:http` DE VERDAD, que cuenta los bytes
// que escribe REALMENTE en el socket: si el fix funciona, el cliente cierra la conexión y el
// servidor deja de escribir. Eso no se puede fingir.
// (El techo del route es `MAX_IMAGE_BYTES` = 20 MiB; aquí no se reproduce como constante para no
// crear una segunda fuente de verdad: los asserts se expresan en «mucho menos que el cuerpo».)
const CHUNK_BYTES = 1024 * 1024; // 1 MiB de ceros: barato, y NO decodifica como imagen
/**
 * Lo que el upstream serviría si NADIE cortara: 200 MiB, DIEZ VECES el techo. No son 21 MiB (lo
 * justo para pasarse) a propósito: el servidor escribe POR DELANTE de lo que el cliente lee (los
 * buffers del socket y del kernel), así que con un cuerpo apenas mayor que el techo, «escribió
 * casi todo» y «se lo tragó todo» se confunden. Con 200 MiB la señal es inequívoca: con el techo,
 * el servidor escribe unas decenas de MiB y el socket se cierra; sin él, escribe los 200 enteros
 * (y el proceso los materializa en memoria — que es EL bug). Son ceros: no cuestan nada.
 */
const HUGE_CHUNKS = 200;
/** Frontera del assert: muy por encima del techo + buffers en vuelo, y muy por debajo de los 200
 *  MiB que se escribirían sin el fix. Cualquier valor de esta horquilla vale; lo que importa es
 *  que las dos hipótesis caigan en lados distintos. */
const WROTE_TOO_MUCH = 80 * 1024 * 1024;

/** Bytes REALMENTE escritos al socket por el upstream, por ruta. El discriminador. */
const bytesWritten = new Map<string, number>();
let upstream: Server;
let upstreamBase: string;
/** Las dos URLs gigantes, ya con el puerto efímero del upstream (se fijan en `beforeAll`). */
let hugeDeclaredUrl: string;
let hugeChunkedUrl: string;

let tdb: TestDatabase;
let briefId: string;
let png: Uint8Array;

function callGet(
  query: Record<string, string>,
  opts: { authed?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.authed !== false) headers.cookie = `${SESSION_COOKIE}=${createSessionValue().value}`;
  const qs = new URLSearchParams(query).toString();
  return GET(new Request(`http://test.local/api/thumbnails?${qs}`, { headers }), {
    params: Promise.resolve({}),
  });
}

// `useHttpMocks` NO es un hook de React: es el helper de msw de la skill testing (registra los
// ciclos beforeAll/afterEach de vitest). El plugin solo mira el prefijo `use`.
// eslint-disable-next-line react-hooks/rules-of-hooks
useHttpMocks(
  http.get('https://cdn.example/hero.jpg', () =>
    HttpResponse.arrayBuffer(png.slice().buffer, {
      headers: { 'content-type': 'image/png' },
    }),
  ),
  // EL 403 REAL: el CDN de una web Next.js sirve sus `/_next/image` solo a su propio front.
  http.get('https://es.example/_next/image', () => new HttpResponse(null, { status: 403 })),
  http.get('https://cdn.example/redirect.jpg', () =>
    HttpResponse.redirect('http://169.254.169.254/latest/meta-data/', 302),
  ),
  // EL DESTINO INTERNO devuelve una IMAGEN VÁLIDA a propósito. Es lo que hace al test capaz de
  // DISCRIMINAR: con `redirect: 'follow'` el proxy la bajaría, la decodificaría y respondería 200
  // con un PNG (el test se pondría rojo, control negativo verificado); solo con `redirect: 'error'`
  // el resultado es 502. Si aquí sirviéramos texto, el decode fallaría igual y el test pasaría por
  // la razón equivocada — pasó en la primera versión.
  http.get('http://169.254.169.254/latest/meta-data/', () =>
    HttpResponse.arrayBuffer(png.slice().buffer, { headers: { 'content-type': 'image/png' } }),
  ),
  // El upstream REAL de los cuerpos gigantes (ver arriba): msw NO lo intercepta — deja pasar la
  // petición al servidor `node:http` de verdad, que es el único que puede contar honestamente los
  // bytes que llegó a escribir.
  http.get(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()),
);

/**
 * El upstream REAL de los cuerpos gigantes. Escribe `HUGE_CHUNKS` MiB de ceros por trozos y
 * CUENTA lo que consigue escribir: cuando el proxy corta la conexión (porque se pasó del techo, o
 * porque ni la empezó al ver el `Content-Length`), el socket se cierra y este servidor deja de
 * escribir. Ese contador es el discriminador que ningún mock puede fingir.
 *
 *  - `/huge-declared`: DECLARA su `Content-Length` (200 MiB) ⇒ el proxy debe rechazarla SIN leer.
 *  - `/huge-chunked`:  NO declara nada ⇒ solo el contador del stream la puede parar.
 */
function startUpstream(): Promise<void> {
  upstream = createServer((req, res) => {
    const path = req.url ?? '/';
    const key = path.includes('declared') ? 'declared' : 'chunked';
    bytesWritten.set(key, 0);
    const headers: Record<string, string> = { 'content-type': 'image/png' };
    if (key === 'declared') headers['content-length'] = String(HUGE_CHUNKS * CHUNK_BYTES);
    res.writeHead(200, headers);

    let sent = 0;
    const chunk = Buffer.alloc(CHUNK_BYTES);
    const pump = (): void => {
      while (sent < HUGE_CHUNKS) {
        if (res.destroyed || res.writableEnded) return; // el cliente cortó: dejamos de escribir
        sent += 1;
        bytesWritten.set(key, (bytesWritten.get(key) ?? 0) + CHUNK_BYTES);
        if (!res.write(chunk)) {
          res.once('drain', pump); // backpressure: seguimos cuando el socket pueda
          return;
        }
      }
      res.end();
    };
    pump();
  });
  return new Promise<void>((resolve) => {
    upstream.listen(0, '127.0.0.1', () => {
      const { port } = upstream.address() as AddressInfo;
      upstreamBase = `http://127.0.0.1:${String(port)}`;
      resolve();
    });
  });
}

beforeAll(async () => {
  setMasterKeyForTests(TEST_MASTER_KEY);
  await startUpstream();
  tdb = await createTestDatabase({ label: 'web:thumbnails' });
  setDbForTests(tdb.db);
  png = await makeTestPng(1200, 900);
  hugeDeclaredUrl = `${upstreamBase}/huge-declared.png`;
  hugeChunkedUrl = `${upstreamBase}/huge-chunked.png`;

  const project = await createProject(tdb.db, { id: newUlid(), name: 'T1.18' });
  const analysis = await createUrlAnalysis(tdb.db, {
    projectId: project.id,
    platform: 'custom',
    urlNormalized: 'https://es.example/hoteles',
    contentHash: 'hash-t118',
    rawContent: { markdown: '# Hoteles', images: [] },
  });
  const brief = await createBriefVersion(tdb.db, {
    urlAnalysisId: analysis.id,
    language: 'es',
    editedByUser: false,
    status: 'draft',
    data: makeBrief({
      assets: {
        hero_image_url: null,
        images: [
          {
            url: OK_URL,
            kind: 'lifestyle',
            has_overlay_text: false,
            background: 'busy',
            video_suitability: 'broll',
          },
          {
            url: FORBIDDEN_URL,
            kind: 'other',
            has_overlay_text: true,
            background: 'busy',
            video_suitability: 'broll',
          },
          {
            url: REDIRECT_URL,
            kind: 'other',
            has_overlay_text: false,
            background: 'clean',
            video_suitability: 'broll',
          },
          // Las dos gigantes: están EN el brief a propósito (pasan la allowlist), porque lo que
          // se prueba con ellas no es la allowlist sino el TECHO DE BYTES.
          {
            url: hugeDeclaredUrl,
            kind: 'other',
            has_overlay_text: false,
            background: 'clean',
            video_suitability: 'broll',
          },
          {
            url: hugeChunkedUrl,
            kind: 'other',
            has_overlay_text: false,
            background: 'clean',
            video_suitability: 'broll',
          },
        ],
      },
      angles: makeBrief().angles.map((angle) => ({ ...angle, suggested_assets: [] })),
    }),
  });
  briefId = brief.id;
});

afterAll(async () => {
  setDbForTests(undefined);
  setMasterKeyForTests(undefined);
  await new Promise<void>((resolve) =>
    upstream.close(() => {
      resolve();
    }),
  );
  await tdb.close();
});

describe('GET /api/thumbnails (T1.18)', () => {
  it('sirve la miniatura de una imagen QUE ESTÁ en el brief (reescalada a PNG)', async () => {
    const res = await callGet({ url: OK_URL, briefId });

    expect(res.status).toBe(200);
    // Homogeneizada a PNG por `rescaleImage` (el mismo de N2): el navegador no depende de qué
    // formatos exóticos sirva el CDN.
    expect(res.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);
    // Es un PNG DE VERDAD (firma \x89PNG): no un envelope de error servido con 200.
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('LA ALLOWLIST: rechaza una URL que NO está en el brief, aunque su host responda', async () => {
    // El SSRF de manual (`?url=http://169.254.169.254/…`). msw la sirve con 200 a propósito: si
    // el handler la fetchease, el test lo vería. La única razón de rechazarla es que el pipeline
    // nunca escribió esa URL en este brief.
    const res = await callGet({ url: NOT_IN_BRIEF_URL, briefId });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_found');
  });

  it('LA ALLOWLIST NO SE PUEDE SALTAR CON OTRO BRIEF: un briefId inexistente es 404', async () => {
    const res = await callGet({ url: OK_URL, briefId: newUlid() });

    expect(res.status).toBe(404);
  });

  it('un REDIRECT de una URL allowlistada NO se sigue (la contención real del SSRF)', async () => {
    // La URL está EN el brief, así que pasa la allowlist — y redirige a un host interno. Sin
    // `redirect: 'error'` el proxy iría ahí y serviría el secreto. Con él, es simplemente una
    // imagen que no se puede bajar.
    const res = await callGet({ url: REDIRECT_URL, briefId });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('provider_error');
    // Y desde luego NO ha servido el contenido del destino interno.
    expect(res.headers.get('content-type')).not.toContain('image');
  });

  it('una candidata que NI EL SERVIDOR puede bajar (403) es un error explícito, no una imagen rota', async () => {
    // EL CASO DE T1.18. El 403 del `/_next/image` de stayforlong: el worker la bajó (por eso N2
    // la clasificó y está en el brief), pero cualquier fetch de fuera recibe 403. El proxy no la
    // disfraza: responde 502 `provider_error` — y ESE es el dato con el que CP1 deshabilita la
    // promoción ANTES de que N7a pague por descubrirlo.
    const res = await callGet({ url: FORBIDDEN_URL, briefId });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('provider_error');
  });

  it('EL TECHO DE BYTES: un upstream que DECLARA un cuerpo gigante NO se descarga', async () => {
    // Sin techo, `arrayBuffer()` materializa los 30 MiB en memoria ANTES de que sharp pueda
    // defenderse: el OOM ocurre en la descarga, no en el decode. Con techo, el `Content-Length`
    // basta para rechazarla sin leer el cuerpo.
    const res = await callGet({ url: hugeDeclaredUrl, briefId });

    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe('provider_error');
    // EL DISCRIMINADOR: el cuerpo NO se descargó. Sin él, el test pasaría igual con el techo
    // quitado (el proxy se tragaría los 200 MiB y fallaría el decode ⇒ el MISMO 502): el status no
    // distingue «no lo bajó» de «lo bajó y no decodificó» — el contador de bytes sí.
    //
    // Se mide lo que el UPSTREAM llegó a ESCRIBIR (no lo que el handler leyó: eso no es observable
    // desde fuera sin instrumentar el route, y un test no debe pedirle costuras al código que
    // vigila). El servidor corre por delante del cliente por los buffers del socket, así que la
    // cota es «una fracción pequeña del cuerpo», no cero: con el techo escribe ~1 chunk antes de
    // que el cierre de la conexión le llegue; sin el techo escribe los 200 MiB.
    const escritos = bytesWritten.get('declared') ?? 0;
    expect(escritos).toBeLessThan(WROTE_TOO_MUCH);
  });

  it('EL TECHO DE BYTES: un upstream SIN Content-Length (chunked) se corta al pasarse del techo', async () => {
    // La segunda capa: un `Content-Length` es una promesa del otro lado, no un hecho — y en
    // chunked ni siquiera existe. El contador del stream es el único que puede parar esto.
    const res = await callGet({ url: hugeChunkedUrl, briefId });

    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe('provider_error');
    // EL DISCRIMINADOR: la descarga se CORTÓ. Aquí no hay `Content-Length` que mirar, así que el
    // contador del stream es lo único que puede pararla: el proxy lee hasta pasarse del techo y
    // cancela ⇒ el upstream se queda MUY lejos de los 200 MiB. Sin el techo los escribe todos.
    const escritos = bytesWritten.get('chunked') ?? 0;
    expect(escritos).toBeGreaterThan(0); // sí empezó a bajar (no había cabecera que la delatara)
    expect(escritos).toBeLessThan(WROTE_TOO_MUCH);
    expect(escritos).toBeLessThan(HUGE_CHUNKS * CHUNK_BYTES); // y NUNCA el cuerpo entero
  });

  it('sin sesión es 401 ANTES de tocar la BD o la red', async () => {
    const res = await callGet({ url: OK_URL, briefId }, { authed: false });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('unauthorized');
  });

  it('una `url` que no es URL, o un `briefId` que no es ULID, son 400 tipados', async () => {
    const malUrl = await callGet({ url: 'no-soy-una-url', briefId });
    expect(malUrl.status).toBe(400);
    expect(((await malUrl.json()) as { code: string }).code).toBe('validation_error');

    const malBrief = await callGet({ url: OK_URL, briefId: 'no-soy-un-ulid' });
    expect(malBrief.status).toBe(400);
  });
});
