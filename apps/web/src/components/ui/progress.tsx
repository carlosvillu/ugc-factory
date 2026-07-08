import { Progress as BaseProgress } from '@base-ui-components/react/progress';
import { cn } from '@/lib/utils';

// Progress — a determinate/indeterminate progress bar. New primitive for TD.4,
// following the DS foundations: a --surface-3 track with a 1px --border, an
// --accent fill, radius-full (the DS uses full radius for progress bars), no
// gradient. Built on Base UI's Progress (Root computes the percentage and wires
// role="progressbar" + aria-valuenow/min/max).
//
// The Root owns the accessibility contract; callers pass value (0..max) or null
// for indeterminate. Two visual cases, both skinned with token classes only:
//   - Determinate (value is a number): Base UI sets the Indicator's inline width
//     to the percentage, so the accent fill grows left-to-right.
//     Base UI adds data-progressing / data-complete on the parts.
//   - Indeterminate (value === null): Base UI emits NO width on the Indicator
//     (it would otherwise fill the whole track and look identical to a completed
//     bar), and marks it data-indeterminate. We select that state and render a
//     short accent segment that slides across the track via the DS keyframe
//     (--animate-progress-indeterminate), so "en curso" is clearly distinct from
//     "completado". The slide is silenced under prefers-reduced-motion (globals.css).
//
// SSR: Base UI builds aria-valuetext via Intl.NumberFormat(locale, {style:
// 'percent'}). With no locale it falls back to the runtime default, which
// differs between Node (server → "66 %", NBSP) and the browser (client →
// "66%") → a hydration mismatch that logs a console.error even in production.
// We pin a fixed locale ('en-US', deterministic and NBSP-free for percents) so
// server and client produce the identical string. A caller can still override
// it via props.
const PROGRESS_LOCALE = 'en-US';

type ProgressProps = React.ComponentProps<typeof BaseProgress.Root>;

export function Progress({ className, value, locale, ...props }: ProgressProps) {
  return (
    <BaseProgress.Root
      data-slot="progress"
      value={value}
      locale={locale ?? PROGRESS_LOCALE}
      {...props}
    >
      <BaseProgress.Track
        data-slot="progress-track"
        className={cn(
          'relative h-1.5 w-full overflow-hidden rounded-full border border-border bg-surface-3',
          className,
        )}
      >
        <BaseProgress.Indicator
          data-slot="progress-indicator"
          className={cn(
            'h-full rounded-full bg-accent transition-all',
            // Indeterminate: no width from Base UI → give the segment a fixed
            // width and slide it, so it never reads as a full/complete bar.
            'data-[indeterminate]:w-1/3 data-[indeterminate]:animate-progress-indeterminate',
          )}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
