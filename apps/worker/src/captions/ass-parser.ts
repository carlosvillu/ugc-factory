// PARSER de ficheros `.ass` (T5.4) — CÓDIGO DE PRODUCCIÓN, no un test-util. Lo reutilizan:
//   · el check `captions_safe_zone` del QA N9 (T5.5) — parsea el `.ass` que se va a quemar y verifica
//     que ningún evento se sale del área útil;
//   · el script de verificación de T8.3 (presets por plataforma);
//   · los tests unit y media del generador (principio 9: los tests importan el parser de producción,
//     no reimplementan el formato).
//
// Alcance deliberado: parsea las secciones `[V4+ Styles]` y `[Events]`, las líneas `Dialogue:`, la
// cabecera `PlayResX/PlayResY`, y dentro del texto de cada diálogo los override tags que T5.4 emite:
// `\pos(x,y)`, `\an<align>`, `\k<cs>`. NO es un parser ASS completo (no cubre `\move`, `\t`, drawing
// `\p`, karaoke `\kf`/`\ko`) — esos no los genera T5.4 y añadirlos sin consumidor sería especulativo.
//
// CLASE DE ERROR propia (anti-T1.8): un `.ass` malformado lanza `AssParseError`, que NUNCA se confunde
// con "fuente no encontrada" (decisión del generador) ni con "ffmpeg falló" (capa de burn-in).

/** Un fallo estructural al parsear un `.ass` (sección ausente, campo de `Dialogue:` incompleto,
 *  timestamp ilegible). Distinto de los errores de generación y de render. */
export class AssParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssParseError';
  }
}

/** Un estilo de la sección `[V4+ Styles]`, con los campos que T5.4 consume aguas abajo. */
export interface AssStyle {
  name: string;
  fontName: string;
  fontSize: number;
  /** 1 = outline+shadow (TikTok), 3 = caja opaca (Reels). §9.7. */
  borderStyle: number;
  /** Alignment por defecto del estilo (numpad `\an`: 1..9). El `\an` inline lo sobreescribe. */
  alignment: number;
  marginL: number;
  marginR: number;
  marginV: number;
}

/** Un tag `\k<cs>`: la duración en CENTISEGUNDOS que la sílaba/palabra permanece resaltada. */
interface KTag {
  /** El texto de la palabra que sigue al tag (hasta el siguiente `\k` o el fin de la línea). */
  text: string;
  /** Duración del highlight en centisegundos (el argumento literal de `\k`). */
  durationCs: number;
  /** Onset del highlight en MILISEGUNDOS relativo al inicio del evento (suma de los `\k` previos ×10). */
  onsetMs: number;
}

/** Un evento `Dialogue:` parseado. NO trae bounding box: el box es responsabilidad del CHECK de safe
 *  zone (safe-zone.ts), que lo deriva INDEPENDIENTEMENTE de estos campos declarados (ancla `\pos`,
 *  alignment `\an`, tamaño de fuente del estilo referenciado y longitud del texto). Que el parser no
 *  autoreporte el box es lo que hace del check un verificador real y no el generador calificándose a sí
 *  mismo (media-composition.md §asserts 3). */
export interface AssDialogue {
  styleName: string;
  startMs: number;
  endMs: number;
  /** El ancla del texto: el punto `\pos(x,y)` si existe; si no, el punto derivado de márgenes+alignment.
   *  Es el punto de referencia del alignment (`\an`), no necesariamente una esquina del box. */
  anchor: { x: number; y: number };
  /** true si el evento declara `\pos` (posicionamiento absoluto); false si se posiciona por márgenes. */
  hasPos: boolean;
  /** Alignment efectivo (inline `\an` si existe, si no el del estilo): 1..9 numpad. */
  alignment: number;
  /** Las líneas de texto visible (separadas por `\N`). Su nº y la más larga fijan la altura/anchura del
   *  box que estima el check. */
  lines: string[];
  /** Las palabras del evento (una por tag `\k`, o el texto plano partido por espacios si no hay `\k`). */
  words: string[];
  /** Los tags `\k` en orden. Vacío si el evento no lleva karaoke (preset subtitle). */
  kTags: KTag[];
  /** El estilo referenciado (resuelto por `parseAssDialogues`): de él salen `fontSize`/márgenes que el
   *  check usa para estimar el box. */
  style: AssStyle;
  /** El texto visible sin override tags (para depurar / golden). */
  plainText: string;
}

export interface ParsedAss {
  playResX: number;
  playResY: number;
  styles: AssStyle[];
  dialogues: AssDialogue[];
}

/** Un diálogo aún sin resolver su estilo (el estilo se resuelve al final del parseo, cuando ya se han
 *  leído todas las líneas Style). */
type RawDialogue = Omit<AssDialogue, 'style'>;

const TIME_RE = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/;

/** `h:mm:ss.cc` → milisegundos. Lanza AssParseError si no encaja. */
function parseAssTime(raw: string): number {
  const m = TIME_RE.exec(raw.trim());
  if (!m) throw new AssParseError(`Timestamp ASS ilegible: "${raw}"`);
  const [, h, min, s, cs] = m;
  return ((Number(h) * 60 + Number(min)) * 60 + Number(s)) * 1000 + Number(cs) * 10;
}

/** Parsea el `.ass` completo: cabecera, estilos, diálogos. Resuelve el estilo de cada diálogo al final
 *  (cuando ya se leyeron todas las líneas Style). */
export function parseAss(ass: string): ParsedAss {
  const lines = ass.split(/\r?\n/);
  let playResX = 0;
  let playResY = 0;
  const styles: AssStyle[] = [];
  const rawDialogues: RawDialogue[] = [];

  let styleFormat: string[] | null = null;
  let eventFormat: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('PlayResX:')) {
      playResX = Number(trimmed.slice('PlayResX:'.length).trim());
      continue;
    }
    if (trimmed.startsWith('PlayResY:')) {
      playResY = Number(trimmed.slice('PlayResY:'.length).trim());
      continue;
    }

    if (trimmed.startsWith('Format:')) {
      const fields = trimmed
        .slice('Format:'.length)
        .split(',')
        .map((f) => f.trim());
      // El Format que precede a un Style define el layout de las líneas Style; el que precede a Dialogue,
      // el de los Dialogue. Se distinguen por qué sección abrió antes; aquí basta con recordar ambos.
      if (fields.includes('Fontname')) styleFormat = fields;
      else eventFormat = fields;
      continue;
    }

    if (trimmed.startsWith('Style:')) {
      if (!styleFormat) throw new AssParseError('Style sin Format previo en [V4+ Styles]');
      styles.push(parseStyleLine(trimmed.slice('Style:'.length), styleFormat));
      continue;
    }

    if (trimmed.startsWith('Dialogue:')) {
      if (!eventFormat) throw new AssParseError('Dialogue sin Format previo en [Events]');
      rawDialogues.push(parseDialogueLine(trimmed.slice('Dialogue:'.length), eventFormat));
      continue;
    }
  }

  if (playResX <= 0 || playResY <= 0) {
    throw new AssParseError('Cabecera sin PlayResX/PlayResY válidos');
  }

  const stylesByName = new Map(styles.map((s) => [s.name, s]));
  const dialogues: AssDialogue[] = rawDialogues.map((d) => {
    const style = stylesByName.get(d.styleName);
    if (!style) {
      throw new AssParseError(
        `Dialogue referencia un estilo inexistente: "${d.styleName}" (estilos: ${[...stylesByName.keys()].join(', ')})`,
      );
    }
    return { ...d, style };
  });

  return { playResX, playResY, styles, dialogues };
}

function fieldIndex(format: string[], name: string): number {
  const i = format.indexOf(name);
  if (i < 0) throw new AssParseError(`Campo "${name}" ausente en Format`);
  return i;
}

/** Lee `arr[i]` exigiendo que exista (los índices vienen de fieldIndex, ya validados contra el Format;
 *  un fallo aquí es una línea Dialogue/Style con menos campos de los que su Format declara). */
function requireField(arr: string[], i: number, what: string): string {
  const v = arr[i];
  if (v === undefined)
    throw new AssParseError(`Campo "${what}" ausente en la línea (índice ${String(i)})`);
  return v;
}

function parseStyleLine(raw: string, format: string[]): AssStyle {
  // El último campo del Format de estilos (Encoding) es numérico y no lleva comas; un split simple basta.
  const fields = raw.split(',').map((f) => f.trim());
  const get = (name: string): string => requireField(fields, fieldIndex(format, name), name);
  return {
    name: get('Name'),
    fontName: get('Fontname'),
    fontSize: Number(get('Fontsize')),
    borderStyle: Number(get('BorderStyle')),
    alignment: Number(get('Alignment')),
    marginL: Number(get('MarginL')),
    marginR: Number(get('MarginR')),
    marginV: Number(get('MarginV')),
  };
}

function parseDialogueLine(raw: string, format: string[]): RawDialogue {
  // El campo Text es el ÚLTIMO y puede contener comas: se separan solo los primeros N-1 campos.
  const textIdx = fieldIndex(format, 'Text');
  const parts = splitLimited(raw, ',', textIdx);
  if (parts.length <= textIdx) throw new AssParseError('Dialogue sin campo Text');

  const styleName = requireField(parts, fieldIndex(format, 'Style'), 'Style').trim();
  const startMs = parseAssTime(requireField(parts, fieldIndex(format, 'Start'), 'Start'));
  const endMs = parseAssTime(requireField(parts, fieldIndex(format, 'End'), 'End'));
  const text = requireField(parts, textIdx, 'Text');

  const { anchor, alignment, hasPos } = parseOverrides(text, format, parts);
  const { kTags, words, plainText } = parseKaraoke(text);
  // Las líneas visibles se separan por `\N` (hard line break de ASS), tras quitar los override tags.
  const lines = text
    .replace(/\{[^}]*\}/g, '')
    .split(/\\N/)
    .map((l) => l.trim());

  return { styleName, startMs, endMs, anchor, hasPos, alignment, lines, words, kTags, plainText };
}

/** Split que agrupa todo lo que sobra a partir del campo `limit` en el último elemento (para el Text). */
function splitLimited(raw: string, sep: string, limit: number): string[] {
  const out: string[] = [];
  let rest = raw;
  for (let i = 0; i < limit; i += 1) {
    const idx = rest.indexOf(sep);
    if (idx < 0) {
      out.push(rest);
      return out;
    }
    out.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  out.push(rest);
  return out;
}

const POS_RE = /\\pos\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/;
const AN_RE = /\\an([1-9])/;
const K_RE = /\\k(\d+)/g;

function parseOverrides(
  text: string,
  format: string[],
  parts: string[],
): { anchor: { x: number; y: number }; alignment: number; hasPos: boolean } {
  const posM = POS_RE.exec(text);
  const anM = AN_RE.exec(text);
  const alignment = anM ? Number(anM[1]) : 0; // 0 = «no declarado inline» (usa el del estilo)

  if (posM) {
    return { anchor: { x: Number(posM[1]), y: Number(posM[2]) }, alignment, hasPos: true };
  }
  // Sin \pos: el ancla se deriva de los márgenes de la línea Dialogue (0 si no se declaran). El generador
  // de T5.4 SIEMPRE emite \pos, pero el parser tolera un evento posicionado por márgenes (real .ass).
  const marginL = Number(parts[format.indexOf('MarginL')] ?? 0);
  const marginV = Number(parts[format.indexOf('MarginV')] ?? 0);
  return { anchor: { x: marginL, y: marginV }, alignment, hasPos: false };
}

function parseKaraoke(text: string): { kTags: KTag[]; words: string[]; plainText: string } {
  // Quita el bloque de override inicial de posicionamiento para no confundirlo con contenido, pero
  // preserva los bloques `{\k..}` que segmentan las palabras.
  const kTags: KTag[] = [];
  const words: string[] = [];
  let cumulativeCs = 0;

  // Recorre los bloques {\k<cs>} y captura el texto que sigue a cada uno.
  // Formato del generador karaoke: `{\pos(..)\an..}{\k34}palabra{\k28}otra` — un bloque \k por palabra.
  const blockRe = /\{([^}]*)\}([^{]*)/g;
  let m: RegExpExecArray | null;
  let sawK = false;
  while ((m = blockRe.exec(text)) !== null) {
    const tags = m[1] ?? '';
    const following = m[2] ?? '';
    K_RE.lastIndex = 0;
    const kMatch = K_RE.exec(tags);
    if (kMatch) {
      sawK = true;
      const durationCs = Number(kMatch[1]);
      const word = following.trim();
      kTags.push({ text: word, durationCs, onsetMs: cumulativeCs * 10 });
      cumulativeCs += durationCs;
      if (word.length > 0) words.push(word);
    } else if (following.trim().length > 0) {
      // Texto plano tras un bloque de solo-posicionamiento (preset subtitle sin \k).
      for (const w of following.trim().split(/\s+/)) words.push(w);
    }
  }

  // plainText: el texto sin ningún override tag.
  const plainText = text
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sawK) {
    // Preset subtitle: no hay \k; las palabras son el texto plano.
    return { kTags: [], words: plainText.length > 0 ? plainText.split(' ') : [], plainText };
  }

  return { kTags, words, plainText };
}

/**
 * API pública principal (media-composition.md:231): parsea las líneas `Dialogue:` de un `.ass` y las
 * devuelve como eventos estructurados, cada uno con su estilo ya resuelto. El check de safe zone y los
 * tests la consumen. `parseAss` ya valida cabecera/estilos y lanza si un evento referencia un estilo
 * inexistente.
 */
export function parseAssDialogues(ass: string): AssDialogue[] {
  return parseAss(ass).dialogues;
}
