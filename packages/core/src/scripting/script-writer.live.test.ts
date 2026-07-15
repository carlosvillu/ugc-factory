// Tier LIVE del ScriptWriter (T2.4) — `pnpm test:live`. GASTA DINERO REAL contra la API de
// Anthropic, con el guard de presupuesto `spendBudget()` (@ugc/test-utils/live-budget).
//
// POR QUÉ ESTOS TESTS NO PUEDEN VIVIR EN LA SUITE NORMAL (external-apis.md §1): los mocks prueban
// NUESTRA lógica; el tier live prueba SU comportamiento. Y las dos cláusulas centrales de la
// Verificación de T2.4 son COMPORTAMIENTO DEL MODELO:
//
//   1. «el guion de una variante `language: 'en'` compuesta desde un brief en español está
//      ÍNTEGRAMENTE en inglés — hook incluido». Un mock que devuelve inglés no prueba NADA: prueba
//      que sabemos escribir inglés en un fixture. La deuda de T2.2 (la semilla llega en español)
//      solo se paga si el MODELO REAL la reescribe nativa.
//   2. Que Sonnet 5 acepta esta petición (sin sampling params, thinking disabled, sin
//      output_config). Un 400 aquí es exactamente el fallo que T1.8 tardó un ciclo en ver porque
//      solo tenía mocks.
//
// Y el COSTE se mide sobre la ENTRADA REAL (regla dura de T2.4, lección de T1.8): el `BatchPlan`
// de la matriz de T2.2 (12 variantes) compuesto del brief de una página real, no una fixture
// cómoda de dos líneas.
import { describe, expect, it } from 'vitest';
import { makeAngle, makeBrief } from '@ugc/test-utils';
import { spendBudget } from '@ugc/test-utils/live-budget';

import { HOOK_LINE_SEEDS } from '../library/seed-data';
import type { AnthropicUsage } from '../analyze/anthropic-client';
import { composeMatrix } from '../strategy/matrix';
import { DURATION_PRESETS } from '../strategy/presets';
import { groupVariantsForScripting, makeScriptWriter } from './script-writer';
import { MAX_HOOK_WORDS, countWords } from '../analyze/brief-validator';

const apiKey = process.env.ANTHROPIC_API_KEY;
const describeLive = apiKey ? describe : describe.skip;

if (!apiKey) {
  console.warn(
    '[live] ANTHROPIC_API_KEY ausente: los tests live de T2.4 se SALTAN. Ponla en .env.test.local.',
  );
}

/** EL BRIEF EN ESPAÑOL — la mitad que hace observable la deuda de T2.2. Todo su contenido (dolor,
 *  beneficios, ángulos, hooks) está en español: es lo que N4 copia TAL CUAL a las variantes `en`. */
const BRIEF_ES = makeBrief({
  pain_points: [
    {
      // 12 palabras: el `pain` maligno. El presupuesto de `{pain}` son 6 ⇒ el renderizador TIENE
      // que truncarlo, o el hook de librería se va a 18 palabras habladas.
      pain: 'la piel tira y se ve apagada al salir de la ducha',
      severity: 'high',
      current_alternative: 'cremas de supermercado que no penetran',
      evidence: null,
    },
  ],
  angles: [
    makeAngle({
      name: 'El dolor de la piel tirante',
      framework: 'pain_point',
      hook_examples: [
        'Llevo años con la piel tirante y nadie me lo explicó',
        'Si tu piel tira después de la ducha, esto te interesa',
      ],
      key_message: 'La hidratación de 24 horas se nota al despertar',
    }),
    makeAngle({
      name: 'Lo que nadie te cuenta del skincare',
      framework: 'curiosity',
      hook_examples: [
        'Nadie te cuenta esto sobre el sérum que usas',
        'Esto es lo que pasa cuando dejas de hidratar',
      ],
      key_message: 'No todos los séricos hidratan igual',
    }),
  ],
});

/** La matriz de la Verificación: 2 ángulos × 3 hooks × es+en = 12 variantes, `hook_test`. */
const PLAN = composeMatrix({
  brief: BRIEF_ES,
  libraryHooks: HOOK_LINE_SEEDS,
  angleCount: 2,
  hooksPerAngle: 3,
  languages: ['es', 'en'],
  objective: 'hook_test',
  tier: 'standard',
});

/** Palabras que delatan español en un texto que DEBERÍA estar en inglés. Se buscan como palabra
 *  entera (no como subcadena: "the" está dentro de "other"). Es un detector GROSERO a propósito —
 *  no intenta ser un identificador de idioma, sino cazar el fallo que la deuda describe: que la
 *  semilla en español se cuele LITERAL en el guion en inglés. */
const SPANISH_MARKERS = [
  'que',
  'de',
  'la',
  'el',
  'los',
  'las',
  'con',
  'para',
  'piel',
  'tira',
  'ducha',
  'esto',
  'nadie',
  'años',
  'sérum',
  'hidrata',
];

/** Coste real de una llamada a Sonnet 5 en USD. Se inlinea (como en el live de T1.8): la tabla de
 *  precios vive en `@ugc/services`, que DEPENDE de core — importarla aquí invertiría la flecha. */
function costUsd(usage: AnthropicUsage): number {
  return (
    (usage.inputTokens * 3) / 1e6 +
    (usage.cacheCreationInputTokens * 3 * 1.25) / 1e6 +
    (usage.cacheReadInputTokens * 3 * 0.1) / 1e6 +
    (usage.outputTokens * 15) / 1e6
  );
}

function spanishWordsIn(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  return [...new Set(words.filter((w) => SPANISH_MARKERS.includes(w)))];
}

describeLive('ScriptWriter contra la API REAL de Sonnet 5 (gasta dinero)', () => {
  it(
    'la deuda de T2.2, pagada: brief en ES + semilla en ES + variante `en` ⇒ guion ÍNTEGRAMENTE en inglés (hook incluido)',
    { timeout: 240_000 },
    async () => {
      // Un grupo de hook-testing en `en` = 1 llamada (1 body + 1 cta + 3 hooks). Sonnet 5 a
      // $3/$15 por MTok: ~7k in + ~1k out ≈ $0,04. Margen 2× por si hay reintento.
      spendBudget(0.09);

      const writer = makeScriptWriter({ apiKey: apiKey ?? '' });
      const groups = groupVariantsForScripting(PLAN);
      const grupoEn = groups.find((g) => g.variants[0]?.language === 'en');
      expect(grupoEn).toBeDefined();
      if (!grupoEn) return;

      // Precondición de la deuda: las semillas que N4 puso en las variantes `en` están EN ESPAÑOL.
      const semillas = grupoEn.variants.map((v) => v.hook.text);
      expect(semillas.some((s) => spanishWordsIn(s).length > 0)).toBe(true);

      // Se escribe SOLO ese grupo (el plan entero costaría 4 llamadas y no probaría más).
      const planSoloEn = { ...PLAN, variants: grupoEn.variants };
      const res = await writer.write({ plan: planSoloEn, brief: BRIEF_ES });

      expect(res.warnings).toEqual(
        expect.not.arrayContaining([expect.stringContaining('api_error')]),
      );
      expect(res.status).toBe('scripted');
      expect(res.scripts).toHaveLength(grupoEn.variants.length);

      for (const script of res.scripts) {
        expect(script.language).toBe('en');
        // LA CLÁUSULA: ni el hook, ni el body, ni el CTA llevan español. El hook es donde la
        // deuda muerde (es lo que llegaba sin traducir), así que se asserta APARTE y primero.
        expect({ hook: script.hook, spanish: spanishWordsIn(script.hook) }).toEqual({
          hook: script.hook,
          spanish: [],
        });
        expect({ full: script.fullText, spanish: spanishWordsIn(script.fullText) }).toEqual({
          full: script.fullText,
          spanish: [],
        });
        // Y sigue cabiendo: la Verificación exige `est_seconds` ≤ TECHO del rango de §8.4 (15 s
        // para hook_test), EN TODOS. El objetivo (12 s) guía el prompt; el techo acota.
        expect(script.estSeconds).toBeLessThanOrEqual(DURATION_PRESETS.hook_test.maxSeconds);
        expect(countWords(script.hook)).toBeLessThanOrEqual(MAX_HOOK_WORDS);
      }

      // Y la ECONOMÍA, contra el modelo real: los bodies de las 3 variantes del ángulo son
      // TEXTUALMENTE idénticos (una sola llamada ⇒ un solo body). El diff de la Verificación.
      const bodies = new Set(
        res.scripts.map((s) =>
          s.scenes
            .filter((sc) => sc.segment !== 'hook')
            .map((sc) => `${sc.narration}|${sc.visual}|${sc.camera}|${sc.emotion}`)
            .join('\n'),
        ),
      );
      expect(bodies.size).toBe(1);

      // COSTE REAL, medido sobre la ENTRADA REAL (no sobre una fixture cómoda): lo que cuesta un
      // grupo. El planning estima ~$0,50 para 12 guiones + reintentos = 4 grupos ⇒ ~$0,12/grupo.
      const usage = res.usage;
      if (!usage) throw new Error('usage ausente: no se puede medir el coste real');
      const usd = costUsd(usage);
      console.warn(
        `[live][T2.4] grupo en (3 guiones): in=${String(usage.inputTokens)} out=${String(usage.outputTokens)} ` +
          `cache_w=${String(usage.cacheCreationInputTokens)} cache_r=${String(usage.cacheReadInputTokens)} ⇒ $${usd.toFixed(4)}`,
      );
      expect(usd).toBeLessThan(0.12);
    },
  );

  it(
    'el guion en `es` suena nativo y el hook de librería llega TRUNCADO al presupuesto (deuda de T2.1)',
    { timeout: 240_000 },
    async () => {
      spendBudget(0.09);

      const writer = makeScriptWriter({ apiKey: apiKey ?? '' });
      const groups = groupVariantsForScripting(PLAN);
      const grupoEs = groups.find((g) => g.variants[0]?.language === 'es');
      expect(grupoEs).toBeDefined();
      if (!grupoEs) return;

      const planSoloEs = { ...PLAN, variants: grupoEs.variants };
      const res = await writer.write({ plan: planSoloEs, brief: BRIEF_ES });

      expect(res.status).toBe('scripted');
      for (const script of res.scripts) {
        expect(script.language).toBe('es');
        // El techo del hook se cumple sobre el guion EMITIDO, no sobre la plantilla: es la deuda
        // de T2.1 verificada de punta a punta (semilla con {pain} → truncado → hook hablado).
        expect(countWords(script.hook)).toBeLessThanOrEqual(MAX_HOOK_WORDS);
        expect(script.estSeconds).toBeLessThanOrEqual(DURATION_PRESETS.hook_test.maxSeconds);
        expect(script.scenes.some((s) => s.segment === 'hook')).toBe(true);
        expect(script.scenes.some((s) => s.segment === 'body')).toBe(true);
        expect(script.scenes.some((s) => s.segment === 'cta')).toBe(true);
      }

      // La evidencia para el juicio humano de «suenan nativos» (cláusula de revisión humana de la
      // Verificación): se IMPRIME el guion entero. No se finge un assert automático de naturalidad.
      for (const script of res.scripts) {
        console.warn(
          `[live][T2.4][es] ${script.filenameCode} (${String(script.estSeconds)}s, tono: ${script.tone})\n` +
            `  HOOK: ${script.hook}\n` +
            script.scenes
              .filter((s) => s.segment !== 'hook')
              .map((s) => `  ${s.segment.toUpperCase()}: ${s.narration}`)
              .join('\n'),
        );
      }
    },
  );
});
