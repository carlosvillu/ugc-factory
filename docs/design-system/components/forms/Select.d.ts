import * as React from "react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value?: string;
  /** Array of strings or `{value, label}` objects. */
  options: Array<string | SelectOption>;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export function Select(props: SelectProps): JSX.Element;
