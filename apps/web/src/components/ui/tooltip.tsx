'use client';

import { useId } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip';
import { cn } from '@/lib/utils';

// Tooltip — a small on-hover / on-focus label. New primitive for TD.4, built on
// Base UI's Tooltip: the popup appears on BOTH hover and keyboard focus and
// dismisses on Escape (the primitive owns that). This version of Base UI does
// NOT emit role="tooltip" nor wire the trigger association itself, so we do it
// explicitly: role="tooltip" + an id on the popup, and aria-describedby on the
// trigger pointing at that id — the tooltip text is then announced for the
// control by assistive tech, in hover and in keyboard focus.
// DS foundations: a solid --surface-3 fill (no glass, no blur), 1px
// --border-strong hairline, radius-md, --shadow-md elevation, small body copy.
// Short fade only; no arrow (an arrow would need arbitrary offset values the DS
// lint bans, and the DS specifies none).
//
// Provider (delay grouping) is shared: mount ONE <TooltipProvider> high in the
// tree. Each tooltip is <Tooltip content={…}><TriggerElement/></Tooltip>.

export const TooltipProvider = BaseTooltip.Provider;

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement<Record<string, unknown>>;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const popupId = useId();
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger
        data-slot="tooltip-trigger"
        aria-describedby={popupId}
        render={children}
      />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner data-slot="tooltip-positioner" side={side} sideOffset={6}>
          <BaseTooltip.Popup
            id={popupId}
            role="tooltip"
            data-slot="tooltip-popup"
            className={cn(
              'rounded-md border border-border-strong bg-surface-3 px-2.5 py-1.5 text-small text-text shadow-md',
              'transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
              className,
            )}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
