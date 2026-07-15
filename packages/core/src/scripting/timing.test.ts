// Unit del TIMING DURO (T2.4, §7.2 N5). Puro, determinista, $0 — y es EL sitio donde se prueba
// que los segundos salen de CONTAR PALABRAS y no de creerse al LLM.
import { describe, expect, it } from 'vitest';

import { secondsForText, WORDS_PER_SECOND, type AdScript, type AdSegment } from '../contracts';
import { DURATION_PRESETS } from '../strategy/presets';
import {
  computeSceneTiming,
  estSecondsOf,
  fullTextOf,
  MIN_SCENE_SECONDS,
  rebuildEditedScript,
  subtitlesFromScenes,
  totalWords,
  wordBudgetFor,
  wordsInSegment,
  type DraftScene,
} from './timing';

function draft(narration: string, segment: AdSegment): DraftScene & { segment: AdSegment } {
  return { narration, visual: 'plano medio', camera: 'estática', emotion: 'cercana', segment };
}

/** Un `AdScript` VÁLIDO armado con las MISMAS primitivas que `assembleScript` (timing + derivaciones)
 *  — así el test de round-trip prueba PARIDAD real, no una reconstrucción hecha a medida. */
function makeScript(narrations: { hook: string; body: string; cta: string }): AdScript {
  const scenes = computeSceneTiming([
    draft(narrations.hook, 'hook'),
    draft(narrations.body, 'body'),
    draft(narrations.cta, 'cta'),
  ]);
  return {
    filenameCode: 'acme-hook01-es-12s',
    sharedBodyKey: 'body-shared-1',
    tone: 'cercano',
    language: 'es',
    hook: narrations.hook,
    cta: narrations.cta,
    scenes,
    subtitles: subtitlesFromScenes(scenes),
    fullText: fullTextOf(scenes),
    wordCount: totalWords(scenes),
    estSeconds: estSecondsOf(scenes),
  };
}

describe('la regla word_count ÷ 2,5 (§7.2 N5)', () => {
  it('secondsForText cuenta palabras y divide por 2,5 — nada más', () => {
    expect(WORDS_PER_SECOND).toBe(2.5);
    expect(secondsForText('una dos tres cuatro cinco')).toBe(2); // 5 / 2,5
    expect(secondsForText('  espacios   raros  ')).toBe(0.8); // 2 / 2,5
  });

  it('wordBudgetFor apunta la MIRA por DEBAJO del techo (PROMPT_AIM_FACTOR) y redondea A LA BAJA', () => {
    // La mira va apretada al 80% del preset a propósito (T2.4, code-review): el modelo se pasa ~25%,
    // así que apuntar bajo hace que el overshoot aterrice con holgura bajo el techo de §8.4. La
    // ACEPTACIÓN sigue en `maxSeconds` (budgetViolation), no aquí.
    // hook_test: floor(seg × 2,5 × 0,8) → hook floor(8)=8, body floor(12)=12, cta floor(4)=4.
    expect(wordBudgetFor(DURATION_PRESETS.hook_test)).toEqual({ hook: 8, body: 12, cta: 4 });
    expect(wordBudgetFor(DURATION_PRESETS.conversion)).toEqual({ hook: 20, body: 32, cta: 8 });
    expect(wordBudgetFor(DURATION_PRESETS.story)).toEqual({ hook: 20, body: 60, cta: 10 });
  });
});

describe('computeSceneTiming', () => {
  it('calcula duración e instante de inicio acumulado (t no es duración: es cuándo empieza)', () => {
    const scenes = computeSceneTiming([
      draft('una dos tres cuatro cinco', 'hook'), // 5 palabras → 2 s, t=0
      draft('seis siete ocho nueve diez once doce trece nueve diez', 'body'), // 10 → 4 s, t=2
      draft('link en la bio ya', 'cta'), // 5 → 2 s, t=6
    ]);

    expect(scenes.map((s) => [s.t, s.seconds])).toEqual([
      [0, 2],
      [2, 4],
      [6, 2],
    ]);
    expect(scenes.map((s) => s.segment)).toEqual(['hook', 'body', 'cta']);
  });

  it('aplica el suelo de 0,5 s: una escena de 1 palabra no puede durar 0,4 s (no existe ese clip)', () => {
    const [scene] = computeSceneTiming([draft('Mira.', 'hook')]);
    expect(scene?.seconds).toBe(MIN_SCENE_SECONDS);
  });

  it('est_seconds redondea AL ALZA (un anuncio no se corta a media palabra)', () => {
    const scenes = computeSceneTiming([draft('una dos tres cuatro cinco seis siete', 'body')]); // 7/2,5 = 2,8
    expect(estSecondsOf(scenes)).toBe(3);
  });
});

describe('subtitulos y agregados', () => {
  it('los subtítulos derivan de las escenas: start/end SON los de la escena (no pueden desincronizarse)', () => {
    const scenes = computeSceneTiming([
      draft('una dos tres cuatro cinco', 'hook'),
      draft('seis siete ocho nueve diez', 'body'),
    ]);
    expect(subtitlesFromScenes(scenes)).toEqual([
      { start: 0, end: 2, text: 'una dos tres cuatro cinco' },
      { start: 2, end: 4, text: 'seis siete ocho nueve diez' },
    ]);
  });

  it('totalWords / fullTextOf / wordsInSegment miden lo hablado, en orden', () => {
    const scenes = computeSceneTiming([
      draft('hook de cinco palabras hoy', 'hook'),
      draft('body con seis palabras justas aquí', 'body'),
    ]);
    expect(totalWords(scenes)).toBe(11);
    expect(fullTextOf(scenes)).toBe(
      'hook de cinco palabras hoy body con seis palabras justas aquí',
    );
    expect(wordsInSegment(scenes, 'hook')).toBe(5);
    expect(wordsInSegment(scenes, 'cta')).toBe(0);
  });
});

describe('rebuildEditedScript (CP3, T2.6)', () => {
  it('un guion SIN editar reconstruye byte a byte el mismo objeto (no inventa v2 espuria)', () => {
    const script = makeScript({
      hook: 'esto lo cambia todo',
      body: 'lo probé una semana y funciona de verdad',
      cta: 'link en la bio',
    });
    // Determinismo/paridad: `rebuildEditedScript` deriva TODO de las narraciones con las mismas
    // primitivas que `makeScript` (= `assembleScript`), así que un guion intacto vuelve idéntico.
    expect(rebuildEditedScript(script)).toEqual(script);
  });

  it('editar la narración de una escena recomputa hook/cta/fullText/timing (LA superficie editable)', () => {
    const original = makeScript({
      hook: 'hook viejo con cuatro palabras',
      body: 'body original de seis palabras aqui',
      cta: 'cta vieja aqui',
    });
    // El cliente cambia SOLO la narración de la escena hook (y deja fullText/hook/timing RANCIOS,
    // como haría el navegador, que no calcula timing). El servidor debe re-derivar desde la escena.
    const staleEdit: AdScript = {
      ...original,
      scenes: original.scenes.map((s) =>
        s.segment === 'hook' ? { ...s, narration: 'hook nuevo con siete palabras nuevas hoy' } : s,
      ),
      // fullText/hook DELIBERADAMENTE viejos: es justo lo que el bug de staleness dejaría pasar.
    };
    const rebuilt = rebuildEditedScript(staleEdit);

    // hook (top-level) se DERIVA de la escena hook, no del campo rancio.
    expect(rebuilt.hook).toBe('hook nuevo con siete palabras nuevas hoy');
    // fullText incluye la narración NUEVA, no la vieja (esto es lo que el re-lint escanea).
    expect(rebuilt.fullText).toContain('hook nuevo con siete palabras nuevas hoy');
    expect(rebuilt.fullText).not.toContain('hook viejo');
    // El timing de la escena hook se recalculó (7 palabras ÷ 2,5 = 2,8 s), no quedó el viejo (4→1,6).
    expect(rebuilt.scenes[0]?.seconds).toBe(2.8);
    // cta intacta (no se tocó su escena) sigue derivándose de su escena cta.
    expect(rebuilt.cta).toBe('cta vieja aqui');
  });

  it('hook y cta (top-level) son el join de las narraciones de sus escenas de segmento', () => {
    const script = makeScript({ hook: 'uno dos', body: 'tres cuatro cinco', cta: 'seis siete' });
    const rebuilt = rebuildEditedScript(script);
    expect(rebuilt.hook).toBe('uno dos');
    expect(rebuilt.cta).toBe('seis siete');
    // La identidad (filenameCode/sharedBodyKey/tone/language) NO se deriva del texto: se conserva.
    expect(rebuilt.filenameCode).toBe('acme-hook01-es-12s');
    expect(rebuilt.sharedBodyKey).toBe('body-shared-1');
    expect(rebuilt.tone).toBe('cercano');
    expect(rebuilt.language).toBe('es');
  });
});
