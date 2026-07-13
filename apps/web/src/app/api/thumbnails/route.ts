// `GET /api/thumbnails?url=…&briefId=…` (T1.18) — EL PROXY DE MINIATURAS de las candidatas a
// hero de CP1. El servidor baja la imagen remota y la sirve reescalada desde el MISMO ORIGEN.
//
// POR QUÉ EXISTE (la lección de T1.15, principio 9 de testing): «se puede descargar» NO es una
// propiedad de la URL, es una propiedad de QUIÉN la descarga. De las 2 candidatas a hero de
// es.stayforlong.com, la de `/_next/image?url=…` la baja el WORKER (por eso N2 la clasificó) pero
// devuelve 403 a cualquier fetch desde FUERA de su web — o sea, al NAVEGADOR. Efecto: CP1 pintaba
// una miniatura ROTA (en la galería cuyo propósito es «elige con criterio») y, peor, la ofrecía
// como promovible: si el usuario la elegía, se persistían decisión + brief v2 con un hero que
// nadie podría descargar, y quien lo descubría era N7a (F4) PAGANDO fal.ai.
//
// Con el proxy, quien baja la imagen es el SERVIDOR (que sí puede) y el navegador la pide al
// mismo origen. Arregla las dos mitades con un mecanismo: la miniatura deja de verse rota Y —si
// el proxy tampoco puede bajarla— el consumidor lo sabe ANTES de gastar en fal.ai (el editor
// deshabilita esa candidata; ver `HeroCandidateOption` en checkpoints/brief-editor.tsx).
//
// ── LA DECISIÓN DE SEGURIDAD: SSRF ───────────────────────────────────────────────────────────
//
// Un proxy que baja «la URL que le pasen por query» es un SSRF de manual (`?url=http://169.254.
// 169.254/…`). La allowlist NO es por dominio (el host lo decide la web que el usuario analiza:
// una lista fija sería o inútil o falsa) ni por firma (otro secreto que rotar). Es POR DATOS:
//
//   la URL solo se sirve si aparece en `assets.images[].url` DEL BRIEF `briefId` PERSISTIDO.
//
// El conjunto permitido es EXACTAMENTE el que la galería necesita: las candidatas de ese brief.
// No hay forma de que el cliente amplíe ese conjunto —lo escribió el pipeline, no el query—, y
// acotarlo al brief concreto (en vez de «cualquier brief de la BD») lo reduce todavía más y evita
// escanear la tabla.
//
// RESIDUO CONOCIDO, declarado y ACOTADO (review de seguridad de T1.18): `assets.images[].url` es
// SALIDA DE UN LLM (Sonnet en N3). Su entrada son las imágenes que N2 sí descargó, pero nada
// IMPIDE que el modelo eco-e una URL del scrape que N2 nunca llegó a bajar, o que una página con
// prompt-injection le cuele una. O sea: la allowlist garantiza «esta URL la escribió NUESTRO
// pipeline en un brief persistido», no «esta URL ya la fetcheó el servidor».
//
// LO QUE ESO PERMITE Y LO QUE NO — importa la diferencia, y es pequeña:
//  - NO permite EXFILTRAR nada. El proxy NUNCA reenvía los bytes crudos: SIEMPRE re-codifica con
//    sharp (`rescaleImage` ⇒ PNG). Un `http://169.254.169.254/latest/meta-data/` devuelve JSON/
//    texto ⇒ sharp no lo decodifica ⇒ 502. Eso mata de paso la clase entera de ataques de
//    content-type (SVG con script, response splitting): por construcción, no por un check que
//    alguien pueda olvidar mañana.
//  - Lo que queda es un ORÁCULO CIEGO: «¿alcanza el servidor este host?» (200 vs 502). En una
//    herramienta MONO-USUARIO self-hosted, con el atacante ya dentro del brief, es un residuo
//    aceptable — y declarado.
// La contención del vector que sí importaba es el `redirect: 'error'` de abajo (una URL
// allowlistada que redirige a un host interno) más el veto de protocolos no-http(s) y el techo de
// bytes (`MAX_IMAGE_BYTES`). No se bloquean rangos IP privados: la versión resistente a
// DNS-rebinding (resolver → conectar a la IP resuelta) es más de lo que esta tarea necesita, y
// media protección es peor que ninguna porque invita a confiar en ella.
import { z } from 'zod';
import { AppError, UlidSchema } from '@ugc/core/contracts';
import { rescaleImage } from '@ugc/core/analyze';
import { getBrief } from '@ugc/db';
import { withRoute, getDb, getRequestLogger } from '@/server';
import { withAuth } from '@/server/with-auth';

// sharp (nativo) + fetch saliente: runtime Node, nunca edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Techo del lado largo (px) de la miniatura servida. Es una MINIATURA de galería (160px de
 *  caja en CP1): 512px cubre pantallas retina de sobra y evita reenviar los 2–5 MB del original
 *  del CDN. Reescalar además HOMOGENEIZA el formato (AVIF/webp/heic → PNG), así que ninguna
 *  miniatura depende de qué formatos soporte el navegador. */
const THUMBNAIL_MAX_EDGE = 512;

/** Timeout duro del fetch a la imagen remota. El mismo criterio que `fetchImageBytes` del
 *  análisis visual (T1.7): una descarga colgada no puede bloquear una request de la UI. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Techo de bytes de la respuesta upstream (review de seguridad de T1.18). Sin él, `arrayBuffer()`
 * materializa en memoria lo que sea que devuelva la URL —varios GB de un CDN comprometido, o un
 * goteo lento que quepa en los 15 s— y el proceso que sirve TODA la app muere de OOM ANTES de que
 * sharp pueda decir nada. Es la misma disciplina que `MAX_BODY_BYTES` (1 MiB) impone a la pata de
 * ENTRADA en `server/with-route.ts`; esta es la de SALIDA, que la abre este endpoint.
 *
 * 20 MiB, y es DELIBERADAMENTE generoso: la imagen se reescala a `THUMBNAIL_MAX_EDGE` (512px), así
 * que del original solo nos interesan sus píxeles, no su peso — un hero fotográfico de una landing
 * real ronda 0,2–5 MB, y un PNG sin comprimir de una pantalla 4K se queda muy por debajo de 20 MiB.
 * El tope no está para elegir «qué imágenes merecen miniatura» (rechazar una legítima daría un
 * falso «no promovible», que es justo el fallo que T1.18 arregla): está para que NINGÚN cuerpo
 * pueda tumbar el proceso. Por eso se pone donde no toca a las imágenes reales y sí a los abusos.
 */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const QuerySchema = z.object({
  /** La URL de la imagen candidata. `z.url()` ya rechaza basura; el protocolo se comprueba
   *  aparte (una `file:///etc/passwd` es una URL perfectamente válida). */
  url: z.url(),
  /** El brief que la contiene: es la ALLOWLIST (ver cabecera). Obligatorio — sin él no hay
   *  conjunto permitido contra el que comprobar, y «cualquier brief de la BD» es un conjunto
   *  más grande del que la UI necesita. */
  briefId: UlidSchema,
});

/** La forma —MÍNIMA— que este handler necesita del jsonb `product_brief.data`: solo la lista de
 *  candidatas. Se valida lo que se USA (el brief entero ya lo validó quien lo escribió) para que
 *  una fila antigua con un campo de más no rompa una miniatura. */
const BriefImagesSchema = z.object({
  assets: z.object({ images: z.array(z.object({ url: z.string() })) }),
});

export const GET = withAuth(
  withRoute(
    async ({ query }) => {
      const row = await getBrief(getDb(), query.briefId);
      if (!row) throw new AppError('not_found', 'brief no encontrado');

      // LA ALLOWLIST. Comparación por igualdad EXACTA de string contra lo persistido: nada de
      // normalizar, de comparar por host ni de "empieza por" — cualquier relajación abre la
      // puerta a servir una URL que el pipeline nunca escribió.
      const parsed = BriefImagesSchema.safeParse(row.data);
      const allowed = parsed.success
        ? new Set(parsed.data.assets.images.map((image) => image.url))
        : new Set<string>();
      if (!allowed.has(query.url)) {
        // 404, no 403: el cliente no tiene por qué distinguir "esa url no está en este brief" de
        // "ese brief no existe" — y un mensaje más preciso solo ayudaría a sondear.
        throw new AppError('not_found', 'la imagen no pertenece a este brief');
      }

      // Protocolo: solo http(s). `file:`, `gopher:`, `data:`… no son imágenes de una web.
      const target = new URL(query.url);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new AppError('validation_error', 'solo se proxifican imágenes http(s)');
      }

      const fetched = await fetchImage(query.url);
      if (!fetched) {
        // EL SERVIDOR TAMPOCO PUEDE BAJARLA. Es información valiosa, no un error a esconder: es
        // justo lo que hay que saber ANTES de que N7a pague por descubrirlo. `provider_error`
        // (502) porque el fallo es del tercero, no del caller — y el consumidor (CP1) lo traduce
        // en "candidata NO promovible, con el motivo en el nombre accesible".
        throw new AppError('provider_error', 'la imagen no se pudo descargar');
      }

      // Reescalado (`rescaleImage`, el MISMO de N2 — no se inventa otro pipeline de imagen):
      // ahorra ancho de banda y homogeneiza a PNG. Si sharp no puede decodificarla, la URL
      // devolvía bytes que NO son una imagen: para el sistema es igual de inservible.
      let thumbnail;
      try {
        thumbnail = await rescaleImage(fetched.bytes, THUMBNAIL_MAX_EDGE);
      } catch (err) {
        // EL LOG LLEVA LA EVIDENCIA, no solo el veredicto (nota del verifier de T1.18): un 2xx que
        // NO trae una imagen es hoy un caso REAL y frecuente —el `/_next/image` de stayforlong
        // responde `202` con `x-amzn-waf-action: challenge` y cuerpo vacío—, y desde el punto de
        // vista de sharp es idéntico a «bytes corruptos»: los dos revientan el decode. Sin el
        // status, el content-type y el tamaño en el log, quien investigue un fallo real no puede
        // distinguir «me está bloqueando un WAF» de «la imagen está corrupta», que son dos
        // problemas distintos con dos arreglos distintos. El VEREDICTO no cambia (502, candidata
        // no promovible: si el servidor no obtiene píxeles, no puede usarla — y eso es correcto
        // tanto si es un WAF como si son bytes rotos); lo que cambia es que el log lo dice.
        getRequestLogger().warn(
          {
            err,
            url: query.url,
            upstream_status: fetched.status,
            upstream_content_type: fetched.contentType,
            bytes: fetched.bytes.byteLength,
          },
          'thumbnail_decode_failed',
        );
        throw new AppError('provider_error', 'la imagen no se pudo decodificar');
      }

      return new Response(new Uint8Array(thumbnail.data), {
        status: 200,
        headers: {
          'Content-Type': thumbnail.mime,
          'Content-Length': String(thumbnail.data.byteLength),
          // Privada (va tras sesión) pero cacheable en el navegador: la galería de CP1 vuelve a
          // pedir las mismas miniaturas en cada render/reload del checkpoint.
          'Cache-Control': 'private, max-age=300',
        },
      });
    },
    { query: QuerySchema },
  ),
);

/** Lo que el upstream devolvió: los bytes MÁS el contexto con el que se puede diagnosticar un
 *  decode fallido (¿un WAF que responde 2xx sin imagen? ¿bytes corruptos?). */
interface FetchedImage {
  bytes: Uint8Array;
  status: number;
  contentType: string | null;
}

/**
 * La imagen remota, o `null` si NO se pudo bajar (status ≠ 2xx, timeout, DNS, TLS, redirect, o
 * CUERPO DEMASIADO GRANDE). `null` no es un fallo del proxy: es el veredicto «el servidor tampoco
 * puede usar esta imagen», que es exactamente lo que CP1 necesita saber.
 *
 * OJO A LOS 2xx QUE NO SON UNA IMAGEN (visto en la Verificación de T1.18): el `/_next/image` de
 * es.stayforlong.com responde hoy `202` con `x-amzn-waf-action: challenge` y CUERPO VACÍO. Para
 * `res.ok` eso es un éxito; el que lo caza es el decode de sharp (bytes que no son imagen ⇒ 502).
 * El veredicto es el correcto —sin píxeles no hay miniatura ni hero utilizable— y por eso NO se
 * añade aquí un filtro por content-type: sería una segunda política de "qué es una imagen" que
 * podría discrepar de la de sharp, que es la que manda. Lo que sí se hace es DEVOLVER el contexto
 * (status/content-type/tamaño) para que el log del decode fallido lo diga.
 *
 * `redirect: 'error'` es la contención de SSRF que de verdad importa (ver cabecera): sin él, una
 * URL allowlistada que responda un 302 hacia `http://169.254.169.254/…` haría que el proxy
 * fuese A ESE destino — y la allowlist no habría servido de nada. Con él, un redirect es
 * simplemente una imagen que no se puede bajar.
 *
 * EL TECHO DE BYTES (review de seguridad de T1.18) — es la MISMA disciplina que `readJson`
 * (`server/with-route.ts`) aplica a la pata de ENTRADA, aquí aplicada a la de SALIDA, que es la
 * que este endpoint abre. `await res.arrayBuffer()` a pelo MATERIALIZA el cuerpo entero en
 * memoria ANTES de que sharp pueda defenderse: una URL allowlistada cuyo host devuelva varios GB
 * (CDN comprometido, o un goteo lento que quepa en el timeout) es un OOM del proceso que sirve
 * TODA la app — y el OOM ocurre en el `arrayBuffer()`, no en el decode. Dos capas, igual que
 * `readJson`:
 *   1) `Content-Length` DECLARADO por encima del tope ⇒ ni se lee el cuerpo (se aborta ya).
 *   2) Sin `Content-Length` (chunked) ⇒ se lee el stream con un CONTADOR que corta en cuanto se
 *      pasa del tope (nunca se acumula más de `MAX_IMAGE_BYTES` + un chunk).
 */
async function fetchImage(url: string): Promise<FetchedImage | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: 'image/*' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) {
      getRequestLogger().info({ url, status: res.status }, 'thumbnail_upstream_not_ok');
      return null;
    }

    // Capa 1: lo que el upstream DECLARA. Si ya dice que no cabe, no se lee ni un byte.
    const declared = Number(res.headers.get('content-length') ?? Number.NaN);
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      getRequestLogger().info({ url, declared }, 'thumbnail_upstream_too_large');
      controller.abort(); // cierra la conexión: no queremos ni empezar a recibir esos bytes
      return null;
    }

    // Capa 2: lo que el upstream MANDA de verdad (un `Content-Length` es una promesa del otro
    // lado, no un hecho; y en chunked no existe). Se lee por trozos con contador.
    const bytes = await readCapped(res, url);
    if (!bytes) return null;
    return { bytes, status: res.status, contentType: res.headers.get('content-type') };
  } catch (err) {
    getRequestLogger().info({ err, url }, 'thumbnail_fetch_failed');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Lee el cuerpo de la respuesta acumulando trozos hasta `MAX_IMAGE_BYTES`; en cuanto se supera,
 * ABORTA la descarga y devuelve `null`. Es el cinturón de la capa 1: cubre a la vez el chunked
 * (sin `Content-Length`) y al upstream que MIENTE en su `Content-Length`.
 */
async function readCapped(res: Response, url: string): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array(0); // sin cuerpo: sharp lo rechazará (imagen vacía)
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      getRequestLogger().info({ url, read: total }, 'thumbnail_upstream_too_large');
      await reader.cancel(); // corta el grifo: no se sigue recibiendo lo que no vamos a usar
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
