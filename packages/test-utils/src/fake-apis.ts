// Servidor HTTP local que FINGE las APIs externas de pago (Firecrawl, Jina, Anthropic)
// para el stack E2E (e2e.md §4). No es msw: los que llaman a la red son los procesos
// SERVIDOR (worker/web), no el navegador, así que hace falta un servidor de verdad al
// que apuntar con los overrides de base URL que ya exponen los clientes
// (`firecrawlBaseUrl`, `jinaBaseUrl`, `anthropicBaseUrl`).
//
// POR QUÉ EXISTE: la suite E2E JAMÁS debe gastar dinero. El único gasto real de T1.10a
// es el de la Verificación (una URL real, ejecutada a mano por el verifier).
//
// LA REGLA DE ORO (la lección que nos mordió en T1.8 y T1.9): un fake debe emitir lo que
// emite el PRODUCTOR REAL, no lo que le conviene al test. Por eso NO se inventan payloads
// aquí: se reutilizan los fixtures de `fixtures/firecrawl.ts` y `fixtures/anthropic.ts`,
// que ya están construidos contra la forma real de la respuesta (envelope
// `{success,data:{...}}` de Firecrawl v2; Messages API de Anthropic con su `content[]` y
// su `usage`). Si el productor real cambia, se cambia el fixture — y el fake le sigue.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  FIRECRAWL_LANDING_RICH,
  FIRECRAWL_LANDING_DISCOVERY_LINKS,
  FIRECRAWL_INTERNAL_REVIEWS,
  FIRECRAWL_INTERNAL_OPINIONES,
  FIRECRAWL_INTERNAL_FAQ,
  JINA_MARKDOWN,
} from './fixtures/firecrawl';
import { anthropicMessageResponse, anthropicBriefResponse } from './fixtures/anthropic';
import { makeBrief, makeVisualAnalysis } from './factories';

// La imagen que el Firecrawl falso devuelve en el landing (FIRECRAWL_LANDING_RICH). El
// brief y el análisis visual falsos la referencian: así `suggested_assets ⊆ assets.images`
// (validación T1.9) se cumple con la MISMA url que el scrape produjo, en vez de con una
// inventada que el pipeline real nunca vería.
const FAKE_HERO_IMAGE = 'https://cdn.glow.example/hero.jpg';

// Los modelos EXACTOS que piden los clientes reales: `MODEL` de visual-analyzer.ts (N2,
// T1.7) y `BRIEF_SYNTHESIZER_MODEL` de brief-synthesizer.ts (N3, T1.8). Es lo que usa el
// fake para saber QUÉ artefacto devolver. Si el código real cambia de modelo, el fake
// responde 400 (ver el handler) en vez de devolver el artefacto equivocado en silencio.
const VISION_MODEL = 'claude-haiku-4-5';
const SYNTHESIS_MODEL = 'claude-sonnet-5';

/**
 * El análisis visual que devuelve el Anthropic falso para N2 (modelo Haiku, T1.7).
 * Construido con `makeVisualAnalysis()` —la ÚNICA factory de un VisualAnalysis válido—
 * en vez de a mano: un objeto inventado aquí podría no parsear contra
 * `VisualAnalysisSchema` (o peor: parsear hoy y divergir mañana en silencio).
 * Se le fija la url de la imagen que el scrape falso sí produce.
 */
export const FAKE_VISUAL_ANALYSIS = makeVisualAnalysis({
  images: [
    {
      url: FAKE_HERO_IMAGE,
      kind: 'packshot',
      has_overlay_text: false,
      background: 'clean',
      video_suitability: 'hero',
    },
  ],
  hero_image_url: FAKE_HERO_IMAGE,
});

/**
 * El brief que devuelve el Anthropic falso para N3 (modelo Sonnet, T1.8). Se construye
 * con `makeBrief()` —el único sitio donde vive un ProductBrief VÁLIDO (Apéndice A)— y no
 * a mano: un brief inventado aquí fallaría la validación determinista de T1.9 (o pasaría
 * por casualidad, que es peor).
 *
 * Se le fijan los assets a la imagen que el scrape falso REALMENTE devuelve, de modo que
 * las dos validaciones de T1.9 que dependen de la coherencia N1↔N3 se ejerciten de
 * verdad en el E2E: `≥1 imagen hero` y `suggested_assets ⊆ assets.images`.
 *
 * El CROSS-CHECK DE PRECIO no se dispara aquí, y es correcto que no lo haga: el landing
 * del Firecrawl falso no trae bloque `product`, así que N1 no extrae precio — y sin
 * precio de N1 el validador NO cruza nada (contrato explícito de `ValidateBriefOptions`).
 * Se deja así a propósito en vez de forzar una coincidencia artificial: el cross-check
 * tiene su cobertura REAL en los unit/integration de T1.9, con el formato de precio que
 * emite el fast path de verdad.
 */
export const FAKE_BRIEF = makeBrief({
  assets: {
    // `hero_image_url` NO nulo: la validación de T1.9 en perfil `url` exige ≥1 imagen
    // hero usable, y su ausencia es un warning BLOQUEANTE (ok:false) que haría fallar a
    // N3. Con la imagen que el scrape falso sí produce, el camino feliz es feliz de
    // verdad — no por haberle quitado el examen.
    hero_image_url: FAKE_HERO_IMAGE,
    images: [
      {
        url: FAKE_HERO_IMAGE,
        kind: 'packshot',
        has_overlay_text: false,
        background: 'clean',
        video_suitability: 'hero',
      },
    ],
  },
});

export interface FakeExternalApis {
  /** Base URL del Firecrawl falso (para `firecrawlBaseUrl`). */
  firecrawlBaseUrl: string;
  /** Base URL del Jina falso (para `jinaBaseUrl`). */
  jinaBaseUrl: string;
  /** Base URL del Anthropic falso (para `anthropicBaseUrl`). */
  anthropicBaseUrl: string;
  /** Para el shutdown del stack. */
  close: () => Promise<void>;
}

/** Lee el body JSON de una request (o `{}` si no hay/no parsea). */
async function readJson(
  req: import('node:http').IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    // Body no-JSON: para un fake es irrelevante (nadie depende de él).
    return {};
  }
}

/**
 * Arranca el servidor de APIs falsas en un puerto EFÍMERO (0 → el SO elige: sin
 * colisiones con otros stacks ni con el 3000 ocupado del host).
 *
 * Rutas que sirve, con la forma REAL de cada proveedor:
 *  - `POST /v2/scrape`  (Firecrawl): el envelope `{success, data:{...}}`. Distingue el
 *    scrape de DESCUBRIMIENTO (`onlyMainContent:false` + `formats:['links']`) del scrape
 *    RICO, igual que hace el ingester real (T1.5), y sirve las páginas internas del
 *    mini-crawl por su path.
 *  - `GET  /*`          (Jina): markdown plano con el preámbulo real de r.jina.ai.
 *  - `POST /v1/messages` (Anthropic): la Messages API. Devuelve el análisis visual (N2) o
 *    el brief (N3) según el modelo que pida el llamante — Haiku para visión (T1.7),
 *    Sonnet para síntesis (T1.8).
 */
export async function startFakeExternalApis(): Promise<FakeExternalApis> {
  const server: Server = createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (body: unknown, status = 200): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    // ── Anthropic: Messages API (N2 visión + N3 síntesis) ───────────────────────
    // Discrimina por el `model` EXACTO que pide el llamante — un dato explícito y estable
    // del cuerpo, no una heurística sobre el contenido. Y de forma ESTRICTA: un modelo
    // desconocido es un 400 ruidoso, no "devuelvo el brief por defecto". Si el código real
    // cambiara de modelo, un fake permisivo respondería el artefacto EQUIVOCADO y el E2E
    // fallaría con un error de parseo desconcertante, tres capas más abajo; así falla aquí,
    // diciendo exactamente qué pasa.
    if (req.method === 'POST' && url.pathname === '/v1/messages') {
      const body = await readJson(req);
      const model = typeof body.model === 'string' ? body.model : '';
      if (model === VISION_MODEL) {
        json(anthropicMessageResponse(FAKE_VISUAL_ANALYSIS));
        return;
      }
      if (model === SYNTHESIS_MODEL) {
        json(anthropicBriefResponse(FAKE_BRIEF));
        return;
      }
      json(
        {
          error:
            `fake-apis: modelo Anthropic no reconocido: "${model}". Esperados: ` +
            `"${VISION_MODEL}" (visión N2) o "${SYNTHESIS_MODEL}" (síntesis N3). ` +
            'Si el código real cambió de modelo, actualiza estas constantes.',
        },
        400,
      );
      return;
    }

    // ── Firecrawl: scrape ───────────────────────────────────────────────────────
    // OJO al path: el cliente real pide `${firecrawlBaseUrl}/scrape`, y su base URL de
    // producción ya incluye la versión (`https://api.firecrawl.dev/v2`). Como aquí la
    // base es la raíz del fake, la request llega a `/scrape` — NO a `/v2/scrape`. Se
    // aceptan ambos por robustez, pero el que se usa de verdad es `/scrape`. (Servir
    // solo `/v2/scrape` daba 404 → el cliente caía al fallback Jina → RawContent SIN
    // imágenes → N2 se saltaba en el camino de URL. El E2E lo cazó.)
    if (req.method === 'POST' && (url.pathname === '/scrape' || url.pathname === '/v2/scrape')) {
      const body = await readJson(req);
      const target = typeof body.url === 'string' ? body.url : '';
      const onlyMainContent = body.onlyMainContent;

      // Scrape de DESCUBRIMIENTO del mini-crawl (T1.5): `onlyMainContent:false` para ver
      // los links del nav/footer. Es una request DISTINTA de la rica, y el fake la
      // distingue igual que el servidor real la respondería.
      if (onlyMainContent === false) {
        json(FIRECRAWL_LANDING_DISCOVERY_LINKS);
        return;
      }

      // Páginas internas del mini-crawl (scrape ligera markdown-only), por path.
      if (target.includes('/reviews') || target.includes('/pages/reviews')) {
        json(FIRECRAWL_INTERNAL_REVIEWS);
        return;
      }
      if (target.includes('/opiniones')) {
        json(FIRECRAWL_INTERNAL_OPINIONES);
        return;
      }
      if (target.includes('/faq')) {
        json(FIRECRAWL_INTERNAL_FAQ);
        return;
      }

      // Landing: el scrape RICO (markdown + imágenes + screenshot data-URI, sin red).
      json(FIRECRAWL_LANDING_RICH);
      return;
    }

    // ── Jina (fallback del scraping): markdown plano ────────────────────────────
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(JINA_MARKDOWN);
      return;
    }

    json({ error: `fake-apis: ruta no manejada ${req.method ?? '?'} ${url.pathname}` }, 404);
  }

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${String(port)}`;

  return {
    firecrawlBaseUrl: base,
    jinaBaseUrl: base,
    anthropicBaseUrl: base,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}
