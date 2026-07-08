import { cn } from '@/lib/utils';

// SafeZoneOverlay — 1:1 with the DS mirror (product/SafeZoneOverlay.jsx): the
// dashed safe-zone guide over a 9:16 preview, switchable by platform preset.
// Presentational PURE: flat props, NO @ugc/core types — the composition/preview
// feature (F0) picks the preset.
//
// The base is the wide diagonal hatch (hatch-9x16-wide, globals.css) under a
// --overlay scrim; the safe-zone box is a dashed --accent outline with an
// --accent-soft fill, inset by the preset's per-edge percentages. The "off"
// preset (in the type but absent from PRESETS) intentionally renders hatch +
// scrim only, no box, empty label. Preset insets are runtime numbers → inline
// style (percentages Tailwind can't emit as classes; the sanctioned exception,
// same as Progress's width). The caption is white mono with caption-shadow for
// legibility over an arbitrary frame.
type SafeZonePreset = 'universal' | 'tiktok' | 'meta' | 'off';

interface PresetInset {
  t: number;
  r: number;
  b: number;
  l: number;
  label: string;
}

const PRESETS: Record<Exclude<SafeZonePreset, 'off'>, PresetInset> = {
  universal: { t: 14.06, r: 12.96, b: 35, l: 6.02, label: 'Universal · 875×978' },
  tiktok: { t: 6.77, r: 12.96, b: 25.2, l: 4.07, label: 'TikTok' },
  meta: { t: 14, r: 6, b: 35, l: 6, label: 'Meta / Reels' },
};

type SafeZoneOverlayProps = React.ComponentProps<'div'> & {
  /** @default "universal" */
  preset?: SafeZonePreset;
  /** Preview width in px (aspect-ratio 9:16 drives height). @default 236 */
  width?: number;
};

export function SafeZoneOverlay({
  className,
  style,
  preset = 'universal',
  width = 236,
  ...props
}: SafeZoneOverlayProps) {
  const p = preset === 'off' ? undefined : PRESETS[preset];
  return (
    <div
      data-slot="safe-zone-overlay"
      className={cn(
        'hatch-9x16-wide relative aspect-9/16 overflow-hidden rounded-lg border border-border-2',
        className,
      )}
      // Width is a runtime number → inline style (the sanctioned path); a caller
      // style still wins.
      style={{ width, ...style }}
      {...props}
    >
      <div aria-hidden className="absolute inset-0 bg-overlay" />
      {p ? (
        <div
          aria-hidden
          // 1.5px dashed accent guide, radius-sm (5px, nearest token to the
          // mirror's 4px). The DS has no 1.5px border-width token and TD.6 bans
          // arbitrary bracket classes, so the runtime-fixed 1.5px goes via inline
          // style (borderWidth), matching the mirror's borderWidth exactly.
          className="absolute rounded-sm border-dashed border-accent bg-accent-soft"
          style={{
            borderWidth: '1.5px',
            top: `${String(p.t)}%`,
            right: `${String(p.r)}%`,
            bottom: `${String(p.b)}%`,
            left: `${String(p.l)}%`,
          }}
        />
      ) : null}
      <span className="caption-shadow absolute inset-x-0 bottom-2 text-center font-mono text-micro text-text-on-accent">
        {p ? p.label : ''}
      </span>
    </div>
  );
}
