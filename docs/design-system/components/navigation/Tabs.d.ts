import * as React from "react";

export interface TabsProps {
  tabs: string[];
  defaultActive?: number;
  onChange?: (index: number) => void;
}

export function Tabs(props: TabsProps): JSX.Element;
