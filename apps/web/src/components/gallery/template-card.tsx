'use client';

// La tarjeta de un template en la rejilla (mockup 5a): thumbnail-placeholder (hatch) + título +
// slug@versión + chips de facetas + uso + estado. La tarjeta ENTERA es un botón (abre la ficha):
// un `<Card>` no es clicable por sí mismo, así que se envuelve en un botón accesible con el
// título como accessible name — el e2e lo abre con `getByRole('button', {name})`.
import type { TemplateSummary } from '@ugc/core/gallery';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { statusBadgeTone, statusLabel } from '@/components/gallery/status-badge';

interface TemplateCardProps {
  template: TemplateSummary;
  onOpen: () => void;
}

export function TemplateCard({ template, onOpen }: TemplateCardProps) {
  const version = Math.max(template.headVersion, 1);
  const facetChips = [...template.verticals, ...template.hookAngles, ...template.formats].slice(
    0,
    3,
  );
  const isDraft = template.status === 'draft';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      aria-label={`Abrir template ${template.title}`}
    >
      <Card className={isDraft ? 'opacity-80' : undefined}>
        {/* Thumbnail placeholder: el hatch del DS (design-system.md §3.8). El thumbnail REAL lo
            genera T4.12 (fal); en T3.8 es un placeholder que dice si falta. */}
        <div
          className="hatch flex aspect-16/10 items-center justify-center rounded-t-lg font-mono text-micro text-text-3"
          aria-hidden
        >
          {isDraft ? 'sin thumbnail' : 'thumbnail'}
        </div>
        <div className="flex flex-col gap-2.5 px-3.5 py-3">
          <div className="flex items-start justify-between gap-2">
            <span className="text-body-sm font-semibold text-text">{template.title}</span>
            <Badge tone={statusBadgeTone(template.status)}>{statusLabel(template.status)}</Badge>
          </div>
          <p className="font-mono text-micro text-text-3">
            {template.slug}@{String(version)} · {template.kind}
          </p>
          {facetChips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {facetChips.map((chip) => (
                <Badge key={chip} tone="neutral">
                  {chip}
                </Badge>
              ))}
            </div>
          ) : null}
          <div className="flex items-center justify-between border-t border-border pt-2.5 text-micro text-text-3">
            <span>
              {template.status === 'draft'
                ? 'borrador · sin publicar'
                : `usado ${String(template.usageCount)}×`}
            </span>
            <span aria-hidden className="text-accent">
              abrir →
            </span>
          </div>
        </div>
      </Card>
    </button>
  );
}
