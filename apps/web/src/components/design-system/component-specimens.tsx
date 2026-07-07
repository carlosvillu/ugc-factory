'use client';

// Component specimens for /design-system (TD.2): the button primitive and the
// form fields, mirroring docs/design-system/components/core/buttons.card.html
// and forms/form-fields.card.html 1:1 — the references the CUA gate compares in
// dark AND light. Client component: the form-fields demo holds the interactive
// state (switches, checkboxes, slider) the way the mirror card's <Demo> does.
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { MetricsTable, type MetricsTableColumn } from '@/components/ui/metrics-table';
import { Select } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { ReactNode } from 'react';

function Specimen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold text-text">{title}</h2>
        <p className="text-small text-text-3">{subtitle}</p>
      </div>
      <div className="rounded-lg border border-border bg-bg-subtle p-6">{children}</div>
    </section>
  );
}

// ── Button — mirrors buttons.card.html ──────────────────────────────────────
function Buttons() {
  return (
    <Specimen
      title="Botones"
      subtitle="primary / secondary / ghost / danger / danger-ghost · sm/md/lg · loading · icon"
    >
      <div className="flex flex-col gap-4">
        {/* Row 1: the five variants + an icon-only button */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Generar lote</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Cancelar lote</Button>
          <Button variant="danger-ghost">Rechazar</Button>
          <Button icon variant="secondary" aria-label="Reintentar">
            ↺
          </Button>
        </div>
        {/* Row 2: sizes + disabled + loading */}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Deshabilitado</Button>
          <Button loading variant="secondary">
            Generando…
          </Button>
        </div>
        {/* Row 3: icon buttons across sizes (square mode) */}
        <div className="flex flex-wrap items-center gap-3">
          <Button icon size="sm" variant="primary" aria-label="Añadir persona">
            +
          </Button>
          <Button icon size="md" variant="ghost" aria-label="Info">
            i
          </Button>
          <Button icon size="lg" variant="danger-ghost" aria-label="Descartar">
            ✕
          </Button>
        </div>
      </div>
    </Specimen>
  );
}

// ── Form fields — mirrors form-fields.card.html ─────────────────────────────
function FormFields() {
  const [url, setUrl] = useState('https://mitienda.com/serum-vitamina-c');
  const [description, setDescription] = useState('Sérum facial con 15% de vitamina C…');
  const [goal, setGoal] = useState('standard');
  const [autopilot, setAutopilot] = useState(true);
  const [c2pa, setC2pa] = useState(false);
  const [tiktok, setTiktok] = useState(true);
  const [reels, setReels] = useState(false);
  const [concurrency, setConcurrency] = useState(4);

  return (
    <Specimen
      title="Campos de formulario"
      subtitle="Input · Textarea · Select · Switch · Checkbox · Slider"
    >
      <div className="flex max-w-sm flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ds-url" className="text-small font-semibold text-text-2">
            URL de producto
          </label>
          <Input
            id="ds-url"
            mono
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ds-desc" className="text-small font-semibold text-text-2">
            Descripción
          </label>
          <Textarea
            id="ds-desc"
            rows={2}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ds-goal" className="text-small font-semibold text-text-2">
            Objetivo del lote
          </label>
          <Select
            id="ds-goal"
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
            }}
          >
            <option value="awareness">Hook testing / awareness</option>
            <option value="standard">Conversión estándar</option>
            <option value="storytelling">Storytelling / objeciones</option>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <span id="ds-autopilot-label" className="text-mono text-text">
            Autopilot
          </span>
          <Switch
            aria-labelledby="ds-autopilot-label"
            checked={autopilot}
            onCheckedChange={setAutopilot}
          />
        </div>

        <div className="flex items-center justify-between">
          <span id="ds-c2pa-label" className="text-mono text-text-2">
            Firmar C2PA
          </span>
          <Switch aria-labelledby="ds-c2pa-label" checked={c2pa} onCheckedChange={setC2pa} />
        </div>

        <div className="flex gap-5">
          <Checkbox checked={tiktok} onCheckedChange={setTiktok} label="TikTok" />
          <Checkbox checked={reels} onCheckedChange={setReels} label="Reels" />
        </div>

        <Slider
          label="Concurrencia de render"
          value={concurrency}
          min={1}
          max={8}
          onValueChange={(v: number | readonly number[]) => {
            const next: number = typeof v === 'number' ? v : (v[0] ?? 0);
            setConcurrency(next);
          }}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-small font-semibold text-text-2">Estados del campo</span>
          <Input aria-label="Campo con error" error defaultValue="valor inválido" />
          <Input aria-label="Campo deshabilitado" disabled defaultValue="no editable" />
        </div>
      </div>
    </Specimen>
  );
}

// ── Badges & alerts — mirrors badges-alerts.card.html ───────────────────────
function BadgesAndAlerts() {
  return (
    <Specimen
      title="Badges y alertas"
      subtitle="Pills de estado, tags de trazabilidad, alertas inline"
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="success">✓ extraído</Badge>
          <Badge tone="violet">inferido · 0.82</Badge>
          <Badge dashed mono>
            est. $1.80
          </Badge>
          <Badge mono>real $2.14</Badge>
          <Badge tone="warning" mono>
            +19%
          </Badge>
          <Badge tone="accent">Standard</Badge>
          <Badge mono>ES</Badge>
          <Badge tone="success" dot>
            Orgánico publicado
          </Badge>
          <Badge tone="warning" dot>
            Ad borrador
          </Badge>
        </div>
        <Alert tone="success">
          Lote publicado. 3 variantes en TikTok orgánico con disclosure AIGC activado.
        </Alert>
        <Alert tone="warning">
          El sonido trending seleccionado no es CML — este post no podrá promocionarse como Spark
          Ad.
        </Alert>
        <Alert tone="danger">
          Claim médico bloqueado por el linter. Sugerencia: &quot;ayuda a lucir la piel más
          luminosa&quot;.
        </Alert>
        <Alert tone="info">
          fal repricea con frecuencia. Ejecuta pnpm fal:verify para recalibrar recetas.
        </Alert>
      </div>
    </Specimen>
  );
}

// ── Empty state — mirrors empty-state.card.html ─────────────────────────────
function EmptyStateSpecimen() {
  return (
    <Specimen
      title="Estado vacío"
      subtitle="Placeholder punteado usado en /library, /gallery, /personas"
    >
      <div className="max-w-md">
        <EmptyState
          title="Aún no hay lotes"
          description="Pega una URL de producto o escribe una descripción para lanzar tu primer lote."
          actionLabel="Nuevo lote"
        />
      </div>
    </Specimen>
  );
}

// ── Tabs — mirrors tabs.card.html ───────────────────────────────────────────
function TabsSpecimen() {
  return (
    <Specimen title="Tabs" subtitle="Barra de tabs con subrayado — operable por teclado (←/→)">
      <div className="max-w-md overflow-hidden rounded-lg border border-border bg-surface">
        <Tabs tabs={['Brief', 'Guiones', 'Assets', 'Logs']} />
        <div className="p-4.5 text-mono text-text-2">
          Panel lateral del nodo con el artefacto completo.
        </div>
      </div>
    </Specimen>
  );
}

// ── Metrics table — mirrors metrics-table.card.html ─────────────────────────
const metricsColumns: MetricsTableColumn[] = [
  { key: 'variant', label: 'Variante', width: '2fr' },
  { key: 'hookRate', label: 'Hook rate', align: 'right', mono: true },
  { key: 'ctr', label: 'CTR', align: 'right', mono: true },
  { key: 'rule', label: 'Regla', align: 'right' },
];

const metricsRows = [
  { variant: 'Pain-point · H02', hookRate: '31.4%', ctr: '2.1%', rule: '↑ scale', tone: 'success' },
  { variant: 'Confesión · H01', hookRate: '26.8%', ctr: '1.6%', rule: '— hold', tone: 'neutral' },
  {
    variant: 'Comparación · H04',
    hookRate: '14.2%',
    ctr: '0.7%',
    rule: '✕ kill',
    tone: 'danger',
  },
] as const;

type MetricsTone = 'success' | 'neutral' | 'danger';

function MetricsTableSpecimen() {
  return (
    <Specimen
      title="Tabla de métricas"
      subtitle="Kill/scale grid — numerales mono, alineados a la derecha"
    >
      <MetricsTable
        columns={metricsColumns}
        rows={metricsRows.map((r) => ({ ...r }))}
        renderCell={(row, col) =>
          col.key === 'rule' ? <Badge tone={row.tone as MetricsTone}>{row.rule}</Badge> : undefined
        }
      />
    </Specimen>
  );
}

export function ComponentSpecimens() {
  return (
    <div className="flex flex-col gap-10">
      <Buttons />
      <FormFields />
      <BadgesAndAlerts />
      <EmptyStateSpecimen />
      <TabsSpecimen />
      <MetricsTableSpecimen />
    </div>
  );
}
