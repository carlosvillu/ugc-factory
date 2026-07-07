import { cn } from '@/lib/utils';

// Select — 1:1 with the DS mirror (forms/Select.jsx): a native <select> styled
// to match Input, with a plain "▼" Unicode glyph caret (no icon asset, no icon
// library) and appearance-none to drop the OS chrome.
//
// DEVIATION FROM the skill inventory (design-system.md §4 lists select on Base
// UI): the mirror spec is an explicitly native styled select, and a native
// <select> is the most faithful 1:1 match to the card AND is fully accessible
// out of the box (role="combobox", keyboard, mobile pickers) with the label
// association the caller provides. A Base UI portal listbox would diverge
// visually from the card and add positioning risk for no accessibility gain.
// Flagged in the TD.2 report per the project's contradiction rules.
type SelectProps = React.ComponentProps<'select'> & {
  error?: boolean;
};

export function Select({ className, error = false, children, ...props }: SelectProps) {
  return (
    <div data-slot="select" className="relative">
      <select
        aria-invalid={error || undefined}
        className={cn(
          'flex h-9 w-full appearance-none rounded-md border border-border-2 bg-surface-2 pl-3 pr-9 font-sans text-mono text-text outline-none transition-colors',
          'focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-60',
          error && 'border-danger focus-visible:border-danger focus-visible:ring-danger-border',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-micro text-text-3"
      >
        ▼
      </span>
    </div>
  );
}
