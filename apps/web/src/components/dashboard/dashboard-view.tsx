// El dashboard `/` (T5.10, mockup 2a `docs/mockups/dashboard.html`). Server component
// PURO (todo estático al cargar): recibe el `DashboardSummary` ya calculado por el RSC de
// la página y lo pinta con primitivas del DS. Color SOLO por token.
//
// FIDELIDAD AL MOCKUP 2a y sus DESVIACIONES HONESTAS (nada de datos inventados):
//   · Grid de KPIs: gasto del mes (real, ledger), lotes activos (real), aprobadas este mes
//     (real, proxy `updated_at`). El 4.º KPI del mockup «Coste medio/variante» se OMITE:
//     mezclaría un gasto de scope global con un recuento local — sin una fuente honesta
//     hoy (ver informe de T5.10). No se pinta un número falso.
//   · «Lotes activos» con barra de progreso: el mockup pinta el paso del pipeline («N3 de
//     11») y un link a `/runs/8f21`; eso NO tiene fuente (ad_batch no guarda run_id). El
//     progreso se deriva de variantes aprobadas/total (dato real) — `batchProgressPct`.
//   · «Requiere atención»: checkpoints en `waiting_approval` (real).
//   · «Presupuesto»: barra `SpendLedger` del DS, reusada de /spend, con el gasto del MES.
import Link from 'next/link';
import type { DashboardSummary } from '@ugc/core/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardBody, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SpendLedger } from '@/components/ui/spend-ledger';
import { formatCost } from '@/lib/money';
import { homeEntries } from '@/lib/routes';
import { tierLabel } from '@/lib/dashboard';
import { BatchProgress } from '@/components/dashboard/batch-progress';
import { centsToDollars } from '@/lib/spend';

export function DashboardView({ summary }: { summary: DashboardSummary }) {
  const { monthSpendCents, monthBudgetCents, approvedThisMonth, activeBatches, attention } =
    summary;

  return (
    <main className="mx-auto flex max-w-(--content-max) flex-col gap-6 px-8 py-8">
      {/* El h1 «UGC Factory» se conserva (navigation.spec.ts lo exige como ancla de la home);
          el subtítulo del mockup es un h2 subordinado. Así la home sigue siendo localizable por
          su nombre Y respeta la jerarquía del mockup. El mockup dibuja un saludo por hora, pero
          este es un RSC: `new Date()` leería el reloj/TZ del servidor (UTC en el stack e2e y en el
          VPS), no el del navegador — daría un saludo desalineado y sin dato real por usuario
          (auth solo-password, sin nombre). Se usa un subtítulo estático y honesto en su lugar. */}
      <header className="flex items-baseline justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 font-semibold tracking-h1 text-text">UGC Factory</h1>
          <h2 className="text-h2 font-semibold text-text-2">Tu actividad de un vistazo</h2>
        </div>
        {/* CTA de navegación (a intake): un <Link> con la skin del Button del DS
            (`buttonVariants`) — no un HTML estilado a mano (design-system.md §3). */}
        <Link href="/analyses/new" className={buttonVariants({ variant: 'primary' })}>
          + Nuevo lote
        </Link>
      </header>

      {/* KPIs del mes (mockup: grid de 4; aquí 3 reales — ver cabecera). */}
      <section
        aria-label="Indicadores del mes"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <KpiCard label="Gasto del mes" value={formatCost(monthSpendCents)} mono>
          {monthBudgetCents !== null ? (
            <span className="text-small text-text-3">
              de {formatCost(monthBudgetCents)} ·{' '}
              {Math.round((monthSpendCents / Math.max(monthBudgetCents, 1)) * 100)}%
            </span>
          ) : (
            <span className="text-small text-text-3">sin presupuesto configurado</span>
          )}
        </KpiCard>
        <KpiCard label="Lotes activos" value={String(activeBatches.length)} mono>
          {attention.length > 0 ? (
            <span className="text-small text-warning">{attention.length} esperando aprobación</span>
          ) : (
            <span className="text-small text-text-3">ninguno esperando aprobación</span>
          )}
        </KpiCard>
        <KpiCard label="Variantes aprobadas" value={String(approvedThisMonth)} mono>
          <span className="text-small text-text-3">este mes</span>
        </KpiCard>
      </section>

      {/* Aproxima el ratio 1.6:1 del mockup con un grid de 5 columnas (3/2), como el panel
          de /spend — utilidades del DS, sin valor arbitrario (design-system.md §3). */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Lotes activos */}
        <section aria-label="Lotes activos" className="flex flex-col gap-3 lg:col-span-3">
          <h2 className="text-mono font-semibold text-text-2">Lotes activos</h2>
          {activeBatches.length === 0 ? (
            <EmptyState
              title="No hay lotes activos"
              description="Arranca un lote desde un análisis: sus variantes aparecerán aquí con su progreso."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {activeBatches.map((batch) => (
                <li key={batch.batchId}>
                  <Card>
                    <CardBody className="flex flex-col gap-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-col gap-1">
                          <Link
                            href={`/projects/${batch.projectId}`}
                            className="text-body font-semibold text-text hover:text-accent focus-visible:text-accent focus-visible:outline-none"
                          >
                            {batch.projectName}
                          </Link>
                          <span className="font-mono text-small text-text-3">
                            tier {tierLabel(batch.tier)} · {batch.totalVariants} variantes
                          </span>
                        </div>
                        <Badge tone={batch.status === 'running' ? 'info' : 'warning'} dot mono>
                          {batch.status === 'running' ? 'generando' : 'planificado'}
                        </Badge>
                      </div>
                      <BatchProgress batch={batch} />
                      <div className="flex items-center justify-between gap-3 text-small text-text-3">
                        <span>
                          {batch.approvedVariants} de {batch.totalVariants} aprobadas
                        </span>
                        {/* Gasto del mes DEL LOTE (mes ∧ proyecto), scoped al lote — dato real
                            del ledger, no el agregado global del KPI de arriba. */}
                        <span className="font-mono">
                          {formatCost(batch.monthSpendCents)} este mes
                        </span>
                      </div>
                    </CardBody>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Panel lateral: requiere atención + presupuesto */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section aria-label="Requiere atención" className="flex flex-col gap-3">
            <h2 className="text-mono font-semibold text-text-2">Requiere atención</h2>
            {attention.length === 0 ? (
              <p className="text-small text-text-3">Nada pendiente de tu decisión ahora mismo.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {attention.map((item) => (
                  <li key={item.runId}>
                    <Link
                      href={`/runs/${item.runId}`}
                      className="block rounded-md focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {/* Primitiva `Alert` del DS (tone="warning" → glyph ⚠ canónico + tokens
                          soft/border). `items-start` para alinear como el banner previo. */}
                      <Alert tone="warning" className="items-start">
                        {item.projectName}: checkpoint {item.nodeKey} esperando revisión.
                      </Alert>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Presupuesto" className="flex flex-col gap-3">
            <h2 className="text-mono font-semibold text-text-2">Presupuesto</h2>
            {monthBudgetCents !== null ? (
              <SpendLedger
                spent={centsToDollars(monthSpendCents)}
                budget={centsToDollars(monthBudgetCents)}
              />
            ) : (
              <Card>
                <CardBody className="flex flex-col gap-1.5">
                  <span className="text-small text-text-2">Gasto del mes</span>
                  <span className="font-mono text-h1 font-semibold text-text">
                    {formatCost(monthSpendCents)}
                  </span>
                  <span className="text-small text-text-3">
                    Sin presupuesto mensual configurado.
                  </span>
                </CardBody>
              </Card>
            )}
          </section>
        </div>
      </div>

      {/* «Ir a»: los accesos a lo que HOY existe, derivados de `lib/routes.ts` (la MISMA
          lista que pinta la nav). Conservado de la home de T1.13 — `navigation.spec.ts`
          ancla en estas tarjetas los recorridos por click DENTRO de <main>, y el
          invariante «destinos sin página no se repiten como tarjeta muerta» lo sostiene el
          tipo, no un comentario. Es una desviación del mockup 2a (que no tiene grid de
          navegación); candidata a acuerdo con el ds-reviewer. */}
      <section aria-label="Ir a" className="flex flex-col gap-4">
        <h2 className="text-mono font-semibold text-text-2">Ir a</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <li>
            <Link
              href="/projects"
              className="block h-full rounded-lg focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Card className="h-full transition-colors hover:border-border-strong">
                <CardBody className="flex flex-col gap-2">
                  <CardTitle>Proyectos</CardTitle>
                  <p className="text-mono text-text-3">
                    Los productos/campañas: crea, edita y archiva, y entra a sus briefs, lotes y
                    métricas.
                  </p>
                </CardBody>
              </Card>
            </Link>
          </li>
          {homeEntries().map((entry) => (
            <li key={entry.href}>
              <Link
                href={entry.href}
                data-slot="home-entry"
                className="block h-full rounded-lg focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Card className="h-full transition-colors hover:border-border-strong">
                  <CardBody className="flex flex-col gap-2">
                    <CardTitle>{entry.cardTitle ?? entry.label}</CardTitle>
                    <p className="text-mono text-text-3">{entry.description}</p>
                  </CardBody>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

/** Una tarjeta KPI del mockup 2a: etiqueta arriba, valor grande, contexto abajo. */
function KpiCard({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-2">
        <span className="text-small text-text-3">{label}</span>
        <span
          className={`text-h1 font-semibold text-text ${mono ? 'font-mono tracking-tight' : ''}`}
        >
          {value}
        </span>
        {children}
      </CardBody>
    </Card>
  );
}
