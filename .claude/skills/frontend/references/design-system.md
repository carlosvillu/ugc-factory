# Design system: de Claude Design a código

Cómo se traduce el design system de UGC Factory (que vive en Claude Design) a tokens Tailwind v4 y componentes en `apps/web/src/components/ui/`. Este documento gobierna TODO valor visual del proyecto: colores, tipografía, radios, variantes. La anatomía de componentes (props, composición, ubicación) vive en `references/components.md`.

## Índice

1. [Fuente de verdad: Claude Design](#1-fuente-de-verdad-claude-design)
2. [Tokens en Tailwind v4 CSS-first: globals.css canónico](#2-tokens-en-tailwind-v4-css-first-globalscss-canónico)
3. [Reglas de uso de tokens](#3-reglas-de-uso-de-tokens)
4. [components/ui como espejo del DS](#4-componentsui-como-espejo-del-ds)
5. [Gotcha monorepo: @source](#5-gotcha-monorepo-source)
6. [Flujo de traducción DS→código](#6-flujo-de-traducción-dscódigo)
7. [Qué NO va aquí](#7-qué-no-va-aquí)

---

## 1. Fuente de verdad: Claude Design

El design system vive en **Claude Design**: <https://claude.ai/design/p/d126b2f1-3ada-48c5-84fa-914e891fea6f>. El código lo OBEDECE, nunca al revés.

- **Ningún valor visual se inventa en código.** Si al construir un componente falta un color, radio, tamaño o variante, el orden es: (1) añadirlo al DS en Claude Design, (2) volcarlo como token a `globals.css`, (3) usarlo. Por qué: un valor inventado "provisional" en un `className` es invisible para el DS y se fosiliza; el DS deja de ser fuente de verdad en silencio.
- **La dirección es siempre DS → código.** Un cambio visual empieza en Claude Design; el commit de código es la traducción, no la decisión.
- **Sincronización futura con `/design-sync`**: cuando existan componentes reales en `components/ui/`, la sincronización DS↔código se hará con la skill `/design-sync`. Hoy es prematuro (no hay código que sincronizar — decisión vinculante de la sesión 2026-07-07); hasta entonces la traducción es manual siguiendo §6.

## 2. Tokens en Tailwind v4 CSS-first: globals.css canónico

Tailwind v4 se configura en CSS (no existe `tailwind.config.js`). TODO valor visual del proyecto vive en **un único fichero**: `apps/web/src/app/globals.css`, con esta estructura canónica en tres bloques:

1. **`:root {}` / `.dark {}`** (fuera de todo `@layer`): CSS variables **semánticas** con los valores crudos en **OKLCH** y **naming 1:1 con los tokens de Claude Design**. Por qué OKLCH: luminosidad perceptualmente uniforme — los pares light/dark se razonan por el canal L sin sorpresas de contraste.
2. **`@theme inline {}`**: mapea cada variable semántica a un token Tailwind (`--color-*`, `--radius-*`, `--font-*`), que es lo que GENERA las clases `bg-background`, `text-muted-foreground`, `rounded-lg`… El modificador `inline` es obligatorio aquí: hace que las utilidades emitan `var(--background)` directamente; sin él, la indirección puede resolverse en `:root` y los overrides de `.dark` dejan de aplicar.
3. **`@layer base {}`**: defaults globales mínimos (fondo, texto, borde).

```css
/* apps/web/src/app/globals.css — ÚNICO fichero del repo con valores visuales */
@import "tailwindcss";

/* dark mode por clase (el toggle pone .dark en <html>), no por media query */
@custom-variant dark (&:is(.dark *));

/* ── 1) Valores crudos: naming 1:1 con Claude Design, siempre OKLCH ─────────
   TODOS los oklch(…) de abajo son placeholder: VOLCAR de Claude Design.     */
:root {
  --background: oklch(1 0 0);              /* ← volcar de Claude Design */
  --foreground: oklch(0.145 0 0);          /* ← volcar de Claude Design */
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --success: oklch(0.65 0.17 150);          /* ← volcar de Claude Design */
  --success-foreground: oklch(0.985 0 0);
  --warning: oklch(0.75 0.15 85);
  --warning-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);

  /* Estados del dominio (step_run.status → canvas, badges) — ver §3 */
  --status-pending: oklch(0.7 0.02 260);           /* ← volcar de Claude Design */
  --status-queued: oklch(0.7 0.06 260);
  --status-running: oklch(0.65 0.15 250);
  --status-waiting-approval: oklch(0.75 0.15 85);
  --status-succeeded: oklch(0.65 0.17 150);
  --status-failed: oklch(0.6 0.22 25);
  --status-inactive: oklch(0.8 0 0);

  /* Radios y tipografía también son tokens: nada de rounded-[10px] sueltos */
  --radius: 0.625rem;                              /* ← volcar de Claude Design */
}

.dark {
  --background: oklch(0.145 0 0);          /* ← volcar de Claude Design */
  --foreground: oklch(0.985 0 0);
  /* …misma lista COMPLETA que :root: cada token tiene su valor dark.
     Un token sin par dark es un bug del volcado, no una omisión aceptable. */
}

/* ── 2) Mapeo a tokens Tailwind: esto GENERA las clases semánticas ───────── */
@theme inline {
  --color-background: var(--background);        /* → bg-background, text-background… */
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-success: var(--success);              /* → bg-success (badges de estado) */
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);  /* → text-muted-foreground */
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --color-status-pending: var(--status-pending);      /* → bg-status-pending… */
  --color-status-queued: var(--status-queued);
  --color-status-running: var(--status-running);
  --color-status-waiting-approval: var(--status-waiting-approval);
  --color-status-succeeded: var(--status-succeeded);
  --color-status-failed: var(--status-failed);
  --color-status-inactive: var(--status-inactive);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  /* La fuente la inyecta next/font en layout.tsx con variable: '--font-inter'
     (familia real: la que dicte Claude Design) */
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;

  /* Animaciones también son tokens: el pulso del checkpoint (canvas.md §4) */
  --animate-checkpoint-pulse: checkpoint-pulse 2s ease-in-out infinite;
  @keyframes checkpoint-pulse {
    0%, 100% { box-shadow: 0 0 0 0 var(--status-waiting-approval); }
    50% { box-shadow: 0 0 0 6px transparent; }
  }
}

/* prefers-reduced-motion: el pulso se apaga; el estado sigue visible por color/badge */
@media (prefers-reduced-motion: reduce) {
  .animate-checkpoint-pulse { animation: none; }
}

/* ── 3) Base mínima ──────────────────────────────────────────────────────── */
@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground; }
}
```

La lista exacta de tokens la dicta el inventario de Claude Design; la de arriba es el mínimo compatible con los componentes generados por shadcn. Si Claude Design define un token que no está aquí, se añade a los TRES sitios (`:root`, `.dark`, `@theme inline`) en el mismo commit.

## 3. Reglas de uso de tokens

1. **Solo clases semánticas de token.** `bg-background`, `text-muted-foreground`, `border-border`, `rounded-lg`, `bg-status-running`. Prohibido en cualquier fichero que no sea `globals.css`: paletas crudas de Tailwind (`bg-blue-500`, `text-zinc-400`), hex/oklch inline (`bg-[#1e40af]`), píxeles mágicos (`rounded-[10px]`, `p-[13px]`). Por qué: un color crudo se salta el DS, no reacciona a `.dark` y hace imposible un retheme (cambiar un token = cambiar toda la app).
2. **Dark mode vía clase `.dark`**, nunca `@media (prefers-color-scheme)`. El toggle escribe la clase en `<html>`; los componentes NO usan el prefijo `dark:` para colores — los tokens ya cambian solos. `dark:` queda reservado para los rarísimos casos no tokenizables (p. ej. invertir un logo bitmap).
3. **Los estados del dominio son tokens semánticos propios** (`--status-*`), no colores ad-hoc en el canvas. El mapeo `step_run.status → clase` es una función pura del dominio (y por tener lógica, se testea — `testing/references/frontend.md` §1):

```ts
// apps/web/src/components/run-canvas/status-class.ts
import type { StepStatus } from '@ugc/core/contracts';

// Clases LITERALES: el compilador de Tailwind solo genera clases que aparecen
// escritas tal cual en el código. `bg-status-${status}` produciría CSS vacío.
const STATUS_CLASS: Record<StepStatus, string> = {
  awaiting_deps: 'bg-status-pending',
  pending: 'bg-status-pending',
  queued: 'bg-status-queued',
  submitting: 'bg-status-queued',
  running: 'bg-status-running',
  waiting_approval: 'bg-status-waiting-approval', // el nodo pulsa (PRD §8.2)
  succeeded: 'bg-status-succeeded',
  failed: 'bg-status-failed',
  rejected: 'bg-status-failed',
  skipped: 'bg-status-inactive',
  cancelled: 'bg-status-inactive',
  expired: 'bg-status-inactive',
  superseded: 'bg-status-inactive',
};

export function statusClass(status: StepStatus): string {
  return STATUS_CLASS[status];
}
```

   Qué estados visuales existen y qué statuses colapsan en cada uno lo decide Claude Design (la agrupación de arriba es el arranque propuesto). Hay exactamente **dos mecanismos sancionados**, ambos consumiendo los MISMOS tokens `--status-*`: (a) `statusClass()` — la agrupación vive SOLO en esta función; badges y listas la importan, jamás la duplican; (b) el nodo del canvas, que necesita estilar varias propiedades por estado, usa `data-status={status}` + variantes literales `data-[status=…]:` (canvas.md §4). Un tercer mecanismo es un error de revisión.
4. **Nunca construyas clases por concatenación** (`bg-${color}`, template strings): Tailwind no las ve y no genera el CSS. Siempre strings literales completos, elegidos por lookup o condicional.
5. **Espaciado y tamaños**: usa la escala estándar de Tailwind (`p-4`, `gap-2`) — la escala ES parte del DS. Un valor arbitrario `[…px]` solo se acepta si Claude Design lo define y entonces se tokeniza.

## 4. components/ui como espejo del DS

`apps/web/src/components/ui/` es el espejo 1:1 del inventario de componentes de Claude Design: **un fichero kebab-case por componente del DS**. Si está en el DS y se usa, existe el fichero; si no está en el DS, no se crea (primero se añade al DS, §1).

- **Origen**: cada componente se genera con `npx shadcn add <componente>` (shadcn/ui sobre **Base UI** — primitiva por defecto desde jul-2026; Radix es opt-in que NO usamos) y luego se ajusta al DS. El código generado es NUESTRO: se edita, se le quitan variantes que el DS no tiene y se le añaden las que sí.
- **Variantes con `cva`, con los MISMOS nombres que Claude Design.** Si el DS llama a las variantes del botón `primary | secondary | ghost | destructive`, esos son los nombres en código — no los defaults de shadcn si difieren. Por qué: el nombre compartido es lo que permite hablar de "el botón ghost" entre DS y código sin tabla de traducción mental.
- **`data-slot` en cada parte** (lo trae el generado de shadcn): permite estilar composiciones desde el padre y es un selector estable para tests/CUA.

```tsx
// apps/web/src/components/ui/badge.tsx — patrón cva: variantes = nombres del DS
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      // MISMOS nombres y conjunto que el ejemplo de components.md §3: un solo Badge canónico
      variant: {
        default: 'bg-secondary text-secondary-foreground',
        success: 'bg-success text-success-foreground',              // ← solo clases semánticas de token
        warning: 'bg-warning text-warning-foreground',
        destructive: 'bg-destructive text-destructive-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

Inventario inicial sugerido (el definitivo lo dicta Claude Design; columna Base UI = primitiva sobre la que shadcn lo construye, `—` = HTML nativo estilado):

| Fichero | Componente DS | Primitiva Base UI | Lo usan (ejemplos) |
|---|---|---|---|
| `button.tsx` | Button | — (`<button>`) | Aprobar/Editar de CP1–CP5, intake |
| `input.tsx` | Input | Input | intake (URL), settings (keys) |
| `textarea.tsx` | Textarea | — (`<textarea>`) | texto libre de intake, editor CP3 |
| `select.tsx` | Select | Select | tier en CP2, locale, personas |
| `dialog.tsx` | Dialog | Dialog | confirmaciones (cancelar lote) |
| `sheet.tsx` | Sheet | Dialog (variante lateral) | panel lateral del canvas |
| `alert-dialog.tsx` | AlertDialog | AlertDialog | acciones destructivas |
| `badge.tsx` | Badge | — (`<span>`) | extraído/inferido en CP1, estados |
| `card.tsx` | Card | — (`<div>`) | galería de variantes, dashboard |
| `table.tsx` | Table | — (`<table>`) | matriz CP2, `/spend`, métricas N11 |
| `tabs.tsx` | Tabs | Tabs | panel del nodo (artefacto/logs/JSON) |
| `toast.tsx` | Toast | Toast | feedback de mutaciones |
| `tooltip.tsx` | Tooltip | Tooltip | costes estimados, iconos del canvas |
| `skeleton.tsx` | Skeleton | — (`<div>`) | loading de galería/listas |
| `switch.tsx` | Switch | Switch | overlay de safe zones (CP4), settings |
| `checkbox.tsx` | Checkbox | Checkbox | selección de variantes en CP4 |
| `progress.tsx` | Progress | Progress | progreso del run |
| `separator.tsx` | Separator | Separator | layout de paneles |

Regla de dependencia (de SKILL.md, repetida porque se viola fácil): `components/ui` **no importa nada** de dominios, stores ni hooks de datos — recibe todo por props. Un `badge.tsx` que importa `StepStatus` ya no es DS, es dominio: eso va en `run-canvas/` (como `statusClass` en §3).

## 5. Gotcha monorepo: @source

Tailwind v4 escanea automáticamente el source del propio app, pero **no ve los paquetes del workspace** (quedan fuera de la raíz de detección). Si algún día un paquete exporta JSX con clases Tailwind, hay que declararlo en el CSS de entrada:

```css
@import "tailwindcss";
/* ruta relativa a ESTE fichero (apps/web/src/app/globals.css) */
@source "../../../../packages/ui/src/**/*.{ts,tsx}";
```

**Hoy NO aplica**: toda la UI vive en `apps/web` (decisión vinculante: no hay `packages/ui` — un solo consumidor no justifica el paquete) y `@ugc/core`/`@ugc/db` no contienen JSX. Esta nota existe porque el síntoma del olvido es traicionero: los componentes del paquete renderizan SIN estilos (las clases están en el HTML pero su CSS nunca se generó) y nada da error. Si aparece `packages/ui`, añadir el `@source` es parte de la MISMA tarea que crea el paquete.

## 6. Flujo de traducción DS→código

Paso a paso para llevar un componente (o un cambio) de Claude Design a `components/ui/`:

1. **Abrir Claude Design** (<https://claude.ai/design/p/d126b2f1-3ada-48c5-84fa-914e891fea6f>) y localizar el componente: qué tokens usa (colores, radio, tipografía) y qué variantes/tamaños define, con sus nombres exactos.
2. **Auditar tokens**: ¿todos los tokens que usa existen ya en `globals.css`? Los que falten se vuelcan primero (valor OKLCH en `:root` Y `.dark`, mapeo en `@theme inline` — §2). Si el componente necesita un valor que el DS no define, PARA: se añade al DS antes (§1).
3. **Generar la base**: `npx shadcn add <componente>` → crea el fichero kebab-case en `components/ui/` sobre Base UI.
4. **Ajustar al DS**: renombrar/podar/añadir variantes `cva` hasta que coincidan 1:1 con los nombres del DS; sustituir cualquier clase no semántica que traiga el generado; conservar `data-slot` y la accesibilidad de la primitiva (SKILL.md, principio 4).
5. **Verificar API real**: Base UI evoluciona — ante cualquier duda de prop/composición, Context7 (`.mcp.json`) antes que la memoria.
6. **Verificación visual**: levantar la app (skill `next-dev-loop`), revisar con la skill `web-design-guidelines` (contraste, estados hover/focus/disabled, dark mode con `.dark` activada) y, si el componente cierra una tarea del planning, gate CUA con evidencia según `testing/references/cua.md`. Lo visual NO se cubre con unit tests (`testing/references/frontend.md` §1): un componente de DS que solo pinta props no lleva test de jsdom.

## 7. Qué NO va aquí

- **Anatomía de componentes** (props, composición server/client, dónde vive un componente de dominio, naming de ficheros) → `references/components.md`.
- **El canvas y sus nodos custom** (React Flow, el mecanismo `data-status` + variantes literales) → `references/canvas.md`.
- **Formularios** (react-hook-form + zodResolver, aunque usen `input.tsx`/`select.tsx`) → `references/forms.md`.
- **Tests de componentes** (qué se testea en jsdom y qué en E2E/CUA) → `testing/references/frontend.md`; el gate de cierre → `testing/references/cua.md`.
- **Rutas, layouts y consumo de la API** → `references/architecture.md`.
