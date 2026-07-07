import * as React from "react";

export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Label shown above the track with the live numeric value at right, in mono. */
  label?: string;
  onChange?: (value: number) => void;
}

export function Slider(props: SliderProps): JSX.Element;
