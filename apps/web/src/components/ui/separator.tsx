import { Separator as BaseSeparator } from '@base-ui-components/react/separator';
import { cn } from '@/lib/utils';

// Separator — a 1px hairline rule that divides content, following the DS
// foundation "1px hairlines everywhere" (--border for structure). New primitive
// for TD.4: the DS uses bare border rules inline; this promotes it to a named,
// accessible divider. Built on Base UI's Separator (renders role="separator"
// with the correct aria-orientation). Only the --border token; no thickness
// beyond 1px (hairline rule of the DS).
type SeparatorProps = React.ComponentProps<typeof BaseSeparator> & {
  orientation?: 'horizontal' | 'vertical';
};

export function Separator({ className, orientation = 'horizontal', ...props }: SeparatorProps) {
  return (
    <BaseSeparator
      data-slot="separator"
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}
