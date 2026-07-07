import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// UGC Factory's single button primitive — 1:1 with the DS mirror
// (docs/design-system/components/core/Button.jsx): variants primary /
// secondary / ghost / danger / danger-ghost, sizes sm / md / lg, plus the
// `loading` and `icon` (square) modes. Only token classes: the mirror's raw
// values map to tokens (accent / surface-3 / danger-soft / text-on-accent…);
// #fff → text-text-on-accent; the focus ring is the DS single ring
// (ring-3 ring-ring). No icon library — the icon mode holds a Unicode glyph.
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 font-sans whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-3 disabled:text-text-4 disabled:border-border cursor-pointer',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-text-on-accent border border-accent font-semibold hover:bg-accent-hover hover:border-accent-hover focus-visible:border-accent-hover',
        secondary:
          'bg-surface-3 text-text border border-border-2 font-medium hover:border-border-strong focus-visible:border-accent',
        ghost:
          'bg-transparent text-text-2 border border-transparent font-medium hover:bg-surface-3 hover:text-text focus-visible:border-accent',
        danger:
          'bg-danger text-text-on-accent border border-danger font-semibold hover:opacity-90 focus-visible:ring-danger-border',
        'danger-ghost':
          'bg-danger-soft text-danger border border-danger-border font-semibold hover:bg-danger hover:text-text-on-accent focus-visible:ring-danger-border',
      },
      size: {
        sm: 'h-7 rounded-sm px-3 text-small',
        md: 'h-9 rounded-md px-4 text-mono',
        lg: 'h-11 rounded-md px-5 text-body',
      },
      icon: {
        true: 'p-0',
        false: '',
      },
    },
    compoundVariants: [
      { icon: true, size: 'sm', class: 'size-7 px-0' },
      { icon: true, size: 'md', class: 'size-8.5 px-0' },
      { icon: true, size: 'lg', class: 'size-8.5 px-0' },
    ],
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      icon: false,
    },
  },
);

type ButtonProps = Omit<React.ComponentProps<'button'>, 'color'> &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  icon,
  loading = false,
  disabled = false,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      data-slot="button"
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, icon }), className)}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current/40 border-t-current"
        />
      ) : null}
      {children}
    </button>
  );
}
