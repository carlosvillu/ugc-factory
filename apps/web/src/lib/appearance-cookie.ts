// Persistencia de la apariencia del design system (tema/acento/densidad) en una COOKIE
// (T0.14). Por qué cookie y no `app_setting`: la Verificación exige que la apariencia
// sobreviva a un RELOAD (no a un reinicio de Postgres — eso es solo para credenciales,
// §19.2); una cookie lo satisface, la lee el layout en el servidor para pintar SIN flash
// (data-* ya en el `<html>` del primer HTML), y aísla el estado por navegador en vez de
// hacerlo global single-user en la BD (que toda página tendría que leer y el spec de
// e2e escribiría en la BD compartida).
//
// El módulo es framework-free (solo string in/out): lo usan el layout (server, lee de
// next/headers) y el switcher de /settings (cliente, escribe document.cookie).
import {
  ACCENTS,
  DENSITIES,
  THEMES,
  DEFAULT_ACCENT,
  DEFAULT_DENSITY,
  DEFAULT_THEME,
  type Accent,
  type Density,
  type Theme,
} from '@/components/design-system/apply-appearance';

export const APPEARANCE_COOKIE = 'ugc_appearance';
// 1 año: la preferencia de apariencia es duradera (no es sesión).
export const APPEARANCE_MAX_AGE = 60 * 60 * 24 * 365;

export interface Appearance {
  theme: Theme;
  accent: Accent;
  density: Density;
}

const DEFAULT_APPEARANCE: Appearance = {
  theme: DEFAULT_THEME,
  accent: DEFAULT_ACCENT,
  density: DEFAULT_DENSITY,
};

function isTheme(v: string): v is Theme {
  return (THEMES as readonly string[]).includes(v);
}
function isAccent(v: string): v is Accent {
  return (ACCENTS as readonly string[]).includes(v);
}
function isDensity(v: string): v is Density {
  return (DENSITIES as readonly string[]).includes(v);
}

/**
 * Parsea el valor de la cookie (`theme.accent.density`) a un `Appearance` validado.
 * Cualquier parte ausente o inválida cae a su default — una cookie corrupta nunca
 * revienta el render, solo degrada al DS por defecto (dark/indigo/balanced).
 */
export function parseAppearanceCookie(raw: string | undefined): Appearance {
  if (!raw) return DEFAULT_APPEARANCE;
  const [theme, accent, density] = raw.split('.');
  return {
    theme: theme && isTheme(theme) ? theme : DEFAULT_THEME,
    accent: accent && isAccent(accent) ? accent : DEFAULT_ACCENT,
    density: density && isDensity(density) ? density : DEFAULT_DENSITY,
  };
}

/** Serializa un `Appearance` al valor de cookie (`theme.accent.density`). */
export function serializeAppearance(a: Appearance): string {
  return `${a.theme}.${a.accent}.${a.density}`;
}

/**
 * Atributos `data-*` a estampar en `<html>` desde el servidor. Omite los que coinciden con
 * el default (== `:root` de globals.css) para no ensuciar el SSR ni provocar mismatch de
 * hidratación — MISMA regla de elisión que apply-appearance.ts (removeAttribute en cliente).
 * Único origen de "qué default se omite", compartido servidor↔cliente: si cambia un default
 * o se añade un eje, se toca aquí y en apply-appearance.ts deja de haber ternarios sueltos.
 */
export function appearanceDataAttrs(a: Appearance): {
  'data-theme'?: Theme;
  'data-accent'?: Accent;
  'data-density'?: Density;
} {
  return {
    ...(a.theme === DEFAULT_THEME ? {} : { 'data-theme': a.theme }),
    ...(a.accent === DEFAULT_ACCENT ? {} : { 'data-accent': a.accent }),
    ...(a.density === DEFAULT_DENSITY ? {} : { 'data-density': a.density }),
  };
}
