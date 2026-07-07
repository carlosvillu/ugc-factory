import * as React from "react";

export interface TextareaProps {
  value?: string;
  defaultValue?: string;
  rows?: number;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  style?: React.CSSProperties;
}

export function Textarea(props: TextareaProps): JSX.Element;
