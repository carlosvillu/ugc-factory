import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Badge — 1:1 with the DS mirror (feedback/Badge.jsx): a pill tag for status,
// tier and traceability ("extraído"/"inferido"), the system's main small-data
// unit. Only token classes: the mirror's per-tone soft/border/fg map to the
// fixed semantic tokens (success/warning/danger/info/violet) plus neutral
// (surface-3/text-2/border-2) and accent (accent-soft/accent/accent-border).
//
// `dashed` renders a dashed neutral outline over transparent (provisional /
// estimated values awaiting a real one — never "disabled"). `mono` sets Geist
// Mono (ids, costs, language codes). `dot` prefixes a small filled status dot
// tinted with the tone's foreground. Mirror geometry: 3px/10px padding
// (py-0.75 px-2.5), 5px gap (gap-1.25), 11px text (text-micro), full radius,
// weight 600, no wrap. The dot is aria-hidden decoration.
const badgeVariants = cva(
  'inline-flex items-center gap-1.25 whitespace-nowrap rounded-full border px-2.5 py-0.75 text-micro font-semibold',
  {
    variants: {
      tone: {
        neutral: 'border-border-2 bg-surface-3 text-text-2',
        accent: 'border-accent-border bg-accent-soft text-accent',
        success: 'border-success-border bg-success-soft text-success',
        warning: 'border-warning-border bg-warning-soft text-warning',
        danger: 'border-danger-border bg-danger-soft text-danger',
        info: 'border-info-border bg-info-soft text-info',
        violet: 'border-violet-border bg-violet-soft text-violet',
      },
      dashed: {
        // Provisional/estimated: dashed neutral outline over transparent, muted text.
        true: 'border-dashed border-border-strong bg-transparent text-text-3',
        false: '',
      },
      mono: {
        true: 'font-mono',
        false: 'font-sans',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      dashed: false,
      mono: false,
    },
  },
);

// The dot inherits the tone's foreground via currentColor.
const dotToneClass = {
  neutral: 'bg-text-2',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  violet: 'bg-violet',
} as const;

type BadgeProps = Omit<React.ComponentProps<'span'>, 'color'> &
  VariantProps<typeof badgeVariants> & {
    dot?: boolean;
  };

export function Badge({
  className,
  tone = 'neutral',
  dashed = false,
  mono = false,
  dot = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ tone, dashed, mono }), className)}
      {...props}
    >
      {dot ? (
        <span
          aria-hidden
          className={cn('size-1.5 shrink-0 rounded-full', dotToneClass[tone ?? 'neutral'])}
        />
      ) : null}
      {children}
    </span>
  );
}
