// La vista de proyecto `/projects/[id]` (T5.10, §8.1: briefs, lotes, variantes y
// métricas). Server component PURO: recibe el `ProjectDetail` ya calculado por el RSC de
// la página y lo pinta con primitivas del DS. Todo dato es real (derivado del estado); no
// hay mockup específico para esta página — se construye sobria y sin inventar tokens.
import type { ProjectDetail } from '@ugc/core/contracts';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatCost } from '@/lib/money';
import { tierLabel } from '@/lib/dashboard';
import { BatchProgress } from '@/components/dashboard/batch-progress';

type BadgeTone = 'info' | 'warning' | 'success' | 'danger' | 'neutral';

const BATCH_STATUS: Record<
  ProjectDetail['batches'][number]['status'],
  { label: string; tone: BadgeTone }
> = {
  planned: { label: 'planificado', tone: 'warning' },
  running: { label: 'generando', tone: 'info' },
  completed: { label: 'completado', tone: 'success' },
  cancelled: { label: 'cancelado', tone: 'neutral' },
};

// Estado INDIVIDUAL de cada variante (§8.1). Etiquetas en femenino y DISTINTAS de las de
// BATCH_STATUS y de los briefs (aprobado/borrador) a propósito: la vista pinta lote y variante
// en la misma página, así que «aprobada» (variante) no debe colisionar con «aprobado» (brief)
// ni «en generación» (variante) con «generando» (lote) — si colisionaran, un assert por texto
// podría pasar leyendo la etiqueta equivocada.
const VARIANT_STATUS: Record<
  ProjectDetail['variants'][number]['status'],
  { label: string; tone: BadgeTone }
> = {
  planned: { label: 'planificada', tone: 'neutral' },
  scripting: { label: 'guionizando', tone: 'info' },
  scripted: { label: 'guionizada', tone: 'info' },
  generating: { label: 'en generación', tone: 'info' },
  composing: { label: 'componiendo', tone: 'info' },
  qa: { label: 'en QA', tone: 'warning' },
  approved: { label: 'aprobada', tone: 'success' },
  rejected: { label: 'rechazada', tone: 'danger' },
  published: { label: 'publicada', tone: 'success' },
};

export function ProjectDetailView({ detail }: { detail: ProjectDetail }) {
  const { project, briefs, batches, variants, metrics } = detail;

  return (
    <main className="mx-auto flex max-w-(--content-max) flex-col gap-8 px-8 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-h1 font-semibold tracking-h1 text-text">{project.name}</h1>
          {project.status === 'archived' ? <Badge tone="neutral">archivado</Badge> : null}
        </div>
        {project.notes ? <p className="max-w-2xl text-body text-text-2">{project.notes}</p> : null}
      </header>

      {/* Métricas del proyecto */}
      <section
        aria-label="Métricas del proyecto"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Metric label="Lotes" value={String(metrics.totalBatches)} />
        <Metric label="Variantes" value={String(metrics.totalVariants)} />
        <Metric label="Aprobadas" value={String(metrics.approvedVariants)} />
        <Metric label="Gasto total" value={formatCost(metrics.spendCents)} mono />
      </section>

      {/* Lotes */}
      <section aria-label="Lotes del proyecto" className="flex flex-col gap-3">
        <h2 className="text-mono font-semibold text-text-2">Lotes</h2>
        {batches.length === 0 ? (
          <EmptyState
            title="Aún no hay lotes"
            description="Arranca un lote desde un análisis del producto: sus variantes y su coste aparecerán aquí."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {batches.map((batch) => {
              const s = BATCH_STATUS[batch.status];
              return (
                <li key={batch.id}>
                  <Card data-testid={`project-batch-${batch.id}`}>
                    <CardBody className="flex flex-col gap-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-body font-semibold text-text">
                            {batch.objective} · tier {tierLabel(batch.tier)}
                          </span>
                          <span className="font-mono text-small text-text-3">
                            {batch.totalVariants} variantes · {formatCost(batch.costActualCents)}
                          </span>
                        </div>
                        <Badge tone={s.tone} dot mono>
                          {s.label}
                        </Badge>
                      </div>
                      <BatchProgress batch={batch} />
                      <span className="text-small text-text-3">
                        {batch.approvedVariants} de {batch.totalVariants} aprobadas
                      </span>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Variantes — FILAS individuales con su estado (§8.1: «variantes con estados
          correctos»), no el agregado del lote. */}
      <section aria-label="Variantes del proyecto" className="flex flex-col gap-3">
        <h2 className="text-mono font-semibold text-text-2">Variantes</h2>
        {variants.length === 0 ? (
          <EmptyState
            title="Aún no hay variantes"
            description="Las variantes aparecen aquí cuando se compone la matriz de un lote."
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {variants.map((variant) => {
              const s = VARIANT_STATUS[variant.status];
              return (
                <li key={variant.id}>
                  <Card data-testid={`project-variant-${variant.id}`}>
                    <CardBody className="flex items-center justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-body font-medium text-text">
                          {variant.filenameCode}
                        </span>
                        <span className="font-mono text-small text-text-3">
                          {variant.angleName} · {variant.language}
                        </span>
                      </div>
                      <Badge tone={s.tone} dot mono>
                        {s.label}
                      </Badge>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Briefs */}
      <section aria-label="Briefs del proyecto" className="flex flex-col gap-3">
        <h2 className="text-mono font-semibold text-text-2">Briefs</h2>
        {briefs.length === 0 ? (
          <EmptyState
            title="Aún no hay briefs"
            description="Analiza el producto para generar su primer brief."
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {briefs.map((brief) => (
              <li key={brief.id}>
                <Card data-testid={`project-brief-${brief.id}`}>
                  <CardBody className="flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-body font-medium text-text">
                        {brief.productName ?? 'Brief sin nombre de producto'}
                      </span>
                      <span className="font-mono text-small text-text-3">
                        v{brief.version} · {brief.language}
                      </span>
                    </div>
                    <Badge tone={brief.status === 'approved' ? 'success' : 'warning'} dot>
                      {brief.status === 'approved' ? 'aprobado' : 'borrador'}
                    </Badge>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-1.5">
        <span className="text-small text-text-3">{label}</span>
        <span className={`text-h2 font-semibold text-text ${mono ? 'font-mono' : ''}`}>
          {value}
        </span>
      </CardBody>
    </Card>
  );
}
