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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FIRECRAWL_LANDING_RICH,
  FIRECRAWL_LANDING_DISCOVERY_LINKS,
  FIRECRAWL_INTERNAL_REVIEWS,
  FIRECRAWL_INTERNAL_OPINIONES,
  FIRECRAWL_INTERNAL_FAQ,
  JINA_MARKDOWN,
} from './fixtures/firecrawl';
import type { ProductBrief } from '@ugc/core/contracts';
import {
  anthropicMessageResponse,
  anthropicBriefResponse,
  anthropicScriptResponse,
  scriptDraft,
} from './fixtures/anthropic';
import { makeBrief, makeVisualAnalysis } from './factories';
import { makeTestPng } from './image-fixtures';

// La imagen que el Firecrawl falso devuelve en el landing (FIRECRAWL_LANDING_RICH). El
// brief y el análisis visual falsos la referencian: así `suggested_assets ⊆ assets.images`
// (validación T1.9) se cumple con la MISMA url que el scrape produjo, en vez de con una
// inventada que el pipeline real nunca vería.
const FAKE_HERO_IMAGE = 'https://cdn.glow.example/hero.jpg';

/**
 * T1.15/T1.18 — LAS IMÁGENES CANDIDATAS del caso `url` SIN HERO (el caso stayforlong): las que el
 * scrape trajo, que N2 clasificó `broll`/`unusable`, y que el usuario puede PROMOVER a hero en
 * CP1. Un fixture con `images: []` no serviría: sin candidatas no habría nada que promover
 * (principio 9).
 *
 * T1.18 — LAS SIRVE ESTE MISMO FAKE, Y UNA DE ELLAS DA 403. Antes eran URLs de un host inventado
 * (`cdn.glow.example`), que NO RESUELVE: ni el navegador ni el servidor podían bajarlas. Eso era
 * invisible mientras la miniatura la pedía el navegador a pelo (una imagen rota más), pero desde
 * T1.18 la baja el SERVIDOR por el proxy `/api/thumbnails` y su resultado DECIDE si la candidata
 * se puede promover: con un host muerto, NINGUNA candidata sería promovible y el E2E no podría
 * distinguir «no se puede bajar» de «el fixture es de mentira».
 *
 * Ahora el fake sirve bytes DE VERDAD (`/img/ok/*` → PNG real) y NIEGA una (`/img/forbidden/*` →
 * 403), que es EXACTAMENTE lo que hace es.stayforlong.com con sus `/_next/image?url=…`: los sirve
 * a su propia web y responde 403 a cualquier otro. Las paths se resuelven contra el ORIGEN del
 * propio fake (puerto efímero), así que el brief que devuelve la síntesis lleva URLs vivas.
 */
const OK_IMAGE_PATHS = ['/img/ok/lifestyle.png', '/img/ok/detail.png'] as const;
/** La candidata que NI EL SERVIDOR puede bajar (403): la razón de ser de T1.18. Se EXPORTA para
 *  que el spec de Playwright señale ESA candidata sin copiar el literal (el fake y el spec tienen
 *  que hablar de la MISMA imagen — el mismo criterio que `FAKE_URL_NO_HERO`). */
export const FAKE_FORBIDDEN_IMAGE_PATH = '/img/forbidden/next-image.png';

/**
 * La URL que el E2E analiza para provocar el caso `url` SIN HERO USABLE. El fake la reconoce en el
 * bloque STRUCTURED DATA del user message (`{"url": ...}`, que el sintetizador REAL escribe) —el
 * mismo mecanismo explícito que `isManualSynthesis`, no una heurística sobre el contenido.
 */
export const FAKE_URL_NO_HERO = 'https://services.example/no-hero/hoteles';

/**
 * T4.11 — La URL que el E2E de generación (F4) analiza para obtener un brief de vertical `beauty`. Mismo
 * mecanismo explícito que `FAKE_URL_NO_HERO`: la URL viaja en el STRUCTURED DATA del user message y el
 * fake la reconoce. POR QUÉ existe: el brief por defecto (`makeBrief`) trae `category: 'skincare'`, y
 * NINGÚN template de galería lista `skincare` como vertical → N6 (compilador de prompts) no casaría
 * template y todo el sub-DAG N7 fallaría en el compilador. `beauty` es la ÚNICA vertical con guard pack
 * sembrado y golden-tested (beauty+tiktok): el camino production-ready que `demo-pain-point` selecciona
 * limpio. Se fija el INPUT (`category`) como en producción — NO se hardcodea el vertical derivado (eso
 * sería la trampa T1.13). El hueco de completitud (verticals fuera de la lista de los pain_point
 * templates no casan) es un hallazgo de producto de F4, no un problema de este fake.
 */
export const FAKE_URL_BEAUTY = 'https://glow.example/beauty/serum';

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
  // T1.10b — UN PAIN POINT CON `evidence` (cita textual) Y OTRO SIN ELLA.
  //
  // Otra vez el mismo criterio: hacer al fake MÁS fiel, no más cómodo. `pain_points[].evidence`
  // es un campo EXTRACTIVO del Apéndice A —el modelo cita la frase de la página de la que sacó
  // el dolor— y Sonnet 5 lo rellena de verdad. El default de `makeBrief()` lo deja a `null` (le
  // basta para lo suyo), así que un CP1 alimentado con él no mostraría NI UNA cita: el badge
  // «✓ extraído» aparecería sin nada que respaldarlo, y la trazabilidad —que es LA razón de ser
  // de este editor— no se podría observar. El par (con cita / sin cita) es lo que hace
  // observables los DOS badges y la evidencia. Override LOCAL, no en la factory.
  pain_points: [
    {
      pain: 'La piel tira y se ve apagada al despertar',
      severity: 'high',
      current_alternative: 'Cremas genéricas que no penetran',
      evidence: 'Mis clientas notan la piel más luminosa desde la primera semana',
    },
    {
      pain: 'Miedo a que irrite la piel sensible',
      severity: 'medium',
      current_alternative: null,
      evidence: null, // inferido: sin cita (el badge violeta, sin <q>)
    },
  ],
  assets: {
    // `hero_image_url` NO nulo: es el CAMINO FELIZ (una tienda con su packshot), y lo es con la
    // imagen que el scrape falso sí produce — no por haberle quitado el examen. Su ausencia ya no
    // mata el run (T1.15): lleva la decisión a CP1, y ESE camino tiene su propio fixture
    // (`FAKE_BRIEF_NO_HERO`, la web de servicio).
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
  // T1.10b — UN HOOK QUE EXCEDE EL TECHO DE ≤12 PALABRAS, A PROPÓSITO.
  //
  // Esto hace al fake MÁS fiel, no menos: los hooks auténticos de Sonnet 5 se pasan del techo
  // con frecuencia (8 `hook_too_long` en los briefs reales de T1.9). Un fake que solo emitiera
  // hooks cortos pintaría un CP1 sin warnings que en producción NUNCA se ve — y el editor
  // llegaría a la Verificación sin que nadie hubiera mirado cómo renderiza un warning. El
  // override es LOCAL (aquí), no en `makeBrief`: su default corto lo comparten decenas de tests
  // que no van de esto.
  //
  // 14 palabras ⇒ `hook_too_long` (MAX_HOOK_WORDS = 12). NO bloquea la aprobación (ningún warning
  // lo hace, T1.15): se avisa y el usuario reescribe el copy si quiere, en el editor.
  angles: makeBrief().angles.map((angle, i) =>
    i === 0
      ? {
          ...angle,
          hook_examples: [
            'Llevo tres semanas usando este sérum cada mañana y mi piel ya no se apaga',
            'Y si el problema no era tu piel',
          ],
        }
      : angle,
  ),
});

/**
 * T4.11 — El brief de vertical `beauty` para el E2E de generación (F4). Es `FAKE_BRIEF` con la categoría
 * cambiada a `beauty` (la única vertical con template + guard pack sembrados): así N6 casa `demo-pain-point`
 * y el sub-DAG N7 corre. Todo lo demás (hero, imágenes, ángulos) se hereda del brief canónico.
 *
 * `avatar_hint` REESCRITO a propósito (T4.11): el default («Creadora 30 años, estilo natural, baño
 * luminoso») lo comparten VARIAS personas de test —las «Vera» de voice-preview.spec, que se siembran en
 * la MISMA BD del stack pero SIN imagen de referencia—. Como N4 ROTA la persona por variante entre TODAS
 * las candidatas con score>0 (matrix.ts `pickPersona`), una variante premium caería en una «Vera» sin
 * imagen → `buildVariantGenerationPlan` lanzaría `PermanentStepError` (avatar sin referencia) y CP3
 * devolvería 500. El score de matching es ciego a la imagen/voz (solo mira descriptor/edad/género), así
 * que subir el score de la persona buena no basta: hay que dejar a las «Vera» en score 0. Este hint tiene
 * tokens DISJUNTOS de los descriptores de todas las demás personas de test (Vera: creadora/natural/baño;
 * Lucía seed: latina/casual; Marcus seed: male→filtrado), y NINGÚN rango de edad (que puntuaría a Vera).
 * Solo la persona `MATCHING_PERSONA` del spec (descriptor «farmacéutica cosmética … bata blanca») casa →
 * `candidates` = [ella] y la rotación es un no-op. El spec lo BLINDA con un assert de `matchPersonas` en
 * su `beforeAll`: si una persona futura contaminara este hint, ese assert se pone rojo en el origen (no
 * como un timeout opaco 30 s aguas abajo). NB: el `avatar_hint` alimenta SOLO el matching de personas —
 * es independiente de `category`/templates, así que no toca el camino N6.
 */
export const FAKE_BEAUTY_AVATAR_HINT =
  'Mujer farmacéutica cosmética en laboratorio dermatológico con bata blanca';

const FAKE_BRIEF_BEAUTY: ProductBrief = {
  ...FAKE_BRIEF,
  product: { ...FAKE_BRIEF.product, category: 'beauty' },
  audience: {
    ...FAKE_BRIEF.audience,
    segments: FAKE_BRIEF.audience.segments.map((seg, i) =>
      i === 0 ? { ...seg, avatar_hint: FAKE_BEAUTY_AVATAR_HINT } : seg,
    ),
  },
};

/**
 * El brief que devuelve el Anthropic falso para N3 EN MODO MANUAL SIN IMÁGENES (T1.10b).
 *
 * SIN HERO Y SIN IMÁGENES — y es lo que EMITIRÍA el productor real: si la síntesis no recibe
 * ninguna imagen (texto libre, N2 saltado por inaplicable), el modelo no puede inventarse
 * `assets.images[]` (la regla 8.7 de su system prompt se lo prohíbe: `suggested_assets` debe
 * referenciar imágenes REALES). El fake anterior devolvía SIEMPRE un brief con hero, incluso
 * cuando la entrada no tenía ni una foto — un fixture cómodo que hacía IMPOSIBLE observar el
 * warning `needs_user_decision` (la petición bloqueante de imágenes del modo manual, §9.2), que
 * es justo lo que CP1 tiene que resolver.
 *
 * Con esto, el camino manual dispara en el validador (perfil `manual`, T1.9):
 *   `needs_user_decision` → brief VÁLIDO (el step NO falla) → llega a CP1 → el editor pide
 *   imágenes o deriva a packshot-IA. Exactamente lo que exige la Verificación.
 */
const FAKE_BRIEF_NO_IMAGES = makeBrief({
  meta: {
    // Modo manual: sin URL (el bicondicional del Apéndice A lo exige).
    source_url: null,
    platform: 'manual',
    language: 'es',
    extracted_at: '2026-07-10T12:00:00.000Z',
    extraction_confidence: 'medium',
    warnings: [],
  },
  assets: {
    hero_image_url: null,
    images: [],
  },
  // Sin imágenes que referenciar, ningún ángulo puede sugerir assets (regla 8.7).
  angles: makeBrief().angles.map((angle) => ({ ...angle, suggested_assets: [] })),
});

/**
 * T1.15 — EL BRIEF DE UNA WEB DE SERVICIO: origen `url`, SIN hero usable, pero CON las imágenes
 * que el scrape SÍ trajo. Es el caso REAL que motivó la tarea (`es.stayforlong.com`): Haiku
 * clasificó honestamente las 3 imágenes que le llegaron —un sello de award, un about-us, un
 * banner— como `broll`/`unusable`, ninguna era `hero`, y el sintetizador dejó
 * `hero_image_url: null`. Hasta T1.15 eso MATABA el run en N3 (warning bloqueante) con la síntesis
 * de Sonnet ya pagada; ahora llega a CP1 y el usuario decide.
 *
 * LA DIFERENCIA CON `FAKE_BRIEF_NO_IMAGES` (y es la que hace que este fixture valga): aquí SÍ hay
 * `assets.images[]`. Son las candidatas que el editor ofrece PROMOVER a hero — con `images: []` no
 * habría nada que elegir y el E2E no ejercitaría la salida nueva. Y son URLs que el Firecrawl
 * falso REALMENTE devuelve en su landing, no inventadas: el pipeline de verdad nunca vería otras.
 *
 * OJO al `suggested_assets: []`: el sintetizador real no puede sugerir assets que no existen
 * (regla 8.7), y dejarlos apuntando a la hero.jpg del brief canónico —que aquí NO está en
 * `images`— haría que el validador emitiera `pruned_suggested_asset` de propina. Ruido que
 * desplazaría los asserts sin aportar nada.
 */
function fakeBriefNoHero(origin: string): ProductBrief {
  return makeBrief({
    assets: {
      hero_image_url: null,
      images: [
        {
          url: `${origin}${OK_IMAGE_PATHS[0]}`,
          kind: 'lifestyle',
          has_overlay_text: true,
          background: 'busy',
          video_suitability: 'broll',
        },
        {
          url: `${origin}${OK_IMAGE_PATHS[1]}`,
          kind: 'other',
          has_overlay_text: false,
          background: 'busy',
          video_suitability: 'broll',
        },
        {
          // LA INSERVIBLE (T1.18): el fake responde 403 a esta URL. CP1 no debe ofrecerla como
          // promovible — y debe decir por qué.
          url: `${origin}${FAKE_FORBIDDEN_IMAGE_PATH}`,
          kind: 'chart_or_text',
          has_overlay_text: true,
          background: 'clean',
          video_suitability: 'unusable',
        },
      ],
    },
    angles: makeBrief().angles.map((angle) => ({ ...angle, suggested_assets: [] })),
  });
}

/**
 * ¿La request de síntesis (N3) es de MODO MANUAL? Se mira el bloque STRUCTURED DATA que el
 * sintetizador REAL escribe en el user message (`brief-synthesizer.ts` buildUserMessage:
 * `{source: raw.source, url, product, branding}`), que es un dato EXPLÍCITO y estable — no una
 * heurística sobre el contenido.
 *
 * `content` es un STRING (el user message), y el JSON va DENTRO de él. Por eso se busca sobre el
 * texto del mensaje y NO sobre `JSON.stringify(body)`: ahí las comillas del JSON interior están
 * ESCAPADAS (`{\"source\":\"manual\"}`) y el patrón nunca casaría.
 */
function isManualSynthesis(body: Record<string, unknown>): boolean {
  return synthesisMessageIncludes(body, '"source":"manual"');
}

/**
 * ¿La request de síntesis es la del caso `url` SIN HERO (T1.15)? Mismo mecanismo explícito: la
 * URL analizada viaja en el STRUCTURED DATA (`{"source":"url","url":"…"}`) y el E2E la elige a
 * propósito (`FAKE_URL_NO_HERO`). Nada de heurísticas sobre el markdown.
 */
function isUrlNoHeroSynthesis(body: Record<string, unknown>): boolean {
  return synthesisMessageIncludes(body, FAKE_URL_NO_HERO);
}

/** ¿La síntesis es la del E2E de generación (F4, `FAKE_URL_BEAUTY`)? Mismo mecanismo explícito. */
function isBeautySynthesis(body: Record<string, unknown>): boolean {
  return synthesisMessageIncludes(body, FAKE_URL_BEAUTY);
}

/** El user message del sintetizador es un STRING con JSON dentro: se busca sobre su TEXTO. */
function synthesisMessageIncludes(body: Record<string, unknown>, needle: string): boolean {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages.some((m: unknown) => {
    if (typeof m !== 'object' || m === null || !('content' in m)) return false;
    const { content } = m;
    return typeof content === 'string' && content.includes(needle);
  });
}

/** El brief que el Anthropic falso devuelve para una síntesis dada. Tres casos, y el orden importa
 *  (manual gana: en manual no hay URL que mirar). El `origin` es el del PROPIO fake: el brief del
 *  caso sin hero lleva URLs de imagen que este servidor sirve de verdad (T1.18). */
function briefForSynthesis(body: Record<string, unknown>, origin: string): ProductBrief {
  if (isManualSynthesis(body)) return FAKE_BRIEF_NO_IMAGES;
  if (isUrlNoHeroSynthesis(body)) return fakeBriefNoHero(origin);
  if (isBeautySynthesis(body)) return FAKE_BRIEF_BEAUTY;
  return FAKE_BRIEF;
}

/**
 * ¿La request de `claude-sonnet-5` es del ScriptWriter (N5) y no del sintetizador (N3)? Los DOS usan
 * el mismo modelo, así que NO se puede discriminar por `model`. Se discrimina por el SYSTEM prompt:
 * el del guionista empieza por «Eres un guionista de anuncios UGC» (byte-estable, cacheado — §8 del
 * prompt). El `system` viaja como array de bloques `{type:'text', text}` (cache_control por bloque).
 */
function isScriptWriting(body: Record<string, unknown>): boolean {
  const system = body.system;
  const blocks = Array.isArray(system) ? system : typeof system === 'string' ? [system] : [];
  return blocks.some((b: unknown) => {
    const text =
      typeof b === 'string' ? b : typeof b === 'object' && b !== null && 'text' in b ? b.text : '';
    return typeof text === 'string' && text.includes('guionista de anuncios UGC');
  });
}

/** El TEXTO del user message (el ScriptWriter manda un único user con el brief recortado + las
 *  semillas). Es de donde el fake saca cuántos hooks emitir y en qué idioma. */
function scriptUserMessage(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (const m of messages) {
    if (
      typeof m === 'object' &&
      m !== null &&
      'role' in m &&
      (m as { role: unknown }).role === 'user'
    ) {
      const { content } = m as { content: unknown };
      if (typeof content === 'string') return content;
      // content puede ser array de bloques {type:'text', text}
      if (Array.isArray(content)) {
        return content
          .map((c) =>
            typeof c === 'object' && c !== null && 'text' in c
              ? String((c as { text: unknown }).text)
              : '',
          )
          .join('\n');
      }
    }
  }
  return '';
}

/** Construye la respuesta de guion para una request del ScriptWriter, leyendo del user message
 *  cuántas semillas hay (`HOOK SEEDS (N; …)`) y el idioma destino (`TARGET LANGUAGE: xx`). Emitir el
 *  número EXACTO de hooks es lo que satisface la biyección semilla↔hook que el writer exige. */
function scriptResponseFor(body: Record<string, unknown>): Record<string, unknown> {
  const message = scriptUserMessage(body);
  const seedMatch = /HOOK SEEDS \((\d+);/.exec(message);
  const seedCount = seedMatch ? Number(seedMatch[1]) : 1;
  const langMatch = /TARGET LANGUAGE:\s*(\S+)/.exec(message);
  const language = langMatch?.[1] ?? 'es';
  // `nonce` estable-pero-distinto por request (idioma + nº de semillas) para que el body/cta no sean
  // idénticos byte a byte entre grupos — no hace falta un contador global aquí.
  const nonce = language.charCodeAt(0) + seedCount;
  return anthropicScriptResponse(scriptDraft(seedCount, language, nonce));
}

// ── OUTPUT del queue de fal POR ENDPOINT (T4.11) ──────────────────────────────────────────────────
// Cada FAMILIA de modelo emite una forma distinta (verificado contra los schemas de fal, ver los
// `fal-*-output.ts` de core): imagen `{images:[…]}`, TTS/música `{audio:{url}}`, ASR `{text, words:[…]}`,
// vídeo `{video:{url}, duration}`. El fake devuelve la que corresponde al endpoint del submit — un fake
// que emitiera siempre `{audio:{url}}` (lo de T4.6) haría fallar N7a/N7c/N7d/N7e por output equivocado,
// enmascarando el fallo determinista que la spec SÍ quiere observar. Las URLs de media cuelgan del
// propio fake (`origin`), que las sirve como bytes reales.
const IS_ASR = /speech-to-text/i;
const IS_VIDEO = /(kling|omnihuman|veo|seedance)/i;
const IS_IMAGE = /(flux|nano-banana|seedream)/i;

/** Las word timestamps que el ASR (`fal-ai/elevenlabs/speech-to-text`) devuelve: ≥1 `word` con tiempos
 *  válidos y crecientes (lo exige `WordTimestampsSchema.min(1)` + `computeWordCoverage`). Sin esto N7b
 *  fallaría por cobertura, no por el fallo que la spec busca. */
function fakeWordTimestamps(): Record<string, unknown> {
  return {
    text: 'Descubre nuestro producto hoy',
    language_code: 'spa',
    language_probability: 0.99,
    words: [
      { text: 'Descubre', start: 0.0, end: 0.5, type: 'word', speaker_id: 'spk_0' },
      { text: 'nuestro', start: 0.5, end: 0.9, type: 'word', speaker_id: 'spk_0' },
      { text: 'producto', start: 0.9, end: 1.4, type: 'word', speaker_id: 'spk_0' },
      { text: 'hoy', start: 1.4, end: 1.8, type: 'word', speaker_id: 'spk_0' },
    ],
  };
}

/** El output que el fake devuelve para el resultado COMPLETED de un endpoint. Discrimina por familia:
 *  ASR antes que audio (elevenlabs sirve las dos), luego vídeo, imagen y por defecto audio (TTS/música). */
function falOutputFor(endpoint: string, origin: string): Record<string, unknown> {
  if (IS_ASR.test(endpoint)) return fakeWordTimestamps();
  if (IS_VIDEO.test(endpoint)) {
    // `duration` a NIVEL RAÍZ (hermana de `video`, no anidada) — así lo valida `fal-video-output.ts`; sin
    // ella `recoverVideoDurationSeconds` no factura y el vídeo fallaría permanente por la razón equivocada.
    return {
      video: { url: `${origin}/fal-media/clip-sample.mp4`, content_type: 'video/mp4' },
      duration: 5,
    };
  }
  if (IS_IMAGE.test(endpoint)) {
    return {
      images: [
        {
          url: `${origin}/fal-media/shot-sample.png`,
          width: 768,
          height: 1344,
          content_type: 'image/png',
        },
      ],
    };
  }
  // TTS (kokoro/elevenlabs-tts) y música (ace-step): `{audio:{url}}`.
  return { audio: { url: `${origin}/fal-media/voice-sample.wav`, content_type: 'audio/wav' } };
}

export interface FakeExternalApis {
  /** Base URL del Firecrawl falso (para `firecrawlBaseUrl`). */
  firecrawlBaseUrl: string;
  /** Base URL del Jina falso (para `jinaBaseUrl`). */
  jinaBaseUrl: string;
  /** Base URL del Anthropic falso (para `anthropicBaseUrl`). */
  anthropicBaseUrl: string;
  /** Base URL del fal falso (para `FAL_BASE_URL`, T4.6): web reescribe `queue.fal.run` aquí. */
  falBaseUrl: string;
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

  // El ORIGEN del propio fake (puerto efímero: solo se sabe tras `listen`). Lo necesitan las URLs
  // de imagen que el brief del caso sin hero devuelve (T1.18): tienen que apuntar AQUÍ para que el
  // proxy de miniaturas del servidor pueda bajarlas de verdad.
  let origin = '';

  // Un PNG REAL (no unos bytes cualquiera): el proxy de miniaturas DECODIFICA la imagen con sharp
  // antes de servirla, así que un fixture con bytes inventados fallaría el decode y toda candidata
  // saldría inservible — el test pasaría por la razón equivocada. Se genera una vez, perezosamente.
  let png: Uint8Array | undefined;

  // El .wav de la muestra de voz (T4.6) y el .mp4 de muestra de vídeo (T4.11), leídos perezosamente la
  // primera vez que se sirven. Y un contador de submits al queue de fal para dar request_ids únicos (dos
  // submits distintos no deben colisionar en la misma pasada).
  let wav: Buffer | undefined;
  let mp4: Buffer | undefined;
  let falSubmitCounter = 0;

  // Sub-DAG de generación (T4.11): el fake devuelve el OUTPUT correcto POR ENDPOINT (imagen/audio/ASR/
  // vídeo/música), no el `{audio:{url}}` genérico de T4.6. Para eso RECUERDA qué endpoint pidió cada
  // request_id en el submit y lo consulta en el GET del resultado.
  const falEndpointByRequestId = new Map<string, string>();

  // FALLO DETERMINISTA de UN sub-step (T4.11, cláusula «fallo determinista + retry granular» de la spec
  // de fase): el fake designa el PRIMER submit de una generación de IMAGEN (N7a, flux-2/nano-banana) como
  // «doomed» y, cuando su resultado se consulta, devuelve un output MALFORMADO (`{}` sin `images`). Eso es
  // una VIOLACIÓN DE CONTRATO de una generación ya COMPLETED → el servicio la mapea a `FalResponseError` →
  // el executor N7 a `PermanentStepError` (sin auto-retry: NO es un status `FAILED`, que sí reintentaría
  // hasta 80 veces). El step queda `failed` y el usuario lo REINTENTA: el retry re-submitea con un
  // request_id NUEVO (no doomed) → output correcto → succeeds, sin tocar a los hermanos sanos. Se elige
  // IMAGEN (no vídeo) a propósito: N7a liquida INLINE (`finalizeGeneration`), sin el salto asíncrono del
  // sweeper del vídeo → la aserción de fallo es más ajustada y menos flaky. Un solo fallo por corrida
  // (`doomedRequestId` se fija una vez y no se re-arma), así que el retry no vuelve a caer.
  let doomedRequestId: string | undefined;

  async function handle(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (body: unknown, status = 200): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    // ── Imágenes candidatas del caso SIN HERO (T1.18) ───────────────────────────
    // El CDN de la web analizada, fingido: unas las sirve y otra las NIEGA. El 403 no es un
    // capricho del fixture — es lo que hace es.stayforlong.com con sus `/_next/image?url=…`
    // (los sirve a su propia web y responde 403 a cualquier fetch de fuera). Sin una candidata
    // que de verdad no se pueda bajar, el E2E de T1.18 no probaría NADA (principio 9).
    if (req.method === 'GET' && url.pathname.startsWith('/img/forbidden/')) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/img/ok/')) {
      png ??= await makeTestPng(600, 600);
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(png.byteLength) });
      res.end(Buffer.from(png));
      return;
    }

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
      if (model === SYNTHESIS_MODEL && isScriptWriting(body)) {
        // N5 · GUIONIZACIÓN (T2.4/T2.6). MISMO modelo que la síntesis, así que se discrimina por el
        // system prompt del guionista (isScriptWriting) ANTES de la rama de síntesis. Devuelve un
        // draft con tantos hooks como semillas pide el user message, en el idioma destino — lo justo
        // para que el writer ensamble `AdScript` válidos y el status sea `scripted`.
        json(scriptResponseFor(body));
        return;
      }
      if (model === SYNTHESIS_MODEL) {
        // T1.10b / T1.15 — EL FAKE RESPONDE SEGÚN LO QUE SE LE PIDE, como haría el modelo real.
        //
        // El user message del sintetizador lleva el bloque STRUCTURED DATA con el `source` y la
        // `url` del RawContent (`brief-synthesizer.ts` buildUserMessage). Tres respuestas:
        //   - MANUAL sin imágenes: no hay NADA visual que el modelo pueda poner en `assets` ⇒
        //     brief sin hero Y SIN IMÁGENES (FAKE_BRIEF_NO_IMAGES).
        //   - URL de una web de SERVICIO (T1.15, `FAKE_URL_NO_HERO`): hay imágenes, pero ninguna
        //     sirve de hero ⇒ FAKE_BRIEF_NO_HERO. Es el caso stayforlong, y el único en el que el
        //     usuario puede PROMOVER una imagen scrapeada.
        //   - Resto: el camino feliz, con hero (FAKE_BRIEF).
        //
        // Devolver siempre el brief CON hero (lo que hacía antes de T1.10b) era el fixture cómodo
        // de T1.8/T1.9: hacía inobservable el warning que CP1 tiene que resolver.
        //
        // OJO al escapado: el user message es un STRING que CONTIENE JSON, así que dentro del
        // body de la request las comillas van escapadas (`{\"source\":\"manual\"}`). Buscar
        // `"source":"manual"` sobre el `JSON.stringify(body)` NO casa nunca. Se mira el TEXTO
        // del mensaje ya des-escapado (que es donde el sintetizador lo escribe).
        json(anthropicBriefResponse(briefForSynthesis(body, origin)));
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

    // ── fal.ai: UPLOAD de inputs (T4.11) ────────────────────────────────────────
    // El SDK de fal sube un input (audio del hook para N7c, imagen para avatar, audio TTS para el ASR de
    // N7b) vía `storage.upload`: POST `rest.fal.ai/storage/upload/initiate` → `{upload_url, file_url}`,
    // luego PUT de los bytes a `upload_url`. La reescritura por-origen del cliente manda `rest.fal.ai` a
    // ESTE fake (T4.11 añadió el origen). Se finge SOLO el flujo single-part; el multipart se 404ea (el
    // SDK cae a single-part para ficheros pequeños). El `file_url` cuelga de este origen y NADIE lo baja
    // (el submit del fake ignora los inputs), así que solo tiene que estar bien formado.
    if (req.method === 'POST' && url.pathname === '/storage/upload/initiate') {
      falSubmitCounter += 1;
      const fileId = `fake-input-${String(falSubmitCounter)}`;
      json({
        upload_url: `${origin}/fal-cdn/upload/${fileId}`,
        file_url: `${origin}/fal-cdn/files/${fileId}`,
      });
      return;
    }
    if (req.method === 'PUT' && url.pathname.startsWith('/fal-cdn/upload/')) {
      // Descarta los bytes (el fake no los necesita) y responde 200 — es lo que el SDK espera del PUT.
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }

    // ── fal.ai: queue de generación (T4.6 TTS-only; T4.11 sub-DAG N6→N7 completo) ─
    // El worker llama a fal por el `fetch` que reescribe los orígenes de fal → este fake (FAL_BASE_URL).
    // Ciclo: submit → status COMPLETED → response con el OUTPUT del endpoint → descarga del media fixture.
    // El request_id se deriva de un contador (dos submits no colisionan). El fake RECUERDA el endpoint de
    // cada request_id para devolver el OUTPUT correcto por tipo de modelo en el GET del resultado.
    // POST del submit del queue: `/{owner}/{alias}` (p. ej. `/fal-ai/kokoro`, `/fal-ai/flux-2`,
    // `/fal-ai/veo3.1/image-to-video`). Se reconoce por el prefijo `fal-ai/` y que NO sea `requests/`.
    const isFalSubmit =
      req.method === 'POST' &&
      url.pathname.startsWith('/fal-ai/') &&
      !url.pathname.includes('/requests/');
    if (isFalSubmit) {
      const endpoint = url.pathname.slice(1); // sin el '/' inicial
      falSubmitCounter += 1;
      const requestId = `fake-${String(falSubmitCounter)}`;
      falEndpointByRequestId.set(requestId, endpoint);
      // Designa el PRIMER submit de IMAGEN como el fallo determinista (una vez por corrida).
      if (doomedRequestId === undefined && IS_IMAGE.test(endpoint)) {
        doomedRequestId = requestId;
      }
      const responseUrl = `${origin}/${endpoint}/requests/${requestId}`;
      json({
        request_id: requestId,
        status_url: `${responseUrl}/status`,
        response_url: responseUrl,
        cancel_url: `${responseUrl}/cancel`,
        status: 'IN_QUEUE',
      });
      return;
    }
    // GET del status del queue: `/{endpoint}/requests/{id}/status` → COMPLETED (fake determinista). El
    // fallo NO es un status `FAILED` (eso reintentaría hasta 80 veces): es un output COMPLETED-pero-
    // malformado, que el servicio trata como violación de contrato terminal (ver `doomedRequestId`).
    if (
      req.method === 'GET' &&
      url.pathname.startsWith('/fal-ai/') &&
      url.pathname.endsWith('/status')
    ) {
      json({ status: 'COMPLETED' });
      return;
    }
    // GET del resultado del queue: `/{endpoint}/requests/{id}` → el OUTPUT correcto POR ENDPOINT.
    if (
      req.method === 'GET' &&
      url.pathname.startsWith('/fal-ai/') &&
      url.pathname.includes('/requests/') &&
      !url.pathname.endsWith('/status')
    ) {
      const requestId = url.pathname.split('/requests/')[1]?.split('/')[0] ?? '';
      const endpoint = falEndpointByRequestId.get(requestId) ?? '';
      // FALLO DETERMINISTA: el submit doomed devuelve un output MALFORMADO (violación de contrato) →
      // `FalResponseError` → `PermanentStepError` → step `failed`, reintentable por el usuario.
      if (requestId === doomedRequestId) {
        json({});
        return;
      }
      json(falOutputFor(endpoint, origin));
      return;
    }
    // Descarga del .mp4 de muestra del output de vídeo (URL pública que el "response" emitió, T4.11).
    if (req.method === 'GET' && url.pathname === '/fal-media/clip-sample.mp4') {
      mp4 ??= readFileSync(
        fileURLToPath(new URL('../fixtures/media/clip-sample.mp4', import.meta.url)),
      );
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(mp4.byteLength) });
      res.end(mp4);
      return;
    }
    // Descarga del .png de muestra del output de imagen (N7a keyframes, T4.11): un PNG real (sharp lo
    // decodifica en la descarga).
    if (req.method === 'GET' && url.pathname === '/fal-media/shot-sample.png') {
      png ??= await makeTestPng(768, 1344);
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(png.byteLength) });
      res.end(Buffer.from(png));
      return;
    }
    // Descarga del .wav del output (URL pública que el "response" emitió).
    if (req.method === 'GET' && url.pathname === '/fal-media/voice-sample.wav') {
      wav ??= readFileSync(
        fileURLToPath(new URL('../fixtures/media/voice-sample.wav', import.meta.url)),
      );
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': String(wav.byteLength) });
      res.end(wav);
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
  origin = base; // las URLs de imagen del brief sin hero (T1.18) cuelgan de este origen

  return {
    firecrawlBaseUrl: base,
    jinaBaseUrl: base,
    anthropicBaseUrl: base,
    falBaseUrl: base,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}
