'use client';

import { Checkbox as BaseCheckbox } from '@base-ui-components/react/checkbox';
import { cn } from '@/lib/utils';

// Checkbox — 1:1 with the DS mirror (forms/Checkbox.jsx): a small filled square
// with a ✓ Unicode glyph (no native styling, no icon asset). Built on Base UI's
// Checkbox primitive (role="checkbox"); #fff → text-text-on-accent; the ✓
// indicator is aria-hidden so it never becomes the control's name.
//
// Labeling: the whole row (box + text) is rendered AS the control — a single
// nativeButton <button role="checkbox"> whose visible text ("TikTok") is its
// accessible name. This is the one structure with a single activation path: a
// pointer click anywhere on the row toggles exactly once. The alternatives all
// break here — an enclosing <label> (or Field.Label) around the interactive
// span double-fires (span toggles, then the label re-activates the hidden
// input → net no-op), and a sibling <label htmlFor> can't target the control
// because Base UI points `for` at the hidden input, not the role="checkbox"
// element. Label-less usage renders the bare box; the caller supplies
// aria-label / aria-labelledby.
type CheckboxProps = React.ComponentProps<typeof BaseCheckbox.Root> & {
  label?: React.ReactNode;
};

export function Checkbox({ className, label, disabled, ...props }: CheckboxProps) {
  const indicator = (
    <BaseCheckbox.Indicator
      data-slot="checkbox-indicator"
      aria-hidden
      className={cn(
        'flex size-4.5 shrink-0 items-center justify-center rounded-sm border border-border-2 bg-surface-2 text-micro leading-none text-text-on-accent transition-colors',
        'in-data-[checked]:border-accent in-data-[checked]:bg-accent',
      )}
    >
      ✓
    </BaseCheckbox.Indicator>
  );

  // Bare box (no label): the caller owns the accessible name.
  if (!label) {
    return (
      <BaseCheckbox.Root
        data-slot="checkbox"
        disabled={disabled}
        nativeButton
        render={<button type="button" />}
        className={cn(
          'inline-flex outline-none',
          'focus-visible:[&_[data-slot=checkbox-indicator]]:border-accent',
          'focus-visible:[&_[data-slot=checkbox-indicator]]:ring-3 focus-visible:[&_[data-slot=checkbox-indicator]]:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...props}
      >
        {indicator}
      </BaseCheckbox.Root>
    );
  }

  // Labeled: the button IS the whole row; its text is the accessible name.
  return (
    <BaseCheckbox.Root
      data-slot="checkbox"
      disabled={disabled}
      nativeButton
      render={<button type="button" />}
      className={cn(
        'inline-flex items-center gap-2 text-mono text-text-2 outline-none data-[checked]:text-text',
        'focus-visible:[&_[data-slot=checkbox-indicator]]:border-accent',
        'focus-visible:[&_[data-slot=checkbox-indicator]]:ring-3 focus-visible:[&_[data-slot=checkbox-indicator]]:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {indicator}
      {label}
    </BaseCheckbox.Root>
  );
}
