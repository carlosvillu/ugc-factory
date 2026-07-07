# Design system: de Claude Design a código

Cómo se traduce el design system de UGC Factory (que vive en Claude Design) a tokens Tailwind v4 y componentes en `apps/web/src/components/ui/`. Este documento gobierna TODO valor visual del proyecto: colores, tipografía, radios, variantes, iconografía. La anatomía de componentes (props, composición, ubicación) vive en `references/components.md`.

> **Actualizado 2026-07-07 al crearse la fase FD**: este documento se reescribió contra el DS real (proyecto «UGC Factory Design System» ya poblado). El esqueleto anterior (OKLCH, naming shadcn, `.dark` por clase) era un placeholder y quedó obsoleto: el DS manda.

## Índice

1. [Fuente de verdad: Claude Design y su espejo en el repo](#1-fuente-de-verdad-claude-design-y-su-espejo-en-el-repo)
2. [Tokens en Tailwind v4 CSS-first](#2-tokens-en-tailwind-v4-css-first)
3. [Reglas de uso](#3-reglas-de-uso)
4. [components/ui como espejo del DS: inventario](#4-componentsui-como-espejo-del-ds-inventario)
5. [Gotcha monorepo: @source](#5-gotcha-monorepo-source)
6. [Flujo de traducción DS→código](#6-flujo-de-traducción-dscódigo)
7. [Qué NO va aquí](#7-qué-no-va-aquí)

---

## 1. Fuente de verdad: Claude Design y su espejo en el repo

El design system vive en **Claude Design**: <https://claude.ai/design/p/d126b2f1-3ada-48c5-84fa-914e891fea6f>. El código lo OBEDECE, nunca al revés. Para que el bucle no dependa de la sesión autenticada, el proyecto está **espejado en `docs/design-system/`** (solo lectura; se regenera con la tool `DesignSync` — `list_files` + `get_file` — y JAMÁS se edita a mano).

Qué es cada cosa dentro del espejo:

| Ruta | Qué es y para qué se usa |
|---|---|
| `tokens/*.css` | Los valores crudos (colores, tipo, spacing, radios/sombras, motion). Se VUELCAN a `globals.css` (§2) |
| `components/<grupo>/<X>.jsx` | Spec de estructura/variantes/estados del componente. **No se copia tal cual** (usa estilos inline; nosotros Tailwind + cva): se lee como especificación |
| `components/<grupo>/<X>.prompt.md` | Intención y uso del componente — leerlo antes de implementarlo |
| `components/**/*.card.html` y `guidelines/*.card.html` | Specimens visuales: la referencia contra la que compara el gate CUA |
| `readme.md` | Fundamentos de contenido y voz (español, sentence case, sin emojis, mono para datos, «extraído»/«inferido») — leerlo antes de escribir copy nuevo |
| `_adherence.oxlintrc.json` | Ideas de lint de adherencia (base de TD.6) |
| `ui_kits/` | Pantallas de referencia — FUERA de alcance hasta que el usuario las traspase |

Reglas de dirección:

- **Ningún valor visual se inventa en código.** Si falta un color, radio, tamaño o variante: (1) se añade al DS, (2) se vuelca como token, (3) se usa. Un valor "provisional" en un `className` es invisible para el DS y se fosiliza.
- **Si falta un componente entero** (el DS original no define dialog, toast…): se diseña siguiendo las foundations del DS (hairlines 1 px, radios 5/7/10 px, focus ring único, glifos Unicode, sin gradientes/blur) y **se sube a Claude Design vía `DesignSync` en la misma tarea** (decisión del usuario 2026-07-07), regenerando el espejo después. Así el DS sigue siendo inventario completo.
- **Un cambio visual empieza en Claude Design**; el commit de código es la traducción, no la decisión.

## 2. Tokens en Tailwind v4 CSS-first

Tailwind v4 se configura en CSS (no existe `tailwind.config.js`). TODO valor visual vive en **un único fichero**: `apps/web/src/app/globals.css`, con tres bloques:

1. **Valores crudos, copiados VERBATIM del espejo** (`docs/design-system/tokens/*.css`): hex tal cual — NO se convierten a OKLCH; la fidelidad literal hace los diffs contra el espejo triviales. **Dark es el tema por defecto** (`:root`); light es override completo bajo `[data-theme="light"]`; el acento es conmutable bajo `[data-accent="emerald|amber|cyan"]` (indigo en `:root`); los semánticos son FIJOS (no cambian con tema ni acento). La densidad vive en `--ui-fs` (13/14/15 px).
2. **`@theme inline {}`**: mapea cada token a Tailwind con **naming 1:1 con el DS** — genera `bg-surface`, `text-text-2`, `border-border-strong`, `bg-accent-soft`, `rounded-md` (=`--r-md` 7px), `shadow-sm`, `font-mono`…
3. **`@layer base {}`**: defaults mínimos (fondo, texto, `font-size: var(--ui-fs)`).

```css
/* apps/web/src/app/globals.css — ÚNICO fichero del repo con valores visuales */
@import 'tailwindcss';

/* light por atributo (el toggle escribe data-theme en <html>); dark es el DEFAULT.
   Variante `light:` solo para lo no tokenizable (p. ej. invertir un bitmap). */
@custom-variant light (&:is([data-theme='light'] *));

/* ── 1) Valores crudos: VERBATIM de docs/design-system/tokens/*.css ─────────── */
:root {
  /* superficies, texto, bordes (dark) — de colors.css */
  --bg: #0a0a0b;  --bg-subtle: #0f0f11;
  --surface: #141416;  --surface-2: #1a1a1d;  --surface-3: #212126;
  --border: #26262b;  --border-2: #33333a;  --border-strong: #46464f;
  --text: #f4f4f5;  --text-2: #a1a1aa;  --text-3: #71717a;  --text-4: #52525b;
  --text-on-accent: #ffffff;
  --stripe: rgba(255, 255, 255, 0.045);

  /* elevación — ÚNICA desviación de naming: el DS las llama --shadow-*, pero ese
     namespace lo usa @theme y crearía un var() circular; se vuelcan como
     --elevation-* y las CLASES resultantes (shadow-sm/md/lg) conservan el nombre */
  --elevation-sm: 0 1px 2px rgba(0, 0, 0, 0.5);
  --elevation-md: 0 6px 18px rgba(0, 0, 0, 0.55);
  --elevation-lg: 0 18px 48px rgba(0, 0, 0, 0.6);

  /* acento (indigo default) */
  --accent: #6366f1;  --accent-hover: #7c80f6;  --accent-soft: #6366f126;
  --accent-border: #6366f159;  --ring: #6366f166;

  /* semánticos FIJOS */
  --success: #22c55e; --success-soft: #22c55e1a; --success-border: #22c55e40; --success-on: #052e16;
  --warning: #f59e0b; --warning-soft: #f59e0b1a; --warning-border: #f59e0b40;
  --danger:  #ef4444; --danger-soft:  #ef44441a; --danger-border:  #ef444440;
  --info:    #3b82f6; --info-soft:    #3b82f61a; --info-border:    #3b82f640;
  --violet:  #a78bfa; --violet-soft:  #a78bfa1a; --violet-border:  #a78bfa40;

  /* radios (radii-shadows.css), densidad y resto de typography/spacing/motion.css */
  --r-sm: 5px;  --r-md: 7px;  --r-lg: 10px;  --r-xl: 14px;  --r-full: 9999px;
  --ui-fs: 14px; /* densidad: 13 compact / 14 balanced / 15 comfortable */
}

[data-theme='light'] {
  /* override COMPLETO de superficies/texto/bordes/stripe/elevación — del espejo.
     Un token de tema sin par light es un bug del volcado. */
}
[data-accent='emerald'] { /* --accent/--accent-hover/--accent-soft/--accent-border/--ring */ }
[data-accent='amber']   { /* … */ }
[data-accent='cyan']    { /* … */ }

/* ── 2) Mapeo a Tailwind: naming 1:1 con el DS ──────────────────────────────── */
@theme inline {
  --color-bg: var(--bg);                    /* → bg-bg */
  --color-bg-subtle: var(--bg-subtle);
  --color-surface: var(--surface);          /* → bg-surface */
  --color-surface-2: var(--surface-2);
  --color-surface-3: var(--surface-3);
  --color-border: var(--border);            /* → border-border (y * { border-color } en base) */
  --color-border-2: var(--border-2);
  --color-border-strong: var(--border-strong);
  --color-text: var(--text);                /* → text-text */
  --color-text-2: var(--text-2);            /* → text-text-2 */
  --color-text-3: var(--text-3);
  --color-text-4: var(--text-4);
  --color-text-on-accent: var(--text-on-accent);
  --color-accent: var(--accent);            /* → bg-accent, text-accent */
  --color-accent-hover: var(--accent-hover);
  --color-accent-soft: var(--accent-soft);
  --color-accent-border: var(--accent-border);
  --color-ring: var(--ring);
  --color-success: var(--success);  --color-success-soft: var(--success-soft);  --color-success-border: var(--success-border);
  --color-warning: var(--warning);  --color-warning-soft: var(--warning-soft);  --color-warning-border: var(--warning-border);
  --color-danger: var(--danger);    --color-danger-soft: var(--danger-soft);    --color-danger-border: var(--danger-border);
  --color-info: var(--info);        --color-info-soft: var(--info-soft);        --color-info-border: var(--info-border);
  --color-violet: var(--violet);    --color-violet-soft: var(--violet-soft);    --color-violet-border: var(--violet-border);

  --radius-sm: var(--r-sm);   /* → rounded-sm = 5px (chips, checkboxes) */
  --radius-md: var(--r-md);   /* → rounded-md = 7px (buttons, inputs) */
  --radius-lg: var(--r-lg);   /* → rounded-lg = 10px (cards, paneles) */
  --radius-xl: var(--r-xl);   /* → rounded-xl = 14px (contenedores grandes) */

  --shadow-sm: var(--elevation-sm);
  --shadow-md: var(--elevation-md);
  --shadow-lg: var(--elevation-lg);

  /* Geist/Geist Mono self-hosted (paquete npm `geist`, inyectado en layout.tsx:
     GeistSans.variable → --font-geist-sans, GeistMono.variable → --font-geist-mono) */
  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;

  /* Motion (de motion.css): spin del spinner y pulseRing de nodos activos */
  --animate-spin: spin 0.7s linear infinite;
  --animate-pulse-ring: pulseRing 2s ease-out infinite;
}

/* prefers-reduced-motion: el pulso se apaga; el estado sigue visible por color/badge */
@media (prefers-reduced-motion: reduce) {
  .animate-pulse-ring { animation: none; }
}

/* ── 3) Base mínima ─────────────────────────────────────────────────────────── */
@layer base {
  * { @apply border-border; }
  body { @apply bg-bg text-text font-sans; font-size: var(--ui-fs); }
}
```

Lo de arriba es el ESQUEMA con los valores dark ya reales; la lista completa y exacta (light, acentos, escala tipográfica, motion) la dicta el espejo — el volcado literal es TD.1. Si Claude Design gana un token nuevo, se añade en los dos bloques (`:root`/overrides Y `@theme inline`) en el mismo commit.

## 3. Reglas de uso

1. **Solo clases semánticas de token.** `bg-surface`, `text-text-2`, `border-border-2`, `bg-accent-soft`, `rounded-md`, `shadow-sm`, `font-mono`. Prohibido fuera de `globals.css`: paletas crudas de Tailwind (`bg-blue-500`, `text-zinc-400`), hex/rgb inline (`bg-[#1e40af]`), píxeles mágicos (`rounded-[10px]`). Por qué: un color crudo se salta el DS, no reacciona a tema/acento y hace imposible el retheme. Desde TD.6 el lint lo bloquea.
2. **Temas y acento por atributo, nunca por media query.** El toggle escribe `data-theme`/`data-accent` en `<html>`; los componentes NO usan prefijos `dark:`/`light:` para colores — los tokens cambian solos. `light:` queda para lo no tokenizable.
3. **El acento JAMÁS significa estado.** `--accent` = marca/acción primaria (y es conmutable: indigo/emerald/amber/cyan). Los estados usan los semánticos FIJOS `success/warning/danger/info` (+ `violet`, reservado a «inferido»/«premium tier»). Un botón de éxito verde-accent o un error pintado con accent es un bug de DS.
4. **Los estados del dominio se mapean a los semánticos en UNA función pura** (con test unitario — `testing/references/frontend.md` §1):

```ts
// apps/web/src/components/run-canvas/status-class.ts
import type { StepStatus } from '@ugc/core/contracts';

// Clases LITERALES: Tailwind solo genera clases escritas tal cual.
// Agrupación de arranque (verde=hecho, ámbar=checkpoint, azul=activo,
// gris=pendiente, rojo=fallo, gris apagado=inactivo); la definitiva la
// dicta Claude Design cuando el canvas se construya (T0.11).
const STATUS_CLASS: Record<StepStatus, string> = {
  awaiting_deps: 'bg-text-4',
  pending: 'bg-text-4',
  queued: 'bg-info',
  submitting: 'bg-info',
  running: 'bg-info',
  waiting_approval: 'bg-warning', // el nodo pulsa (animate-pulse-ring)
  succeeded: 'bg-success',
  failed: 'bg-danger',
  rejected: 'bg-danger',
  skipped: 'bg-border-strong',
  cancelled: 'bg-border-strong',
  expired: 'bg-border-strong',
  superseded: 'bg-border-strong',
};

export function statusClass(status: StepStatus): string {
  return STATUS_CLASS[status];
}
```

   Hay exactamente **dos mecanismos sancionados**, ambos sobre los MISMOS tokens semánticos: (a) `statusClass()` — la agrupación vive SOLO ahí; (b) el nodo del canvas, que estila varias propiedades por estado, usa `data-status={status}` + variantes literales `data-[status=…]:` (canvas.md §4). Un tercer mecanismo es un error de revisión.
5. **Nunca construyas clases por concatenación** (`bg-${color}`): Tailwind no las ve. Strings literales completos, elegidos por lookup o condicional.
6. **Espaciado**: la escala 4 px del DS ES la escala estándar de Tailwind (`p-4`, `gap-2`, `p-6` para el padding interno de cards). Un valor `[…px]` solo si Claude Design lo define, y entonces se tokeniza.
7. **Iconografía sin librerías.** El DS usa glifos Unicode en la fuente de UI (✓ ✕ ⚠ i ◆ ↺ ▼ +) y dots de estado (span redondo de 6–7 px). `lucide-react`, heroicons o cualquier icon font están PROHIBIDOS (lint TD.6). Ojo: el código que genera shadcn trae imports de `lucide-react` — sustituirlos por glifos es parte del ajuste (§6). Emojis: nunca.
8. **Sin gradientes, blur, glassmorphism ni texturas.** Única excepción: el hatch diagonal (`repeating-linear-gradient` 45°, `--surface-3` + `--stripe`) como placeholder de vídeo 9:16 sin renderizar.
9. **La barra izquierda de 4 px es el motivo de «estado de un vistazo»**: exclusiva de filas/cards con estado (nodos del pipeline, rows de lista). No es decoración genérica de cards.
10. **El copy también es DS**: español, sentence case, sin emojis, datos siempre en `font-mono` (si un valor se puede pegar en un terminal o spreadsheet, es mono: costes, ids, timestamps, confianzas), y el patrón «extraído» (con cita) vs «inferido · 0.78» en toda superficie de output de IA. Detalle en `docs/design-system/readme.md`.

## 4. components/ui como espejo del DS: inventario

`apps/web/src/components/ui/` es el espejo 1:1 del inventario de Claude Design: un fichero kebab-case por componente. **Usar el componente del DS es obligatorio**: si existe `components/ui/<x>`, escribir HTML crudo estilado equivalente es un error de review.

- **Origen**: `npx shadcn add <componente>` (shadcn/ui sobre **Base UI** — Radix es opt-in que NO usamos) y ajuste al DS: variantes `cva` con los MISMOS nombres que el DS, clases no semánticas sustituidas, imports de lucide sustituidos por glifos, `data-slot` conservado (selector estable para tests/CUA), a11y de la primitiva intacta.
- **Los componentes de producto son presentacionales PUROS**: props planas, prohibido importar tipos de dominio de `@ugc/core` (regla de dependencia de SKILL.md). El wrapper de dominio (que conoce `StepRun` etc.) vive en su carpeta de dominio y se construye en la tarea de la feature.

Inventario (fase FD; espec en `docs/design-system/components/<grupo>/`):

| Fichero | Grupo DS | Origen | Notas |
|---|---|---|---|
| `button.tsx` | core | DS | `primary\|secondary\|ghost\|danger\|danger-ghost` × `sm\|md\|lg` + `loading` + `icon` |
| `input.tsx` `textarea.tsx` `select.tsx` `checkbox.tsx` `switch.tsx` `slider.tsx` | forms | DS | nombres de estados/tamaños del espejo |
| `badge.tsx` `alert.tsx` `empty-state.tsx` | feedback | DS | semánticos fijos; violet solo «inferido/premium» |
| `tabs.tsx` | navigation | DS | operable por teclado |
| `metrics-table.tsx` | data | DS | tabla genérica (la usan `/metrics` y `/spend`) |
| `pipeline-node.tsx` `checkpoint-banner.tsx` `variant-card.tsx` `spend-ledger.tsx` `safe-zone-overlay.tsx` | product | DS | presentacionales puros (ver arriba); pulseRing + hatch 9:16 |
| `dialog.tsx` `sheet.tsx` `alert-dialog.tsx` `toast.tsx` `tooltip.tsx` `skeleton.tsx` `progress.tsx` `card.tsx` `separator.tsx` | — | TD.4 | fuera del DS original: se crean con sus foundations y se SUBEN a Claude Design |

Tras TD.7 esta tabla se cierra con las variantes reales implementadas; si diverge del código, gana el código committeado + espejo y hay que actualizarla (nunca en silencio).

## 5. Gotcha monorepo: @source

Tailwind v4 escanea el source del propio app, pero **no ve los paquetes del workspace**. Hoy NO aplica: toda la UI vive en `apps/web` (decisión vinculante: no hay `packages/ui`). Si algún día un paquete exporta JSX con clases Tailwind, declararlo en `globals.css` (`@source "../../../../packages/ui/src/**/*.{ts,tsx}"`) es parte de la MISMA tarea que crea el paquete — el síntoma del olvido es traicionero: componentes SIN estilos y ningún error.

## 6. Flujo de traducción DS→código

1. **Leer el espejo**: `docs/design-system/components/<grupo>/<X>.jsx` (estructura, variantes, medidas exactas), `<X>.prompt.md` (intención) y el `*.card.html` correspondiente (referencia visual del gate CUA). Si el espejo parece desactualizado respecto a Claude Design, regenerarlo ANTES (via `DesignSync`).
2. **Auditar tokens**: ¿todo lo que usa el componente existe ya en `globals.css`? Lo que falte se vuelca primero (valor en `:root` Y sus overrides de tema/acento + `@theme inline`). Si el componente necesita un valor que el DS no define, PARA: se añade al DS antes (§1).
3. **Generar la base**: `npx shadcn add <componente>` → fichero kebab-case en `components/ui/` sobre Base UI. Para componentes sin equivalente shadcn (los de producto), se escriben a mano con el mismo patrón (cva + `data-slot`).
4. **Ajustar al DS**: variantes cva con los nombres exactos del DS; sustituir clases no semánticas e imports de lucide (glifos §3.7); conservar `data-slot` y la a11y de la primitiva (SKILL.md, principio 4).
5. **Verificar API real**: Base UI evoluciona — ante duda de prop/composición, Context7 (`.mcp.json`) antes que la memoria.
6. **Showcase**: añadir la sección del componente a `/design-system` (todas las variantes × estados) — es lo que el verifier compara contra el `*.card.html`.
7. **Verificación visual**: `next-dev-loop` + `web-design-guidelines` (contraste, hover/focus/disabled, dark Y light, 2 acentos); si cierra tarea del planning, gate CUA con evidencia (`testing/references/cua.md`). Lo visual NO se cubre con unit tests.
8. **Si el componente es nuevo para el DS** (no existía en Claude Design): convertirlo al formato del proyecto (`.jsx` + `.d.ts` + `.prompt.md` + card) y subirlo vía `DesignSync` (`finalize_plan` → `write_files`), regenerando el espejo local después.

## 7. Qué NO va aquí

- **Anatomía de componentes** (props, composición server/client, dónde vive un componente de dominio, naming) → `references/components.md`.
- **El canvas y sus nodos custom** (React Flow, `data-status` + variantes literales) → `references/canvas.md`.
- **Formularios** (react-hook-form + zodResolver, aunque usen `input.tsx`) → `references/forms.md`.
- **Tests de componentes** → `testing/references/frontend.md`; el gate de cierre → `testing/references/cua.md`.
- **Rutas, layouts y consumo de la API** → `references/architecture.md`.
