import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// The shadcn/ui `cn` helper: merge conditional class lists (clsx) and resolve
// Tailwind conflicts last-wins (tailwind-merge). Every component in
// components/ui/ composes its cva variants with a caller `className` through
// this, so a consumer can always override a token class without specificity
// fights.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
