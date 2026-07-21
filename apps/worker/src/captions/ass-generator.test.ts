// Unit tests del generador ASS (T5.4) — suite `worker:unit`, SIN ffmpeg (lógica pura). Cubre los 4
// asserts de media-composition.md:222-225 + selección de fuente + golden file, y aporta el CONTROL
// NEGATIVO obligatorio para safe zone y sincronía (reintroducir el bug → rojo). El parser es código de
// producción (principio 9: se importa, no se reimplementa).
import { describe, expect, it } from 'vitest';
import { expectGolden, makeWordTimestamps } from '@ugc/test-utils';

import {
  generateAss,
  AssGenerationError,
  FONT_LATIN,
  FONT_FALLBACK,
  PLAY_RES_X,
  PLAY_RES_Y,
} from './ass-generator';
import { parseAss, parseAssDialogues, AssParseError } from './ass-parser';
import {
  SAFE_ZONE_BOX_UNIVERSAL,
  estimateDialogueBox,
  findSafeZoneViolations,
  checkAssSafeZone,
} from './safe-zone';

const golden = (name: string): string => new URL(`./golden/${name}.ass`, import.meta.url).pathname;

describe('generateAss — estructura y estilos', () => {
  it('emite PlayResX/Y = 1080/1920 y un estilo Caption', () => {
    const parsed = parseAss(
      generateAss(makeWordTimestamps({ words: 8 }), { preset: 'karaoke', platform: 'universal' }),
    );
    expect(parsed.playResX).toBe(PLAY_RES_X);
    expect(parsed.playResY).toBe(PLAY_RES_Y);
    expect(parsed.styles.map((s) => s.name)).toContain('Caption');
  });

  it('reels usa caja opaca (BorderStyle=3); tiktok/universal usan contorno (BorderStyle=1)', () => {
    const reels = parseAss(
      generateAss(makeWordTimestamps({ words: 4 }), { preset: 'karaoke', platform: 'reels' }),
    );
    const tiktok = parseAss(
      generateAss(makeWordTimestamps({ words: 4 }), { preset: 'karaoke', platform: 'tiktok' }),
    );
    expect(reels.styles[0]?.borderStyle).toBe(3);
    expect(tiktok.styles[0]?.borderStyle).toBe(1);
  });

  it('cada Dialogue referencia un estilo existente en [V4+ Styles]', () => {
    // parseAssDialogues LANZA si un evento referencia un estilo inexistente → llegar aquí ya lo prueba.
    const events = parseAssDialogues(
      generateAss(makeWordTimestamps({ words: 20 }), { preset: 'karaoke', platform: 'universal' }),
    );
    expect(events.every((e) => e.styleName === 'Caption')).toBe(true);
  });
});

// ── ASSERT 1: formato de eventos ────────────────────────────────────────────
describe('assert 1 — formato de eventos', () => {
  it('cada evento tiene start < end', () => {
    const events = parseAssDialogues(
      generateAss(makeWordTimestamps({ words: 40 }), { preset: 'karaoke', platform: 'universal' }),
    );
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) expect(ev.startMs).toBeLessThan(ev.endMs);
  });

  it('karaoke: 1–4 palabras por página', () => {
    const events = parseAssDialogues(
      generateAss(makeWordTimestamps({ words: 40 }), { preset: 'karaoke', platform: 'universal' }),
    );
    for (const ev of events) {
      expect(ev.words.length).toBeGreaterThanOrEqual(1);
      expect(ev.words.length).toBeLessThanOrEqual(4);
    }
  });

  it('subtitle: 3–7 palabras por página en ≤2 líneas', () => {
    const ass = generateAss(makeWordTimestamps({ words: 40 }), {
      preset: 'subtitle',
      platform: 'universal',
    });
    const events = parseAssDialogues(ass);
    for (const ev of events) {
      expect(ev.words.length).toBeGreaterThanOrEqual(1); // la última página puede tener <3 palabras
      expect(ev.words.length).toBeLessThanOrEqual(7);
    }
    // ≤2 líneas: el texto plano parte por \N en el .ass; comprobamos que ninguna página excede 2 segmentos.
    for (const line of ass.split(/\r?\n/).filter((l) => l.startsWith('Dialogue:'))) {
      const text = line.split(',').slice(9).join(',');
      const nLines = text.split('\\N').length;
      expect(nLines).toBeLessThanOrEqual(2);
    }
  });

  it('maxWordsPerPage fuera del rango del preset → AssGenerationError', () => {
    expect(() =>
      generateAss(makeWordTimestamps({ words: 4 }), {
        preset: 'karaoke',
        platform: 'universal',
        maxWordsPerPage: 5,
      }),
    ).toThrow(AssGenerationError);
    expect(() =>
      generateAss(makeWordTimestamps({ words: 8 }), {
        preset: 'subtitle',
        platform: 'universal',
        maxWordsPerPage: 2,
      }),
    ).toThrow(AssGenerationError);
  });

  it('respeta un maxWordsPerPage dentro de rango', () => {
    const events = parseAssDialogues(
      generateAss(makeWordTimestamps({ words: 12 }), {
        preset: 'karaoke',
        platform: 'universal',
        maxWordsPerPage: 2,
      }),
    );
    for (const ev of events) expect(ev.words.length).toBeLessThanOrEqual(2);
  });
});

// ── ASSERT 2: karaoke \k coherente ──────────────────────────────────────────
describe('assert 2 — karaoke \\k coherente', () => {
  it('la suma de \\k (cs) de una página ≈ duración del evento', () => {
    const events = parseAssDialogues(
      generateAss(makeWordTimestamps({ words: 12 }), { preset: 'karaoke', platform: 'universal' }),
    );
    for (const ev of events) {
      const kSumCs = ev.kTags.reduce((s, k) => s + k.durationCs, 0);
      expect(kSumCs).toBeCloseTo((ev.endMs - ev.startMs) / 10, 0);
    }
  });

  it('ninguna palabra del evento karaoke queda sin tag \\k', () => {
    const events = parseAssDialogues(
      generateAss(makeWordTimestamps({ words: 20 }), { preset: 'karaoke', platform: 'universal' }),
    );
    for (const ev of events) {
      expect(ev.kTags.length).toBe(ev.words.length);
      for (const k of ev.kTags) expect(k.durationCs).toBeGreaterThanOrEqual(1);
    }
  });

  it('subtitle NO lleva tags \\k', () => {
    const events = parseAssDialogues(
      generateAss(makeWordTimestamps({ words: 20 }), { preset: 'subtitle', platform: 'universal' }),
    );
    for (const ev of events) expect(ev.kTags.length).toBe(0);
  });
});

// ── ASSERT 3: safe zone (box ESTIMADO por el check, no autorreportado) ───────
describe('assert 3 — safe zone (box estimado independientemente)', () => {
  const box = SAFE_ZONE_BOX_UNIVERSAL;

  it('ningún evento sale de la safe zone (box estimado desde \\pos+\\an+fontSize+texto)', () => {
    for (const preset of ['karaoke', 'subtitle'] as const) {
      const ass = generateAss(makeWordTimestamps({ words: 40 }), { preset, platform: 'universal' });
      // checkAssSafeZone estima el box INDEPENDIENTEMENTE (no lee ningún box del generador).
      expect(checkAssSafeZone(ass)).toEqual([]);
      // findSafeZoneViolations sobre diálogos YA parseados: el patrón que reutiliza el QA N9 (T5.5).
      expect(findSafeZoneViolations(parseAssDialogues(ass))).toEqual([]);
      for (const ev of parseAssDialogues(ass)) {
        const bbox = estimateDialogueBox(ev, ev.style);
        expect(bbox.minX).toBeGreaterThanOrEqual(box.minX);
        expect(bbox.maxX).toBeLessThanOrEqual(box.maxX);
        expect(bbox.minY).toBeGreaterThanOrEqual(box.minY);
        expect(bbox.maxY).toBeLessThanOrEqual(box.maxY);
      }
    }
  });

  it('el ancla \\pos cae dentro del rango (snippet de la reference)', () => {
    const events = parseAssDialogues(
      generateAss(makeWordTimestamps({ words: 40 }), { preset: 'karaoke', platform: 'universal' }),
    );
    for (const ev of events) {
      expect(ev.anchor.x).toBeGreaterThanOrEqual(box.minX);
      expect(ev.anchor.x).toBeLessThanOrEqual(box.maxX);
      expect(ev.anchor.y).toBeGreaterThanOrEqual(box.minY);
      expect(ev.anchor.y).toBeLessThanOrEqual(box.maxY);
    }
  });

  it('texto largo (4 palabras reales anchas): el generador ENCOGE la fuente para que el check pase', () => {
    // 4 palabras largas pero plausibles en una página karaoke: al default 64px desbordarían; el generador
    // reduce fontSize hasta que quepan de VERDAD, y el check independiente da 0 violaciones.
    const wt = makeWordTimestamps({
      texts: ['transformation', 'incredible', 'guaranteed', 'immediately'],
      onsets: [0, 0.5, 1.0, 1.5],
    });
    const ass = generateAss(wt, { preset: 'karaoke', platform: 'universal', maxWordsPerPage: 4 });
    // El fontSize declarado tuvo que bajar respecto al default (64): prueba de que hubo ajuste real.
    expect(parseAss(ass).styles[0]?.fontSize).toBeLessThan(64);
    expect(checkAssSafeZone(ass)).toEqual([]);
  });

  // CONTROL NEGATIVO: un `.ass` con posición declarada que SÍ desborda → el check independiente lo caza.
  // Se construye a mano (fontSize grande + texto largo + \pos cerca del borde), NO se muta un box
  // autorreportado: es exactamente el modo de fallo (texto off-screen) que el bug real producía.
  it('CONTROL NEGATIVO: un evento cuya posición declarada desborda por los lados se detecta', () => {
    const overflowing = [
      '[Script Info]',
      'PlayResX: 1080',
      'PlayResY: 1920',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      // fontSize 90, centrado en x=540: un texto largo estimado ancho desborda ambos bordes.
      'Style: Caption,TikTok Sans,90,&H00FFFFFF,&H00AAAAAA,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,2,2,0,0,0,1',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:00.00,0:00:02.00,Caption,,0,0,0,,{\\pos(540,1248)\\an2}esta linea es demasiado ancha para la safe zone universal',
    ].join('\n');
    const violations = checkAssSafeZone(overflowing);
    expect(violations.length).toBe(1);
    expect(violations[0]?.reason).toMatch(/left|right/);
  });

  it('CONTROL NEGATIVO: un evento anclado por encima del top de la safe zone se detecta', () => {
    const tooHigh = [
      '[Script Info]',
      'PlayResX: 1080',
      'PlayResY: 1920',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Caption,TikTok Sans,64,&H00FFFFFF,&H00AAAAAA,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,2,2,0,0,0,1',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      // \an8 (top-center) anclado en y=200 < zoneTop(270): el bloque cae por encima del área.
      'Dialogue: 0,0:00:00.00,0:00:02.00,Caption,,0,0,0,,{\\pos(500,200)\\an8}hola',
    ].join('\n');
    const violations = checkAssSafeZone(tooHigh);
    expect(violations.length).toBe(1);
    expect(violations[0]?.reason).toContain('top');
  });
});

// ── ASSERT 4: sincronía word-timestamps ↔ audio ±100 ms ─────────────────────
describe('assert 4 — sincronía karaoke ±100 ms', () => {
  // Onsets exactos conocidos: cada palabra empieza en un instante que controlamos al milisegundo.
  const onsets = [0, 0.5, 1.1, 1.7, 2.4, 3.0, 3.6, 4.3];
  const wt = makeWordTimestamps({ onsets });

  it('el inicio del highlight \\k de cada palabra cae a ≤100 ms de su timestamp real', () => {
    const events = parseAssDialogues(generateAss(wt, { preset: 'karaoke', platform: 'universal' }));
    let wordIdx = 0;
    for (const ev of events) {
      for (const k of ev.kTags) {
        const highlightOnsetMs = ev.startMs + k.onsetMs; // inicio absoluto del highlight
        const trueOnsetMs = (onsets[wordIdx] ?? NaN) * 1000;
        expect(Math.abs(highlightOnsetMs - trueOnsetMs)).toBeLessThanOrEqual(100);
        wordIdx += 1;
      }
    }
    expect(wordIdx).toBe(onsets.length); // se cubrieron todas las palabras
  });

  // CONTROL NEGATIVO REAL: un `.ass` con un `\k` MAL (que desincroniza la 2ª palabra) debe ser
  // detectado por la MISMA lógica de comparación que usa el assert positivo, ejercitando el parser de
  // producción (parseAssDialogues → kTags[].onsetMs). No es aritmética local: se construye un .ass
  // desincronizado a mano (como el control negativo de safe zone) y se comprueba que el check lo caza.
  // Palabras en onsets 0.0 y 0.5 s; el 1er `\k` dice 80 cs (0.8 s) → la 2ª palabra se resalta en 0.8 s,
  // 300 ms tarde que su timestamp real (0.5 s).
  it('CONTROL NEGATIVO: un .ass con un \\k desincronizado >100 ms se detecta', () => {
    const desyncedAss = [
      '[Script Info]',
      'PlayResX: 1080',
      'PlayResY: 1920',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Caption,TikTok Sans,64,&H00FFFFFF,&H00AAAAAA,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,2,2,0,0,0,1',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      // \k80 → la 2ª palabra ('two') no se resalta hasta 0.80 s; su onset real es 0.50 s.
      'Dialogue: 0,0:00:00.00,0:00:01.00,Caption,,0,0,0,,{\\pos(500,1248)\\an2}{\\k80}one {\\k20}two',
    ].join('\n');
    const realOnsetsMs = [0, 500]; // los timestamps verdaderos de 'one' y 'two'
    const ev = parseAssDialogues(desyncedAss)[0];
    expect(ev).toBeDefined();
    if (!ev) return;
    const maxDriftMs = Math.max(
      ...ev.kTags.map((k, i) => Math.abs(ev.startMs + k.onsetMs - (realOnsetsMs[i] ?? NaN))),
    );
    expect(maxDriftMs).toBeGreaterThan(100); // la MISMA comparación del assert positivo lo caza (300 ms)
  });
});

// ── Selección de fuente por script ──────────────────────────────────────────
describe('fallback de fuente por script', () => {
  it('texto latino → TikTok Sans', () => {
    const parsed = parseAss(
      generateAss(makeWordTimestamps({ texts: ['hello', 'world', 'again'] }), {
        preset: 'karaoke',
        platform: 'universal',
      }),
    );
    expect(parsed.styles[0]?.fontName).toBe(FONT_LATIN);
  });

  // Cirílico y griego: scripts que la Noto Sans BASE (la vendorizada, T5.1) SÍ cubre → el fallback
  // RENDERIZA de verdad (verificado en la imagen: 0 glyph-not-found, glifos reales). Estos son el "no
  // latino" que v1 soporta (PRD §17: el seed es es+en; cirílico es la muestra de cobertura no-latina).
  it('texto cirílico → fuente fallback (Noto), que la RENDERIZA', () => {
    const parsed = parseAss(
      generateAss(makeWordTimestamps({ texts: ['Привет', 'мир', 'снова'] }), {
        preset: 'karaoke',
        platform: 'universal',
      }),
    );
    expect(parsed.styles[0]?.fontName).toBe(FONT_FALLBACK);
  });

  it('texto griego → fuente fallback (Noto)', () => {
    const parsed = parseAss(
      generateAss(makeWordTimestamps({ texts: ['Γεια', 'σου', 'κόσμε'] }), {
        preset: 'karaoke',
        platform: 'universal',
      }),
    );
    expect(parsed.styles[0]?.fontName).toBe(FONT_FALLBACK);
  });

  // LIMITACIÓN CONOCIDA de v1 (NO un PASS de renderizado): el generador enruta CJK al MISMO 'Noto Sans',
  // pero esa familia NO cubre CJK — en la imagen renderiza TOFU (□□), verificado por el verifier de T5.4.
  // CJK exige la familia SEPARADA 'Noto Sans CJK' en la imagen (T5.1) + selección de familia POR SCRIPT en
  // el generador. Fuera del alcance v1 (seed es+en, PRD §17). Este test NO afirma que CJK renderiza: solo
  // FIJA el comportamiento actual de selección para que el día que se implemente CJK real, cambie a la
  // familia correcta y este test se actualice conscientemente (no se descubra el tofu en producción).
  it('texto CJK → hoy selecciona Noto Sans (base) — DEUDA: no renderiza CJK, requiere Noto Sans CJK', () => {
    const parsed = parseAss(
      generateAss(makeWordTimestamps({ texts: ['你好', '世界'] }), {
        preset: 'karaoke',
        platform: 'universal',
      }),
    );
    // Comportamiento ACTUAL, honesto sobre su limitación: enruta a la fuente fallback base (que tofuea CJK).
    expect(parsed.styles[0]?.fontName).toBe(FONT_FALLBACK);
  });
});

// ── Filtro type==='word' ────────────────────────────────────────────────────
describe('filtro de entradas ASR', () => {
  it('ignora entradas spacing/audio_event (no son palabras)', () => {
    const withNoise = makeWordTimestamps({ words: 6, withNonWords: true });
    const events = parseAssDialogues(
      generateAss(withNoise, { preset: 'karaoke', platform: 'universal' }),
    );
    const totalWords = events.reduce((s, ev) => s + ev.words.length, 0);
    expect(totalWords).toBe(6); // solo las 6 `word`, no los `spacing` intercalados
  });

  it('WordTimestamps sin palabras con tiempos → AssGenerationError', () => {
    const empty = {
      text: 'x',
      words: [{ text: ' ', start: null, end: null, type: 'spacing' as const, speaker_id: null }],
    };
    expect(() => generateAss(empty, { preset: 'karaoke', platform: 'universal' })).toThrow(
      AssGenerationError,
    );
  });
});

// ── Casos frontera ──────────────────────────────────────────────────────────
describe('casos frontera', () => {
  it('una sola palabra produce un único evento de una página', () => {
    const events = parseAssDialogues(
      generateAss(makeWordTimestamps({ words: 1 }), { preset: 'karaoke', platform: 'universal' }),
    );
    expect(events.length).toBe(1);
    expect(events[0]?.words.length).toBe(1);
  });
});

// ── Golden file (formato ASS sensible a cada campo) ─────────────────────────
describe('golden file', () => {
  it('.ass karaoke para un fixture fijo de timestamps', async () => {
    const wt = makeWordTimestamps({
      onsets: [0, 0.4, 0.9, 1.5, 2.0, 2.6],
      texts: ['tired', 'of', 'ads', 'that', 'feel', 'fake'],
    });
    const ass = generateAss(wt, { preset: 'karaoke', platform: 'universal' });
    await expectGolden(ass, golden('karaoke-universal'));
  });

  it('.ass subtitle/reels para el mismo fixture', async () => {
    const wt = makeWordTimestamps({
      onsets: [0, 0.4, 0.9, 1.5, 2.0, 2.6],
      texts: ['tired', 'of', 'ads', 'that', 'feel', 'fake'],
    });
    const ass = generateAss(wt, { preset: 'subtitle', platform: 'reels' });
    await expectGolden(ass, golden('subtitle-reels'));
  });
});

// ── Parser: errores de clase propia ─────────────────────────────────────────
describe('ass-parser — clase de error propia', () => {
  it('un .ass sin cabecera PlayRes → AssParseError', () => {
    expect(() =>
      parseAss(
        '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n',
      ),
    ).toThrow(AssParseError);
  });

  it('un Dialogue con estilo inexistente → AssParseError', () => {
    const ass = generateAss(makeWordTimestamps({ words: 3 }), {
      preset: 'karaoke',
      platform: 'universal',
    }).replace('Caption,,', 'Ghost,,');
    expect(() => parseAssDialogues(ass)).toThrow(AssParseError);
  });
});
