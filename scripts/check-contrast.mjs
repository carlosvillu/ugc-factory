#!/usr/bin/env node
// Verifica el contraste WCAG de los pares fg/bg del design system, en AMBOS temas,
// de forma determinista y en el gate. Sube al escalón mecánico la regla de prosa de
// cua.md §111 ("comprueba el contraste a ojo"): incumplida ≥6 veces (T1.12, T1.17,
// T3.8, T5.6 redescubrieron el mismo --danger dark), con 10 scripts ad-hoc de un
// solo uso bajo docs/verifications/ que este fichero unifica y jubila (auditoría del
// journal, 2026-07-23). Cero dependencias externas: parsea globals.css a mano.
//
//   pnpm check:contrast        imprime la matriz y falla (exit 1) bajo el umbral
//
// Umbral 4.5:1 = WCAG AA para texto normal (el estándar real, no un margen inventado).
//
// Los tokens -soft son SEMITRANSPARENTES (hex de 8 dígitos: #rrggbbaa). Un highlight
// -soft NO se ve sobre negro puro sino COMPOSITADO sobre la superficie real donde
// vive; medir el hex crudo miente. Por eso se compone alpha-over-surface antes de
// medir — el error exacto de T1.12/T3.8.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = join(ROOT, 'apps/web/src/app/globals.css');

const THRESHOLD = 4.5; // WCAG AA para texto normal (el estándar real, no un margen inventado)

// ── Pares fg/bg a verificar, por SUPERFICIE. Cada par es [fg, bg]. Un bg -soft se
//    compone sobre la superficie indicada como tercer elemento (o --surface por
//    defecto), que es donde el highlight vive de verdad. ─────────────────────────
const PAIRS = [
  // Texto sobre superficies
  ['--text', '--surface'],
  ['--text-2', '--surface'],
  ['--text-on-accent', '--accent'],
  // Estados sólidos sobre superficie (íconos/labels de estado)
  ['--success', '--surface'],
  ['--warning', '--surface'],
  ['--danger', '--surface'],
  ['--info', '--surface'],
  // Texto -on sobre su color sólido (badges rellenos): --success-on se pinta sobre --success
  ['--success-on', '--success'],
  // Highlights -soft compositados sobre la superficie real (la clase de bug de T1.12/T3.8):
  // el color sólido de la familia se lee sobre su propio -soft (label/ícono sobre el highlight)
  ['--danger', '--danger-soft', '--surface'],
  ['--info', '--info-soft', '--surface'],
  ['--warning', '--warning-soft', '--surface'],
  ['--success', '--success-soft', '--surface'],
  ['--violet', '--violet-soft', '--surface'],
  // Resaltado de slots de /gallery: texto de acento sobre el highlight accent-soft (T3.8, diferido)
  ['--accent', '--accent-soft', '--surface'],
];

// ── CUARENTENA (auditoría del journal 2026-07-23 + memoria ds-contrast-slots-galeria).
//    La familia de highlights -soft en tema DARK falla AA (danger-soft 4.45:1, info-soft
//    4.48:1) — el resaltado de slots de /gallery (T3.8) es el caso original, y su
//    recalibración en Claude Design + DesignSync es una decisión del usuario DIFERIDA
//    explícitamente. El check protege TODOS los demás pares; estos quedan excluidos con
//    puntero a la decisión pendiente, para NO forzar aquí la llamada que se aplazó. Se
//    recalibran juntos (arreglar uno y dejar el otro sería incoherente). Al resolver:
//    borrar las entradas y el check volverá a cubrirlos. Claves = "fg|bg|theme", que
//    DEBEN corresponder a un par real de PAIRS (si no, la exclusión sería inerte). ──
const QUARANTINE = new Set([
  '--accent|--accent-soft|dark', // resaltado de slots /gallery, caso original T3.8
  '--accent|--accent-soft|light', // (memoria ds-contrast-slots-galeria)
  '--danger|--danger-soft|dark', // familia -soft dark, mismo lote de recalibración
  '--info|--info-soft|dark', // nuevo miembro enumerado 2026-07-23, misma familia -soft
]);

// ── Parser de globals.css: extrae los pares `--token: valor;` de un bloque. El bloque
//    :root es el tema DARK (default); [data-theme=light] REDEFINE un subconjunto y el
//    resto hereda de :root — por eso light se construye como {...dark, ...lightOverrides}.
function parseBlock(css, selectorRe) {
  const start = css.search(selectorRe);
  if (start === -1) return {};
  const open = css.indexOf('{', start);
  // recorre balanceando llaves para respetar bloques anidados (@theme, etc. no aplican aquí)
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = css.slice(open + 1, end);
  const tokens = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

// ── Color: parsea #rgb/#rrggbb/#rrggbbaa y rgba(); devuelve {r,g,b,a} en [0,255]/[0,1].
function parseColor(value) {
  let v = value.trim();
  const hex = v.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    if (h.length === 4) h = [...h].map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  const rgba = v.match(/rgba?\(([^)]+)\)/i);
  if (rgba) {
    const p = rgba[1].split(',').map((s) => s.trim());
    return { r: +p[0], g: +p[1], b: +p[2], a: p[3] !== undefined ? +p[3] : 1 };
  }
  return null;
}

// ── Resuelve un token a color; sigue una cadena de var() si el valor es otra var.
function resolve(token, theme) {
  let value = theme[token];
  let guard = 0;
  while (value && value.startsWith('var(') && guard++ < 8) {
    const inner = value.match(/var\((--[\w-]+)\)/);
    if (!inner) break;
    value = theme[inner[1]];
  }
  return value ? parseColor(value) : null;
}

// ── Compositado alpha-over: pinta `fg` (con su alpha) sobre `bg` opaco. ──────────
function composite(fg, bg) {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

// ── Luminancia relativa WCAG y ratio de contraste. ──────────────────────────────
function luminance({ r, g, b }) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function main() {
  const css = readFileSync(CSS, 'utf8');
  const dark = parseBlock(css, /:root\s*\{/);
  const lightOverrides = parseBlock(css, /\[data-theme=['"]?light['"]?\]\s*\{/);
  const themes = {
    dark,
    light: { ...dark, ...lightOverrides }, // light hereda de dark lo que no redefine
  };

  const failures = [];
  const quarantined = [];

  for (const theme of ['dark', 'light']) {
    const T = themes[theme];
    for (const [fgTok, bgTok, surfaceTok] of PAIRS) {
      const key = `${fgTok}|${bgTok}|${theme}`;
      if (QUARANTINE.has(key)) {
        quarantined.push(key);
        continue;
      }
      const fg = resolve(fgTok, T);
      let bg = resolve(bgTok, T);
      if (!fg || !bg) {
        failures.push(`${theme}: no resuelve ${fgTok} o ${bgTok}`);
        continue;
      }
      // bg semitransparente ⇒ compositar sobre su superficie real
      if (bg.a < 1) {
        const surf = resolve(surfaceTok ?? '--surface', T);
        if (surf) bg = composite(bg, surf);
      }
      const r = ratio(fg, bg);
      const mark = r >= THRESHOLD ? 'ok ' : 'XX ';
      const line = `  [${mark}] ${theme.padEnd(5)} ${fgTok} sobre ${bgTok}: ${r.toFixed(2)}:1`;
      console.log(line);
      if (r < THRESHOLD) {
        failures.push(`${theme}: ${fgTok} sobre ${bgTok} = ${r.toFixed(2)}:1 (< ${THRESHOLD}:1)`);
      }
    }
  }

  // ── Check de completitud: todo token -on/-soft del DS debe estar clasificado
  //    (en un PAIR o en la cuarentena) — un token nuevo no puede escapar al check.
  const declared = new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]));
  for (const q of QUARANTINE) declared.add(q.split('|')[1]);
  const softOnTokens = Object.keys(dark).filter((t) => /-(on|soft)$/.test(t));
  const unclassified = softOnTokens.filter((t) => !declared.has(t));
  for (const t of unclassified) {
    failures.push(
      `token ${t} sin par declarado en la matriz PAIRS ni en la cuarentena — ` +
        `clasifícalo (sobre qué superficie se ve) o exclúyelo con motivo`,
    );
  }

  if (quarantined.length) {
    console.log(
      `\n  ⚠ ${quarantined.length} pares en cuarentena (decisión de recalibración DIFERIDA, ` +
        `memoria ds-contrast-slots-galeria): ${[...new Set(quarantined.map((q) => q.split('|').slice(0, 2).join(' sobre ')))].join(', ')}`,
    );
  }

  if (failures.length) {
    console.error(`\ncheck:contrast FALLA (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    '\ncheck:contrast OK — todos los pares ≥ ' + THRESHOLD + ':1 (los diferidos en cuarentena)',
  );
}

main();
