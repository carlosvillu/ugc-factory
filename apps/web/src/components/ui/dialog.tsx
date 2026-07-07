'use client';

import { Dialog as BaseDialog } from '@base-ui-components/react/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Dialog — a modal overlay panel. New primitive for TD.4, built following the
// DS foundations (hairline 1px --border, radius-lg card, --surface fill,
// --shadow-lg elevation, --overlay scrim, ✕ Unicode close glyph — no icon
// library). Built on Base UI's Dialog primitive, which owns the whole a11y
// contract: role="dialog", modal behavior (background made inert — Base UI uses
// `inert` rather than an aria-modal attribute), focus trap, initial focus in / focus
// return to trigger on close, Escape to dismiss, and aria-labelledby /
// aria-describedby wired from Title / Description. The restyle only skins the
// parts; the skeleton is intact.
//
// Composition mirrors Base UI's parts so callers stay flexible:
//   <Dialog>
//     <DialogTrigger render={<Button>…</Button>} />
//     <DialogPopup>
//       <DialogTitle>…</DialogTitle>
//       <DialogDescription>…</DialogDescription>
//       …
//       <DialogClose render={<Button variant="ghost">Cerrar</Button>} />
//     </DialogPopup>
//   </Dialog>
// DialogPopup bundles Portal + Backdrop + Viewport + Popup + a ✕ close so the
// common case is one element; power users can still reach the raw parts.

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialog.Title>) {
  return (
    <BaseDialog.Title
      data-slot="dialog-title"
      className={cn('text-h3 font-semibold text-text', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialog.Description>) {
  return (
    <BaseDialog.Description
      data-slot="dialog-description"
      className={cn('text-mono text-text-2', className)}
      {...props}
    />
  );
}

// The dialog footer: right-aligned action row separated by a hairline rule.
export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'mt-1 flex items-center justify-end gap-2 border-t border-border pt-4',
        className,
      )}
      {...props}
    />
  );
}

type DialogPopupProps = React.ComponentProps<typeof BaseDialog.Popup> & {
  /** Hide the top-right ✕ close affordance (e.g. when the footer owns dismissal). */
  hideClose?: boolean;
};

export function DialogPopup({
  className,
  children,
  hideClose = false,
  ...props
}: DialogPopupProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        data-slot="dialog-backdrop"
        className="fixed inset-0 bg-overlay transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
      />
      <BaseDialog.Viewport
        data-slot="dialog-viewport"
        className="fixed inset-0 flex items-center justify-center overflow-y-auto p-6"
      >
        <BaseDialog.Popup
          data-slot="dialog-popup"
          className={cn(
            'relative flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-surface p-6 shadow-lg outline-none focus-visible:ring-3 focus-visible:ring-ring',
            'transition-all data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {hideClose ? null : (
            <BaseDialog.Close
              data-slot="dialog-close"
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
