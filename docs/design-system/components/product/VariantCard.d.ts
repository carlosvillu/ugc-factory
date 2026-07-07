import * as React from "react";

export interface VariantCardProps {
  /** Traceable filename, e.g. "serum-painpoint-h02-lena-18s". */
  filenameCode: string;
  title: string;
  /** Short tags — persona name, language code, etc. */
  tags?: string[];
  /** @default "composing" */
  status?: "approved" | "composing" | "failed";
  /** e.g. "0:18" */
  duration?: string;
  /** e.g. "$2.14" or "est. $2.00" */
  cost?: string;
  /** @default "STD" */
  tier?: string;
}

export function VariantCard(props: VariantCardProps): JSX.Element;
