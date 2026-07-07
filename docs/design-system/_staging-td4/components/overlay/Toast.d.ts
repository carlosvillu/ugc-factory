import * as React from "react";

export interface ToastProps {
  /** Semantic tone — sets the left accent bar and glyph. @default "info" */
  tone?: "success" | "warning" | "danger" | "info";
  /** @default "Notificación" */
  title?: string;
  description?: string;
}

export function Toast(props: ToastProps): JSX.Element;
