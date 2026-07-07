'use client';

import { Slider as BaseSlider } from '@base-ui-components/react/slider';
import { cn } from '@/lib/utils';

// Slider — 1:1 with the DS mirror (forms/Slider.jsx): a range with an accent
// fill and an optional label row above (label left, live mono value right).
// Built on Base UI's Slider primitive (the Thumb nests a real
// <input type="range"> → role="slider", keyboard + aria wired).
//
// Accessible name: role="slider" lives on the Thumb's nested input, a
// DESCENDANT of Root — so an aria-label on Root (the group) does NOT name the
// control (ARIA name computation does not pull an ancestor's label onto a
// descendant). Both the visible `label` string and any caller-supplied
// `aria-label` are therefore forwarded to the Thumb via getAriaLabel (an
// explicit aria-label wins), and the aria-label is stripped from the Root
// props so it never lands on the group.
type SliderProps = React.ComponentProps<typeof BaseSlider.Root> & {
  label?: React.ReactNode;
};

export function Slider({ className, label, 'aria-label': ariaLabel, ...props }: SliderProps) {
  const thumbLabel = ariaLabel ?? (typeof label === 'string' ? label : undefined);
  return (
    <BaseSlider.Root
      data-slot="slider"
      className={cn('flex w-full flex-col gap-2', className)}
      {...props}
    >
      {label != null ? (
        <div className="flex items-center justify-between text-small text-text-2">
          <span>{label}</span>
          <BaseSlider.Value className="font-mono text-text" />
        </div>
      ) : null}
      <BaseSlider.Control data-slot="slider-control" className="flex h-4 w-full items-center py-2">
        <BaseSlider.Track
          data-slot="slider-track"
          className="h-1.5 w-full rounded-full bg-surface-3"
        >
          <BaseSlider.Indicator data-slot="slider-indicator" className="rounded-full bg-accent" />
          <BaseSlider.Thumb
            data-slot="slider-thumb"
            getAriaLabel={thumbLabel ? () => thumbLabel : null}
            className={cn(
              'size-4 rounded-full border border-accent bg-accent outline-none',
              'focus-visible:ring-3 focus-visible:ring-ring',
              'data-[disabled]:opacity-60',
            )}
          />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}
