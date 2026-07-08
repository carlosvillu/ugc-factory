import * as React from "react";

export interface TooltipProps {
  /** @default "Coste estimado del render" */
  content?: React.ReactNode;
  /** Side of the trigger the popup appears on. @default "top" */
  side?: "top" | "right" | "bottom" | "left";
  /** The trigger element / label. @default "Estimar" */
  children?: React.ReactNode;
}

export function Tooltip(props: TooltipProps): JSX.Element;
