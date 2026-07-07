import * as React from "react";

export interface InputProps {
  value?: string;
  placeholder?: string;
  /** Use Geist Mono — for URLs, prices, ids. @default false */
  mono?: boolean;
  error?: boolean;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  style?: React.CSSProperties;
}

export function Input(props: InputProps): JSX.Element;
