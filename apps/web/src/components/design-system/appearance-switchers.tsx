'use client';

import { useState } from 'react';
import {
  ACCENTS,
  applyAccent,
  applyDensity,
  applyTheme,
  DEFAULT_ACCENT,
  DEFAULT_DENSITY,
  DEFAULT_THEME,
  DENSITIES,
  THEMES,
  type Accent,
  type Density,
  type Theme,
} from './apply-appearance';

// A labelled segmented control. Each button writes the chosen value onto
// document.documentElement via the pure apply-* helpers, so the whole page
// re-themes live off the token system with no React re-render of specimens.
function Segmented<T extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-micro font-medium uppercase tracking-widest text-text-3">{label}</span>
      <div
        role="group"
        aria-label={label}
        className="inline-flex gap-1 rounded-lg border border-border bg-surface-2 p-1"
      >
        {options.map((opt) => {
          const active = opt === value;
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={active}
              onClick={() => {
                onSelect(opt);
              }}
              className={
                active
                  ? 'rounded-md bg-accent px-3 py-1.5 text-small font-medium text-text-on-accent'
                  : 'rounded-md px-3 py-1.5 text-small font-medium text-text-2 hover:bg-surface-3 hover:text-text'
              }
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AppearanceSwitchers() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [accent, setAccent] = useState<Accent>(DEFAULT_ACCENT);
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);

  return (
    <div className="flex flex-wrap items-end gap-6 rounded-lg border border-border bg-surface p-6 shadow-sm">
      <Segmented
        label="Tema"
        options={THEMES}
        value={theme}
        onSelect={(v) => {
          setTheme(v);
          applyTheme(document.documentElement, v);
        }}
      />
      <Segmented
        label="Acento"
        options={ACCENTS}
        value={accent}
        onSelect={(v) => {
          setAccent(v);
          applyAccent(document.documentElement, v);
        }}
      />
      <Segmented
        label="Densidad"
        options={DENSITIES}
        value={density}
        onSelect={(v) => {
          setDensity(v);
          applyDensity(document.documentElement, v);
        }}
      />
    </div>
  );
}
