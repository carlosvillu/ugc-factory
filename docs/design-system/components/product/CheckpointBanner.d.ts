import * as React from "react";

export interface CheckpointBannerProps {
  title: string;
  description: string;
  onApprove?: () => void;
  onEdit?: () => void;
  onReject?: () => void;
}

export function CheckpointBanner(props: CheckpointBannerProps): JSX.Element;
