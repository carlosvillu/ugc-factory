// Foundation specimens for /design-system. Each block mirrors a
// docs/design-system/guidelines/*.card.html 1:1 (the CUA reference). Server
// components, token classes only — no arbitrary values, no raw palettes, no
// icon libraries (Unicode glyphs only). See references/design-system.md §3.
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

// ── Colors · surfaces & text ────────────────────────────────────────────────
function Surfaces() {
  const swatches: { name: string; klass: string; desc: string }[] = [
    { name: '--bg', klass: 'bg-bg', desc: 'base' },
    { name: '--surface', klass: 'bg-surface', desc: 'card / panel' },
    { name: '--surface-2', klass: 'bg-surface-2', desc: 'input' },
    { name: '--surface-3', klass: 'bg-surface-3', desc: 'elevado' },
  ];
  return (
    <Specimen title="Superficies y texto" subtitle="Escala neutra dark-first, --bg → --surface-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        {swatches.map((s) => (
          <div key={s.name} className="overflow-hidden rounded-md border border-border bg-surface">
            <div className={`h-12 border-b border-border ${s.klass}`} />
            <div className="px-2.5 py-2">
              <div className="font-mono text-micro font-semibold text-text">{s.name}</div>
              <div className="text-micro text-text-3">{s.desc}</div>
            </div>
          </div>
        ))}
        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <div className="flex h-12 items-center justify-center border-b border-border bg-surface text-lg font-semibold text-text">
            Aa
          </div>
          <div className="px-2.5 py-2">
            <div className="font-mono text-micro font-semibold text-text">--text</div>
            <div className="text-micro text-text-3">primario</div>
          </div>
        </div>
        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <div className="flex h-12 items-center justify-center border-b border-border bg-surface text-lg font-semibold text-text-3">
            Aa
          </div>
          <div className="px-2.5 py-2">
            <div className="font-mono text-micro font-semibold text-text">--text-3</div>
            <div className="text-micro text-text-3">terciario</div>
          </div>
        </div>
      </div>
    </Specimen>
  );
}

// ── Colors · semantic status ────────────────────────────────────────────────
function Semantic() {
  const rows: { name: string; hex: string; klass: string }[] = [
    { name: 'Success', hex: '#22c55e', klass: 'bg-success' },
    { name: 'Warning', hex: '#f59e0b', klass: 'bg-warning' },
    { name: 'Danger', hex: '#ef4444', klass: 'bg-danger' },
    { name: 'Info', hex: '#3b82f6', klass: 'bg-info' },
  ];
  return (
    <Specimen
      title="Estados semánticos"
      subtitle="Fijos en todo tema y acento: success / warning / danger / info"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {rows.map((r) => (
          <div
            key={r.name}
            className="flex items-center gap-2.5 rounded-md border border-border bg-surface p-3"
          >
            <span className={`size-6.5 shrink-0 rounded-md ${r.klass}`} />
            <div>
              <div className="text-small font-semibold text-text">{r.name}</div>
              <div className="font-mono text-micro text-text-3">{r.hex}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-small text-text-3">
        El acento nunca significa estado; los estados usan estos semánticos fijos (más{' '}
        <span className="text-violet">violet</span> para «inferido / premium»).
      </p>
    </Specimen>
  );
}

// ── Colors · accent (reacts live to data-accent) ────────────────────────────
function Accent() {
  // The four options shown simultaneously (mirrors colors-accent.card.html):
  // each swatch is a subtree scoped with data-accent, so the tokens re-resolve
  // per column regardless of the page-level accent. `indigo` has no override
  // rule (it is the :root default) so its column follows the page accent — at
  // rest (page default = indigo) that is correct and matches the card.
  const options: { accent: string | undefined; label: string }[] = [
    { accent: undefined, label: 'indigo' },
    { accent: 'emerald', label: 'emerald' },
    { accent: 'amber', label: 'amber' },
    { accent: 'cyan', label: 'cyan' },
  ];
  return (
    <Specimen
      title="Acento de marca"
      subtitle="4 opciones conmutables: indigo (default) / emerald / amber / cyan"
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {options.map((o) => (
            <div
              key={o.label}
              data-accent={o.accent}
              className="overflow-hidden rounded-md border border-border bg-surface"
            >
              <div className="h-11 bg-accent" />
              <div className="px-2.5 py-2 font-mono text-micro text-text-2">{o.label}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span className="rounded-full border border-accent-border bg-accent-soft px-3 py-1 text-small font-semibold text-accent">
            badge accent-soft
          </span>
          <span className="size-8 rounded-md bg-accent" />
          <span className="rounded-md bg-accent px-3 py-1.5 text-small font-medium text-text-on-accent">
            Acción primaria
          </span>
          <span className="inline-flex items-center gap-2 font-mono text-micro text-text-3">
            <span className="size-8 rounded-full border border-accent ring-3 ring-ring" />
            focus ring
          </span>
        </div>
      </div>
    </Specimen>
  );
}

// ── Colors · borders ────────────────────────────────────────────────────────
function Borders() {
  const boxes: { name: string; klass: string }[] = [
    { name: '--border', klass: 'border-border' },
    { name: '--border-2', klass: 'border-border-2' },
    { name: '--border-strong', klass: 'border-border-strong' },
  ];
  return (
    <Specimen title="Bordes" subtitle="border / border-2 / border-strong — hairlines de 1px">
      <div className="flex gap-4">
        {boxes.map((b) => (
          <div
            key={b.name}
            className={`flex flex-1 items-center justify-center rounded-md border bg-surface p-4 ${b.klass}`}
          >
            <span className="font-mono text-micro text-text-2">{b.name}</span>
          </div>
        ))}
      </div>
    </Specimen>
  );
}

// ── Colors · light theme (fixed swatch block, mirrors colors-light-theme.card
//    .html) ─── the wrapper's data-theme="light" re-scopes the tokens for this
//    subtree, so it always shows the light values regardless of the page theme.
function LightTheme() {
  const swatches = ['--bg', '--surface', '--surface-3', '--accent'] as const;
  const klass: Record<(typeof swatches)[number], string> = {
    '--bg': 'bg-bg',
    '--surface': 'bg-surface',
    '--surface-3': 'bg-surface-3',
    '--accent': 'bg-accent',
  };
  return (
    <Specimen
      title="Tema claro"
      subtitle="[data-theme=light] — mismos tokens, valores invertidos (siempre visible aquí)"
    >
      <div data-theme="light" className="rounded-md bg-bg p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {swatches.map((s) => (
            <div
              key={s}
              className="overflow-hidden rounded-md border border-border bg-surface shadow-sm"
            >
              <div className={`h-10 border-b border-border ${klass[s]}`} />
              <div className="px-2.5 py-2 font-mono text-micro text-text-2">{s}</div>
            </div>
          ))}
        </div>
      </div>
    </Specimen>
  );
}

// ── Typography · scale ──────────────────────────────────────────────────────
function TypeScale() {
  const rows: { tag: string; klass: string; sample: string }[] = [
    { tag: 'Display/42', klass: 'text-display font-semibold', sample: 'Matriz de anuncios' },
    { tag: 'H1/30', klass: 'text-h1 font-semibold', sample: 'Canvas del pipeline' },
    { tag: 'H2/22', klass: 'text-h2 font-semibold', sample: 'ProductBrief editable' },
    { tag: 'H3/17', klass: 'text-h3 font-semibold', sample: 'Ángulo · pain-point' },
    {
      tag: 'Body/14',
      klass: 'text-body',
      sample: 'Cuerpo de texto por defecto para descripciones y paneles.',
    },
    {
      tag: 'Mono/13',
      klass: 'text-mono font-mono text-text-2',
      sample: 'fal-ai/kling-video/ai-avatar/v2/standard',
    },
  ];
  return (
    <Specimen
      title="Escala tipográfica"
      subtitle="Display 42 → Mono 13, con tracking negativo en los grandes"
    >
      <div className="flex flex-col">
        {rows.map((r, i) => (
          <div
            key={r.tag}
            className={`flex items-baseline gap-4 py-2.5 ${i < rows.length - 1 ? 'border-b border-border' : ''}`}
          >
            <span className="w-24 shrink-0 font-mono text-micro text-text-3">{r.tag}</span>
            <span className={`text-text ${r.klass}`}>{r.sample}</span>
          </div>
        ))}
      </div>
    </Specimen>
  );
}

// ── Typography · families ───────────────────────────────────────────────────
function TypeFamilies() {
  return (
    <Specimen
      title="Familias tipográficas"
      subtitle="Geist (UI) vs Geist Mono (datos / coste / ids)"
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-1.5 font-mono text-micro text-text-3">--font-sans</div>
          <div className="text-h2 font-semibold tracking-h2 text-text">Geist</div>
          <div className="mt-1.5 text-small text-text-2">
            Canvas del pipeline · Aprobar y continuar
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-1.5 font-mono text-micro text-text-3">--font-mono</div>
          <div className="text-h2 font-mono font-medium text-text">Geist Mono</div>
          <div className="mt-1.5 font-mono text-small text-text-2">$1.82 · req_a9f2 · −14 LUFS</div>
        </div>
      </div>
    </Specimen>
  );
}

// ── Spacing · scale ─────────────────────────────────────────────────────────
function SpacingScale() {
  const rows: { klass: string; label: string }[] = [
    { klass: 'w-1', label: '--space-xs · 4px' },
    { klass: 'w-2', label: '--space-sm · 8px' },
    { klass: 'w-3', label: '--space-md · 12px' },
    { klass: 'w-4', label: '--space-lg · 16px' },
    { klass: 'w-6', label: '--space-xl · 24px' },
    { klass: 'w-8', label: '--space-2xl · 32px' },
  ];
  return (
    <Specimen title="Escala de espaciado" subtitle="Base 4px — xs/sm/md/lg/xl/2xl">
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className={`h-4 rounded-sm bg-accent ${r.klass}`} />
            <span className="font-mono text-small text-text-2">{r.label}</span>
          </div>
        ))}
      </div>
    </Specimen>
  );
}

// ── Spacing · card padding & rhythm ─────────────────────────────────────────
function CardPadding() {
  return (
    <Specimen
      title="Padding de card y ritmo"
      subtitle="Padding interno de card, radio --r-lg, sombra --shadow-sm"
    >
      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <div className="mb-1.5 text-small font-semibold text-text">Panel de gasto</div>
        <div className="text-small text-text-2">
          24px de padding interno (p-6); radio --r-lg (10px); borde 1px --border; sombra --shadow-sm
          en reposo.
        </div>
      </div>
    </Specimen>
  );
}

// ── Radii ───────────────────────────────────────────────────────────────────
function Radii() {
  const cols: { klass: string; label: string }[] = [
    { klass: 'rounded-sm', label: 'r-sm · 5' },
    { klass: 'rounded-md', label: 'r-md · 7' },
    { klass: 'rounded-lg', label: 'r-lg · 10' },
    { klass: 'rounded-xl', label: 'r-xl · 14' },
    { klass: 'rounded-2xl', label: 'r-2xl · 18' },
    { klass: 'rounded-full', label: 'r-full' },
  ];
  return (
    <Specimen title="Radios de esquina" subtitle="sm 5 · md 7 · lg 10 · xl 14 · 2xl 18 · full">
      <div className="flex flex-wrap gap-4">
        {cols.map((c) => (
          <div key={c.label} className="flex flex-col items-center gap-2">
            <div className={`size-16 border border-border-2 bg-surface-3 ${c.klass}`} />
            <span className="font-mono text-micro text-text-2">{c.label}</span>
          </div>
        ))}
      </div>
    </Specimen>
  );
}

// ── Elevation ───────────────────────────────────────────────────────────────
function Elevation() {
  const cols: { klass: string; label: string }[] = [
    { klass: 'shadow-sm', label: '--shadow-sm' },
    { klass: 'shadow-md', label: '--shadow-md' },
    { klass: 'shadow-lg', label: '--shadow-lg' },
  ];
  return (
    <Specimen title="Elevación" subtitle="shadow-sm / md / lg — negro puro, solo opacidad">
      <div className="flex flex-wrap items-center gap-8">
        {cols.map((c) => (
          <div key={c.label} className="flex flex-col items-center">
            <div className={`h-11 w-17.5 rounded-md bg-surface-3 ${c.klass}`} />
            <span className="mt-2.5 font-mono text-micro text-text-2">{c.label}</span>
          </div>
        ))}
      </div>
    </Specimen>
  );
}

// ── Brand glyphs & left-accent bar & pulse-ring ─────────────────────────────
function Glyphs() {
  const glyphs: { g: string; label: string; klass?: string }[] = [
    { g: '✓', label: 'aprobado', klass: 'text-success' },
    { g: '✕', label: 'rechazado', klass: 'text-danger' },
    { g: '⚠', label: 'alerta', klass: 'text-warning' },
    { g: 'i', label: 'info', klass: 'text-info' },
    { g: '◆', label: 'checkpoint', klass: 'text-warning' },
    { g: '↺', label: 'reintentar' },
    { g: '▼', label: 'select' },
    { g: '+', label: 'añadir' },
  ];
  return (
    <Specimen
      title="Glifos e indicadores"
      subtitle="Glifos Unicode planos — sin icon font ni librería; barra de acento 4px; pulse-ring"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-small text-text-2">
        {glyphs.map((g) => (
          <span key={g.label} className="inline-flex items-center gap-1.5">
            <span className={`text-base ${g.klass ?? 'text-text-2'}`} aria-hidden>
              {g.g}
            </span>
            {g.label}
          </span>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <div className="flex w-40 overflow-hidden rounded-lg border border-border-2 bg-surface">
          <div className="w-1 bg-success" />
          <div className="px-2.5 py-2 text-small text-text">N1 · Ingesta</div>
        </div>
        <div
          className="animate-pulse-ring flex size-11 items-center justify-center rounded-full border border-warning-border bg-warning-soft text-warning [--pulse-color:var(--color-warning-border)]"
          aria-label="Nodo en checkpoint (pulse-ring)"
        >
          ◆
        </div>
        <span className="font-mono text-micro text-text-3">animate-pulse-ring</span>
      </div>
    </Specimen>
  );
}

export function FoundationSpecimens() {
  return (
    <div className="flex flex-col gap-10">
      <Surfaces />
      <Semantic />
      <Accent />
      <Borders />
      <LightTheme />
      <TypeScale />
      <TypeFamilies />
      <SpacingScale />
      <CardPadding />
      <Radii />
      <Elevation />
      <Glyphs />
    </div>
  );
}
