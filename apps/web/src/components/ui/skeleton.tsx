import { cn } from '@/lib/utils';

// Skeleton — a quiet loading placeholder block. New primitive for TD.4,
// following the DS foundations: a flat --surface-3 fill (no gradient, no
// shimmer sweep — the DS bans gradients and decorative animation), radius-sm by
// default, softened with the DS pulse cadence via a low-opacity pulse. The
// pulse reuses the reduced-motion contract already wired in globals.css.
// Presentational only: aria-hidden, because the surrounding region should own
// the aria-busy/role="status" for assistive tech, not each block.
type SkeletonProps = React.ComponentProps<'div'>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('animate-skeleton rounded-sm bg-surface-3', className)}
      {...props}
    />
  );
}
