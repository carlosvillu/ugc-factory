'use client';

import { AlertDialog as BaseAlertDialog } from '@base-ui-components/react/alert-dialog';
import { cn } from '@/lib/utils';

// AlertDialog — a modal that demands an explicit decision (destructive confirms
// like "Cancelar lote", "Rechazar variante"). New primitive for TD.4, built on
// Base UI's AlertDialog: same parts as Dialog but role="alertdialog", forced
// modal, and NON-dismissible by outside click (only an action button or Escape
// closes it — a mis-click must not confirm a destructive op). It owns the a11y
// contract (focus trap, focus return, aria-labelledby / aria-describedby).
// DS foundations: hairline --border, radius-lg, --surface fill, --shadow-lg,
// --overlay scrim. NO ✕ affordance — the footer actions are the only exits, so
// the choice is deliberate.
//
// Callers compose the footer with the DS Button (a danger action + a secondary
// cancel), wrapping each in AlertDialogClose so it both acts and dismisses.

export const AlertDialog = BaseAlertDialog.Root;
export const AlertDialogTrigger = BaseAlertDialog.Trigger;
export const AlertDialogClose = BaseAlertDialog.Close;

export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof BaseAlertDialog.Title>) {
  return (
    <BaseAlertDialog.Title
      data-slot="alert-dialog-title"
      className={cn('text-h3 font-semibold text-text', className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof BaseAlertDialog.Description>) {
  return (
    <BaseAlertDialog.Description
      data-slot="alert-dialog-description"
      className={cn('text-mono text-text-2', className)}
      {...props}
    />
  );
}

export function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        'mt-1 flex items-center justify-end gap-2 border-t border-border pt-4',
        className,
      )}
      {...props}
    />
  );
}

export function AlertDialogPopup({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseAlertDialog.Popup>) {
  return (
    <BaseAlertDialog.Portal>
      <BaseAlertDialog.Backdrop
        data-slot="alert-dialog-backdrop"
        className="fixed inset-0 bg-overlay transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
      />
      <BaseAlertDialog.Viewport
        data-slot="alert-dialog-viewport"
        className="fixed inset-0 flex items-center justify-center overflow-y-auto p-6"
      >
        <BaseAlertDialog.Popup
          data-slot="alert-dialog-popup"
          className={cn(
            'relative flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-surface p-6 shadow-lg outline-none focus-visible:ring-3 focus-visible:ring-ring',
            'transition-all data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Viewport>
    </BaseAlertDialog.Portal>
  );
}
