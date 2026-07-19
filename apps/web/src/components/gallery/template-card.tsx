'use client';

// La tarjeta de un template en la rejilla (mockup 5a): thumbnail-placeholder (hatch) + título +
// slug@versión + chips de facetas + uso + estado. La tarjeta ENTERA es un botón (abre la ficha):
// un `<Card>` no es clicable por sí mismo, así que se envuelve en un botón accesible con el
// título como accessible name — el e2e lo abre con `getByRole('button', {name})`.
import type { TemplateSummary } from '@ugc/core/gallery';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Image } from '@/components/ui/image';
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
  const hasThumbnail = template.thumbnailAssetId != null && template.thumbnailAssetId !== '';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      aria-label={`Abrir template ${template.title}`}
    >
      <Card className={isDraft ? 'opacity-80' : undefined}>
        {/* Thumbnail: la MINIATURA-IMAGEN real generada por T4.12 (fal), servida por
            `GET /api/assets/:id/download`. La primitiva `Image` del DS (no un `<img>` crudo:
            política frontend §1) la pinta con su máquina de estados. El estado SIN thumbnail (draft
            sin generar) NO se pinta a mano: se pasa `src={undefined}`, con lo que `Image` entra en
            su estado `empty` y pinta su propio hatch-placeholder del DS con el `placeholder` label
            — el mismo hatch que un div bespoke, pero de la primitiva que lo posee. El wrapper
            conserva la geometría de la tarjeta (`aspect-16/10`, esquinas superiores redondeadas, sin
            borde interno); por eso `Image` va con `radius="none"` y `bordered={false}`. */}
        <div className="aspect-16/10 overflow-hidden rounded-t-lg">
          <Image
            src={
              hasThumbnail ? `/api/assets/${String(template.thumbnailAssetId)}/download` : undefined
            }
            alt={hasThumbnail ? `Miniatura de ${template.title}` : ''}
            placeholder={isDraft ? 'sin thumbnail' : 'thumbnail'}
            ratio="16/10"
            radius="none"
            bordered={false}
            className="size-full"
          />
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
