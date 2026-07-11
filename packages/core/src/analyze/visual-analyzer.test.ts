// Unit del VisualAnalyzer (T1.7): la llamada a Haiku 4.5 mockeada con msw a nivel de red
// (POST /v1/messages). PROHIBIDA la red real (skill testing): `onUnhandledRequest:'error'`
// revienta cualquier fuga — un análisis real gasta dinero. Los fixtures son de autoría (shape
// real de messages.parse), no grabaciones. Cubre las observables #1/#2/#3/#5/#6; la #4
// (cost_entry) vive en el test de integración del servicio de web.
import sharp from 'sharp';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { server } from '@ugc/test-utils';
import {
  ANTHROPIC_P3_HAPPY_OUTPUT,
  ANTHROPIC_P3_NO_SOCIAL_OUTPUT,
  anthropicMalformedResponse,
  anthropicMessageResponse,
  anthropicRefusalResponse,
} from '@ugc/test-utils/fixtures/anthropic';

import { makeVisualAnalyzer, type VisualAnalyzeInput } from './visual-analyzer';
import type { ImageBytes } from './rescale';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

// Base URL explícito → los handlers msw son legibles y el default de producción
// (api.anthropic.com) no se toca. NO se pasa `fetch`: el SDK captura el global, que msw parchea.
const ANTHROPIC_BASE = 'https://api.anthropic.com';
const MESSAGES_ENDPOINT = `${ANTHROPIC_BASE}/v1/messages`;

const analyzer = makeVisualAnalyzer({ apiKey: 'sk-ant-test-key', baseURL: ANTHROPIC_BASE });

/** Genera un PNG real de `w`×`h` (bytes decodificables por sharp, para el reescalado). */
async function makePng(w: number, h: number, mime = 'image/png'): Promise<ImageBytes> {
  const buf = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .png()
    .toBuffer();
  return { data: new Uint8Array(buf), mime };
}

describe('VisualAnalyzer — camino feliz (Verificación #1)', () => {
  it('clasifica imágenes, puebla brand_style.palette, social proof y deriva hero_image_url', async () => {
    server.use(
      http.post(MESSAGES_ENDPOINT, () =>
        HttpResponse.json(anthropicMessageResponse(ANTHROPIC_P3_HAPPY_OUTPUT)),
      ),
    );

    const screenshot = await makePng(1200, 3000); // se reescalará ≤1080p
    // Las imágenes de producto llegan al analyzer YA PREPARADAS (bytes ≤768px, list
    // superviviente): el servicio de web hace el fetch+rescale; el analyzer solo las base64ea.
    const input: VisualAnalyzeInput = {
      screenshot,
      productImages: [
        { url: 'https://cdn.glow.example/hero.jpg', bytes: await makePng(600, 600) },
        { url: 'https://cdn.glow.example/lifestyle.jpg', bytes: await makePng(600, 600) },
        { url: 'https://cdn.glow.example/ingredients.png', bytes: await makePng(600, 600) },
      ],
    };

    const res = await analyzer.analyze(input);

    expect(res.status).toBe('analyzed');
    // Las 3 imágenes clasificadas, en orden, con la URL re-inyectada desde la entrada.
    expect(res.visualAnalysis.images).toHaveLength(3);
    expect(res.visualAnalysis.images[0]).toEqual({
      url: 'https://cdn.glow.example/hero.jpg',
      kind: 'packshot',
      has_overlay_text: false,
      background: 'clean',
      video_suitability: 'hero',
    });
    expect(res.visualAnalysis.images[2]?.video_suitability).toBe('unusable');
    // hero_image_url = la primera imagen 'hero'.
    expect(res.visualAnalysis.hero_image_url).toBe('https://cdn.glow.example/hero.jpg');
    // brand_style.palette poblada desde el VLM (complementaria a la de Firecrawl).
    expect(res.visualAnalysis.brand_style?.palette).toEqual(['#0EA5A4', '#F8FAFC', '#F59E0B']);
    expect(res.visualAnalysis.brand_style?.aesthetic).toContain('minimalista');
    // rendered_social_proof desde el screenshot.
    expect(res.visualAnalysis.rendered_social_proof?.rating).toBe(4.8);
    expect(res.visualAnalysis.rendered_social_proof?.review_count).toBe(2130);
    expect(res.visualAnalysis.rendered_social_proof?.quotes).toHaveLength(2);
    // usage reportado para el cost_entry (Verificación #4, que el servicio registra).
    expect(res.usage?.inputTokens).toBeGreaterThan(0);
    expect(res.usage?.outputTokens).toBeGreaterThan(0);
  });
});

describe('VisualAnalyzer — modo manual: clasifica subidas sin screenshot (Verificación #2)', () => {
  it('clasifica las imágenes SUBIDAS (bytes base64) sin screenshot', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(MESSAGES_ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(anthropicMessageResponse(ANTHROPIC_P3_NO_SOCIAL_OUTPUT));
      }),
    );

    const upload = await makePng(900, 900);
    const res = await analyzer.analyze({
      productImages: [{ url: 'upload://user/photo-1.png', bytes: upload }],
    });

    expect(res.status).toBe('analyzed');
    expect(res.visualAnalysis.images).toHaveLength(1);
    expect(res.visualAnalysis.images[0]?.url).toBe('upload://user/photo-1.png');
    // Sin screenshot: no hay tono de marca ni social proof.
    expect(res.visualAnalysis.brand_style).toBeNull();
    expect(res.visualAnalysis.rendered_social_proof).toBeNull();
    // La subida se mandó como bloque base64 (privada), no como url.
    const body = capturedBody as {
      messages: { content: { type: string; source?: { type: string } }[] }[];
    };
    const imageBlocks = body.messages[0]?.content.filter((b) => b.type === 'image') ?? [];
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]?.source?.type).toBe('base64');
  });
});

describe('VisualAnalyzer — sin imágenes: skipped, cero llamada (Verificación #3)', () => {
  it('devuelve skipped SIN llamar a Anthropic cuando no hay screenshot ni subidas', async () => {
    // Handler que FALLA el test si se llama (msw onUnhandledRequest:error también lo pillaría,
    // pero un handler explícito documenta la intención: cero red = cero coste).
    let called = false;
    server.use(
      http.post(MESSAGES_ENDPOINT, () => {
        called = true;
        return HttpResponse.json(anthropicMessageResponse(ANTHROPIC_P3_HAPPY_OUTPUT));
      }),
    );

    const res = await analyzer.analyze({ productImages: [] });

    expect(called).toBe(false); // NO se llamó a Anthropic.
    expect(res.status).toBe('skipped');
    expect(res.visualAnalysis.images).toEqual([]);
    expect(res.visualAnalysis.hero_image_url).toBeNull();
    // Cero coste: no hay usage que registrar.
    expect(res.usage).toBeNull();
  });

  it('también skipped con productImages ausente (undefined)', async () => {
    const res = await analyzer.analyze({});
    expect(res.status).toBe('skipped');
    expect(res.usage).toBeNull();
  });
});

describe('VisualAnalyzer — respuesta null/malformada: skip tipado, no crash (Verificación #5)', () => {
  it('refusal (parsed_output===null) → status refused, usage registrado, sin crash', async () => {
    server.use(http.post(MESSAGES_ENDPOINT, () => HttpResponse.json(anthropicRefusalResponse())));

    const screenshot = await makePng(1000, 1000);
    const res = await analyzer.analyze({ screenshot });

    expect(res.status).toBe('refused');
    expect(res.visualAnalysis.images).toEqual([]);
    // Se pagaron los tokens → usage presente (el servicio SÍ registra coste).
    expect(res.usage?.inputTokens).toBeGreaterThan(0);
    expect(res.warnings).toContain('visual_analysis_refused');
  });

  it('respuesta no-JSON (parse throw) → status parse_error, sin crash', async () => {
    server.use(http.post(MESSAGES_ENDPOINT, () => HttpResponse.json(anthropicMalformedResponse())));

    const screenshot = await makePng(1000, 1000);
    const res = await analyzer.analyze({ screenshot });

    expect(res.status).toBe('parse_error');
    expect(res.visualAnalysis.images).toEqual([]);
    expect(res.warnings).toContain('visual_analysis_parse_error');
  });
});

describe('VisualAnalyzer — rescale del screenshot ≤1080p antes de mandar (Verificación #6)', () => {
  it('el screenshot que se manda a Anthropic va reescalado (base64 decodificable ≤1080 lado largo)', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(MESSAGES_ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(anthropicMessageResponse(ANTHROPIC_P3_NO_SOCIAL_OUTPUT));
      }),
    );

    // Screenshot enorme (escala oatly): 1920×4453. Debe salir ≤1080 en el lado largo.
    const huge = await makePng(1920, 4453);
    await analyzer.analyze({ screenshot: huge });

    const body = capturedBody as {
      messages: { content: { type: string; source?: { type: string; data?: string } }[] }[];
    };
    const imageBlock = body.messages[0]?.content.find((b) => b.type === 'image');
    expect(imageBlock?.source?.type).toBe('base64');
    // Decodifica el base64 enviado y comprueba dimensiones ≤1080.
    const sent = Buffer.from(imageBlock?.source?.data ?? '', 'base64');
    const meta = await sharp(sent).metadata();
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(1080);
  });
});
