'use client';

// La GALERÍA de templates: el rail de facetas + la rejilla de tarjetas del mockup 5a + la ficha
// (diálogo) con su editor. El mockup 5a dibuja la lista y el rail; la ficha/editor se construyen
// sobrios con primitivas del DS (skill frontend §1: usar el componente del DS es OBLIGATORIO).
//
// ESTADO: `useState` del cliente, NO Zustand. La regla de la skill (principio 5) reserva el store
// para el estado EN VIVO (SSE). Aquí no hay nada vivo: la galería se lee una vez y se muta por
// REST. Un store sería ceremonia sin cliente.
//
// FILTROS: el rail son BOTONES reales (no spans clicables): un filtro clicable que fuera un span
// rompe la a11y (principio 4: los tests consultan por rol) y el ds-reviewer. `aria-pressed` marca
// el estado activo. Cada cambio de filtro re-pide la lista al servidor (la búsqueda facetada la
// sirve el GIN de T3.1; no se filtra en el cliente — sería reimplementar la regla).
import { useState } from 'react';
import type {
  FacetCount,
  PromptStatus,
  TemplateEditResult,
  TemplateFilterQuery,
  TemplateList,
  TemplateSummary,
} from '@ugc/core/gallery';
import { templateActions } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { TemplateCard } from '@/components/gallery/template-card';
import { TemplateDetail } from '@/components/gallery/template-detail';
import { NewTemplateForm } from '@/components/gallery/new-template-form';

interface GalleryBrowserProps {
  /** La primera página facetada que el RSC leyó. El cliente la posee a partir de aquí. */
  initial: TemplateList;
}

/** Las facetas del rail, EXACTAMENTE las del mockup 5a: Formato · Ángulo de hook · Vertical (+
 *  Estado, que va aparte por ser single-select). El mockup NO dibuja Estética ni Plataforma en el
 *  rail, así que no se añaden aquí (el ds-reviewer rechaza desviarse del mockup): siguen siendo
 *  facetas del modelo (filtrables por querystring), pero no forman parte de la navegación visual. */
const FACET_RAIL = [
  { key: 'formats', label: 'Formato' },
  { key: 'hookAngles', label: 'Ángulo de hook' },
  { key: 'verticals', label: 'Vertical' },
] as const;

type FacetKey = (typeof FACET_RAIL)[number]['key'];

type DialogState = { kind: 'none' } | { kind: 'detail'; id: string } | { kind: 'create' };

export function GalleryBrowser({ initial }: GalleryBrowserProps) {
  const [data, setData] = useState<TemplateList>(initial);
  const [filter, setFilter] = useState<TemplateFilterQuery>({});
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [loading, setLoading] = useState(false);

  /** Re-pide la lista al servidor con el filtro dado y la aplica. */
  async function applyFilter(next: TemplateFilterQuery): Promise<void> {
    setFilter(next);
    setLoading(true);
    try {
      const fresh = await templateActions.list(next);
      setData(fresh);
    } finally {
      setLoading(false);
    }
  }

  /** Alterna un valor de faceta en el filtro (multi-select por faceta) y re-pide. */
  function toggleFacet(facet: FacetKey, value: string): void {
    const current = filter[facet] ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    void applyFilter({ ...filter, [facet]: next.length > 0 ? next : undefined });
  }

  /** Alterna el filtro de estado (single-select). */
  function toggleStatus(status: PromptStatus): void {
    void applyFilter({ ...filter, status: filter.status === status ? undefined : status });
  }

  /** Tras crear un template, refresca la lista y abre su ficha. */
  async function onCreated(summary: TemplateSummary): Promise<void> {
    setDialog({ kind: 'detail', id: summary.id });
    await applyFilter(filter);
  }

  /** Tras guardar una edición (v2), refresca la lista (el usage/headVersion pueden cambiar). */
  function onEdited(_result: TemplateEditResult): void {
    void applyFilter(filter);
  }

  const isActive = (facet: FacetKey, value: string): boolean =>
    (filter[facet] ?? []).includes(value);

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      {/* ── Rail de facetas (mockup 5a, izquierda) ── */}
      <aside aria-label="Facetas" className="flex w-full shrink-0 flex-col gap-4 md:w-52">
        <p className="font-mono text-micro font-semibold tracking-widest text-text-3">FACETAS</p>
        {FACET_RAIL.map(({ key, label }) => (
          <FacetGroup
            key={key}
            label={label}
            counts={data.facets[key]}
            isActive={(v) => isActive(key, v)}
            onToggle={(v) => {
              toggleFacet(key, v);
            }}
          />
        ))}
        <FacetGroup
          label="Estado"
          counts={data.statusCounts}
          isActive={(v) => filter.status === v}
          onToggle={(v) => {
            toggleStatus(v as PromptStatus);
          }}
        />
      </aside>

      {/* ── Rejilla de tarjetas (mockup 5a, derecha) ── */}
      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-h3 font-semibold text-text">
            Templates{' '}
            <span className="font-mono text-body-sm font-normal text-text-3">
              · {String(data.total)} {data.total === 1 ? 'resultado' : 'resultados'}
            </span>
          </h2>
          <Button
            size="sm"
            onClick={() => {
              setDialog({ kind: 'create' });
            }}
          >
            + Nuevo template
          </Button>
        </div>

        {data.templates.length === 0 ? (
          <EmptyState
            title="Ningún template con estos filtros"
            description="Ajusta o limpia las facetas del rail, o crea un template nuevo."
          />
        ) : (
          <div
            aria-busy={loading}
            className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3"
          >
            {data.templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onOpen={() => {
                  setDialog({ kind: 'detail', id: t.id });
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Ficha (diálogo) ── */}
      <Dialog
        open={dialog.kind === 'detail'}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: 'none' });
        }}
      >
        <DialogPopup className="max-w-3xl">
          <DialogTitle>Ficha del template</DialogTitle>
          {dialog.kind === 'detail' ? (
            <TemplateDetail
              key={dialog.id}
              templateId={dialog.id}
              onEdited={onEdited}
              onStatusChanged={() => {
                void applyFilter(filter);
              }}
            />
          ) : null}
        </DialogPopup>
      </Dialog>

      {/* ── Nuevo template (diálogo) ── */}
      <Dialog
        open={dialog.kind === 'create'}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: 'none' });
        }}
      >
        <DialogPopup className="max-w-2xl">
          <DialogTitle>Nuevo template</DialogTitle>
          <NewTemplateForm
            onCreated={(s) => {
              void onCreated(s);
            }}
          />
        </DialogPopup>
      </Dialog>
    </div>
  );
}

/** Un grupo de facetas del rail: la etiqueta + los chips-botón con su conteo. */
function FacetGroup({
  label,
  counts,
  isActive,
  onToggle,
}: {
  label: string;
  counts: FacetCount[];
  isActive: (value: string) => boolean;
  onToggle: (value: string) => void;
}) {
  if (counts.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body-sm font-medium text-text-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {counts.map((c) => {
          const active = isActive(c.value);
          return (
            <Button
              key={c.value}
              variant={active ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={active}
              onClick={() => {
                onToggle(c.value);
              }}
            >
              <span>{c.value}</span>
              <Badge tone="neutral" mono className="ml-1.5">
                {String(c.count)}
              </Badge>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
