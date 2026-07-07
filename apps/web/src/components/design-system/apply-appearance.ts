// Pure helpers that write the design-system appearance preferences onto an
// element's data-* attributes (in the app: document.documentElement). Kept
// framework-free and side-effect-only-on-the-passed-element so it is trivially
// unit-testable and reusable by /settings (T0.14).

export const THEMES = ['dark', 'light'] as const;
export const ACCENTS = ['indigo', 'emerald', 'amber', 'cyan'] as const;
export const DENSITIES = ['compact', 'balanced', 'comfortable'] as const;

export type Theme = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];
export type Density = (typeof DENSITIES)[number];

// Defaults match the :root token values in globals.css, so no attribute needs
// to be written on first paint (SSR-clean, no hydration mismatch).
export const DEFAULT_THEME: Theme = 'dark';
export const DEFAULT_ACCENT: Accent = 'indigo';
export const DEFAULT_DENSITY: Density = 'balanced';

// Theme: dark is the default (:root), so we only stamp data-theme for light.
export function applyTheme(el: HTMLElement, theme: Theme): void {
  if (theme === DEFAULT_THEME) {
    el.removeAttribute('data-theme');
  } else {
    el.setAttribute('data-theme', theme);
  }
}

// Accent: indigo is the default (:root), so we only stamp data-accent otherwise.
export function applyAccent(el: HTMLElement, accent: Accent): void {
  if (accent === DEFAULT_ACCENT) {
    el.removeAttribute('data-accent');
  } else {
    el.setAttribute('data-accent', accent);
  }
}

// Density: balanced is the default (:root --ui-fs 14px); stamp otherwise.
export function applyDensity(el: HTMLElement, density: Density): void {
  if (density === DEFAULT_DENSITY) {
    el.removeAttribute('data-density');
  } else {
    el.setAttribute('data-density', density);
  }
}
