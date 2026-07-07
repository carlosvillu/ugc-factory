'use client';

import { Switch as BaseSwitch } from '@base-ui-components/react/switch';
import { cn } from '@/lib/utils';

// Switch — 1:1 with the DS mirror (forms/Switch.jsx): a 38×22 pill track with a
// circular thumb, accent when on. Built on Base UI's Switch primitive
// (role="switch", aria-checked + keyboard wired by the primitive). #fff thumb →
// bg-text-on-accent; off thumb → bg-text-3. The caller supplies the accessible
// name via aria-label or an associated <label> (the switch has no visible text
// of its own, matching the mirror).
type SwitchProps = React.ComponentProps<typeof BaseSwitch.Root>;

export function Switch({ className, ...props }: SwitchProps) {
  return (
    <BaseSwitch.Root
      data-slot="switch"
      className={cn(
        'relative inline-flex h-5.5 w-9.5 shrink-0 items-center rounded-full border border-border-2 bg-surface-3 p-0.5 outline-none transition-colors',
        'focus-visible:ring-3 focus-visible:ring-ring',
        'data-[checked]:border-transparent data-[checked]:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        data-slot="switch-thumb"
        className={cn(
          'size-4 rounded-full bg-text-3 transition-all',
          'data-[checked]:size-4.5 data-[checked]:translate-x-4 data-[checked]:bg-text-on-accent data-[checked]:shadow-sm',
        )}
      />
    </BaseSwitch.Root>
  );
}
