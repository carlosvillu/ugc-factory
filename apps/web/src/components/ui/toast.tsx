'use client';

import { Toast as BaseToast } from '@base-ui-components/react/toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Toast — transient, non-blocking status messages. New primitive for TD.4,
// built on Base UI's Toast. The Provider owns the aria-live region (priority
// 'low' → polite, 'high' → assertive); the a11y contract is the primitive's.
// DS foundations: a solid --surface fill (no glass), hairline --border,
// radius-lg, --shadow-lg elevation, a semantic left accent bar per tone (the
// DS's "status at a glance" 4px bar), a colored Unicode glyph, ✕ close glyph —
// no icon library, no gradient.
//
// Usage: mount ONE <ToastProvider> high in the tree, then call
//   const { add } = useToast();
//   add({ title: 'Lote publicado', description: '…', type: 'success' });
// `type` selects the tone (success/warning/danger/info); default is neutral.
//
// NOTE (upstream, dev-only): Base UI's ToastRoot measures its height in a layout
// effect via ReactDOM.flushSync (for the stacking offset). React emits a
// dev-only "flushSync was called from inside a lifecycle method" warning on
// every toast mount (2× under StrictMode). It is stripped from production
// builds (verified: 0 console errors in `next start`) and is not fixable from
// app code — it lives entirely inside the primitive's effect. Tracked as
// upstream debt; do NOT drop BaseToast.Root to hide it (that loses timeout
// dismissal, close wiring and Title/Description aria).
export const useToast = BaseToast.useToastManager;

const TONE: Record<string, { bar: string; glyph: string; glyphClass: string }> = {
  success: { bar: 'bg-success', glyph: '✓', glyphClass: 'text-success' },
  warning: { bar: 'bg-warning', glyph: '⚠', glyphClass: 'text-warning' },
  danger: { bar: 'bg-danger', glyph: '✕', glyphClass: 'text-danger' },
  info: { bar: 'bg-info', glyph: 'i', glyphClass: 'text-info' },
};

function ToastList() {
  const { toasts } = useToast();
  return toasts.map((toast) => {
    const tone = toast.type ? TONE[toast.type] : undefined;
    return (
      <BaseToast.Root
        key={toast.id}
        toast={toast}
        data-slot="toast"
        className={cn(
          'relative flex w-full items-start gap-2.5 overflow-hidden rounded-lg border border-border bg-surface py-3.5 pr-3.5 pl-4 shadow-lg',
          'transition-all data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
        )}
      >
        {/* 4px left accent bar — the DS's "status at a glance" motif, rendered
            as a real element rather than a ::before pseudo (which would force an
            arbitrary-bracket content utility that TD.6 vetoes). */}
        <span
          aria-hidden
          data-slot="toast-bar"
          className={cn('absolute inset-y-0 left-0 w-1', tone ? tone.bar : 'bg-border-strong')}
        />
        {tone ? (
          <span aria-hidden className={cn('shrink-0 text-body leading-none', tone.glyphClass)}>
            {tone.glyph}
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <BaseToast.Title data-slot="toast-title" className="text-mono font-semibold text-text" />
          <BaseToast.Description data-slot="toast-description" className="text-small text-text-2" />
        </div>
        <BaseToast.Close
          data-slot="toast-close"
          render={<Button icon size="sm" variant="ghost" aria-label="Descartar" />}
          className="-mt-1 -mr-1 shrink-0"
        >
          ✕
        </BaseToast.Close>
      </BaseToast.Root>
    );
  });
}

interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  return (
    <BaseToast.Provider>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport
          data-slot="toast-viewport"
          className="fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2.5 outline-none"
        >
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}
