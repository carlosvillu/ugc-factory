// EL SCRIPTWRITER (N5, T2.4 — PRD §9.4, §7.2 N5, §17): de `BatchPlan` (lo que N4 decidió) a
// `AdScript[]` (los guiones que CP3 edita y que N6 compila). La otra mitad de la frontera §7.4
// `ProductBrief → BatchPlan → AdScript[]`.
//
// DÓNDE VIVE Y POR QUÉ: es el MISMO tipo de pieza que N3 (`analyze/brief-synthesizer.ts`) — red
// (una llamada a Sonnet 5) + CPU (armar el prompt, parsear, calcular el timing). Nada de BD, nada
// de cola. La persistencia y el `cost_entry` viven en `@ugc/services` (`write-scripts.ts`), igual
// que `synthesize-brief.ts`. **No se registra ningún executor en el DAG**: el run de ANÁLISIS
// (N1→N2→N3→N4) termina en CP2, y el DAG del LOTE (N5→N6→N7…) no existe todavía — la tarea que lo
// exige explícitamente es T3.5 («registro del executor N6 en el orquestador»), no esta.
//
// ═══ LAS DOS DEUDAS HEREDADAS, Y CÓMO SE PAGAN AQUÍ ══════════════════════════════════════════
//
// 1. TRUNCADO AL PRESUPUESTO (deuda de T2.1). Los hooks de la LIBRERÍA son plantillas con
//    `{pain}` / `{benefit}` / `{product}` / `{category}`. Sustituirlos por los valores del brief
//    SIN truncar hace que el techo de 12 palabras vuelva a mentir —ya en el anuncio emitido—,
//    porque `ProductBriefSchema` declara esos campos como `z.string()` sin `.max()`: un `pain` de
//    12 palabras convierte un hook de 10 palabras en uno de 18. Aquí se resuelve con
//    `renderPlaceholders` (library/placeholders.ts), que trunca cada valor a
//    `PLACEHOLDER_WORD_BUDGET`. Es el MISMO presupuesto con el que T2.1 validó la librería: una
//    constante, dos consumidores, y ahora los dos la respetan.
//
// 2. LA SEMILLA NO ESTÁ TRADUCIDA (deuda de T2.2). El compositor copia los `hook_examples` del
//    brief tal cual a TODAS las variantes — incluidas las de `language: 'en'`, mientras el brief
//    está en el idioma del análisis (normalmente `es`). Es correcto por contrato (§17 asigna el
//    idioma destino nativo a N5, no a N4), pero significa que **`hook.text` es una SEMILLA**. Si
//    se encajara literal, el anuncio en inglés saldría con el gancho en español. Aquí manda
//    `variant.language`: viaja como `TARGET LANGUAGE` en el user message, y el §2 del system
//    prompt ordena escribir NATIVO (no traducir) e ignorar el idioma del material de entrada.
//
// ═══ HOOK-TESTING: LA IDENTIDAD TEXTUAL ES POR CONSTRUCCIÓN ═════════════════════════════════
//
// La Verificación exige que los bodies de las variantes de un mismo ángulo sean TEXTUALMENTE
// idénticos (diff vacío). No se consigue "pidiéndole al modelo que los repita" —dos llamadas
// producen dos textos "casi iguales" y la economía del modo se rompe (N7 deja de deduplicar y el
// estimador, que cobra el body UNA vez, pasa a mentir)—. Se consigue **llamando UNA VEZ POR
// GRUPO**: el modelo emite UN body + UN cta + N hooks, y las N variantes del grupo se ensamblan
// con LA MISMA referencia de escenas de body/cta. No hay dos textos que comparar porque solo se
// generó uno.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { SCRIPT_WRITER_SYSTEM_PROMPT } from '../../prompts/script-writer';
import {
  makeAnthropicClient,
  sumAnthropicUsage,
  toAnthropicUsage,
  type AnthropicDeps,
  type AnthropicUsage,
} from '../analyze/anthropic-client';
import { extractJsonObject } from '../analyze/brief-synthesizer';
import { MAX_HOOK_WORDS } from '../analyze/brief-validator';
import {
  AdScriptSchema,
  type AdScript,
  type AdSegment,
  type BatchPlan,
  type PlannedVariant,
  type ProductBrief,
} from '../contracts';
import { renderPlaceholders, type PlaceholderValues } from '../library/placeholders';
import { DURATION_PRESETS } from '../strategy/presets';
import {
  computeSceneTiming,
  estSecondsOf,
  fullTextOf,
  subtitlesFromScenes,
  totalWords,
  wordBudgetFor,
  wordsInSegment,
  type DraftScene,
} from './timing';

/** Modelo de guiones: Sonnet 5 (§7.2 N5, §13.1). El mismo que N3. */
export const SCRIPT_WRITER_MODEL = 'claude-sonnet-5';

/** Tope de salida. No es palanca de coste (solo se paga lo emitido): es el seguro contra un JSON
 *  cortado a media respuesta. Un grupo de hook-testing emite 1 body + 1 cta + 3 hooks: holgado. */
const MAX_TOKENS = 8_000;

/** Estados TIPADOS del guionista, con la misma separación que T1.8 (que la ganó con un FAIL de
 *  verificación): `api_error` (no pudimos hablar con el proveedor / petición inválida — no mejora
 *  reintentando) ≠ `parse_error` (respondió, se pagó, pero no cumple el contrato — reintentar
 *  RE-TIRA EL DADO, porque sin sampling params el default de Anthropic sigue siendo temperature 1). */
export type ScriptWriterStatus =
  'scripted' | 'over_budget' | 'refused' | 'parse_error' | 'api_error';

/** Rondas de generación por grupo: 1 intento + hasta 2 reintentos (code-review: 1→2 reintentos).
 *  Sonnet 5 a temperature 1 no siempre rescata un overshoot en un solo reintento; con la mira ya
 *  apretada (`PROMPT_AIM_FACTOR`), 3 rondas dejan margen holgado para aterrizar bajo techo. */
const MAX_SCRIPT_ROUNDS = 3;

/** Severidad para agregar el estado del LOTE a partir de los grupos: gana el más severo. `api_error`
 *  es el más grave (petición inválida: hay que ARREGLARLA, no reintentar), luego `refused` (decisión
 *  del modelo), `parse_error` (accidente reintentable) y `over_budget` (guion pagado pero que no cabe
 *  en la ventana de §8.4 — el usuario lo recorta en CP3). `scripted` es el suelo. */
const STATUS_SEVERITY: Readonly<Record<ScriptWriterStatus, number>> = {
  scripted: 0,
  over_budget: 1,
  parse_error: 2,
  refused: 3,
  api_error: 4,
};

/**
 * LO QUE EL MODELO EMITE (§8 del system prompt): texto y nada de tiempo. Los `min(1)` son la RED
 * REAL — sin `output_config` (ver `attempt`) nada obliga al modelo a nada, y aunque lo hubiera, la
 * API de Anthropic **no aplica constraints de array** (§13.2): las cardinalidades se validan aquí.
 */
const DraftSceneSchema = z.object({
  narration: z.string().min(1),
  visual: z.string().min(1),
  camera: z.string().min(1),
  emotion: z.string().min(1),
});

const ScriptDraftSchema = z.object({
  tone: z.string().min(1),
  hooks: z
    .array(DraftSceneSchema.extend({ seedIndex: z.number().int().nonnegative() }))
    .min(1)
    .max(6),
  body: z.array(DraftSceneSchema).min(1).max(3),
  cta: z.array(DraftSceneSchema).min(1).max(3),
});
export type ScriptDraft = z.infer<typeof ScriptDraftSchema>;

/**
 * UN GRUPO DE GENERACIÓN: lo que se resuelve con UNA llamada al modelo.
 *
 * - En `hook_test` (`plan.sharedBodyAndCta`), un grupo = las variantes de un mismo ángulo Y mismo
 *   idioma (y misma persona: en `hook_test` la persona rota por ángulo+idioma precisamente para no
 *   contaminar el experimento — ver `strategy/matrix.ts`). Todas comparten `segmentKeys.body`, así
 *   que **agrupar por esa clave es agrupar por lo que de verdad se comparte**, sin re-derivar el
 *   criterio de N4 (y sin poder divergir de él en silencio).
 * - En modo normal, cada variante es su propio grupo: su `segmentKeys.body` es único.
 *
 * En los dos casos la regla es la MISMA —agrupar por `segmentKeys.body`— y eso no es casualidad:
 * esa clave ES la definición de "qué body se comparte con quién" que N4 ya tomó.
 */
export interface ScriptGroup {
  sharedBodyKey: string;
  variants: PlannedVariant[];
}

/** Agrupa las variantes del plan por su clave de body: el criterio de dedup que N4 ya fijó. */
export function groupVariantsForScripting(plan: BatchPlan): ScriptGroup[] {
  const groups = new Map<string, PlannedVariant[]>();
  for (const variant of plan.variants) {
    // `segmentKeys` es un `z.record(AdSegmentSchema, …)`: los tres segmentos son claves del
    // contrato, así que `body` está SIEMPRE (el tipo lo garantiza y el Zod de `BatchPlan` lo
    // valida en la frontera). No hace falta un guard aquí — sería código muerto.
    const key = variant.segmentKeys.body;
    const bucket = groups.get(key);
    if (bucket) bucket.push(variant);
    else groups.set(key, [variant]);
  }
  return [...groups.entries()].map(([sharedBodyKey, variants]) => ({ sharedBodyKey, variants }));
}

/**
 * Los valores con los que se resuelven los `{placeholder}` de un hook de librería. Se toman los
 * PRIMEROS del brief (el más relevante: el brief los emite por relevancia, y el ángulo ya eligió
 * el enfoque). Cada uno lo TRUNCA `renderPlaceholders` a su presupuesto — ver la deuda 1.
 */
export function placeholderValuesFor(brief: ProductBrief): PlaceholderValues {
  return {
    product: brief.product.name,
    benefit: brief.benefits[0]?.benefit,
    pain: brief.pain_points[0]?.pain,
    category: brief.product.category,
  };
}

/**
 * INSTRUCCIONES DE VARIACIÓN (§9.4: «la diversidad entre variantes se instruye en el prompt» —
 * Sonnet 5 rechaza temperature/top_p/top_k con 400). Se reparten por índice de grupo, de forma
 * DETERMINISTA: la variación no puede depender del azar, porque no hay azar que controlar.
 *
 * Cubren registro Y estructura Y apertura, que es lo que §9.4 pide («registro, estructura y hook
 * distintos por variante»).
 */
export const VARIATION_INSTRUCTIONS: readonly string[] = [
  'Arranca in-medias-res: mete al espectador en mitad de la escena, sin presentación. Registro directo y seco.',
  'Registro de confesión: cuentas algo que te daba apuro admitir. Frases cortas, ritmo íntimo, cámara cerca.',
  'Estructura mito/verdad: abre con la creencia común y desmóntala. Registro didáctico pero de colega, no de profesor.',
  'Estructura de demostración: enseña antes de explicar. La narración acompaña lo que se ve, no lo anuncia. Registro entusiasta y rápido.',
  'Registro de queja compartida: empieza por la frustración, con humor. Estructura problema → alivio.',
  'Estructura de lista hablada («tres cosas que…»), pero contada, no recitada. Registro enérgico, cortes rápidos.',
];

/** Entrada del guionista: el plan de N4 + el brief que lo originó. */
export interface WriteScriptsInput {
  plan: BatchPlan;
  brief: ProductBrief;
}

export interface ScriptWriterResult {
  scripts: AdScript[];
  usage: AnthropicUsage | null;
  status: ScriptWriterStatus;
  warnings: string[];
}

export type ScriptWriterDeps = AnthropicDeps;

/**
 * Arma el USER message de UN grupo. PURO y determinista (se testea sin red).
 *
 * TODO lo variable vive aquí y NADA en el system: el idioma destino, las semillas, el presupuesto,
 * el objetivo, la instrucción de variación. Es la condición que mantiene el prefijo del system
 * BYTE-ESTABLE y, por tanto, cacheable (T1.8 lo aprendió: un `{{language}}` en el system apaga la
 * caché EN SILENCIO).
 *
 * LAS SEMILLAS VAN YA RENDERIZADAS Y TRUNCADAS (deuda 1): un `{pain}` de la librería se sustituye
 * aquí por el dolor real del brief, recortado a su presupuesto de palabras. Lo que llega al modelo
 * es lo que el espectador podría oír, no una plantilla.
 */
export function buildScriptUserMessage(args: {
  group: ScriptGroup;
  brief: ProductBrief;
  plan: BatchPlan;
  variationIndex: number;
  /** Feedback del intento anterior (reintento por presupuesto). Vacío en el primer intento. */
  feedback?: string;
}): string {
  const { group, brief, plan, variationIndex, feedback } = args;
  const first = group.variants[0];
  if (first === undefined) throw new Error('script-writer: grupo vacío');

  const angle = brief.angles[first.angleIndex];
  const preset = DURATION_PRESETS[plan.objective];
  const budget = wordBudgetFor(preset);
  const values = placeholderValuesFor(brief);
  const hookTesting = plan.sharedBodyAndCta && group.variants.length > 1;

  const seeds = group.variants.map(
    (variant, index) =>
      `  [${String(index)}] (${variant.hook.source}) ${renderPlaceholders(variant.hook.text, values)}`,
  );

  return [
    `MODE: ${hookTesting ? 'hook_testing' : 'single'}`,
    `TARGET LANGUAGE: ${first.language}`,
    `OBJECTIVE: ${plan.objective}`,
    `TARGET DURATION: ${String(preset.targetSeconds)}s`,
    `BODY SCENES: máximo ${String(preset.maxBodyScenes)} escena(s) de body (§7.5). hook y cta: 1 escena cada uno.`,
    '',
    'WORD BUDGET (techo duro de palabras habladas — TOTAL del segmento sumando TODAS sus escenas, no por escena):',
    `  hook: ${String(budget.hook)} palabras en total (máx. ${String(MAX_HOOK_WORDS)} por hook)`,
    `  body: ${String(budget.body)} palabras en total (repártelas entre sus ${String(preset.maxBodyScenes)} escena(s) como MUCHO)`,
    `  cta: ${String(budget.cta)} palabras en total`,
    '',
    `HOOK SEEDS (${String(group.variants.length)}; escribe un hook por cada una, en el idioma destino):`,
    ...seeds,
    '',
    'ANGLE:',
    JSON.stringify({
      name: angle?.name ?? first.angleName,
      framework: first.framework,
      key_message: angle?.key_message ?? null,
      target_segment: angle?.target_segment ?? null,
      awareness_level: angle?.awareness_level ?? null,
      cta: angle?.cta ?? null,
      suggested_tone: angle?.suggested_tone ?? null,
    }),
    '',
    `PERSONA (quién habla): ${first.personaName ?? 'sin fijar — creador genérico del segmento'}`,
    '',
    // El brief RECORTADO a lo que un guion necesita. No viaja entero: `meta`, `assets`, el resto
    // de ángulos y las 10 features son input que se paga y que el guionista no usa (lección de
    // coste de T1.8: el input es lo que más pesa). Lo que sí necesita: qué es el producto, qué
    // promete, a quién le duele qué, qué objeción hay que desactivar y qué prueba social existe.
    'PRODUCT BRIEF (recortado a lo que un guion necesita):',
    JSON.stringify({
      product: {
        name: brief.product.name,
        one_liner: brief.product.one_liner,
        category: brief.product.category,
        how_it_works: brief.product.how_it_works,
      },
      benefits: brief.benefits.slice(0, 3),
      pain_points: brief.pain_points.slice(0, 3),
      objections: brief.objections.slice(0, 2),
      social_proof: {
        rating: brief.social_proof.rating,
        review_count: brief.social_proof.review_count,
        quotes: brief.social_proof.quotes.slice(0, 2),
      },
      pricing: { active_offer: brief.pricing.active_offer, guarantee: brief.pricing.guarantee },
      brand_tone: brief.brand.recommended_ad_tone,
    }),
    '',
    `VARIATION: ${VARIATION_INSTRUCTIONS[variationIndex % VARIATION_INSTRUCTIONS.length] ?? ''}`,
    ...(feedback === undefined || feedback === ''
      ? []
      : ['', `CORRECCIÓN OBLIGATORIA: ${feedback}`]),
    '',
    `RECUERDA: TODO el guion —hook, body, CTA— va ÍNTEGRAMENTE en ${first.language}. Las semillas pueden venir en otro idioma: reescríbelas nativas, no las traduzcas.`,
  ].join('\n');
}

/**
 * ¿Los hooks emitidos cubren EXACTAMENTE los seedIndex del grupo? (biyección). Devuelve el
 * problema (para el warning/feedback) o null si la cobertura es perfecta.
 *
 * POR QUÉ ES CRÍTICO Y POR QUÉ NO BASTA EL ZOD (hallazgo de code-review). En hook-testing el A/B
 * mide EL HOOK: la variante `seedIndex=k` tiene que llevar el hook que el modelo escribió PARA la
 * semilla k. Si el modelo emite seedIndex no contiguos, repetidos o fuera de rango (p. ej. [0,0,2]
 * saltándose el 1), un `find` con fallback posicional le daría a la variante 1 el hook de OTRA
 * semilla EN SILENCIO — dos variantes con el mismo gancho atribuido a semillas distintas, y el
 * experimento contaminado. `AdScriptSchema` no lo caza: el hook es un string válido, solo está MAL
 * ASIGNADO. Por eso se valida la biyección ANTES de ensamblar; garantizada, el `find` de
 * `assembleScript` SIEMPRE acierta (sin fallback posicional que enmascare nada) y un
 * fallo se convierte en `parse_error` → reintento, no en un A/B roto que pasa verde.
 */
export function hookBijectionProblem(draft: ScriptDraft, variantCount: number): string | null {
  const emitted = draft.hooks.map((h) => h.seedIndex);
  const expected = [...Array(variantCount).keys()]; // [0, 1, …, variantCount-1]
  const emittedSet = new Set(emitted);

  if (emitted.length !== variantCount) {
    return `el modelo emitió ${String(emitted.length)} hooks para ${String(variantCount)} semillas`;
  }
  if (emittedSet.size !== emitted.length) {
    return `hay seedIndex REPETIDOS en los hooks (${emitted.join(',')})`;
  }
  const missing = expected.filter((i) => !emittedSet.has(i));
  if (missing.length > 0) {
    return `faltan hooks para las semillas [${missing.join(',')}] (emitidos: [${emitted.join(',')}])`;
  }
  return null;
}

/** Ensambla el `AdScript` de UNA variante a partir del borrador del grupo. PURO.
 *  PRECONDICIÓN: `hookBijectionProblem(draft, group.variants.length) === null` — el caller
 *  (`writeGroup`) la garantiza antes de llamar aquí, así que el `find` de abajo SIEMPRE acierta. */
export function assembleScript(args: {
  draft: ScriptDraft;
  variant: PlannedVariant;
  sharedBodyKey: string;
  seedIndex: number;
}): AdScript {
  const { draft, variant, sharedBodyKey, seedIndex } = args;

  // El hook de ESTA variante: el que el modelo escribió para SU semilla. Sin fallback posicional
  // (ver `hookBijectionProblem`): con la biyección validada aguas arriba, `find` no puede fallar,
  // y si por un bug de invariante lo hiciera, es un `parse_error` honesto, no un A/B contaminado en
  // silencio. Nunca se INVENTA ni se REASIGNA un hook aquí.
  const hookDraft = draft.hooks.find((h) => h.seedIndex === seedIndex);
  if (hookDraft === undefined) {
    throw new ScriptAssemblyError(
      `el modelo no devolvió hook para la semilla ${String(seedIndex)} (${variant.filenameCode})`,
    );
  }

  // LA IDENTIDAD TEXTUAL DEL BODY, POR CONSTRUCCIÓN: `draft.body` y `draft.cta` son LOS MISMOS
  // objetos para todas las variantes del grupo (una sola llamada, un solo borrador). No hay dos
  // textos que puedan diferir porque solo se generó uno.
  const drafts: (DraftScene & { segment: AdSegment })[] = [
    { ...stripSeedIndex(hookDraft), segment: 'hook' as const },
    ...draft.body.map((scene) => ({ ...scene, segment: 'body' as const })),
    ...draft.cta.map((scene) => ({ ...scene, segment: 'cta' as const })),
  ];

  const scenes = computeSceneTiming(drafts);

  return {
    filenameCode: variant.filenameCode,
    hook: hookDraft.narration,
    cta: draft.cta.map((scene) => scene.narration).join(' '),
    scenes,
    subtitles: subtitlesFromScenes(scenes),
    fullText: fullTextOf(scenes),
    wordCount: totalWords(scenes),
    estSeconds: estSecondsOf(scenes),
    tone: draft.tone,
    language: variant.language,
    sharedBodyKey,
  };
}

function stripSeedIndex(scene: DraftScene & { seedIndex: number }): DraftScene {
  return {
    narration: scene.narration,
    visual: scene.visual,
    camera: scene.camera,
    emotion: scene.emotion,
  };
}

/** Error de ensamblado (el modelo respondió algo que no permite construir el guion). Se trata como
 *  `parse_error`: se pagó, se reintenta. */
class ScriptAssemblyError extends Error {}

/**
 * VALIDACIÓN DE PRESUPUESTO — la cláusula de la Verificación («`est_seconds` ≤ TECHO del preset,
 * §8.4: hook-test 15 s») convertida en código, y no en una esperanza depositada en el prompt. Se
 * acepta contra el TECHO del rango, no contra el objetivo (T2.4, 2026-07-15): el objetivo guía la
 * escritura del prompt, el techo acota la aceptación — ver `maxSeconds` en `presets.ts`.
 *
 * Devuelve el mensaje de corrección para el reintento, o null si el guion cabe. Se mide sobre las
 * PALABRAS QUE EL MODELO ESCRIBIÓ (ya con el suelo de 0,5 s por escena aplicado), nunca sobre lo
 * que el modelo diga que dura.
 */
export function budgetViolation(script: AdScript, plan: BatchPlan): string | null {
  const preset = DURATION_PRESETS[plan.objective];
  const problems: string[] = [];

  // Se rechaza contra el TECHO de §8.4 (`maxSeconds`), no contra el objetivo: un guion dentro del
  // rango declarado es embarcable aunque no clave el punto de mira (T2.4). El prompt sí apunta al
  // objetivo (ver `wordBudgetFor` abajo), así que la reescritura empuja hacia el centro del rango.
  if (script.estSeconds > preset.maxSeconds) {
    problems.push(
      `el guion dura ${String(script.estSeconds)}s y el techo del objetivo son ${String(preset.maxSeconds)}s (${String(script.wordCount)} palabras a 2,5 palabras/s)`,
    );
  }

  const hookWords = wordsInSegment(script.scenes, 'hook');
  if (hookWords > MAX_HOOK_WORDS) {
    problems.push(
      `el hook tiene ${String(hookWords)} palabras y el techo son ${String(MAX_HOOK_WORDS)}`,
    );
  }

  // §7.5: el body no puede tener más escenas de las que el preset permite (hook_test = 1 clip
  // b-roll). Cada escena de más es una generación de vídeo de más Y narración de más — la causa
  // raíz del overshoot de duración de T2.4. Se valida aquí, no solo en el prompt: el prompt PIDE,
  // el check OBLIGA (y dispara el reintento con el número exacto de escenas sobrantes).
  const bodyScenes = script.scenes.filter((scene) => scene.segment === 'body').length;
  if (bodyScenes > preset.maxBodyScenes) {
    problems.push(
      `el body tiene ${String(bodyScenes)} escenas y §7.5 permite ${String(preset.maxBodyScenes)} para este objetivo`,
    );
  }

  if (problems.length === 0) return null;
  const budget = wordBudgetFor(preset);
  return [
    `El guion anterior NO CABE: ${problems.join('; ')}.`,
    `Reescríbelo MÁS CORTO respetando el presupuesto: hook ≤${String(budget.hook)} palabras (1 escena), body ≤${String(budget.body)} palabras en ${String(preset.maxBodyScenes)} escena(s) COMO MUCHO, cta ≤${String(budget.cta)} palabras (1 escena).`,
    'Corta ideas y escenas ENTERAS; no acortes recortando palabras sueltas de cada frase.',
  ].join(' ');
}

export function makeScriptWriter(deps: ScriptWriterDeps) {
  /** UNA llamada al modelo para UN grupo. Nunca LANZA: estado tipado (patrón de T1.7/T1.8). */
  async function attempt(
    userMessage: string,
    warnings: string[],
  ): Promise<{
    draft: ScriptDraft | null;
    usage: AnthropicUsage | null;
    status: ScriptWriterStatus;
  }> {
    const client = makeAnthropicClient(deps);

    // SIN `output_config` — LA MISMA DECISIÓN QUE T1.8, Y POR LA MISMA RAZÓN MEDIDA. La
    // decodificación restringida de Anthropic 400ea contra la API REAL con schemas no triviales
    // (uniones >16 params, "compiled grammar too large"), y —aunque entrara— **IGNORA las
    // constraints de array** (§13.2: `minItems`/`maxItems` no se aplican), que es justo lo que
    // aquí importa (N hooks, 1–3 escenas por segmento). La red real es el `safeParse` de abajo.
    // El schema viaja como TEXTO en el system (§8), cacheado, a coste marginal ~0.
    let response;
    try {
      response = await client.messages.create({
        model: SCRIPT_WRITER_MODEL,
        max_tokens: MAX_TOKENS,
        // Sonnet 5 corre adaptive thinking si se OMITE `thinking` (skill claude-api) y esos tokens
        // se facturan a precio de OUTPUT. Se apaga: escribir un guion con el brief delante es
        // redacción guiada, no razonamiento multi-paso.
        thinking: { type: 'disabled' },
        // SIN temperature / top_p / top_k: Sonnet 5 los rechaza con 400 (§9.4, §13.2). La
        // diversidad la instruye `VARIATION` en el user message.
        system: [
          {
            type: 'text',
            text: SCRIPT_WRITER_SYSTEM_PROMPT,
            // El system es BYTE-ESTABLE (nada interpolado) → desde la 2ª llamada del lote se lee
            // al 0,1×. Con 12 guiones por lote, esto sí paga: el system se escribe una vez y se
            // lee once.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const rawStatus: unknown = err instanceof Anthropic.APIError ? err.status : undefined;
      const status = typeof rawStatus === 'number' ? rawStatus : undefined;
      warnings.push(
        `script_writer_api_error${status === undefined ? '' : `_${String(status)}`}: ${detail}`,
      );
      return { draft: null, usage: null, status: 'api_error' };
    }

    const usage = toAnthropicUsage(response.usage);

    if (response.stop_reason === 'refusal') {
      warnings.push('script_writer_refused');
      return { draft: null, usage, status: 'refused' };
    }

    const text = response.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('');

    let raw: unknown;
    try {
      raw = JSON.parse(extractJsonObject(text)) as unknown;
    } catch {
      warnings.push('script_writer_not_json');
      return { draft: null, usage, status: 'parse_error' };
    }

    const parsed = ScriptDraftSchema.safeParse(raw);
    if (!parsed.success) {
      const detalle = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
        .join('; ');
      warnings.push(`script_schema_invalid: ${detalle}`);
      return { draft: null, usage, status: 'parse_error' };
    }

    return { draft: parsed.data, usage, status: 'scripted' };
  }

  /**
   * Escribe los guiones de UN grupo (1 llamada + hasta `MAX_SCRIPT_ROUNDS - 1` reintentos).
   * Devuelve un guion por variante del grupo — todos con las MISMAS escenas de body y cta en
   * hook-testing.
   *
   * FAIL-CLOSED EN EL PRESUPUESTO (code-review — el bug que cazó el verifier). El diseño anterior
   * embarcaba un guion que se pasaba del techo como `scripted` + warning `script_over_budget`: un
   * guion de 16 s violando §8.4 salía marcado como bueno, y la cláusula «est_seconds ≤ techo en
   * TODOS» fallaba. Ahora, si tras TODOS los reintentos el guion SIGUE pasándose del techo, el
   * grupo NO es `scripted`: sale con estado `over_budget`. Los guiones pagados se DEVUELVEN igual
   * (el usuario puede acortarlos en CP3), pero el ESTADO dice la verdad —no caben— y
   * `STATUS_SEVERITY` lo propaga al lote. Nunca un `scripted` mentiroso.
   *
   * TODOS los fallos blandos (parse_error, biyección, contrato, presupuesto) reintentan mientras
   * queden rondas; la MIRA del prompt va apretada bajo el techo (`PROMPT_AIM_FACTOR`) para que el
   * overshoot conocido de Sonnet 5 aterrice con holgura y el reintento no re-apunte al número que
   * causó el fallo.
   */
  async function writeGroup(args: {
    group: ScriptGroup;
    brief: ProductBrief;
    plan: BatchPlan;
    variationIndex: number;
    warnings: string[];
  }): Promise<{ scripts: AdScript[]; usage: AnthropicUsage | null; status: ScriptWriterStatus }> {
    const { group, brief, plan, variationIndex, warnings } = args;

    let usage: AnthropicUsage | null = null;
    let feedback: string | undefined;
    // El mejor guion NO-embarcable visto (se pasa del techo): se conserva para devolverlo con
    // estado `over_budget` si NINGÚN intento consigue meterlo bajo el techo. Que el usuario lo vea
    // en CP3 es útil; marcarlo `scripted` sería mentir.
    let lastOverBudget: { scripts: AdScript[]; violation: string } | null = null;

    for (let round = 0; round < MAX_SCRIPT_ROUNDS; round += 1) {
      const isLastRound = round === MAX_SCRIPT_ROUNDS - 1;
      const message = buildScriptUserMessage({ group, brief, plan, variationIndex, feedback });
      const result = await attempt(message, warnings);
      usage = sumAnthropicUsage(usage, result.usage);

      // `api_error` y `refused` no mejoran reintentando (uno es determinista, el otro es una
      // decisión del modelo): se devuelven tal cual.
      if (result.status === 'api_error' || result.status === 'refused') {
        return { scripts: [], usage, status: result.status };
      }

      const draft = result.draft;
      if (draft === null) {
        // parse_error: reintenta (si queda ronda).
        if (!isLastRound) warnings.push('script_writer_retry_parse');
        feedback = undefined;
        continue;
      }

      // BIYECCIÓN HOOK↔SEMILLA (code-review): los hooks emitidos deben cubrir EXACTAMENTE los
      // seedIndex del grupo, o el A/B queda contaminado en silencio (ver `hookBijectionProblem`).
      // Un fallo aquí es del PRODUCTOR (el modelo), así que se trata como `parse_error` → reintento.
      const bijection = hookBijectionProblem(draft, group.variants.length);
      if (bijection !== null) {
        warnings.push(`script_hooks_not_bijective: ${bijection}`);
        feedback = `Los hooks estaban MAL: ${bijection}. Devuelve EXACTAMENTE un hook por cada HOOK SEED, con su seedIndex correcto (0..${String(group.variants.length - 1)}), sin repetir ni saltarte ninguno.`;
        continue;
      }

      let scripts: AdScript[];
      try {
        scripts = group.variants.map((variant, seedIndex) =>
          assembleScript({ draft, variant, sharedBodyKey: group.sharedBodyKey, seedIndex }),
        );
      } catch (err) {
        warnings.push(
          `script_assembly_failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (!isLastRound) warnings.push('script_writer_retry_parse');
        feedback = undefined;
        continue;
      }

      // El Zod del CONTRATO (`AdScriptSchema`), sobre lo ya ensamblado y temporizado: la red final.
      const invalid = scripts.find((script) => !AdScriptSchema.safeParse(script).success);
      if (invalid !== undefined) {
        warnings.push(`script_contract_invalid: ${invalid.filenameCode}`);
        if (!isLastRound) warnings.push('script_writer_retry_parse');
        feedback = undefined;
        continue;
      }

      // PRESUPUESTO: se mide sobre el guion REAL. Si no cabe, se reintenta CON el número exacto de
      // la desviación (información que el intento anterior no tenía) mientras queden rondas.
      const violation = scripts.map((script) => budgetViolation(script, plan)).find(Boolean);
      if (violation) {
        lastOverBudget = { scripts, violation };
        if (!isLastRound) {
          warnings.push(`script_writer_retry_budget: ${violation}`);
          feedback = violation;
          continue;
        }
        // Última ronda y SIGUE sin caber → FAIL-CLOSED: se devuelven los guiones pagados pero con
        // estado `over_budget`, NUNCA `scripted`. La cláusula «est_seconds ≤ techo» no se viola en
        // silencio: el lote lo verá y CP3 puede recortar.
        warnings.push(`script_over_budget: ${violation}`);
        return { scripts, usage, status: 'over_budget' };
      }

      return { scripts, usage, status: 'scripted' };
    }

    // Agotadas las rondas sin un draft ensamblable. Si el último problema fue de PRESUPUESTO (hubo
    // guiones válidos pero grandes), se devuelven con `over_budget`; si nunca hubo draft válido, es
    // `parse_error`. En ninguno de los dos casos se miente con `scripted`.
    if (lastOverBudget !== null) {
      warnings.push(`script_over_budget: ${lastOverBudget.violation}`);
      return { scripts: lastOverBudget.scripts, usage, status: 'over_budget' };
    }
    return { scripts: [], usage, status: 'parse_error' };
  }

  /**
   * Escribe TODOS los guiones del lote: una llamada por GRUPO (no por variante). En hook-testing
   * eso son `ángulos × idiomas` llamadas en vez de `variantes` — que es exactamente la economía
   * que §7.2 N5 promete y que el estimador ya cobra.
   *
   * Las llamadas van EN SERIE, no en paralelo: el system prompt se cachea (ephemeral) y una ráfaga
   * paralela lo ESCRIBE N veces (1,25×) en lugar de escribirlo una y leerlo N-1 (0,1×). Con 12
   * guiones eso es dinero real, y N5 no está en el camino crítico de latencia de nadie.
   */
  async function write(input: WriteScriptsInput): Promise<ScriptWriterResult> {
    const warnings: string[] = [];
    const groups = groupVariantsForScripting(input.plan);

    const scripts: AdScript[] = [];
    let usage: AnthropicUsage | null = null;
    let status: ScriptWriterStatus = 'scripted';

    for (const [index, group] of groups.entries()) {
      const result = await writeGroup({
        group,
        brief: input.brief,
        plan: input.plan,
        variationIndex: index,
        warnings,
      });
      usage = sumAnthropicUsage(usage, result.usage);
      scripts.push(...result.scripts);
      // El estado MÁS SEVERO del lote gana (jerarquía real, no "el último no-scripted"): un lote con
      // 5 grupos OK y 1 en `api_error` NO es 'scripted', y si hay un `api_error` Y un `parse_error`
      // el agregado reporta el `api_error` (el más accionable: hay que arreglar la petición, no
      // reintentar). Los guiones que sí salieron se devuelven igualmente: se pagaron y son útiles.
      if (STATUS_SEVERITY[result.status] > STATUS_SEVERITY[status]) status = result.status;
    }

    return { scripts, usage, status, warnings };
  }

  return { write };
}

export type ScriptWriter = ReturnType<typeof makeScriptWriter>;
