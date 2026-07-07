import * as React from "react";

export interface AlertProps {
  /** @default "info" */
  tone?: "success" | "warning" | "danger" | "info";
  children: React.ReactNode;
}

export function Alert(props: AlertProps): JSX.Element;
