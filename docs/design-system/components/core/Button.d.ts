import * as React from "react";

export interface ButtonProps {
  children: React.ReactNode;
  /** Visual style. @default "primary" */
  variant?: "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";
  /** @default "md" */
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  /** Shows a spinner and keeps label (used for e.g. "Generando…"). */
  loading?: boolean;
  /** Renders as a square icon-only button sized to `size`. */
  icon?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  style?: React.CSSProperties;
}

export function Button(props: ButtonProps): JSX.Element;
