import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Alert — 1:1 with the DS mirror (feedback/Alert.jsx): an inline status banner,
// a colored Unicode glyph (✓ ⚠ ✕ i — never an icon asset) plus one line of
// specific, actionable copy on a soft-tinted card. Only token classes: the
// mirror's per-tone soft/border/fg map to the fixed semantic tokens; body text
// is text (not the tone). Mirror geometry: 11px gap (gap-2.75), 13/16 padding
// (py-3.25 px-4), radius-md, 13px copy (text-mono), 15px glyph (text-body — the
// nearest named token; the DS has no 15px step and TD.6 bans arbitraries, same
// snap button.tsx `lg` uses for its 15px).
//
// A11y: the glyph is aria-hidden decoration (the tone is conveyed by copy, not
// by the symbol's name). role follows urgency (skill frontend §5): danger is a
// block/error → role="alert" (assertive); success/warning/info are non-urgent
// feedback → role="status" (polite).
const alertVariants = cva(
  'flex items-center gap-2.75 rounded-md border px-4 py-3.25 text-mono text-text',
  {
    variants: {
      tone: {
        success: 'border-success-border bg-success-soft',
        warning: 'border-warning-border bg-warning-soft',
        danger: 'border-danger-border bg-danger-soft',
        info: 'border-info-border bg-info-soft',
      },
    },
    defaultVariants: {
      tone: 'info',
    },
  },
);

const GLYPH = {
  success: '✓',
  warning: '⚠',
  danger: '✕',
  info: 'i',
} as const;

const glyphToneClass = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
} as const;

type AlertProps = React.ComponentProps<'div'> & VariantProps<typeof alertVariants>;

export function Alert({ className, tone = 'info', children, ...props }: AlertProps) {
  const t = tone ?? 'info';
  return (
    <div
      data-slot="alert"
      role={t === 'danger' ? 'alert' : 'status'}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      <span aria-hidden className={cn('shrink-0 text-body leading-none', glyphToneClass[t])}>
        {GLYPH[t]}
      </span>
      <span>{children}</span>
    </div>
  );
}
