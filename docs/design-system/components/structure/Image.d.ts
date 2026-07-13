import * as React from "react";

export interface ImageProps {
  /** Image URL. Omit to render the hatch placeholder only. */
  src?: string;
  /** Alt text — pass a real description for meaningful images. */
  alt?: string;
  /** Lock the frame's aspect ratio before load, e.g. "9/16", "1/1", "16/9". */
  ratio?: string;
  /** Corner radius token. Default "lg". */
  radius?: "none" | "sm" | "md" | "lg" | "xl" | "full";
  /** object-fit for the loaded image. Default "cover". */
  fit?: "cover" | "contain" | "fill" | "none" | "scale-down";
  /** Draw the 1px --border frame. Default true. */
  bordered?: boolean;
  /** Mono label shown in the placeholder before load. Default "imagen". */
  placeholder?: string;
  /** Size the frame via width / height (or let ratio + a fixed width drive it). */
  style?: React.CSSProperties;
  className?: string;
}

export function Image(props: ImageProps): JSX.Element;
