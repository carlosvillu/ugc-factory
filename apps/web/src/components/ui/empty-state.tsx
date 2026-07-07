import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// EmptyState — 1:1 with the DS mirror (feedback/EmptyState.jsx): a dashed-border
// placeholder for empty lists ("Aún no hay lotes" in /library, /gallery,
// /personas), composing the Button primitive for the primary action. Only token
// classes. Mirror geometry: dashed border-strong, radius-lg, bg-surface, 32/20
// padding (py-8 px-5), 12px gap (gap-3); the "+" chip is 44px (size-11),
// radius-lg, surface-3, border-2, text-3, 20px glyph (text-h2 — nearest named
// token; the DS has no 20px step and TD.6 bans arbitraries). Title 14px
// (text-body) weight 600; description 12px (text-small) text-3, max 240px
// (max-w-60). Action button gets a 4px top margin (mt-1).
//
// A11y: the "+" chip is aria-hidden decoration; the title is a heading so the
// empty state is locatable by name. The action is a real <button> (Button
// primitive) — keyboard/role for free.
interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface px-5 py-8 text-center',
        className,
      )}
    >
      <span
        aria-hidden
        className="flex size-11 items-center justify-center rounded-lg border border-border-2 bg-surface-3 text-h2 text-text-3"
      >
        +
      </span>
      <div>
        <h3 className="mb-0.75 text-body font-semibold text-text">{title}</h3>
        {description ? <p className="max-w-60 text-small text-text-3">{description}</p> : null}
      </div>
      {actionLabel ? (
        <Button variant="primary" className="mt-1" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
