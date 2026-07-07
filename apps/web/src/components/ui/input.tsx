import { cn } from '@/lib/utils';

// Text input — 1:1 with the DS mirror (forms/Input.jsx). `mono` sets data
// values (URLs, prices, ids) in Geist Mono per the DS copy rule; `error` paints
// the danger border + soft ring. Native <input>: label association is the
// caller's job (the field wrapper), giving the accessible name the test/CUA
// query by. Focus is the DS single ring (ring-3 ring-ring).
type InputProps = React.ComponentProps<'input'> & {
  mono?: boolean;
  error?: boolean;
};

export function Input({
  className,
  mono = false,
  error = false,
  type = 'text',
  ...props
}: InputProps) {
  return (
    <input
      data-slot="input"
      type={type}
      aria-invalid={error || undefined}
      className={cn(
        'flex h-9 w-full rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-mono text-text outline-none transition-colors',
        'placeholder:text-text-3',
        'focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-60',
        mono ? 'font-mono' : 'font-sans',
        error && 'border-danger focus-visible:border-danger focus-visible:ring-danger-border',
        className,
      )}
      {...props}
    />
  );
}
