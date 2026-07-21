// GENERADOR de subtítulos `.ass` (T5.4, §9.7 / Apéndice C) — LÓGICA PURA: WordTimestamps → texto ASS.
// Vive en apps/worker (lo consume el burn-in de T5.5) pero no toca red, disco ni ffmpeg: sus tests
// corren en la suite unit normal, sin la imagen. El burn-in real (libass) es de la suite media.
//
// Qué produce:
//   · preset `karaoke`  : 1–4 palabras/página, un tag `\k<cs>` por palabra (word-highlight canónico TikTok).
//   · preset `subtitle` : 3–7 palabras repartidas en ≤2 líneas, sin karaoke.
//   · estilos: TikTok Sans blanco + contorno negro (BorderStyle=1) para `tiktok`/`universal`; caja opaca
//     (BorderStyle=3) para `reels` (§9.7).
//   · posicionamiento como CONSTRAINT de layout: cada evento se ancla dentro de la safe zone universal
//     (Apéndice C) y el generador ENCOGE el tamaño de fuente (`fitFontSize`) hasta que el texto cabe de
//     verdad. El generador NO autorreporta el box: el check de safe zone (safe-zone.ts, QA N9) lo estima
//     INDEPENDIENTEMENTE desde la posición declarada (`\pos`/`\an`) + el fontSize del estilo, con la MISMA
//     cota de glyph advance (`estimateTextWidth`, exportada de aquí). Así el verificador no confía en el
//     generador — es un verificador real, no el generador calificándose a sí mismo.
//   · fallback de fuente por SCRIPT del texto: latino → TikTok Sans; no-latino → Noto Sans. COBERTURA
//     REAL v1: latín + los scripts que la Noto Sans BASE trae (cirílico, griego…). LIMITACIÓN CONOCIDA:
//     CJK/árabe/hebreo/tailandés/devanagari se enrutan al MISMO 'Noto Sans' pero esa familia NO los cubre
//     → renderizarían TOFU. El fallback correcto es POR SCRIPT (Noto Sans CJK, Noto Sans Arabic…), lo que
//     exige esas familias en la imagen (T5.1) + selección por script aquí. v1 sembrado es es+en (PRD §17),
//     así que hoy solo se garantiza latín+cirílico; el resto es deuda anotada (T5.4).
//
// CLASE DE ERROR propia (anti-T1.8): entrada inválida (sin palabras con tiempos tras filtrar) →
// `AssGenerationError`. NUNCA se confunde con "fuente no encontrada" (eso lo decide fontconfig en render)
// ni con "ffmpeg falló" (capa de burn-in). El generador no comprueba que la fuente exista: solo declara
// su NOMBRE; la resolución la hace libass/fontconfig en la imagen del worker.
import type { CaptionStyle, CaptionPlatform } from '@ugc/core/contracts';
import type { WordTimestamps } from '@ugc/core/generation';

/** Fallo de generación: la entrada no permite producir un `.ass` (p. ej. ninguna palabra con tiempos). */
export class AssGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssGenerationError';
  }
}

/** SAFE ZONE UNIVERSAL (TikTok ∩ Meta) sobre 1080×1920 — PRD Apéndice C. Márgenes en px. */
export const SAFE_ZONE_UNIVERSAL = {
  top: 270,
  bottom: 672,
  left: 65,
  right: 140,
} as const;

export const PLAY_RES_X = 1080;
export const PLAY_RES_Y = 1920;

/** Nombres de fuente EXACTOS como los expone `fc-list` en la imagen del worker (T5.1 healthcheck). Un
 *  nombre que no coincida hace que libass sustituya la fuente en silencio → el nombre es load-bearing. */
export const FONT_LATIN = 'TikTok Sans';
export const FONT_FALLBACK = 'Noto Sans';

// El preset (`CaptionStyle` en el contrato) y la plataforma (`CaptionPlatform`) son la MISMA verdad
// del dominio que valida el schema de core — se DERIVAN de ahí (type-only, sin arrastrar red) en vez
// de re-declararse a mano. `preset` es el nombre del campo de opciones; su tipo es el `CaptionStyle` de core.
type CaptionPreset = CaptionStyle;

export interface GenerateAssOptions {
  preset: CaptionPreset;
  platform: CaptionPlatform;
  /** Override del máx. de palabras por página. Default: 4 (karaoke) / 7 (subtitle). Se clampa al rango
   *  del preset (karaoke 1–4, subtitle 3–7) — un valor fuera del rango es un error de configuración. */
  maxWordsPerPage?: number;
  /** Tamaño de fuente en px del espacio PlayRes. Default 64 (legible en 1080×1920). */
  fontSize?: number;
}

const PRESET_LIMITS: Record<CaptionPreset, { min: number; max: number; default: number }> = {
  karaoke: { min: 1, max: 4, default: 4 },
  subtitle: { min: 3, max: 7, default: 7 },
};

/** Una palabra con tiempos, ya en MILISEGUNDOS y filtrada (solo `type:'word'` con start/end válidos). */
interface TimedWord {
  text: string;
  startMs: number;
  endMs: number;
}

/** Filtra las entradas ASR a palabras con tiempos válidos, en ms. MISMO criterio que computeWordCoverage
 *  (type==='word' + start/end no nulos + end>=start): un spacing/audio_event no es una palabra. */
function toTimedWords(wt: WordTimestamps): TimedWord[] {
  const out: TimedWord[] = [];
  for (const w of wt.words) {
    if (w.type !== 'word') continue;
    if (w.start === null || w.end === null || w.end < w.start) continue;
    // Segundos → milisegundos. El GOTCHA de T5.4: los tiempos ASR van en segundos.
    out.push({
      text: w.text,
      startMs: Math.round(w.start * 1000),
      endMs: Math.round(w.end * 1000),
    });
  }
  return out;
}

/** Agrupa las palabras en páginas de a lo sumo `maxWords` por página. */
function paginate(words: TimedWord[], maxWords: number): TimedWord[][] {
  const pages: TimedWord[][] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    pages.push(words.slice(i, i + maxWords));
  }
  return pages;
}

/** ¿El texto es enteramente escritura latina (+ signos/espacios)? Si hay un solo carácter de otro script
 *  (cirílico, CJK, árabe, hebreo, griego…), se activa el fallback de fuente. Decisión por SCRIPT del
 *  texto, no por language_code (que puede faltar o mentir). */
function isLatinScript(text: string): boolean {
  // Rechaza cualquier letra/ideograma fuera de Latín básico+extendido. Los signos ASCII y espacios no
  // cuentan como script. \p{Script=Latin} cubre acentos latinos; cualquier otra letra fuerza el fallback.
  for (const ch of text) {
    if (/\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)) return false;
  }
  return true;
}

function selectFont(wt: WordTimestamps): string {
  // Binario latín/no-latín: v1 solo tiene DOS familias (TikTok Sans, Noto Sans base). Cuando un script
  // no-latino no lo cubre Noto Sans base (CJK, árabe…), esto lo enruta igualmente a Noto Sans y el render
  // tofuea — es la deuda documentada en la cabecera. La selección por-script real (Noto Sans CJK/Arabic…)
  // llegará con esas familias en la imagen; hoy el binario basta para el seed es+en+cirílico.
  return isLatinScript(wt.text) ? FONT_LATIN : FONT_FALLBACK;
}

/** ms → `h:mm:ss.cc` (centisegundos), el formato de tiempo de ASS. */
function formatAssTime(ms: number): string {
  const totalCs = Math.round(ms / 10);
  const cs = totalCs % 100;
  const totalS = (totalCs - cs) / 100;
  const s = totalS % 60;
  const totalMin = (totalS - s) / 60;
  const min = totalMin % 60;
  const h = (totalMin - min) / 60;
  const pad = (n: number, w: number): string => String(n).padStart(w, '0');
  return `${String(h)}:${pad(min, 2)}:${pad(s, 2)}.${pad(cs, 2)}`;
}

/**
 * Duraciones `\k` en centisegundos, derivadas de las DIFERENCIAS de onsets ACUMULADOS redondeados.
 * Por qué así (no redondear cada duración por separado): redondear cada `dur = end-start` a cs acumula
 * deriva y la Σ deja de cuadrar con la duración del evento. Redondeando el onset absoluto de cada palabra
 * (relativo al inicio de la página) y tomando `\k_i = onset_{i+1} - onset_i`, la Σ de los `\k` es EXACTA-
 * mente la duración de la página y cada highlight cae a ≤5 ms de su timestamp real. Los huecos entre
 * palabras se absorben en el `\k` de la palabra previa (el highlight dura hasta que empieza la siguiente).
 */
function computeKDurations(page: TimedWord[]): number[] {
  const first = page[0];
  const last = page[page.length - 1];
  if (!first || !last) throw new AssGenerationError('página de karaoke vacía');
  const pageStartMs = first.startMs;
  const pageEndMs = last.endMs;
  // Onsets acumulados en cs relativos al inicio de la página; el "onset" de la palabra i+1 marca el fin
  // del highlight de la palabra i. El último borde es el fin de la página.
  const boundariesCs: number[] = [];
  for (const w of page) boundariesCs.push(Math.round((w.startMs - pageStartMs) / 10));
  boundariesCs.push(Math.round((pageEndMs - pageStartMs) / 10));

  const durations: number[] = [];
  for (let i = 0; i < page.length; i += 1) {
    let d = (boundariesCs[i + 1] ?? 0) - (boundariesCs[i] ?? 0);
    if (d < 1) d = 1; // un `\k` de 0 cs no resalta nada; mínimo 1 cs (palabra degenerada de duración ~0).
    durations.push(d);
  }
  return durations;
}

/** Ancho medio de glifo ≈ 0,62 × fontSize (cota alta para sans). Detalle privado de `estimateTextWidth`. */
const GLYPH_ADVANCE_RATIO = 0.62;
/** Alto de línea ≈ 1,25 × fontSize. Compartido con el check para que su estimación de altura coincida. */
export const LINE_HEIGHT_RATIO = 1.25;

/** Cota conservadora del ancho de un texto en px del espacio PlayRes: `glyph advance × nº de caracteres`.
 *  No es medición real de glifos (eso exige rasterizar) — es una SOBRESTIMACIÓN suficiente para el
 *  constraint de layout: si el box estimado cabe, el real (más estrecho) también. EXPORTADA y reusada por
 *  el check de safe zone (safe-zone.ts): una sola implementación garantiza la invariante "ambos estiman
 *  con la misma cota" sin depender de que dos copias se mantengan byte-idénticas a mano. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * GLYPH_ADVANCE_RATIO;
}

const ZONE_LEFT = SAFE_ZONE_UNIVERSAL.left; // 65
const ZONE_RIGHT = PLAY_RES_X - SAFE_ZONE_UNIVERSAL.right; // 940
const ZONE_TOP = SAFE_ZONE_UNIVERSAL.top; // 270
const ZONE_BOTTOM = PLAY_RES_Y - SAFE_ZONE_UNIVERSAL.bottom; // 1248
const ZONE_WIDTH = ZONE_RIGHT - ZONE_LEFT; // 875
const ZONE_HEIGHT = ZONE_BOTTOM - ZONE_TOP; // 978
const ZONE_CENTER_X = Math.round((ZONE_LEFT + ZONE_RIGHT) / 2);

/**
 * El TAMAÑO DE FUENTE que hace caber TODAS las páginas dentro de la safe zone: se parte del deseado
 * (`desired`) y se REDUCE hasta que la línea más ancha de cualquier página cabe en el ancho útil y el
 * bloque más alto cabe en el alto útil. Devuelve un tamaño entero ≥ MIN_FONT_SIZE. Esta es la constraint
 * de layout REAL: el generador nunca coloca texto más ancho que la zona (el desbordamiento off-screen que
 * el check independiente detectaría). El estilo declara ESTE tamaño, así que el check —que lo lee del
 * estilo— estima el box con el mismo número.
 */
const MIN_FONT_SIZE = 24;
function fitFontSize(pageLineTexts: string[][], desired: number): number {
  // El nº de líneas del bloque más alto no depende de `size` → se calcula una vez fuera del bucle.
  const tallestLines = Math.max(...pageLineTexts.map((l) => l.length), 1);
  let size = desired;
  while (size > MIN_FONT_SIZE) {
    const widestOk = pageLineTexts.every((lines) =>
      lines.every((t) => estimateTextWidth(t, size) <= ZONE_WIDTH),
    );
    const heightOk = Math.round(size * LINE_HEIGHT_RATIO) * tallestLines <= ZONE_HEIGHT;
    if (widestOk && heightOk) break;
    size -= 1;
  }
  return size;
}

/** Ancla `\pos` de una página (alignment 2, bottom-center): SIEMPRE en el borde inferior de la safe zone.
 *  El bloque de texto sube desde ahí `nLines × lineHeight`; como `fitFontSize` garantiza
 *  `blockHeight ≤ ZONE_HEIGHT`, el box `[ZONE_BOTTOM − blockHeight, ZONE_BOTTOM]` cae siempre dentro. */
function layoutAnchor(): { x: number; y: number } {
  return { x: ZONE_CENTER_X, y: ZONE_BOTTOM };
}

/** Envuelve una página en ≤2 líneas para el preset subtitle (reparto equilibrado por nº de palabras). */
function wrapTwoLines(words: string[]): string[] {
  if (words.length <= 3) return [words.join(' ')];
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(' '), words.slice(half).join(' ')];
}

function styleBlock(fontName: string, fontSize: number, platform: CaptionPlatform): string {
  // BorderStyle: 1 = contorno + sombra (TikTok/universal); 3 = caja opaca (Reels, §9.7).
  const borderStyle = platform === 'reels' ? 3 : 1;
  // Colores ASS en &HAABBGGRR. Texto blanco, contorno/caja negros. PrimaryColour blanco; para karaoke,
  // SecondaryColour (el color "aún no resaltado") gris para que el highlight se distinga al colorearse.
  const primary = '&H00FFFFFF'; // blanco opaco (palabra ya resaltada)
  const secondary = '&H00AAAAAA'; // gris (palabra aún no resaltada) — el \k la "enciende" a primary
  const outline = '&H00000000'; // negro (contorno o caja)
  const back = '&H80000000'; // negro semi-opaco (sombra / relleno de caja)
  const outlineW = platform === 'reels' ? 6 : 4; // grosor de caja/contorno
  const shadow = platform === 'reels' ? 0 : 2;
  // Alignment 2 = bottom-center. Los márgenes del estilo son 0: el posicionamiento real lo fija \pos.
  return [
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${fontName},${String(fontSize)},${primary},${secondary},${outline},${back},1,0,0,0,100,100,0,0,${String(borderStyle)},${String(outlineW)},${String(shadow)},2,0,0,0,1`,
  ].join('\n');
}

function karaokeText(page: TimedWord[], kDurations: number[]): string {
  // `{\k<cs>}palabra ` por palabra; el espacio final separa visualmente (no se resalta).
  return page.map((w, i) => `{\\k${String(kDurations[i])}}${w.text}`).join(' ');
}

/**
 * Genera el `.ass` completo desde los word timestamps. Determinista: mismos timestamps + opciones →
 * mismo texto byte a byte (sin fecha ni versión) → apto para golden files.
 */
export function generateAss(wt: WordTimestamps, opts: GenerateAssOptions): string {
  const limits = PRESET_LIMITS[opts.preset];
  const maxWords = opts.maxWordsPerPage ?? limits.default;
  if (maxWords < limits.min || maxWords > limits.max) {
    throw new AssGenerationError(
      `maxWordsPerPage=${String(maxWords)} fuera del rango del preset ${opts.preset} (${String(limits.min)}–${String(limits.max)})`,
    );
  }

  const words = toTimedWords(wt);
  if (words.length === 0) {
    throw new AssGenerationError('WordTimestamps sin ninguna palabra con tiempos válidos');
  }

  const fontName = selectFont(wt);
  const pages = paginate(words, maxWords);

  // Las líneas visibles de cada página (para el ajuste de fuente): en karaoke, una línea con todas las
  // palabras; en subtitle, ≤2 líneas envueltas.
  const pageLineTexts: string[][] = pages.map((page) =>
    opts.preset === 'karaoke'
      ? [page.map((w) => w.text).join(' ')]
      : wrapTwoLines(page.map((w) => w.text)),
  );

  // El tamaño de fuente se AJUSTA a la safe zone: se reduce desde el deseado hasta que la página más ancha
  // y la más alta caben. Ese es el número que declara el estilo → el check independiente estima con él.
  const fontSize = fitFontSize(pageLineTexts, opts.fontSize ?? 64);
  const anchor = layoutAnchor();
  const overrides = `{\\pos(${String(anchor.x)},${String(anchor.y)})\\an2}`;

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${String(PLAY_RES_X)}`,
    `PlayResY: ${String(PLAY_RES_Y)}`,
    '',
    '[V4+ Styles]',
    styleBlock(fontName, fontSize, opts.platform),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const eventLines: string[] = [];
  pages.forEach((page, pageIdx) => {
    const first = page[0];
    const last = page[page.length - 1];
    if (!first || !last) return; // paginate nunca produce páginas vacías; guard para el type checker.
    const startMs = first.startMs;
    const endMs = last.endMs;

    let bodyText: string;
    if (opts.preset === 'karaoke') {
      const kDurations = computeKDurations(page);
      bodyText = karaokeText(page, kDurations);
    } else {
      bodyText = (pageLineTexts[pageIdx] ?? []).join('\\N');
    }

    eventLines.push(
      `Dialogue: 0,${formatAssTime(startMs)},${formatAssTime(endMs)},Caption,,0,0,0,,${overrides}${bodyText}`,
    );
  });

  return `${header.join('\n')}\n${eventLines.join('\n')}\n`;
}
