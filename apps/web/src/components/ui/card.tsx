import { cn } from '@/lib/utils';

// Card — the DS's flat, quiet container: 1px --border, radius-lg (10px, the DS
// caps cards here — never a "friendly" 16px+), --surface background, --shadow-sm
// at rest. New primitive for TD.4: the DS shows cards inline everywhere; this
// promotes the recurring pattern to a named container with optional structural
// parts. No gradient, no glass — a solid --surface fill only.
//
// Compound parts (Header / Title / Body / Footer) are thin layout slots so a
// card reads as header + body + footer with the DS's internal padding rhythm
// and a 1px --border rule between sections. Each is exercised in the showcase.

type DivProps = React.ComponentProps<'div'>;

export function Card({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col rounded-lg border border-border bg-surface shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="card-header"
      className={cn('flex flex-col gap-1 border-b border-border px-5.5 py-4.5', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="card-title"
      className={cn('text-h3 font-semibold text-text', className)}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="card-body"
      className={cn('flex flex-col gap-3 px-5.5 py-4.5', className)}
      {...props}
    />
  );
}

export function CardFooter({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center gap-2 border-t border-border px-5.5 py-4.5', className)}
      {...props}
    />
  );
}
