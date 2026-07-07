'use client';

import { Dialog as BaseDialog } from '@base-ui-components/react/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Sheet — a modal panel pinned to an edge of the viewport (a side drawer). New
// primitive for TD.4. It is a styled Base UI Dialog Popup positioned against an
// edge — NOT a separate drawer engine — so it inherits the same a11y contract
// as Dialog: role="dialog", modal behavior (background inert), focus trap, focus return, Escape to
// dismiss, aria-labelledby / aria-describedby. DS foundations: hairline 1px
// --border on the inner edge, --surface fill, --shadow-lg elevation, --overlay
// scrim, ✕ Unicode close glyph. Slides in from the chosen side; under
// prefers-reduced-motion the slide transition + translate are neutralized in
// globals.css (targeting [data-slot=sheet-popup]) so the panel just appears in
// place. The edge position comes from the viewport flex, not the transform, so
// dropping the transform keeps it pinned correctly.
//
// Composition mirrors Dialog (Trigger / Title / Description / Close reused).

export const Sheet = BaseDialog.Root;
export const SheetTrigger = BaseDialog.Trigger;
export const SheetClose = BaseDialog.Close;

export function SheetTitle({ className, ...props }: React.ComponentProps<typeof BaseDialog.Title>) {
  return (
    <BaseDialog.Title
      data-slot="sheet-title"
      className={cn('text-h3 font-semibold text-text', className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialog.Description>) {
  return (
    <BaseDialog.Description
      data-slot="sheet-description"
      className={cn('text-mono text-text-2', className)}
      {...props}
    />
  );
}

const SIDE = {
  right: {
    viewport: 'justify-end',
    popup:
      'h-full border-l data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full',
  },
  left: {
    viewport: 'justify-start',
    popup:
      'h-full border-r data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full',
  },
} as const;

type SheetPopupProps = React.ComponentProps<typeof BaseDialog.Popup> & {
  /** Which edge the sheet is pinned to. @default 'right' */
  side?: 'left' | 'right';
  hideClose?: boolean;
};

export function SheetPopup({
  className,
  children,
  side = 'right',
  hideClose = false,
  ...props
}: SheetPopupProps) {
  const s = SIDE[side];
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        data-slot="sheet-backdrop"
        className="fixed inset-0 bg-overlay transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
      />
      <BaseDialog.Viewport
        data-slot="sheet-viewport"
        className={cn('fixed inset-0 flex', s.viewport)}
      >
        <BaseDialog.Popup
          data-slot="sheet-popup"
          className={cn(
            'relative flex w-full max-w-sm flex-col gap-4 overflow-y-auto border-border bg-surface p-6 shadow-lg outline-none focus-visible:ring-3 focus-visible:ring-ring',
            'transition-transform data-[ending-style]:opacity-100 data-[starting-style]:opacity-100',
            s.popup,
            className,
          )}
          {...props}
        >
          {hideClose ? null : (
            <BaseDialog.Close
              data-slot="sheet-close"
              render={<Button icon size="sm" variant="ghost" aria-label="Cerrar" />}
              className="absolute right-3 top-3"
            >
              ✕
            </BaseDialog.Close>
          )}
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  );
}
