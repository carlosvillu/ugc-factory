'use client';

import { Tabs as BaseTabs } from '@base-ui-components/react/tabs';
import { cn } from '@/lib/utils';

// Tabs — 1:1 with the DS mirror (navigation/Tabs.jsx): an underline tab BAR for
// node side-panels and secondary navigation (Brief / Guiones / Assets / Logs).
// The mirror is bar-only — it renders no tabpanels (the card's body is static
// content), so this component does too. Built on Base UI's Tabs primitive
// (Root + List + Tab) purely for the ARIA tablist/tab semantics and keyboard
// navigation (←/→ move between tabs, Home/End, aria-selected on the active tab)
// — the restyle keeps that skeleton intact, only the skin changes.
//
// API kept 1:1 with the mirror `.d.ts` (tabs: string[], defaultActive, onChange
// by index): the tab index IS the Base UI value (defaultValue defaults to 0),
// and onValueChange re-emits the index as onChange. Uncontrolled by default.
//
// Only token classes. Mirror geometry: 2px gap (gap-0.5), 0/6 list padding
// (px-1.5), 1px bottom hairline (border-b border-border); each tab 12/14 padding
// (py-3 px-3.5), a 2px bottom underline (accent when active, transparent
// otherwise), 13px text (text-mono), text/weight-600 when active, text-3/
// weight-500 otherwise. Focus ring is the DS single ring.
interface TabsProps {
  tabs: string[];
  defaultActive?: number;
  onChange?: (index: number) => void;
  className?: string;
}

export function Tabs({ tabs, defaultActive = 0, onChange, className }: TabsProps) {
  return (
    <BaseTabs.Root
      data-slot="tabs"
      defaultValue={defaultActive}
      onValueChange={(value) => {
        onChange?.(value as number);
      }}
    >
      <BaseTabs.List
        data-slot="tabs-list"
        className={cn('flex gap-0.5 border-b border-border px-1.5', className)}
      >
        {tabs.map((label, index) => (
          <BaseTabs.Tab
            key={label}
            value={index}
            data-slot="tabs-tab"
            className={cn(
              'cursor-pointer border-b-2 border-transparent bg-transparent px-3.5 py-3 text-mono font-medium text-text-3 outline-none transition-colors',
              'hover:text-text-2',
              'data-[active]:border-accent data-[active]:font-semibold data-[active]:text-text',
              'focus-visible:ring-3 focus-visible:ring-ring',
            )}
          >
            {label}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
    </BaseTabs.Root>
  );
}
