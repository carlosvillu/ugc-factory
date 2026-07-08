import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// CheckpointBanner — 1:1 with the DS mirror (product/CheckpointBanner.jsx): the
// waiting_approval banner shown when the pipeline pauses at a checkpoint.
// Presentational PURE: flat props + plain callbacks, NO @ugc/core types — the
// checkpoint feature (F0) wires the real approve/edit/reject handlers.
//
// Composes the Button primitive (secondary Editar, danger-ghost Rechazar). The
// mirror's "Aprobar y continuar" is a success-tinted button the DS renders by
// overriding Button's colors inline; since Button has no success variant, we
// override the primary variant's accent classes with the fixed success tokens
// through cn — success is the sanctioned "confirm/continue" semantic here, not a
// re-tinted accent. The leading ◆ glyph sits in a warning-soft chip (Unicode, no
// icon lib). Mirror geometry mapped to tokens: warning-soft fill, warning-border
// 1px, radius-lg, 16/20px padding, 34px glyph chip (radius-md), 14/10px gaps.
type CheckpointBannerProps = React.ComponentProps<'div'> & {
  title: string;
  description: string;
  onApprove?: () => void;
  onEdit?: () => void;
  onReject?: () => void;
};

export function CheckpointBanner({
  className,
  title,
  description,
  onApprove,
  onEdit,
  onReject,
  ...props
}: CheckpointBannerProps) {
  return (
    <div
      data-slot="checkpoint-banner"
      className={cn(
        'flex flex-wrap items-center justify-between gap-4 rounded-lg border border-warning-border bg-warning-soft px-5 py-4',
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden
          className="flex size-8.5 shrink-0 items-center justify-center rounded-md border border-warning-border bg-warning-soft text-body text-warning"
        >
          ◆
        </span>
        <div>
          <div className="text-mono font-semibold text-text">{title}</div>
          <div className="text-small text-text-2">{description}</div>
        </div>
      </div>
      <div className="flex gap-2.5">
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Editar
        </Button>
        <Button variant="danger-ghost" size="sm" onClick={onReject}>
          Rechazar
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onApprove}
          className="border-success bg-success text-success-on hover:border-success hover:bg-success focus-visible:border-success"
        >
          Aprobar y continuar
        </Button>
      </div>
    </div>
  );
}
