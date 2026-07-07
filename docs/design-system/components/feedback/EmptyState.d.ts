import * as React from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState(props: EmptyStateProps): JSX.Element;
