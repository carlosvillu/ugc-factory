// BriefSynthesizer (T1.8, PRD §9.2 P4, research/07 §5 P4): el paso de SÍNTESIS del pipeline de
// análisis. UNA sola llamada a Sonnet 5 con structured output = ProductBrief (el contrato de
// T1.1). Una llamada y no ocho (una por faceta) porque las facetas se retroalimentan —las
// objeciones dependen del precio; los ángulos, de todo— y porque el prompt caching hace que el
// system prompt largo salga casi gratis a partir de la 2ª llamada.
//
// SPLIT (igual que T1.4 y T1.7): este módulo hace SOLO RED (la llamada a Anthropic) + CPU
// (armar el user message, truncar el markdown, parsear). La PERSISTENCIA —leer la key descifrada
// de secretos (T0.14), registrar el `cost_entry`, guardar el brief— vive en la capa servicio de
// web (`synthesize-brief.ts`), la frontera prohibida de core (architecture §1). El cliente
// Anthropic y el mapeo de `usage` los comparte con T1.7 vía `anthropic-client.ts`.
//
// FRONTERA CON T1.9: aquí termina en el `safeParse` contra el Zod de T1.1 (que YA aplica las
// cardinalidades 5–10 ángulos / 2–3 hooks / ≤4 segments / ≤5 quotes). La validación DETERMINISTA
// DE NEGOCIO (precio N1==N3, ≥1 hero image, hooks ≤12 palabras, suggested_assets ⊆ assets.images)
// es el BriefValidator de T1.9 — NO vive aquí.
//
// COSTE (<$0,25/brief EN FRÍO, PRD criterio O1). El bound nació en $0,15 y subió a $0,25 tras
// medirlo: con Sonnet 5 y el contrato de T1.1, el brief más austero que el sistema sabe escribir
// pesa ~6.900-8.100 tokens de salida — 1,7× el presupuesto de output que dejaba $0,15. No era un
// bug: $0,15 + Sonnet 5 + este contrato no caben juntos. Se mantuvieron modelo y contrato.
//
// Y OJO CON EL NÚMERO QUE SE MIRA: el honesto es el de CACHÉ FRÍA. La caché ephemeral dura ~5 min
// y en producción los briefs no llegan en ráfaga, así que la mayoría de llamadas pagan la
// ESCRITURA del system (1,25×), no la lectura (0,1×). Medir solo en caliente fue el error de fondo
// de tres ciclos de verificación: enseñaba el mejor caso y lo llamaba "coste por brief".
//
// Palancas, en orden de impacto REAL (medido, no supuesto):
//   0. RECORTE DEL VISUAL ANALYSIS (trimVisualAnalysis / MAX_VISUAL_IMAGES): LA MAYOR, y la que
//      nadie había visto. En una tienda real (117 imágenes) el bloque pesaba 10.996 tokens de
//      input — el 38% del user message, MÁS que el markdown. Recortado a las útiles para vídeo:
//      1.126 tokens (-88%).
//   1. TRUNCADO DEL MARKDOWN (MAX_MARKDOWN_CHARS): importante, pero NO la principal, en contra de
//      lo que se supuso durante dos ciclos. El input es lo que se paga (Sonnet 5: $3/MTok input,
//      $15/MTok output).
//   2. THINKING DESACTIVADO. Sonnet 5 corre adaptive thinking POR DEFECTO si se omite `thinking`
//      (skill claude-api: silent default change). Esos tokens se facturan a precio de OUTPUT
//      ($15/MTok) y son ilimitados: con un ProductBrief entero de salida, dejarlos correr rompe
//      el bound. Se DESACTIVA explícitamente — la síntesis es extracción estructurada guiada por
//      un system prompt exhaustivo, no un problema de razonamiento multi-paso.
//   3. TOPE DE ÁNGULOS (regla 6.3 del system prompt): la palanca de OUTPUT, y el output se paga a
//      5× el input. Los ángulos son el bloque MÁS GRANDE del brief (34-43% de la salida medida).
//      Con 5-10 ángulos el modelo se iba a 8 y emitía ~11.400 tokens; acotado a 5-6 emite ~6.200-
//      6.800. El CONTRATO de T1.1 sigue aceptando 5-10: el tope es una instrucción de PROMPT.
//   4. PROMPT CACHING del system (cache_control ephemeral): el prefijo es BYTE-ESTABLE (nada se
//      interpola en el system; el idioma va en el user message) y supera el mínimo cacheable →
//      desde la 2ª llamada el system se lee al 0,1×. OJO: es la palanca MENOS importante — se midió
//      y en caliente ahorra ~$0,0045, el 1% del coste. Se creyó dos ciclos que era el problema.
import Anthropic from '@anthropic-ai/sdk';

import { BRIEF_SYNTHESIZER_SYSTEM_PROMPT } from '../../prompts/brief-synthesizer';
import { ProductBriefSchema, type ProductBrief } from '../contracts/product-brief';
import type { RawContent } from '../contracts/raw-content';
import type { VisualAnalysis } from '../contracts/visual-analysis';
import {
  makeAnthropicClient,
  toAnthropicUsage,
  type AnthropicDeps,
  type AnthropicUsage,
} from './anthropic-client';

/** Modelo de síntesis: Sonnet 5 ($3/$15 por MTok). OVERRIDE del default "opus" de la skill
 *  claude-api — el planning de T1.8 (y el PRD §9.2) lo fijan explícitamente. */
export const BRIEF_SYNTHESIZER_MODEL = 'claude-sonnet-5';

/**
 * Tope de tokens de salida. NO es una palanca de coste: solo se paga lo que el modelo REALMENTE
 * emite, así que subirlo es un seguro casi gratis. Se sube de 12k a 16k porque medido contra
 * tiendas reales (verificación de T1.8) un brief de ugmonk emitió 11.386 tokens — el 95% del techo
 * anterior. Una página más rica habría dado JSON CORTADO a media respuesta: `parse_error` con los
 * tokens ya pagados, que es la peor combinación posible. Quien acota el coste de salida es el tope
 * de ángulos del prompt (§6.3), no esto.
 */
const MAX_TOKENS = 16_000;

/**
 * Techo de caracteres del markdown que se manda. ES UNA DE LAS DOS PALANCAS DE COSTE.
 *
 * OJO CON EL RATIO chars/token: el valor anterior (120.000) se calibró suponiendo ~4 chars/token,
 * y la medición real de la verificación de T1.8 lo desmiente — el markdown de una tienda real, con
 * markup, URLs largas y tablas, sale a **~1,6–3,3 chars/token**, no 4. Con 120k chars el markdown
 * de ugmonk pesó 63.280 tokens de input = $0,19 él solo: rompía el bound de <$0,15/brief ANTES de
 * emitir un token de salida.
 *
 * DIMENSIONADO CON MEDICIÓN, NO CON SUPOSICIONES (`count_tokens`, endpoint gratuito, sobre el
 * markdown real de ugmonk): a 40.000 chars el markdown TODAVÍA pesaba ~18.200 tokens (ratio real
 * ~2,2 chars/token), que a $3/MTok son $0,055 de input y no dejaban sitio para la salida. A 20.000
 * chars pesa ~9k tokens ≈ $0,027, que es lo que el bound de $0,15/brief puede permitirse una vez se
 * reserva el output (5-6 ángulos ≈ $0,10) y la caché del system ($0,0045).
 *
 * Se recorta por el FINAL: la cabeza de la landing es donde vive el producto (título, precio,
 * beneficios, reviews); la cola suele ser footer, navegación y enlaces legales. Además el
 * mini-crawl de T1.5 apendó reviews/FAQ al final, así que un recorte agresivo puede llevarse parte
 * de ese material — es el precio de un bound de coste duro, y la cabeza (donde está el producto)
 * siempre sobrevive.
 */
export const MAX_MARKDOWN_CHARS = 20_000;

/** Marca visible del recorte, para que el modelo sepa que el contenido está truncado (y no
 *  concluya que la página "termina" ahí) y para que sea observable en los tests. */
export const TRUNCATION_MARKER = '\n\n[…contenido truncado por longitud…]';

/** Estado del paso de síntesis (observable, para logs/tests y para que el servicio decida):
 *  - 'synthesized': llamada OK y el brief VALIDA contra el Zod de T1.1.
 *  - 'refused': Sonnet devolvió refusal (parsed_output===null) — manejo TIPADO, no crash.
 *  - 'parse_error': la respuesta no cuadró con el schema del structured output (el SDK LANZA al
 *    parsear), O cuadró pero NO pasa el `safeParse` del Zod completo (p.ej. 4 ángulos: la API de
 *    Anthropic NO aplica constraints de array, así que el modelo puede devolver una cardinalidad
 *    inválida y el structured output la acepta — el Zod es la red real). En ambos casos hay
 *    `usage` (se pagaron los tokens) y el servicio registra el coste igualmente. */
/**
 * Estados TIPADOS de la síntesis. `api_error` está SEPARADO de `parse_error` a propósito
 * (hallazgo del FAIL de verificación de T1.8): un 400/401/429/timeout significa "no pudimos hablar
 * con el proveedor / nuestra petición es inválida y NUNCA va a funcionar", mientras que
 * `parse_error` significa "el modelo respondió, se pagaron tokens, pero el brief no cumple el
 * contrato". Mezclarlos hizo que un 400 determinista se presentara como un output malformado y
 * pasara invisible hasta la verificación. Uno se arregla cambiando el código; el otro, reintentando.
 */
export type BriefSynthesizerStatus = 'synthesized' | 'refused' | 'parse_error' | 'api_error';

/** Resultado del sintetizador. `brief` es null salvo en 'synthesized'. `usage` SIEMPRE está
 *  presente cuando hubo respuesta HTTP (incluso en refusal): se pagaron los tokens. Es null solo
 *  si el SDK lanzó antes de darnos usage medible. */
export interface BriefSynthesizerResult {
  brief: ProductBrief | null;
  usage: AnthropicUsage | null;
  status: BriefSynthesizerStatus;
  /** Warnings observables (markdown truncado, refusal, error de validación Zod…). */
  warnings: string[];
}

/** Entrada de la síntesis: las tres fuentes que se funden (research §5 P4).
 *  - `raw`: el RawContent de N1/N2 (T1.4 url / T1.6 manual) — de él salen PLATFORM, STRUCTURED
 *    DATA (product/branding) y el PAGE CONTENT (markdown, ya con el mini-crawl apendado en T1.5).
 *  - `visualAnalysis`: el VisualAnalysis de N3 (T1.7) — clasificación de imágenes, paleta,
 *    social proof renderizado. Puede ser null (paso 'skipped' sin imágenes).
 *  - `targetLanguage`: el idioma de ANÁLISIS (Entrega: "en el idioma de análisis"). Viaja en el
 *    USER message, NUNCA en el system (rompería el prefijo cacheable — ver el prompt).
 *  - `extractedAt`: marca ISO-8601 para `meta.extracted_at`. Inyectable (determinismo en tests);
 *    también va en el user message por la misma razón que el idioma. */
export interface BriefSynthesizeInput {
  raw: RawContent;
  visualAnalysis?: VisualAnalysis | null;
  targetLanguage: string;
  extractedAt: string;
}

export type BriefSynthesizerDeps = AnthropicDeps;

/** Recorta el markdown al techo de coste, marcando el corte. Puro y determinista. */
export function truncateMarkdown(markdown: string, maxChars: number = MAX_MARKDOWN_CHARS): string {
  if (markdown.length <= maxChars) return markdown;
  return markdown.slice(0, maxChars) + TRUNCATION_MARKER;
}

/**
 * Nº máximo de imágenes clasificadas que viajan en el bloque VISUAL ANALYSIS. Un anuncio UGC usa un
 * hero y unos pocos planos de recurso; las 117 imágenes de una tienda real son catálogo, no
 * material de vídeo. Ver el comentario de la palanca en `buildUserMessage`.
 */
export const MAX_VISUAL_IMAGES = 12;

/**
 * Recorta el VisualAnalysis a las imágenes ÚTILES PARA VÍDEO, conservando el resto del análisis
 * (paleta, estética, social proof) intacto. Puro y determinista.
 *
 * Orden: hero primero, luego broll; las 'unusable' se descartan enteras (por definición no sirven
 * para el vídeo: son las que el clasificador de T1.7 marcó como inservibles). Si tras descartar no
 * quedara ninguna, se conserva la lista original recortada — es preferible dar al modelo algo que
 * dejar `assets.images` vacío y romper la coherencia que exige el contrato (reglas 6.4 / 8.7).
 */
export function trimVisualAnalysis(visual: VisualAnalysis): VisualAnalysis {
  const rank = (s: VisualAnalysis['images'][number]['video_suitability']): number =>
    s === 'hero' ? 0 : s === 'broll' ? 1 : 2;

  const usables = visual.images.filter((img) => img.video_suitability !== 'unusable');
  const fuente = usables.length > 0 ? usables : visual.images;

  const images = [...fuente]
    .sort((a, b) => rank(a.video_suitability) - rank(b.video_suitability))
    .slice(0, MAX_VISUAL_IMAGES);

  return { ...visual, images };
}

/**
 * Arma el USER message (research §5 P4: `PLATFORM:` + `STRUCTURED DATA (P1)` + `VISUAL ANALYSIS
 * (P3)` + `PAGE CONTENT (markdown)` + `TARGET LANGUAGE`). PURO y determinista.
 *
 * TODO lo variable vive AQUÍ y NO en el system: idioma, plataforma, URL, timestamp, contenido.
 * Esa es la condición que hace que el prefijo `system` sea byte-idéntico entre llamadas y que,
 * por tanto, `cache_read_input_tokens > 0` en la 2ª (Verificación). Un `{{language}}` interpolado
 * en el system —como en el esqueleto de research— desactivaría la caché EN SILENCIO.
 */
export function buildUserMessage(input: BriefSynthesizeInput): string {
  const { raw, visualAnalysis, targetLanguage, extractedAt } = input;

  // STRUCTURED DATA (P1): lo determinista del fast path (JSON-LD / .json de Shopify) + branding.
  // Es la FUENTE DE VERDAD del precio (regla 1.3 del system prompt).
  //
  // SIN `images` (PALANCA DE COSTE, medida en la verificación de T1.8): aquí viajaba
  // `raw.images.map(i => i.url)` — 117 URLs de CDN en una tienda real como ugmonk, cientos de
  // tokens cada una y DUPLICADAS, porque el bloque VISUAL ANALYSIS de abajo ya trae esas mismas
  // imágenes YA CLASIFICADAS (url + kind + background + video_suitability + hero_image_url). Es
  // trabajo de N2 (T1.7), no de la síntesis. Pagábamos dos veces por la misma lista — y el modelo
  // la ECOABA en `assets` (3.595 chars del brief de ugmonk, el 15% de la salida): se pagaba una
  // tercera vez, ya a precio de OUTPUT.
  const structured = {
    source: raw.source,
    url: raw.url,
    product: raw.product ?? null,
    branding: raw.branding ?? null,
  };

  const markdown = truncateMarkdown(raw.markdown);

  // VISUAL ANALYSIS RECORTADO — LA TERCERA PALANCA DE COSTE (y la mayor que nadie había medido).
  // Medido con `count_tokens` sobre la página real de ugmonk: el bloque VISUAL ANALYSIS completo
  // (117 imágenes clasificadas) pesa **10.996 tokens de input**, el 38% del user message. Cada
  // imagen son ~90 tokens de URL de CDN + 4 campos, y el brief NO puede usar 117 imágenes: el
  // vídeo usa un puñado. Mandarlas todas es pagar input por material que se descarta.
  //
  // El criterio de recorte es el MISMO que la regla 6.3.c del system prompt ("assets.images no es
  // un vertedero"): se quedan las que sirven para vídeo. Se descartan las 'unusable' y se corta a
  // MAX_VISUAL_IMAGES, priorizando hero > broll. El hero se preserva SIEMPRE (`hero_image_url`
  // apunta a él: si lo recortáramos, el brief referenciaría una imagen que no está en la lista).
  const visualRecortado = visualAnalysis ? trimVisualAnalysis(visualAnalysis) : null;

  // FALLBACK: si NO hay análisis visual pero la página sí tenía imágenes (N2 falló o fue rechazado,
  // que no es lo mismo que 'skipped'), el bloque P3 no las lleva y el modelo se quedaría SIN NINGUNA
  // fuente de imágenes → `assets.images` vacío y `suggested_assets` sin nada que referenciar (rompe
  // la regla 8.7 y la coherencia interna que exige el contrato). En ese caso —y SOLO en ese— se
  // mandan las URLs desnudas. Con análisis visual (el caso normal) no se manda nada: es redundante.
  const imagenesSinAnalisis =
    visualAnalysis === null || visualAnalysis === undefined ? raw.images.map((img) => img.url) : [];

  // JSON COMPACTO (sin `null, 2`): la indentación del user message son tokens de INPUT que se pagan
  // y que el modelo no necesita para parsear. Es un ahorro puro, sin efecto sobre la salida (no es
  // una instrucción al modelo sobre CÓMO responder — eso ya se probó y degradaba la calidad).
  return [
    `PLATFORM: ${raw.platform}`,
    '',
    `EXTRACTED_AT: ${extractedAt}`,
    '',
    'STRUCTURED DATA (P1):',
    JSON.stringify(structured),
    '',
    'VISUAL ANALYSIS (P3):',
    visualRecortado ? JSON.stringify(visualRecortado) : 'null (sin análisis visual)',
    ...(imagenesSinAnalisis.length > 0
      ? ['', 'IMÁGENES DE LA PÁGINA (sin clasificar):', JSON.stringify(imagenesSinAnalisis)]
      : []),
    '',
    'PAGE CONTENT (markdown):',
    markdown,
    '',
    `TARGET LANGUAGE: ${targetLanguage}`,
  ].join('\n');
}

/**
 * Aísla el objeto JSON dentro de la respuesta del modelo. DEFENSA EN PROFUNDIDAD, no un parcheo:
 * al no haber structured output (ver el comentario largo en `synthesize`), nada IMPIDE que el
 * modelo envuelva el JSON en vallas ```json o le ponga una frase delante, por mucho que la regla
 * 10 del system prompt le diga que no. Un brief PERFECTO envuelto en markdown no puede contarse
 * como `parse_error`: sería tirar a la basura una llamada ya pagada por un detalle cosmético.
 *
 * Recorta del primer `{` al último `}`. Si no hay objeto, devuelve el texto tal cual y que sea el
 * `JSON.parse` quien falle (y el estado `parse_error` quien lo cuente).
 */
export function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

export function makeBriefSynthesizer(deps: BriefSynthesizerDeps) {
  /**
   * Sintetiza el ProductBrief en UNA llamada. Nunca LANZA por refusal ni por respuesta que no
   * valide: estado TIPADO ('refused'/'parse_error') — mismo patrón que el VisualAnalyzer de T1.7.
   */
  async function attempt(
    input: BriefSynthesizeInput,
    warnings: string[],
  ): Promise<BriefSynthesizerResult> {
    const client = makeAnthropicClient(deps);

    // POR QUÉ `messages.create` SIN `output_config` (lección del FAIL de verificación de T1.8).
    // La decodificación restringida de Anthropic NO puede con un schema del tamaño del brief: son
    // DOS límites duros de plataforma, ambos con 400 determinista contra la API real (nunca contra
    // los mocks) — (1) máx. 16 params con unión, y (2) tamaño de la gramática compilada ("The
    // compiled grammar is too large"), que no tiene umbral público. El (2) es del MECANISMO, no
    // del schema: recortar campos sería adivinar contra un endpoint de pago sin diana. Por eso el
    // schema viaja como TEXTO en el system (cacheado, coste marginal ~0) y aquí no va structured
    // output. La validación real la hace `ProductBriefSchema.safeParse()` más abajo — que ya era
    // la ÚNICA red real, porque la API IGNORA las cardinalidades aunque el schema viaje en
    // `output_config`. Y `messages.parse()` queda descartado de paso: valida client-side y LANZA,
    // mezclando "el modelo respondió raro" con "nuestra petición es inválida" — justo lo que
    // ocultó el 400 durante un ciclo entero.
    let response;
    try {
      response = await client.messages.create({
        model: BRIEF_SYNTHESIZER_MODEL,
        max_tokens: MAX_TOKENS,
        // COST-CRITICAL: Sonnet 5 corre adaptive thinking si se OMITE `thinking` (skill
        // claude-api). Los tokens de thinking se facturan a precio de output ($15/MTok) y no
        // están acotados por el schema → romperían el <$0,15/brief. Se apaga explícitamente.
        thinking: { type: 'disabled' },
        system: [
          {
            type: 'text',
            text: BRIEF_SYNTHESIZER_SYSTEM_PROMPT,
            // Prefijo cacheable. El system es BYTE-ESTABLE (nada interpolado) y supera el mínimo
            // cacheable del modelo → desde la 2ª llamada, cache_read_input_tokens > 0.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: buildUserMessage(input) }],
      });
    } catch (err) {
      // ERRORES DE LA API (401/429/400/timeout de red). NO son "el modelo respondió mal": son
      // "no pudimos hablar con el proveedor" o "nuestra petición es inválida". Confundirlos fue lo
      // que ocultó el 400 de las uniones durante todo un ciclo → estado PROPIO (`api_error`) y el
      // mensaje SE PROPAGA en warnings en vez de tirarse al suelo.
      const detail = err instanceof Error ? err.message : String(err);
      // `APIError.status` viene tipado como `any` en el SDK → se estrecha a number explícitamente.
      const rawStatus: unknown = err instanceof Anthropic.APIError ? err.status : undefined;
      const status = typeof rawStatus === 'number' ? rawStatus : undefined;
      warnings.push(
        `brief_synthesis_api_error${status === undefined ? '' : `_${String(status)}`}: ${detail}`,
      );
      // Sin `usage` fiable: la excepción no lo trae (y en un 400 no se gastó nada).
      return { brief: null, usage: null, status: 'api_error', warnings };
    }

    const usage = toAnthropicUsage(response.usage);

    // stop_reason 'refusal' ⇒ el modelo declinó (skill claude-api). Se pagaron los tokens → se
    // devuelve usage para que el servicio registre el coste; el flujo continúa sin brief.
    if (response.stop_reason === 'refusal') {
      warnings.push('brief_synthesis_refused');
      return { brief: null, usage, status: 'refused', warnings };
    }

    // Se lee el JSON de la respuesta y se valida contra el CONTRATO de T1.1. Esta es la ÚNICA
    // validación real del sistema: sin structured output nada obliga al modelo a nada, y aunque lo
    // hubiera, la API IGNORA las cardinalidades (5–10 ángulos, 2–3 hooks…). El Zod es la red.
    const text = response.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('');

    let raw: unknown;
    try {
      raw = JSON.parse(extractJsonObject(text)) as unknown;
    } catch {
      warnings.push('brief_synthesis_not_json');
      return { brief: null, usage, status: 'parse_error', warnings };
    }

    const validated = ProductBriefSchema.safeParse(raw);
    if (!validated.success) {
      // El modelo respondió, se pagó, pero el brief NO cumple el contrato (p. ej. 4 ángulos: la
      // API no aplica min/maxItems — el Zod es la red de seguridad real).
      // El warning lleva la RUTA del campo, no solo el mensaje: sin ella, un
      // "expected string, received undefined" no dice QUÉ campo falta y obliga a gastar otra
      // llamada de pago para averiguarlo. Se listan hasta 3 issues (uno solo puede engañar).
      const detalle = validated.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
        .join('; ');
      warnings.push(`brief_schema_invalid: ${detalle}`);
      return { brief: null, usage, status: 'parse_error', warnings };
    }

    return { brief: validated.data, usage, status: 'synthesized', warnings };
  }

  /**
   * Sintetiza el brief con UN reintento acotado ante `parse_error`.
   *
   * POR QUÉ EXISTE ESTE REINTENTO: al caer `output_config` (ver el comentario largo de `attempt`),
   * NADA obliga estructuralmente al modelo a respetar los enums — y se ha observado, contra la API
   * real, que a veces traduce UN valor de enum al idioma del brief ("awareness_level" en español) en
   * 1 de 3 segmentos, pese a que los valores exactos están en el system prompt DOS veces (§9 en el
   * JSON Schema y §12 en la lista literal). Es una deriva de baja frecuencia (la verificación obtuvo
   * 4/4 briefs limpios), no un fallo sistemático: reintentar RE-TIRA EL DADO de verdad porque no se
   * fija `temperature` (default 1.0 de Anthropic), así que el segundo intento samplea distinto.
   *
   * Sin reintento, esa deriva convierte una llamada YA PAGADA en cero briefs. Con él, el fallo
   * queda absorbido. Se reintenta SOLO `parse_error` (el modelo respondió y se pagó): un
   * `api_error` es determinista —una petición inválida no mejora por repetirla— y un `refused` es
   * una decisión del modelo, no un accidente.
   *
   * SE DEVUELVE EL `usage` DEL PRIMER INTENTO cuando el reintento tiene éxito, y los warnings
   * ACUMULAN los dos intentos: el coste del reintento es real y el servicio debe poder registrarlo,
   * pero el warning `brief_schema_invalid` del 1er intento NO se pierde — es la señal de que la
   * deriva de enums sigue viva y hay que vigilarla.
   */
  async function synthesize(input: BriefSynthesizeInput): Promise<BriefSynthesizerResult> {
    const warnings: string[] = [];

    if (input.raw.markdown.length > MAX_MARKDOWN_CHARS) {
      warnings.push('markdown_truncated');
    }

    const primero = await attempt(input, warnings);
    if (primero.status !== 'parse_error') return primero;

    warnings.push('brief_synthesis_retry');
    const segundo = await attempt(input, warnings);

    // El coste del reintento SE SUMA al del primer intento: los dos se pagaron. Ocultarlo dejaría
    // al registro de costes mintiendo por defecto (T1.8 nació de un bound de dinero: el contador
    // tiene que contar TODO lo gastado, no lo que salió bien).
    const usage = sumUsage(primero.usage, segundo.usage);
    return { ...segundo, usage, warnings };
  }

  return { synthesize };
}

/** Suma el consumo de dos intentos. Los dos se pagaron: el coste registrado es el total. */
function sumUsage(a: AnthropicUsage | null, b: AnthropicUsage | null): AnthropicUsage | null {
  if (a === null) return b;
  if (b === null) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

export type BriefSynthesizer = ReturnType<typeof makeBriefSynthesizer>;
