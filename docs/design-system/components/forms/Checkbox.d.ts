import * as React from "react";

export interface CheckboxProps {
  checked?: boolean;
  label?: React.ReactNode;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
}

export function Checkbox(props: CheckboxProps): JSX.Element;
