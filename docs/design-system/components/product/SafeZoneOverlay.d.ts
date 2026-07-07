import * as React from "react";

export interface SafeZoneOverlayProps {
  /** @default "universal" */
  preset?: "universal" | "tiktok" | "meta" | "off";
  /** Preview width in px (aspect-ratio 9:16 drives height). @default 236 */
  width?: number;
}

export function SafeZoneOverlay(props: SafeZoneOverlayProps): JSX.Element;
