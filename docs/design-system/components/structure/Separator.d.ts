import * as React from "react";

export interface SeparatorProps {
  /** @default "horizontal" */
  orientation?: "horizontal" | "vertical";
  style?: React.CSSProperties;
}

export function Separator(props: SeparatorProps): JSX.Element;
