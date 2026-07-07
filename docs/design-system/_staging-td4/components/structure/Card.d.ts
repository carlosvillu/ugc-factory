import * as React from "react";

export interface CardProps {
  /** Header title. @default "Variante 3 · Hook directo" */
  title?: string;
  /** Body content. */
  children?: React.ReactNode;
  /** Optional footer content; when set, a footer section with a 1px rule renders. */
  footer?: React.ReactNode;
}

export function Card(props: CardProps): JSX.Element;
