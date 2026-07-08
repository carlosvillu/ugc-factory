import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// VariantCard — 1:1 with the DS mirror (product/VariantCard.jsx): the 9:16 video
// variant card for the library grid (/library). Presentational PURE: flat props,
// NO @ugc/core types — the library feature (F0) maps a Variant row to these props.
//
// The preview area is the diagonal-hatch placeholder (hatch-9x16 utility,
// globals.css) until a real render exists; while composing it shows a spinner,
// on failure a ⚠ glyph, otherwise a "preview 9:16" label. Composes Badge for the
// status pill, the tier pill (accent) and the free tags (mono when a 2-letter
// language code, matching the mirror's /^[A-Z]{2}$/ test). The duration pill
// floats over the preview on the --overlay-strong scrim with white mono. Mirror
// geometry mapped to tokens: 230px width, radius-lg, 1px border (danger when
// failed), shadow-sm, 13/14px body padding, 10/11px inner type snapped to micro.
type VariantCardStatus = 'approved' | 'composing' | 'failed';

// Decorative glyphs are split from the accessible label so a screen reader reads
// "aprobada" / "linaje", not "tick aprobada" / "linaje right-arrow" (matches how
// the sibling components aria-hide ◆/⚠). `glyph` is rendered in an aria-hidden
// span; `label` is the accessible name.
const STATUS_BADGE: Record<
  VariantCardStatus,
  { glyph?: string; label: string; tone: 'success' | 'info' | 'danger' }
> = {
  approved: { glyph: '✓', label: 'aprobada', tone: 'success' },
  composing: { label: 'componiendo', tone: 'info' },
  failed: { label: 'fallo', tone: 'danger' },
};

const ACTION: Record<VariantCardStatus, { label: string; glyph: string }> = {
  approved: { label: 'linaje', glyph: '→' },
  composing: { label: 'ver', glyph: '→' },
  failed: { label: 'reintentar', glyph: '↺' },
};

// A 2-letter uppercase tag is a language code → render it in mono (mirror rule).
function isLanguageCode(tag: string): boolean {
  return /^[A-Z]{2}$/.test(tag);
}

type VariantCardProps = React.ComponentProps<'div'> & {
  /** Traceable filename, e.g. "serum-painpoint-h02-lena-18s". */
  filenameCode: string;
  title: string;
  /** Short tags — persona name, language code, etc. */
  tags?: string[];
  status?: VariantCardStatus;
  /** e.g. "0:18". */
  duration?: string;
  /** e.g. "$2.14" or "est. $2.00". */
  cost?: string;
  /** e.g. "STD" / "PREM". @default "STD" */
  tier?: string;
  /** Where the action link points (ver / linaje / reintentar). @default "#" */
  actionHref?: string;
};

export function VariantCard({
  className,
  filenameCode,
  title,
  tags = [],
  status = 'composing',
  duration,
  cost,
  tier = 'STD',
  actionHref = '#',
  ...props
}: VariantCardProps) {
  const badge = STATUS_BADGE[status];
  return (
    <div
      data-slot="variant-card"
      className={cn(
        'w-57.5 overflow-hidden rounded-lg border bg-surface shadow-sm',
        status === 'failed' ? 'border-danger-border' : 'border-border',
        className,
      )}
      {...props}
    >
      <div className="hatch-9x16 relative flex aspect-9/16 items-center justify-center">
        {status === 'composing' ? (
          <span
            aria-hidden
            // Mirror spinner is 3px solid; the DS has no 3px border-width token and
            // TD.6 bans bracket arbitraries, so the fixed 3px goes via inline
            // borderWidth (colors stay tokenized).
            className="size-6.5 animate-spin rounded-full border-border-strong border-t-info"
            style={{ borderWidth: '3px' }}
          />
        ) : status === 'failed' ? (
          <span aria-hidden className="text-h2 text-danger">
            ⚠
          </span>
        ) : (
          <span className="font-mono text-micro text-text-3">preview 9:16</span>
        )}
        <span className="absolute left-2.5 top-2.5">
          <Badge tone={badge.tone}>
            {badge.glyph ? (
              <span aria-hidden className="leading-none">
                {badge.glyph}
              </span>
            ) : null}
            {badge.label}
          </Badge>
        </span>
        <span className="absolute right-2.5 top-2.5">
          <Badge tone="accent">{tier}</Badge>
        </span>
        {duration ? (
          <span className="absolute bottom-2.5 right-2.5 rounded-sm bg-overlay-strong px-1.75 py-0.5 font-mono text-micro text-text-on-accent">
            {duration}
          </span>
        ) : null}
      </div>
      <div className="px-3.5 py-3.25">
        <div className="mb-1.25 truncate font-mono text-micro text-text-3">{filenameCode}</div>
        <div className="mb-2 text-mono font-semibold text-text">{title}</div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Badge key={t} mono={isLanguageCode(t)}>
              {t}
            </Badge>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-border pt-2.75">
          <span className="font-mono text-micro text-text-2">{cost}</span>
          <a href={actionHref} className="text-micro text-accent">
            {ACTION[status].label} <span aria-hidden>{ACTION[status].glyph}</span>
          </a>
        </div>
      </div>
    </div>
  );
}
