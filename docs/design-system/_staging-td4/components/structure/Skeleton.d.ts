import * as React from "react";

export interface SkeletonProps {
  /** Set the block size via width / height. */
  style?: React.CSSProperties;
  className?: string;
}

export function Skeleton(props: SkeletonProps): JSX.Element;
