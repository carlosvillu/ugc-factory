// Unit del BriefSynthesizer (T1.8): la llamada a Sonnet 5 mockeada con msw a nivel de RED
// (POST /v1/messages). PROHIBIDA la red real (skill testing): `onUnhandledRequest:'error'`
// revienta cualquier fuga — una síntesis real gasta dinero.
//
// QUÉ SE PRUEBA AQUÍ (offline, $0) y QUÉ NO:
//  - Aquí: el CONTRATO DE REQUEST (modelo, cache_control en el system, AUSENCIA de output_config +
//    schema en el system, thinking disabled, prefijo byte-idéntico entre llamadas), el truncado del
//    markdown, el mapeo de usage, y las ramas TIPADAS (refusal / parse_error / api_error /
//    cardinalidad inválida).
//  - NO aquí: que el modelo REAL resista la página adversarial, y que `cache_read_input_tokens`
//    sea > 0 de verdad. Eso es comportamiento del proveedor: un mock que inyecta la respuesta no
//    prueba ninguno de los dos. Viven en `brief-synthesizer.live.test.ts` (tier live, con guard
//    de presupuesto). Lección de T1.5/T1.7: el mock oculta la realidad.
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeBrief, makeRawContent, makeVisualAnalysis, server } from '@ugc/test-utils';
import {
  anthropicBriefRefusalResponse,
  anthropicBriefResponse,
} from '@ugc/test-utils/fixtures/anthropic';

import {
  ANTI_INJECTION_BLOCK,
  BRIEF_SYNTHESIZER_SYSTEM_PROMPT,
} from '../../prompts/brief-synthesizer';
import { productBriefJsonSchema, ProductBriefSchema } from '../contracts';
import {
  buildUserMessage,
  extractJsonObject,
  makeBriefSynthesizer,
  truncateMarkdown,
  trimVisualAnalysis,
  BRIEF_SYNTHESIZER_MODEL,
  MAX_MARKDOWN_CHARS,
  MAX_VISUAL_IMAGES,
  TRUNCATION_MARKER,
  type BriefSynthesizeInput,
} from './brief-synthesizer';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const MESSAGES_ENDPOINT = `${ANTHROPIC_BASE}/v1/messages`;

const synthesizer = makeBriefSynthesizer({ apiKey: 'sk-ant-test-key', baseURL: ANTHROPIC_BASE });

function input(overrides: Partial<BriefSynthesizeInput> = {}): BriefSynthesizeInput {
  return {
    raw: makeRawContent(),
    visualAnalysis: makeVisualAnalysis(),
    targetLanguage: 'es',
    extractedAt: '2026-07-10T12:00:00.000Z',
    ...overrides,
  };
}

/** Captura los cuerpos de las requests que llegan a Anthropic (contrato de REQUEST). */
function captureBodies(bodies: Record<string, unknown>[], response: () => Record<string, unknown>) {
  server.use(
    http.post(MESSAGES_ENDPOINT, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(response());
    }),
  );
}

describe('BriefSynthesizer — camino feliz', () => {
  it('devuelve el ProductBrief validado contra el Zod de T1.1 y el usage mapeado', async () => {
    const brief = makeBrief();
    server.use(
      http.post(MESSAGES_ENDPOINT, () =>
        HttpResponse.json(
          anthropicBriefResponse(brief, {
            input_tokens: 9500,
            output_tokens: 3100,
            cache_creation_input_tokens: 5200,
          }),
        ),
      ),
    );

    const res = await synthesizer.synthesize(input());

    expect(res.status).toBe('synthesized');
    expect(res.brief).toEqual(brief);
    // Los 5–10 ángulos de la Verificación los garantiza el Zod (min(5).max(10)): si el brief
    // pasó, la cardinalidad está.
    expect(res.brief?.angles.length).toBeGreaterThanOrEqual(5);
    expect(res.brief?.angles.length).toBeLessThanOrEqual(10);
    expect(res.usage).toEqual({
      inputTokens: 9500,
      outputTokens: 3100,
      cacheCreationInputTokens: 5200,
      cacheReadInputTokens: 0,
    });
    expect(res.warnings).toEqual([]);
  });
});

describe('BriefSynthesizer — contrato de REQUEST (lo que se ENVÍA, no lo que se recibe)', () => {
  it('manda Sonnet 5, thinking desactivado y cache_control en el system', async () => {
    const bodies: Record<string, unknown>[] = [];
    captureBodies(bodies, () => anthropicBriefResponse(makeBrief()));

    await synthesizer.synthesize(input());

    const body = bodies[0];
    expect(body).toBeDefined();
    // Modelo: Sonnet 5 POR PLANNING (override del default opus de la skill claude-api).
    expect(body?.model).toBe(BRIEF_SYNTHESIZER_MODEL);
    expect(BRIEF_SYNTHESIZER_MODEL).toBe('claude-sonnet-5');
    // COST-CRITICAL: Sonnet 5 corre adaptive thinking si se OMITE `thinking`, y esos tokens se
    // facturan a precio de OUTPUT. Sin este assert, un descuido futuro reventaría el <$0,15/brief
    // en silencio.
    expect(body?.thinking).toEqual({ type: 'disabled' });
    // Prefijo cacheable marcado.
    const system = body?.system as { type: string; text: string; cache_control?: unknown }[];
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  // GUARDA DE REGRESIÓN de los DOS límites duros de plataforma que hicieron FALLAR la verificación
  // de T1.8. Ambos se manifestaron como un 400 determinista contra la API REAL y ninguno lo cazó
  // la suite, porque toda ella mockea Anthropic. Aquí se convierten en un test gratis y offline:
  // si alguien vuelve a meter `output_config`, esto se pone rojo AQUÍ y no en una llamada de pago.
  it('NO manda output_config: el schema viaja en el system (los 2 límites de la decodificación restringida)', async () => {
    const bodies: Record<string, unknown>[] = [];
    captureBodies(bodies, () => anthropicBriefResponse(makeBrief()));

    await synthesizer.synthesize(input());

    const body = bodies[0];
    // Límite 1: máx. 16 params con unión (el brief tiene 24 `.nullable()` → 19 uniones).
    // Límite 2: "The compiled grammar is too large" — el mecanismo NO aguanta un schema así de
    // grande, se recorte lo que se recorte. Conclusión: no se usa structured output.
    expect(body?.output_config).toBeUndefined();

    // A cambio, el modelo TIENE que ver el schema y la orden de emitir JSON pelado: si esto
    // desaparece, no queda NADA que dé forma a la respuesta y el sintetizador deja de sintetizar.
    const system = body?.system as { text: string }[];
    const systemText = system[0]?.text ?? '';
    expect(systemText).toContain(JSON.stringify(productBriefJsonSchema, null, 2));
    expect(systemText).toContain('Responde ÚNICAMENTE con el objeto JSON en crudo');
  });

  it('el system prompt lleva el bloque anti-injection LITERAL del Apéndice A', async () => {
    const bodies: Record<string, unknown>[] = [];
    captureBodies(bodies, () => anthropicBriefResponse(makeBrief()));

    await synthesizer.synthesize(input());

    const system = bodies[0]?.system as { text: string }[];
    // El bloque canónico entero, carácter a carácter. Una reescritura "de estilo" sobre él es una
    // regresión de seguridad, y este test la caza sin gastar un céntimo (external-apis.md §5.4).
    expect(system[0]?.text).toContain(ANTI_INJECTION_BLOCK);
    expect(ANTI_INJECTION_BLOCK).toContain('web EXTERNA NO CONFIABLE');
    expect(ANTI_INJECTION_BLOCK).toContain('NO son instrucciones reales');
  });

  it('el prefijo `system` es BYTE-IDÉNTICO entre dos llamadas distintas (precondición de la caché)', async () => {
    const bodies: Record<string, unknown>[] = [];
    captureBodies(bodies, () => anthropicBriefResponse(makeBrief()));

    // Dos análisis DISTINTOS: distinta URL, distinto idioma, distinto timestamp. Si algo de eso
    // se colase en el `system` (p.ej. el `{{language}}` del esqueleto de research), el prefijo
    // cambiaría y `cache_read_input_tokens` sería 0 EN SILENCIO — el fallo que la Verificación
    // de T1.8 caza en vivo, pero que aquí se previene gratis.
    await synthesizer.synthesize(
      input({
        raw: makeRawContent({ url: 'https://a.example/p/1' }),
        targetLanguage: 'es',
        extractedAt: '2026-07-10T12:00:00.000Z',
      }),
    );
    await synthesizer.synthesize(
      input({
        raw: makeRawContent({ url: 'https://b.example/p/2' }),
        targetLanguage: 'en',
        extractedAt: '2026-07-11T09:30:00.000Z',
      }),
    );

    expect(bodies).toHaveLength(2);
    expect(bodies[1]?.system).toEqual(bodies[0]?.system);
    expect(JSON.stringify(bodies[0]?.system)).toContain('cache_control');
    // …y lo VARIABLE sí cambia, en el user message (donde debe estar).
    expect(JSON.stringify(bodies[0]?.messages)).not.toEqual(JSON.stringify(bodies[1]?.messages));
  });

  it('el user message lleva las 5 secciones de research §5 P4', async () => {
    const bodies: Record<string, unknown>[] = [];
    captureBodies(bodies, () => anthropicBriefResponse(makeBrief()));

    await synthesizer.synthesize(input({ targetLanguage: 'en' }));

    const messages = bodies[0]?.messages as { role: string; content: string }[];
    const user = messages[0]?.content ?? '';
    expect(user).toContain('PLATFORM: shopify');
    expect(user).toContain('STRUCTURED DATA (P1):');
    expect(user).toContain('VISUAL ANALYSIS (P3):');
    expect(user).toContain('PAGE CONTENT (markdown):');
    expect(user).toContain('TARGET LANGUAGE: en');
  });
});

describe('BriefSynthesizer — truncado del markdown (la palanca de coste)', () => {
  it('recorta el markdown al techo y marca el corte', () => {
    const long = 'x'.repeat(MAX_MARKDOWN_CHARS + 5_000);
    const out = truncateMarkdown(long);
    expect(out.length).toBe(MAX_MARKDOWN_CHARS + TRUNCATION_MARKER.length);
    expect(out.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it('no toca un markdown que ya cabe', () => {
    const short = '# Sérum\n\nCorto.';
    expect(truncateMarkdown(short)).toBe(short);
  });

  it('el markdown que SE ENVÍA va truncado y el resultado avisa (warning observable)', async () => {
    const bodies: Record<string, unknown>[] = [];
    captureBodies(bodies, () => anthropicBriefResponse(makeBrief()));

    // Simula el markdown gordo del mini-crawl de T1.5 (landing + reviews + faq + about).
    const huge = '# Landing\n' + 'contenido '.repeat(30_000);
    expect(huge.length).toBeGreaterThan(MAX_MARKDOWN_CHARS);

    const res = await synthesizer.synthesize(input({ raw: makeRawContent({ markdown: huge }) }));

    expect(res.warnings).toContain('markdown_truncated');
    const messages = bodies[0]?.messages as { content: string }[];
    const user = messages[0]?.content ?? '';
    expect(user).toContain(TRUNCATION_MARKER);
    // Lo que de verdad importa: NO se ha mandado el markdown entero (eso es lo que rompería el
    // bound de coste). El user message completo cabe holgadamente por debajo del original.
    expect(user.length).toBeLessThan(huge.length);
  });

  it('buildUserMessage es PURO: mismo input ⇒ mismo string (determinismo del prefijo)', () => {
    const i = input();
    expect(buildUserMessage(i)).toBe(buildUserMessage(i));
  });
});

describe('BriefSynthesizer — MODO TEXTO LIBRE (la 3ª entrada de la Verificación)', () => {
  // La Verificación exige "2 URLs reales + 1 TEXTO LIBRE". La rama manual (T1.6) tiene una
  // trampa propia: `BriefMetaSchema` lleva un bicondicional (`platform==='manual'` ⟺
  // `source_url===null`). Si el modelo, ante un texto libre, emite `platform:'custom'` o se
  // inventa una `source_url`, el safeParse FALLA y no sale brief. Aquí se cubre lo que ES
  // determinista (que el user message se arma bien sin URL, sin screenshot y sin análisis
  // visual); que el MODELO respete el bicondicional se comprueba en el tier live.
  const manualRaw = () =>
    makeRawContent({
      source: 'manual',
      url: null,
      platform: 'manual',
      markdown:
        'Vendo una mochila antirrobo de 22L con puerto USB y tejido impermeable. Cuesta 59 €.',
      images: [],
      branding: null,
      product: null,
      screenshotRef: null,
    });

  it('arma el user message sin URL, sin visual analysis y con PLATFORM: manual', () => {
    const user = buildUserMessage({
      raw: manualRaw(),
      visualAnalysis: null, // el paso de visión se SALTÓ (sin imágenes) → T1.7 devuelve 'skipped'
      targetLanguage: 'es',
      extractedAt: '2026-07-10T12:00:00.000Z',
    });

    expect(user).toContain('PLATFORM: manual');
    // El JSON del user message va COMPACTO (sin indentar): la indentación son tokens de input que
    // se pagan. Se afirma el DATO, no su formato — el assert anterior (`'"url": null'`, con el
    // espacio de la indentación) se acoplaba a la serialización, no al comportamiento.
    expect(user).toContain('"url":null');
    // Sin análisis visual el bloque va explícitamente nulo (no se omite: el modelo debe SABER que
    // no hay imágenes, para dejar assets vacío en vez de inventarse URLs — regla 1.4 del prompt).
    expect(user).toContain('VISUAL ANALYSIS (P3):\nnull (sin análisis visual)');
    expect(user).toContain('mochila antirrobo');
    expect(user).toContain('TARGET LANGUAGE: es');
  });

  it('sintetiza en modo manual y el brief valida (meta.platform=manual, source_url=null)', async () => {
    // El brief manual del fixture respeta el bicondicional del Apéndice A.
    const manualBrief = makeBrief({
      meta: {
        source_url: null,
        platform: 'manual',
        language: 'es',
        extracted_at: '2026-07-10T12:00:00.000Z',
        extraction_confidence: 'medium',
        warnings: ['sin imágenes: se recomienda subir 3 fotos de producto'],
      },
    });
    server.use(
      http.post(MESSAGES_ENDPOINT, () => HttpResponse.json(anthropicBriefResponse(manualBrief))),
    );

    const res = await synthesizer.synthesize({
      raw: manualRaw(),
      visualAnalysis: null,
      targetLanguage: 'es',
      extractedAt: '2026-07-10T12:00:00.000Z',
    });

    expect(res.status).toBe('synthesized');
    expect(res.brief?.meta.platform).toBe('manual');
    expect(res.brief?.meta.source_url).toBeNull();
    expect(res.brief?.angles.length).toBeGreaterThanOrEqual(5);
  });

  it('si el modelo VIOLA el bicondicional (platform=manual con source_url), el brief se RECHAZA', async () => {
    // El modo de fallo REAL de la rama manual: `BriefMetaSchema.superRefine` lo caza. Sin este
    // guardarraíl entraría al pipeline un brief con una URL inventada.
    const bad = makeBrief({
      meta: {
        source_url: 'https://me-la-he-inventado.example.com',
        platform: 'manual',
        language: 'es',
        extracted_at: '2026-07-10T12:00:00.000Z',
        extraction_confidence: 'low',
      },
    });
    server.use(http.post(MESSAGES_ENDPOINT, () => HttpResponse.json(anthropicBriefResponse(bad))));

    const res = await synthesizer.synthesize({
      raw: manualRaw(),
      visualAnalysis: null,
      targetLanguage: 'es',
      extractedAt: '2026-07-10T12:00:00.000Z',
    });

    expect(res.status).toBe('parse_error');
    expect(res.brief).toBeNull();
  });
});

describe('BriefSynthesizer — un ERROR DE API no se disfraza de brief malformado', () => {
  // ESTE BLOQUE EXISTE POR EL FAIL DE VERIFICACIÓN DE T1.8. El `catch {}` desnudo se tragaba un
  // HTTP 400 determinista y lo devolvía como `status: 'parse_error'`, indistinguible de "el modelo
  // respondió raro". Resultado: el sintetizador no producía NI UN brief contra la API real y toda
  // la suite seguía verde (los mocks nunca devolvían 400). Un 400 significa "nuestra petición es
  // inválida y NUNCA va a funcionar"; un parse_error, "reintenta". No pueden compartir estado.

  it('el 400 REAL que rompió T1.8 (too many union types) → status api_error, con el mensaje', async () => {
    // El cuerpo exacto que devolvió la API (docs/verifications/T1.8/probe-output.txt).
    server.use(
      http.post(MESSAGES_ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'error',
            error: {
              type: 'invalid_request_error',
              message:
                'Schemas contains too many parameters with union types (19 parameters with ' +
                'type arrays or anyOf). This causes exponential compilation cost. Reduce the ' +
                'number of nullable or union-typed parameters (limit: 16 parameters with unions).',
            },
          },
          { status: 400 },
        ),
      ),
    );

    const res = await synthesizer.synthesize(input());

    // NO es parse_error: es un fallo de NUESTRA petición.
    expect(res.status).toBe('api_error');
    expect(res.brief).toBeNull();
    // Y el motivo se PROPAGA en vez de tirarse al suelo — esto es lo que habría hecho visible el
    // bug en el primer test live en vez de en la verificación.
    const detalle = res.warnings.join(' ');
    expect(detalle).toContain('api_error');
    expect(detalle).toContain('union');
  });

  it('401 (credencial inválida) → api_error, NO parse_error', async () => {
    server.use(
      http.post(MESSAGES_ENDPOINT, () =>
        HttpResponse.json(
          { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
          { status: 401 },
        ),
      ),
    );

    const res = await synthesizer.synthesize(input());

    expect(res.status).toBe('api_error');
    expect(res.warnings.join(' ')).toContain('401');
  });
});

describe('BriefSynthesizer — ramas tipadas: nada crashea', () => {
  it('refusal (parsed_output===null) → status refused, usage registrado, sin crash', async () => {
    server.use(
      http.post(MESSAGES_ENDPOINT, () => HttpResponse.json(anthropicBriefRefusalResponse())),
    );

    const res = await synthesizer.synthesize(input());

    expect(res.status).toBe('refused');
    expect(res.brief).toBeNull();
    // Se pagaron los tokens de input → el servicio DEBE poder registrar el cost_entry.
    expect(res.usage?.inputTokens).toBe(8800);
    expect(res.warnings).toContain('brief_synthesis_refused');
  });

  it('respuesta que no es JSON del schema → status parse_error, sin crash', async () => {
    server.use(
      http.post(MESSAGES_ENDPOINT, () =>
        HttpResponse.json({
          id: 'msg_bad',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-5',
          content: [{ type: 'text', text: 'lo siento, no puedo generar el brief' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 9000, output_tokens: 20 },
        }),
      ),
    );

    const res = await synthesizer.synthesize(input());

    expect(res.status).toBe('parse_error');
    expect(res.brief).toBeNull();
  });

  it('RED DE SEGURIDAD ZOD: un brief con 4 ángulos (cardinalidad inválida) se RECHAZA', async () => {
    // La API de Anthropic NO aplica constraints de array (PRD §13.2, architecture §4): el schema
    // que VIAJA en output_config va sin `minItems`/`maxItems` (los poda `toAnthropicJsonSchema`),
    // así que el modelo PUEDE devolver 4 ángulos y el servidor los acepta. Quien los caza es la
    // capa Zod — y este test demuestra que efectivamente los caza, que es lo que la Verificación
    // exige ("hay 5–10 ángulos distintos").
    //
    // El rechazo lo hace NUESTRO `safeParse` contra ProductBriefSchema, no el SDK: desde el fix
    // del 400 se usa `messages.create` (el schema que viaja es el wire REDUCIDO, sin cardinalidades)
    // y la respuesta se valida explícitamente contra el CONTRATO. Por eso el warning es
    // 'brief_schema_invalid' — la red de seguridad de verdad se ejecuta, en vez de que el SDK
    // lanzara antes de llegar a ella.
    const full = makeBrief();
    const cropped = { ...full, angles: full.angles.slice(0, 4) };
    expect(cropped.angles).toHaveLength(4);

    server.use(
      http.post(MESSAGES_ENDPOINT, () => HttpResponse.json(anthropicBriefResponse(cropped))),
    );

    const res = await synthesizer.synthesize(input());

    // Lo observable y lo que importa: NO se emite un brief con cardinalidad inválida, y no crashea.
    expect(res.status).toBe('parse_error');
    expect(res.brief).toBeNull();
    expect(res.warnings.some((w) => w.startsWith('brief_schema_invalid'))).toBe(true);
    // Y el coste SÍ se devuelve: los tokens se pagaron aunque el brief no valga (record-first).
    expect(res.usage).not.toBeNull();
  });

  it('un brief con 6 hooks en un ángulo (viola 2–3) también se RECHAZA', async () => {
    // Segunda cardinalidad del Apéndice A, por el mismo camino: la API no la aplica, Zod sí.
    const full = makeBrief();
    const firstAngle = full.angles[0];
    if (firstAngle === undefined) throw new Error('fixture sin ángulos');
    const bad = {
      ...full,
      angles: [
        { ...firstAngle, hook_examples: ['a', 'b', 'c', 'd', 'e', 'f'] },
        ...full.angles.slice(1),
      ],
    };

    server.use(http.post(MESSAGES_ENDPOINT, () => HttpResponse.json(anthropicBriefResponse(bad))));

    const res = await synthesizer.synthesize(input());

    expect(res.status).toBe('parse_error');
    expect(res.brief).toBeNull();
  });
});

describe('BriefSynthesizer — el system prompt es un artefacto versionado', () => {
  it('es estático: no contiene marcadores de interpolación ni datos por-request', () => {
    // Cualquiera de estos dentro del system rompería la caché EN SILENCIO (prefijo variable).
    expect(BRIEF_SYNTHESIZER_SYSTEM_PROMPT).not.toContain('{{');
    expect(BRIEF_SYNTHESIZER_SYSTEM_PROMPT).not.toContain('${');
  });

  it('contiene la taxonomía de facetas, los frameworks de ángulos y las reglas FTC', () => {
    const p = BRIEF_SYNTHESIZER_SYSTEM_PROMPT;
    expect(p).toContain('TAXONOMÍA DE FACETAS');
    expect(p).toContain('FRAMEWORKS DE ÁNGULOS');
    expect(p).toContain('FTC');
    // Los 10 frameworks del enum del schema, explicados uno a uno.
    for (const framework of [
      'pain_point',
      'transformation',
      'social_proof',
      'curiosity',
      'us_vs_them',
      'unboxing_demo',
      'offer_urgency',
      'myth_busting',
      'identity',
      'founder_story',
    ]) {
      expect(p).toContain(framework);
    }
  });
});

// Sin structured output, el ÚNICO que obliga al modelo a emitir JSON pelado es una regla del
// prompt — y una regla del prompt no es una garantía. `extractJsonObject` es la defensa en
// profundidad: un brief PERFECTO envuelto en vallas ```json no puede tirarse a la basura como
// `parse_error`, porque esa llamada YA se pagó.
describe('extractJsonObject — tolera que el modelo no emita el JSON pelado', () => {
  it('devuelve el objeto tal cual cuando ya viene pelado', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('quita las vallas ```json (el envoltorio más probable)', () => {
    const wrapped = '```json\n{"a":1}\n```';
    expect(JSON.parse(extractJsonObject(wrapped))).toEqual({ a: 1 });
  });

  it('quita el preámbulo en prosa ("Aquí tienes el brief:")', () => {
    const chatty = 'Aquí tienes el brief:\n\n{"a":1}\n\nEspero que te sirva.';
    expect(JSON.parse(extractJsonObject(chatty))).toEqual({ a: 1 });
  });

  it('sin objeto JSON devuelve el texto tal cual → que falle el JSON.parse (y sea parse_error)', () => {
    expect(extractJsonObject('lo siento, no puedo')).toBe('lo siento, no puedo');
  });
});

describe('BriefSynthesizer — un brief envuelto en markdown SÍ se sintetiza (no es parse_error)', () => {
  it('el modelo mete el JSON en vallas ```json y aun así sale un brief válido', async () => {
    const brief = makeBrief();
    server.use(
      http.post('https://api.anthropic.com/v1/messages', () =>
        HttpResponse.json({
          id: 'msg_fenced',
          type: 'message',
          role: 'assistant',
          model: BRIEF_SYNTHESIZER_MODEL,
          // La respuesta REAL que el prompt intenta evitar pero no puede garantizar.
          content: [{ type: 'text', text: '```json\n' + JSON.stringify(brief) + '\n```' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 200 },
        }),
      ),
    );

    const result = await synthesizer.synthesize(input());

    expect(result.status).toBe('synthesized');
    expect(result.brief).toEqual(brief);
  });
});

// GUARDA de la §11 del prompt. Sin `output_config` nada FUERZA la presencia de un campo: el modelo
// omitía esporádicamente un string obligatorio contra la API real ("expected string, received
// undefined") y tiraba un brief YA PAGADO. La mitigación es listarlos en prosa al final del prompt.
// Este test evita que la lista se desincronice del contrato: si T1.1 añade un campo obligatorio y
// el prompt no lo nombra, el modelo no sabrá que es obligatorio y el fallo volvería a aparecer
// SOLO en una llamada de pago. Aquí sale gratis y offline.
describe('system prompt §11 — nombra TODOS los campos obligatorios del contrato', () => {
  /** Rutas required + no-nullable del espejo JSON Schema (misma regla que usa el prompt). */
  function requiredStringPaths(node: unknown, path: string, out: string[]): void {
    if (node === null || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'object' && typeof n.properties === 'object' && n.properties !== null) {
      const required = Array.isArray(n.required) ? (n.required as string[]) : [];
      for (const [key, value] of Object.entries(n.properties as Record<string, unknown>)) {
        const child = value as Record<string, unknown>;
        const childPath = path === '' ? key : `${path}.${key}`;
        if (required.includes(key) && child.type === 'string') out.push(childPath);
        requiredStringPaths(child, childPath, out);
        if (child.items !== undefined) requiredStringPaths(child.items, `${childPath}[]`, out);
      }
    }
  }

  it('cada campo obligatorio del ProductBrief aparece LITERALMENTE en el system prompt', () => {
    const required: string[] = [];
    requiredStringPaths(productBriefJsonSchema, '', required);

    // Que no se vacíe por un cambio de forma del espejo (un test que no comprueba nada es peor
    // que ninguno — la lección de la vacuidad del test de evidence).
    expect(required.length).toBeGreaterThan(20);

    const ausentes = required.filter((path) => !BRIEF_SYNTHESIZER_SYSTEM_PROMPT.includes(path));
    expect(ausentes).toEqual([]);
  });

  it('los campos NULLABLES no se cuelan en la lista de obligatorios (el null ahí es información)', () => {
    const required: string[] = [];
    requiredStringPaths(productBriefJsonSchema, '', required);

    // `evidence`, `price`, `brand_name`… pueden ser null legítimamente: exigirlos haría que el
    // modelo se inventara datos que no están en la página (justo lo que el prompt PROHÍBE).
    expect(required).not.toContain('pricing.price');
    expect(required).not.toContain('product.brand_name');
    expect(required).not.toContain('meta.source_url');
  });
});

// GUARDA de la §12 del prompt. La regla 6.2 decía "solo aceptan valores del enum del schema" pero
// NUNCA los listaba: los imponía `output_config`. Al caer la decodificación restringida, el modelo
// (que redacta en español) traducía los enums y el brief entero se caía en el safeParse:
//   "audience.segments.0.awareness_level: Invalid option: expected one of "unaware"|..."
// Este test garantiza que el prompt sigue enseñando los valores EXACTOS de cada enum del contrato.
describe('system prompt §12 — enseña los valores EXACTOS de todos los enums', () => {
  function enumPaths(node: unknown, path: string, out: Map<string, string[]>): void {
    if (node === null || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (Array.isArray(n.enum) && path !== '') out.set(path, n.enum.map(String));
    if (typeof n.properties === 'object' && n.properties !== null) {
      for (const [key, value] of Object.entries(n.properties as Record<string, unknown>)) {
        enumPaths(value, path === '' ? key : `${path}.${key}`, out);
      }
    }
    if (n.items !== undefined) enumPaths(n.items, `${path}[]`, out);
    if (Array.isArray(n.anyOf)) for (const branch of n.anyOf) enumPaths(branch, path, out);
  }

  it('todos los valores de todos los enums del contrato aparecen en el system prompt', () => {
    const enums = new Map<string, string[]>();
    enumPaths(productBriefJsonSchema, '', enums);

    // Que no se vacíe en silencio si cambia la forma del espejo.
    expect(enums.size).toBeGreaterThanOrEqual(10);

    const ausentes: string[] = [];
    for (const [path, values] of enums) {
      for (const value of values) {
        if (!BRIEF_SYNTHESIZER_SYSTEM_PROMPT.includes(`"${value}"`))
          ausentes.push(`${path}=${value}`);
      }
    }
    expect(ausentes).toEqual([]);
  });

  it('el enum que rompió la verificación (awareness_level) está con sus 5 valores', () => {
    // Caso concreto y observado: el modelo lo traducía al español. Regresión explícita.
    for (const v of ['unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware']) {
      expect(BRIEF_SYNTHESIZER_SYSTEM_PROMPT).toContain(`"${v}"`);
    }
    expect(BRIEF_SYNTHESIZER_SYSTEM_PROMPT).toContain('NO los traduzcas');
  });
});

// LAS DOS PALANCAS DE COSTE, convertidas en tests GRATIS (regla de trabajo 8 del planning).
// El FAIL #2 de la verificación de T1.8 fue de DINERO: briefs de tiendas reales a 25 y 37 céntimos
// contra un bound de 15. El bug NO se vio porque los tests solo miraban fixtures sintéticas de 467
// tokens. Estos asserts fijan las decisiones que lo arreglan para que nadie las revierta sin darse
// cuenta de que está reabriendo el agujero.
describe('BriefSynthesizer — palancas de coste (bound <$0,15/brief)', () => {
  it('NO manda la lista de URLs de imágenes cuando hay análisis visual (viajaban DUPLICADAS)', () => {
    // ugmonk trae 117 imágenes: mandarlas en STRUCTURED DATA cuando el bloque VISUAL ANALYSIS ya
    // las lleva clasificadas es pagarlas dos veces (y el modelo las ecoaba en `assets`: una tercera
    // vez, ya a precio de OUTPUT).
    const raw = makeRawContent({
      images: Array.from({ length: 117 }, (_, i) => ({
        url: `https://cdn.example.com/img-${String(i)}.jpg`,
        alt: null,
        width: null,
        height: null,
      })),
    });
    const user = buildUserMessage({
      raw,
      visualAnalysis: makeVisualAnalysis(),
      targetLanguage: 'es',
      extractedAt: '2026-07-10T12:00:00.000Z',
    });

    // Ninguna de las 117 URLs crudas viaja en el bloque STRUCTURED DATA.
    const structured = user.slice(
      user.indexOf('STRUCTURED DATA (P1):'),
      user.indexOf('VISUAL ANALYSIS (P3):'),
    );
    expect(structured).not.toContain('img-0.jpg');
    expect(structured).not.toContain('img-116.jpg');
    expect(structured).not.toContain('"images"');
  });

  it('SIN análisis visual sí manda las imágenes (si no, el modelo se queda sin fuente de assets)', () => {
    // Caso borde real: N2 falló/rechazó (≠ 'skipped'). Sin este fallback, `assets.images` saldría
    // vacío y `suggested_assets` no tendría nada que referenciar (rompe la coherencia del contrato).
    const raw = makeRawContent({
      images: [{ url: 'https://cdn.example.com/hero.jpg', alt: null }],
    });
    const user = buildUserMessage({
      raw,
      visualAnalysis: null,
      targetLanguage: 'es',
      extractedAt: '2026-07-10T12:00:00.000Z',
    });

    expect(user).toContain('https://cdn.example.com/hero.jpg');
  });

  it('el JSON del user message va COMPACTO (la indentación son tokens de input pagados)', () => {
    const user = buildUserMessage({
      raw: makeRawContent(),
      visualAnalysis: makeVisualAnalysis(),
      targetLanguage: 'es',
      extractedAt: '2026-07-10T12:00:00.000Z',
    });
    // Un JSON indentado con `null, 2` produce saltos de línea + 2 espacios tras cada `{`.
    expect(user).not.toContain('{\n  "');
  });

  it('MAX_MARKDOWN_CHARS acota el input muy por debajo del bound (ratio real ~1,6-3,3 chars/token)', () => {
    // El valor viejo (120.000) se calibró suponiendo 4 chars/token. Medido contra ugmonk: 102.816
    // chars = 63.280 tokens (1,63 chars/token) = $0,19 de input ÉL SOLO, con el bound en $0,15.
    expect(MAX_MARKDOWN_CHARS).toBeLessThanOrEqual(50_000);
    // Peor ratio observado (1,6 chars/token) → coste máximo del markdown a $3/MTok.
    const peorCasoTokens = MAX_MARKDOWN_CHARS / 1.6;
    const peorCasoUsd = (peorCasoTokens * 3) / 1e6;
    // Ha de dejar sitio de sobra para el output, que es la partida GRANDE: un brief de 5-6 ángulos
    // emite ~6.900-8.100 tokens = $0,10-0,12, y en frío el system se cobra a 1,25×. El bound del
    // PRD es $0,25 (criterio O1), pero este guard NO se relaja al subir el bound: acota la palanca
    // del markdown, y dejarla crecer solo porque ahora "cabe" es como se llegó a los 120.000 chars.
    expect(peorCasoUsd).toBeLessThan(0.05);
  });
});

describe('system prompt — tope de ángulos (la palanca de OUTPUT)', () => {
  it('pide 5-6 ángulos, no 5-10 (el modelo se iba a 8 y el output se disparaba)', () => {
    // Los ángulos son el bloque MÁS GRANDE del brief (34-43% de la salida medida). Con 8 ángulos,
    // ugmonk emitió 11.386 tokens = $0,17 de output: por encima del bound AUNQUE EL INPUT FUESE 0.
    // La Verificación exige un MÍNIMO de 5 ángulos, así que 5-6 la cumple.
    expect(BRIEF_SYNTHESIZER_SYSTEM_PROMPT).toContain('5 ángulos');
    expect(BRIEF_SYNTHESIZER_SYSTEM_PROMPT).toContain('6 como máximo');

    // UNA SOLA VERDAD EN TODO EL PROMPT. El assert anterior era `not.toContain('Entre 5 y 10
    // ángulos')` —sensible a mayúsculas— y por eso NO cazó que la §4 seguía diciendo "entre 5 y 10
    // ángulos" en minúscula mientras la §6.3 decía "5; 6 máximo": el prompt se contradecía a sí
    // mismo y lo encontró el verifier, no la suite. La regex es insensible a mayúsculas y busca
    // CUALQUIER rango que empiece en 5 y acabe en 10, lo escriba quien lo escriba.
    expect(BRIEF_SYNTHESIZER_SYSTEM_PROMPT).not.toMatch(/entre\s+5\s+y\s+10\s+ángulos/i);
    expect(BRIEF_SYNTHESIZER_SYSTEM_PROMPT).not.toMatch(/5\s*[-–]\s*10\s+ángulos/i);
  });

  it('el CONTRATO de T1.1 sigue aceptando 5-10 ángulos (el tope es de PROMPT, no de schema)', () => {
    // Importante: no se ha tocado T1.1. Un brief de 8 ángulos que llegara seguiría siendo VÁLIDO.
    const brief = makeBrief({
      angles: Array.from({ length: 8 }, (_, i) => ({
        ...makeBrief().angles[0]!,
        name: `Ángulo ${String(i)}`,
      })),
    });
    expect(ProductBriefSchema.safeParse(brief).success).toBe(true);
  });
});

describe('trimVisualAnalysis — la TERCERA palanca de coste (medida, no supuesta)', () => {
  // Medido con `count_tokens` sobre la página real de ugmonk (117 imágenes): el bloque VISUAL
  // ANALYSIS completo pesaba 10.996 tokens de input — el 38% del user message, más que el markdown.
  // Recortarlo a las útiles para vídeo lo dejó en 1.126 tokens. Es el mayor recorte de los tres.
  it('recorta a MAX_VISUAL_IMAGES y descarta las "unusable"', () => {
    const visual = makeVisualAnalysis({
      images: [
        ...Array.from({ length: 40 }, (_, i) => ({
          url: `https://cdn.example.com/unusable-${String(i)}.jpg`,
          kind: 'other' as const,
          has_overlay_text: false,
          background: 'busy' as const,
          video_suitability: 'unusable' as const,
        })),
        ...Array.from({ length: 40 }, (_, i) => ({
          url: `https://cdn.example.com/broll-${String(i)}.jpg`,
          kind: 'lifestyle' as const,
          has_overlay_text: false,
          background: 'clean' as const,
          video_suitability: 'broll' as const,
        })),
        {
          url: 'https://cdn.example.com/hero.jpg',
          kind: 'packshot' as const,
          has_overlay_text: false,
          background: 'clean' as const,
          video_suitability: 'hero' as const,
        },
      ],
    });

    const trimmed = trimVisualAnalysis(visual);

    expect(trimmed.images).toHaveLength(MAX_VISUAL_IMAGES);
    // Ninguna 'unusable' sobrevive: por definición no sirven para el vídeo.
    expect(trimmed.images.every((i) => i.video_suitability !== 'unusable')).toBe(true);
    // El hero SIEMPRE se conserva y va primero: `hero_image_url` lo referencia, y recortarlo
    // dejaría al brief apuntando a una imagen que no está en la lista.
    expect(trimmed.images[0]?.video_suitability).toBe('hero');
    // El resto del análisis (paleta, estética, social proof) viaja intacto: solo se recortan imágenes.
    expect(trimmed.brand_style).toEqual(visual.brand_style);
  });

  it('si TODAS son unusable conserva algunas (mejor eso que assets.images vacío)', () => {
    const visual = makeVisualAnalysis({
      images: Array.from({ length: 20 }, (_, i) => ({
        url: `https://cdn.example.com/u-${String(i)}.jpg`,
        kind: 'other' as const,
        has_overlay_text: true,
        background: 'busy' as const,
        video_suitability: 'unusable' as const,
      })),
    });

    // Un brief sin NINGUNA imagen rompe la coherencia interna que exige el contrato (suggested_assets
    // sin nada que referenciar): se prefiere dar material mediocre a no dar ninguno.
    expect(trimVisualAnalysis(visual).images).toHaveLength(MAX_VISUAL_IMAGES);
  });

  it('el user message NO lleva las 117 imágenes: solo las recortadas', () => {
    const visual = makeVisualAnalysis({
      images: Array.from({ length: 117 }, (_, i) => ({
        url: `https://cdn.example.com/foto-${String(i)}.jpg`,
        kind: 'lifestyle' as const,
        has_overlay_text: false,
        background: 'clean' as const,
        video_suitability: 'broll' as const,
      })),
    });

    const user = buildUserMessage(input({ visualAnalysis: visual }));
    const enviadas = [...user.matchAll(/foto-\d+\.jpg/g)].length;

    expect(enviadas).toBe(MAX_VISUAL_IMAGES);
    expect(user).not.toContain('foto-116.jpg');
  });
});

describe('BriefSynthesizer — reintento acotado ante deriva de enums', () => {
  // Sin `output_config` NADA obliga al modelo a respetar los enums, y contra la API real se observó
  // que a veces traduce UN valor al idioma del brief. Sin reintento, esa deriva convierte una
  // llamada YA PAGADA en cero briefs.
  it('reintenta UNA vez si el brief no valida, y devuelve el del 2º intento', async () => {
    const bueno = makeBrief();
    // 1º intento: enum traducido al español (la deriva real observada en producción).
    const malo = JSON.parse(JSON.stringify(makeBrief())) as Record<string, unknown>;
    const audience = malo.audience as { segments: Record<string, unknown>[] };
    audience.segments[0]!.awareness_level = 'consciente del problema';

    let llamadas = 0;
    server.use(
      http.post(MESSAGES_ENDPOINT, () => {
        llamadas += 1;
        return HttpResponse.json(
          anthropicBriefResponse(llamadas === 1 ? (malo as never) : bueno, {
            input_tokens: 1000,
            output_tokens: 500,
          }),
        );
      }),
    );

    const res = await synthesizer.synthesize(input());

    expect(llamadas).toBe(2);
    expect(res.status).toBe('synthesized');
    expect(res.brief).toEqual(bueno);
    // El warning del 1er intento NO se pierde: es la señal de que la deriva sigue viva.
    expect(res.warnings.some((w) => w.startsWith('brief_schema_invalid'))).toBe(true);
    expect(res.warnings).toContain('brief_synthesis_retry');
    // El coste de AMBOS intentos se suma: los dos se pagaron. Un contador que solo cuenta el
    // intento bueno miente, y T1.8 nació de un bound de dinero.
    expect(res.usage?.outputTokens).toBe(1000);
    expect(res.usage?.inputTokens).toBe(2000);
  });

  it('NO reintenta un api_error (una petición inválida no mejora por repetirla)', async () => {
    let llamadas = 0;
    server.use(
      http.post(MESSAGES_ENDPOINT, () => {
        llamadas += 1;
        return HttpResponse.json(
          { type: 'error', error: { type: 'invalid_request_error', message: 'bad request' } },
          { status: 400 },
        );
      }),
    );

    const res = await synthesizer.synthesize(input());

    expect(res.status).toBe('api_error');
    expect(llamadas).toBe(1);
  });

  it('se rinde tras el 2º intento fallido (reintento ACOTADO, no bucle)', async () => {
    const malo = JSON.parse(JSON.stringify(makeBrief())) as Record<string, unknown>;
    const audience = malo.audience as { segments: Record<string, unknown>[] };
    audience.segments[0]!.awareness_level = 'inventado';

    let llamadas = 0;
    server.use(
      http.post(MESSAGES_ENDPOINT, () => {
        llamadas += 1;
        return HttpResponse.json(anthropicBriefResponse(malo as never));
      }),
    );

    const res = await synthesizer.synthesize(input());

    expect(llamadas).toBe(2);
    expect(res.status).toBe('parse_error');
  });
});
