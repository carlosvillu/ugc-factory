import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The DS defines custom font-size tokens (text-micro/mono/small/body/h1/h2/h3/
// display, mapped in globals.css @theme). Stock tailwind-merge classifies ANY
// `text-*` as the same group, so it treats `text-mono` (a font-size) and
// `text-text-on-accent` (a color) as conflicting and drops the earlier one —
// silently stripping the text color from every component that sets both (e.g.
// the primary button rendered its label in --text instead of --text-on-accent:
// near-black in light theme). Teaching twMerge that these tokens are font-sizes
// keeps color and size in separate groups so both survive.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'mono', 'small', 'body', 'h1', 'h2', 'h3', 'display'] }],
    },
  },
});

// The shadcn/ui `cn` helper: merge conditional class lists (clsx) and resolve
// Tailwind conflicts last-wins (tailwind-merge). Every component in
// components/ui/ composes its cva variants with a caller `className` through
// this, so a consumer can always override a token class without specificity
// fights.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
