import * as React from "react";

export interface BadgeProps {
  children: React.ReactNode;
  /** @default "neutral" */
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "violet";
  /** Dashed neutral outline — used for provisional/estimated values. @default false */
  dashed?: boolean;
  /** Set Geist Mono (ids, costs, language codes). @default false */
  mono?: boolean;
  /** Prefix a small filled status dot. @default false */
  dot?: boolean;
  style?: React.CSSProperties;
}

export function Badge(props: BadgeProps): JSX.Element;
