import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// PipelineNode — 1:1 with the DS mirror (product/PipelineNode.jsx): the visual
// card for a single step_run in the canvas (React Flow supplies the graph; this
// is the card only). Presentational PURE: flat props, NO @ugc/core domain types
// — the run-canvas feature (F0) wraps it, mapping StepRun → these props.
//
// `status` drives the left 4px accent bar (the DS "estado de un vistazo" motif,
// design-system.md §3.9), the status dot (or a spinner while running) and, for
// checkpoint/running, the pulse ring. The pulse is the `animate-pulse-ring`
// CLASS (not an inline animation) so prefers-reduced-motion silences it via
// globals.css while border + dot color keep the state visible. --pulse-color
// per status also lives in globals.css (keyed off data-status) — the raw hex the
// mirror sets inline is not allowed in a className.
//
// Mirror geometry mapped to tokens: 168px default width, radius-lg, 1px border
// (--warning when checkpoint, else --border-2), --surface fill, shadow-sm at
// rest, 72% opacity when pending, 4px accent bar, 12/13px inner padding.

type PipelineNodeStatus = 'done' | 'checkpoint' | 'running' | 'pending';

// Box-shadow per state mirrors PipelineNode.jsx exactly: done/pending rest on
// shadow-sm; checkpoint/running carry the STATIC attention halo (pulse-ring-static
// = box-shadow 0 0 0 3px <pulse>22) so the ring persists even under
// prefers-reduced-motion, with animate-pulse-ring pulsing over it when motion is
// allowed. The pulse class is NOT on the cva base: its keyframe animates
// box-shadow, so on done/pending it would override the static shadow-sm and blank
// their resting shadow. reduced-motion silences the animation (globals.css) while
// the static ring stays.
const nodeVariants = cva('flex overflow-hidden rounded-lg border bg-surface', {
  variants: {
    status: {
      done: 'border-border-2 shadow-sm',
      checkpoint: 'border-warning pulse-ring-static animate-pulse-ring',
      running: 'border-border-2 pulse-ring-static animate-pulse-ring',
      pending: 'border-border-2 opacity-72 shadow-sm',
    },
  },
  defaultVariants: { status: 'pending' },
});

// Status tint — single source of truth for both the left 4px accent bar and the
// status dot (the mirror uses the same color for both).
const statusToneClass: Record<PipelineNodeStatus, string> = {
  done: 'bg-success',
  checkpoint: 'bg-warning',
  running: 'bg-info',
  pending: 'bg-text-3',
};

type PipelineNodeProps = React.ComponentProps<'div'> &
  VariantProps<typeof nodeVariants> & {
    /** Node code, e.g. "N1" or "N3 · CP1". */
    code: string;
    title: string;
    /** Secondary line — source detail, or "esperando aprobación" for checkpoints. */
    meta: string;
    /** Elapsed time or "—" for not-yet-run. */
    time?: string;
    /** Cost string, e.g. "$0.01" or "est. $0". */
    cost?: string;
    /** Card width in px (React Flow supplies node sizing). @default 168 */
    width?: number;
  };

export function PipelineNode({
  className,
  style,
  status = 'pending',
  code,
  title,
  meta,
  time,
  cost,
  width = 168,
  ...props
}: PipelineNodeProps) {
  const s = status ?? 'pending';
  const isCheckpoint = s === 'checkpoint';
  return (
    <div
      data-slot="pipeline-node"
      data-status={s}
      className={cn(nodeVariants({ status: s }), className)}
      // Width is a runtime number (the sanctioned inline-style path, same as the
      // percentages in SpendLedger/SafeZoneOverlay); a caller style still wins.
      style={{ width, ...style }}
      {...props}
    >
      <span aria-hidden className={cn('w-1 shrink-0', statusToneClass[s])} />
      <div className="min-w-0 flex-1 px-3.25 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span
            className={cn(
              'font-mono text-micro font-semibold',
              isCheckpoint ? 'text-warning' : 'text-text-3',
            )}
          >
            {code}
          </span>
          {s === 'running' ? (
            <span
              aria-hidden
              className="inline-block size-2.75 animate-spin rounded-full border-2 border-info border-t-transparent"
            />
          ) : (
            <span aria-hidden className={cn('size-1.75 rounded-full', statusToneClass[s])} />
          )}
        </div>
        <div className="mb-0.5 text-mono font-semibold text-text">{title}</div>
        <div
          className={cn(
            'mb-2.5 text-micro',
            isCheckpoint ? 'font-medium text-warning' : 'text-text-3',
          )}
        >
          {meta}
        </div>
        <div className="flex justify-between font-mono text-micro text-text-3">
          <span>{time}</span>
          <span className="text-text-2">{cost}</span>
        </div>
      </div>
    </div>
  );
}
