import * as React from "react";

export interface SheetProps {
  /** Which edge the sheet is pinned to. @default "right" */
  side?: "left" | "right";
  /** @default "Detalles de la variante" */
  title?: string;
  /** @default "Guion, receta fal y coste estimado del render seleccionado." */
  description?: string;
  children?: React.ReactNode;
}

export function Sheet(props: SheetProps): JSX.Element;
