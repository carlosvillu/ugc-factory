// GUARD DE CONTRASTE de la paleta del visor de JSON (T1.16, tras el FAIL del verifier).
//
// No es un test de "las clases se llaman como yo creo": eso ya lo dice TypeScript. Es el
// guard que le faltaba a la tarea — mide el CONTRASTE REAL de cada clase de la paleta contra
// la superficie REAL sobre la que se pinta, leyendo los hexes de `globals.css` (la fuente de
// verdad del DS en código), y falla si alguno baja de AA. Dos regresiones quedan cerradas:
//
//   1. Que alguien vuelva a colorear texto con un token de MARCA (`--accent`): el mismo hex en
//      los dos temas y ELEGIBLE POR EL USUARIO (indigo/emerald/amber/cyan) no puede cumplir
//      4,5:1 sobre #1a1a1d y sobre #f7f7f9 a la vez. Se comprueba explícitamente Y por medida
//      (los 4 acentos entran en la matriz).
//   2. Que un token gris demasiado tenue (`--text-3`, 3,59:1 en dark) se cuele como color de
//      contenido.
//
// Los hexes NO se copian aquí: se PARSEAN de globals.css. Si el DS recalibra un token (como
// hizo T1.12), este test lo mide de nuevo solo — y si el recalibrado rompe el visor, avisa.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { JSON_TOKEN_CLASS } from './json-token-palette';

// El cwd depende de quién lance vitest (la raíz del monorepo con `--project`, o `apps/web`):
// se prueban las dos rutas en vez de asumir una — un test que solo pasa según desde dónde se
// invoque es un test roto a medias.
function loadGlobalsCss(): string {
  for (const candidate of ['apps/web/src/app/globals.css', 'src/app/globals.css']) {
    try {
      return readFileSync(resolve(process.cwd(), candidate), 'utf8');
    } catch {
      // siguiente candidato
    }
  }
  throw new Error('globals.css no encontrado desde el cwd del test');
}

const CSS = loadGlobalsCss();

// Umbral WCAG AA para texto normal (el visor pinta a 11px/400: no califica como "texto grande").
const AA = 4.5;

// La superficie REAL del visor: el `<pre>` va sobre `bg-surface-2`, dentro de una modal
// `--surface`. Se miden LAS DOS (calibrar contra una superficie idealizada —blanco/negro puros—
// fue exactamente lo que hizo fallar la ronda 1 de T1.12).
const SURFACES = ['surface', 'surface-2'] as const;

/** Extrae el valor de una custom property dentro de un bloque de selector de globals.css. */
function tokenValue(selector: string, name: string): string {
  const block = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(CSS);
  if (block === null) throw new Error(`bloque no encontrado en globals.css: ${selector}`);
  const decl = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block[1] ?? '');
  if (decl === null) throw new Error(`token --${name} no encontrado en ${selector}`);
  return decl[1] ?? '';
}

// `:root` es el tema DARK (el default del DS); `[data-theme='light']` lo sobreescribe.
const dark = (name: string) => tokenValue(':root', name);
const light = (name: string) => {
  try {
    return tokenValue("\\[data-theme='light'\\]", name);
  } catch {
    return dark(name); // un token sin par de tema (p. ej. --accent) es el MISMO en ambos
  }
};

function luminance(hex: string): number {
  const ch = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// `text-success` → `success`. La paleta solo usa utilidades `text-<token>`.
function tokenOf(className: string): string {
  const name = className.replace(/^text-/, '');
  return name;
}

test('cada color de la paleta cumple AA en los DOS temas y sobre la superficie REAL del visor', () => {
  const failures: string[] = [];

  for (const [kind, className] of Object.entries(JSON_TOKEN_CLASS)) {
    const token = tokenOf(className);
    for (const theme of ['dark', 'light'] as const) {
      const fg = theme === 'dark' ? dark(token) : light(token);
      for (const surface of SURFACES) {
        const bg = theme === 'dark' ? dark(surface) : light(surface);
        const ratio = contrast(fg, bg);
        if (ratio < AA) {
          failures.push(
            `${kind} (${className}) ${theme}/${surface}: ${ratio.toFixed(2)}:1 < ${String(AA)}`,
          );
        }
      }
    }
  }

  // El array de fallos ES el mensaje: si algo baja de AA, el diff del assert imprime
  // token, tema, superficie y ratio medido — no un `false !== true` mudo.
  expect(failures).toEqual([]);
});

test('ningún color de la paleta deriva de --accent (color de MARCA, no de TEXTO)', () => {
  // El guard de NOMBRE, además del de medida: `--accent` es el mismo hex en los dos temas Y lo
  // elige el usuario, así que su ratio depende de una preferencia estética. Aunque un acento
  // concreto midiera bien, atar la legibilidad a él es el bug. Prohibido de raíz.
  for (const className of Object.values(JSON_TOKEN_CLASS)) {
    expect(className).not.toMatch(/accent/);
  }
});

test('CONTROL: los tokens que el verifier rechazó fallarían este guard', () => {
  // Sin este control, el test de arriba podría estar midiendo mal y pasar por casualidad. Se
  // comprueba que los DOS colores que el verifier tumbó (el acento en las claves, el --text-3
  // en la puntuación) caen por debajo de AA con esta misma métrica.
  const surface2Dark = dark('surface-2');
  const surface2Light = light('surface-2');

  // El acento por defecto (indigo, en `:root`) sobre la superficie oscura del visor.
  expect(contrast(dark('accent'), surface2Dark)).toBeLessThan(AA); // ~3,20
  // Y los acentos elegibles, sobre la superficie clara (el mismo hex, sin par de tema).
  for (const accent of ['emerald', 'amber', 'cyan']) {
    const hex = tokenValue(`\\[data-accent='${accent}'\\]`, 'accent');
    expect({ accent, ratio: contrast(hex, surface2Light) < AA }).toEqual({
      accent,
      ratio: true,
    }); // 2,0–2,4 en light: fallan
  }
  // La puntuación con el gris tenue: 3,59:1 en dark.
  expect(contrast(dark('text-3'), surface2Dark)).toBeLessThan(AA);
});
