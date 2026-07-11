'use client';

// Switchers de apariencia de /settings (T0.14). A diferencia de los switchers efímeros
// de /design-system (que solo cambian el árbol en memoria para mostrar el DS), estos
// PERSISTEN la elección en la cookie `ugc_appearance` además de aplicarla en vivo sobre
// `document.documentElement`. Así el reload la reaplica desde el servidor (el layout lee
// la cookie y estampa `<html>`) SIN flash. Reusa los helpers puros apply-* y las
// constantes del DS (una sola fuente de valores para live-apply y validación de cookie).
import { useState } from 'react';
import {
  ACCENTS,
  applyAccent,
  applyDensity,
  applyTheme,
  DENSITIES,
  THEMES,
  type Accent,
  type Density,
  type Theme,
} from '@/components/design-system/apply-appearance';
import {
  APPEARANCE_COOKIE,
  APPEARANCE_MAX_AGE,
  serializeAppearance,
  type Appearance,
} from '@/lib/appearance-cookie';

function writeAppearanceCookie(a: Appearance): void {
  // Path=/ para que TODA página la lea; SameSite=Lax; Max-Age de 1 año. No HttpOnly: es
  // preferencia de UI, no una credencial, y el cliente la escribe.
  document.cookie = `${APPEARANCE_COOKIE}=${serializeAppearance(a)}; Path=/; Max-Age=${String(
    APPEARANCE_MAX_AGE,
  )}; SameSite=Lax`;
}

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
      <span className="text-small font-medium text-text-2">{label}</span>
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
                  ? 'rounded-md bg-accent px-3 py-1.5 text-small font-medium capitalize text-text-on-accent'
                  : 'rounded-md px-3 py-1.5 text-small font-medium capitalize text-text-2 hover:bg-surface-3 hover:text-text'
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

export function AppearanceSettings({ initial }: { initial: Appearance }) {
  const [appearance, setAppearance] = useState<Appearance>(initial);

  function update(next: Appearance): void {
    setAppearance(next);
    applyTheme(document.documentElement, next.theme);
    applyAccent(document.documentElement, next.accent);
    applyDensity(document.documentElement, next.density);
    writeAppearanceCookie(next);
  }

  return (
    <div className="flex flex-wrap items-end gap-6">
      <Segmented
        label="Tema"
        options={THEMES}
        value={appearance.theme}
        onSelect={(theme: Theme) => {
          update({ ...appearance, theme });
        }}
      />
      <Segmented
        label="Acento"
        options={ACCENTS}
        value={appearance.accent}
        onSelect={(accent: Accent) => {
          update({ ...appearance, accent });
        }}
      />
      <Segmented
        label="Densidad"
        options={DENSITIES}
        value={appearance.density}
        onSelect={(density: Density) => {
          update({ ...appearance, density });
        }}
      />
    </div>
  );
}
