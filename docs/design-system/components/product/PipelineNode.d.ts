import * as React from "react";

export interface PipelineNodeProps {
  /** Node code, e.g. "N1" or "N3 · CP1". */
  code: string;
  title: string;
  /** Secondary line — source detail, or "esperando aprobación" for checkpoints. */
  meta: string;
  /** Elapsed time or "—" for not-yet-run. */
  time?: string;
  /** Cost string, e.g. "$0.01" or "est. $0". */
  cost?: string;
  /** @default "pending" */
  status?: "done" | "checkpoint" | "running" | "pending";
  /** Card width in px. @default 168 */
  width?: number;
}

export function PipelineNode(props: PipelineNodeProps): JSX.Element;
