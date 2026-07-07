import { cn } from '@/lib/utils';

// Multi-line text field — 1:1 with the DS mirror (forms/Textarea.jsx): same
// surface/border/radius as Input, vertical resize only, DS focus ring. Native
// <textarea>; the label association (accessible name) is the caller's job.
type TextareaProps = React.ComponentProps<'textarea'> & {
  error?: boolean;
};

export function Textarea({ className, rows = 3, error = false, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      aria-invalid={error || undefined}
      className={cn(
        'flex w-full resize-y rounded-md border border-border-2 bg-surface-2 px-3 py-2 font-sans text-mono text-text outline-none transition-colors',
        'placeholder:text-text-3',
        'focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-60',
        error && 'border-danger focus-visible:border-danger focus-visible:ring-danger-border',
        className,
      )}
      {...props}
    />
  );
}
