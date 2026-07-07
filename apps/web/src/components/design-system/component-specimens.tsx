'use client';

// Component specimens for /design-system (TD.2): the button primitive and the
// form fields, mirroring docs/design-system/components/core/buttons.card.html
// and forms/form-fields.card.html 1:1 — the references the CUA gate compares in
// dark AND light. Client component: the form-fields demo holds the interactive
// state (switches, checkboxes, slider) the way the mirror card's <Demo> does.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
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

export function ComponentSpecimens() {
  return (
    <div className="flex flex-col gap-10">
      <Buttons />
      <FormFields />
    </div>
  );
}
