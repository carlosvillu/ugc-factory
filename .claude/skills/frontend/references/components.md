# Convenciones de componentes y hooks (apps/web)

Cómo se escribe, se nombra y se ubica cada componente y hook de `apps/web`. Complementa a `architecture.md` (frontera server/client, páginas) y a `design-system.md` (tokens, estilos). Regla transversal: los componentes reciben y emiten tipos inferidos de los contratos Zod de `@ugc/core` (`ProductBrief`, `StepRun`, `AdVariant`…), nunca shapes ad-hoc — un cambio de contrato debe romper la compilación aquí, esa es la señal deseada.

## Índice

1. [Convenciones React 19](#1-convenciones-react-19)
2. [Naming y ubicación](#2-naming-y-ubicación)
3. [shadcn/ui sobre Base UI](#3-shadcnui-sobre-base-ui)
4. [Cuándo extraer un hook (y cuándo no escribir un Effect)](#4-cuándo-extraer-un-hook-y-cuándo-no-escribir-un-effect)
5. [Accesibilidad vinculante: la API de test](#5-accesibilidad-vinculante-la-api-de-test)
6. [Composición: señales de alarma](#6-composición-señales-de-alarma)
7. [Qué NO va aquí](#7-qué-no-va-aquí)

---

## 1. Convenciones React 19

**Function declarations, siempre.** Ni arrow functions asignadas a const para componentes, ni `React.FC` (impide componentes genéricos y es verbosidad sin beneficio en React 19). Props tipadas con `interface` propia o, si el componente envuelve un elemento nativo, `React.ComponentProps<'x'> & {...}`:

```tsx
// Componente de dominio: interface con tipos de los contratos de @ugc/core
import type { StepRun } from '@ugc/core';

interface StepDetailPanelProps {
  step: StepRun;
  onApprove: (stepId: string) => void;
}

export function StepDetailPanel({ step, onApprove }: StepDetailPanelProps) { /* … */ }

// Componente que extiende un elemento nativo: ComponentProps + intersección
type CostBadgeProps = React.ComponentProps<'span'> & { amountUsd: number };
```

**`ref` es una prop normal — `forwardRef` PROHIBIDO en código nuevo.** React 19 pasa `ref` como prop a function components; `forwardRef` es ruido legacy que además rompe el naming en DevTools. En React 19, `React.ComponentProps<'button'>` ya incluye `ref` con el tipo correcto:

```tsx
// ❌ ANTES (React 18) — no escribir nunca más
export const ApproveButton = React.forwardRef<HTMLButtonElement, ApproveButtonProps>(
  function ApproveButton({ checkpoint, ...props }, ref) {
    return <button ref={ref} type="button" {...props} />;
  },
);

// ✅ DESPUÉS (React 19) — ref viaja en las props
interface ApproveButtonProps extends React.ComponentProps<'button'> {
  checkpoint: 'CP1' | 'CP2' | 'CP3' | 'CP4' | 'CP5';
}

export function ApproveButton({ checkpoint, ref, ...props }: ApproveButtonProps) {
  return <button ref={ref} type="button" data-checkpoint={checkpoint} {...props} />;
}
```

**Sin `defaultProps`.** Defaults en el destructuring: `function VariantCard({ locale = 'es', ...props })`. Es lo único que React 19 soporta en function components y lo único que TypeScript narrowea bien.

**React Compiler activado (`reactCompiler: true`) → sin `useMemo`/`useCallback` preventivos.** El compilador memoiza automáticamente; un `useMemo` "por si acaso" es ruido que oculta los pocos casos donde una memoización manual significa algo. Escribe el cálculo directo:

```tsx
// ❌ ruido: el compilador ya memoiza esto
const totalCost = useMemo(() => estimateMatrixCost(matrix, recipe), [matrix, recipe]);

// ✅ directo — y la fórmula vive como función pura en @ugc/core (testeable sin jsdom)
const totalCost = estimateMatrixCost(matrix, recipe);
```

La ÚNICA excepción son los requisitos de identidad estable de React Flow (`nodeTypes` a nivel de módulo, nodos con `memo`): viven en `canvas.md`, no las generalices al resto de la app.

## 2. Naming y ubicación

| Cosa | Convención | Ejemplo |
|---|---|---|
| Ficheros y carpetas | kebab-case | `brief-editor.tsx`, `run-canvas/` |
| Export de componente | PascalCase, el fichero se llama como su export | `brief-editor.tsx` → `export function BriefEditor` |
| Hooks | camelCase con prefijo `use`, fichero `use-*.ts` | `use-event-source.ts` → `useEventSource` |
| Funciones puras co-locadas | fichero propio junto al componente | `run-canvas/steps-to-graph.ts` |
| Tests | co-locados `*.test.ts(x)` (convención de la skill `testing`, su fuente de verdad) | `brief-editor.test.tsx` |

**Un componente exportado por fichero.** Sub-componentes privados sin export pueden convivir en el mismo fichero mientras nadie más los necesite; en cuanto otro fichero los importa, se mudan al suyo. Por qué: el grep por nombre de fichero debe encontrar el componente a la primera.

**Dominio vs design system:**

- `components/<dominio>/` (`run-canvas/`, `checkpoints/`, `intake/`, `gallery/`, `personas/`, `library/`, `metrics/`, `spend/`, `settings/`) — componentes que conocen los contratos del negocio (`ProductBrief`, `StepRun`, la matriz de CP2…).
- `components/ui/` — el design system: espejo 1:1 del inventario de Claude Design, sin conocimiento de dominio. **No importa de dominios ni de stores, jamás** (regla de dependencia de la skill).

**Cuándo se promociona algo a `ui/`:** cuando cumple LAS DOS condiciones — (a) es agnóstico de dominio (no importa nada de `@ugc/core` ni de carpetas de dominio; habla en props genéricas) y (b) lo usan ≥2 dominios. Un `cost-badge` que solo usa `spend/` se queda en `spend/`; el día que `checkpoints/` lo necesite Y se pueda expresar sin tipos de dominio, se promociona (y se añade al inventario del DS en Claude Design primero — ver `design-system.md`). Promocionar antes de tiempo crea un pseudo-DS de piezas de un solo uso.

**Hooks:** transversales (los usan ≥2 dominios o son infraestructura: `use-event-source.ts`, `use-run-events.ts`) en `src/hooks/`; hooks de un solo dominio co-locados en su carpeta (`components/checkpoints/use-matrix-selection.ts`). Mismo criterio de promoción que los componentes.

## 3. shadcn/ui sobre Base UI

**Qué es:** shadcn/ui NO es una dependencia — es código que se copia dentro del repo y pasa a ser nuestro. `npx shadcn add <componente>` genera el fichero en `components/ui/` según la config de `apps/web/components.json` (lo crea `npx shadcn init`; no lo escribas a mano). Desde julio de 2026 el código generado usa **primitivas de Base UI por defecto** — es exactamente lo que queremos. **NUNCA instalar las variantes Radix**: ver `@radix-ui/*` en `package.json` es un error de revisión, sin excepciones. Por qué: dos librerías de primitivas = dos sistemas de foco, portales y aria compitiendo.

```bash
npx shadcn add button dialog select badge   # copia los ficheros a src/components/ui/
```

**Editar el código copiado es lo esperado, no una herejía.** El componente generado es el punto de partida; se ajusta a los tokens y variantes del DS de Claude Design (ver `design-system.md`). Eso sí: cada edición debe mantener las primitivas Base UI y sus atributos aria intactos — se toca la piel, no el esqueleto.

**Variantes con cva, con los MISMOS nombres de variante que el DS de Claude Design.** Los nombres de variante son literales del espejo — la traducción DS↔código es 1:1 o `/design-sync` no podrá reconciliarlos el día que exista. El Badge real usa `tone` (7 tonos) + los modificadores `dashed`/`mono`/`dot`, con tokens `-soft`/`-border`/fg (el inventario completo vive en `design-system.md` §4):

```tsx
// apps/web/src/components/ui/badge.tsx (extracto real, TD.3)
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.25 whitespace-nowrap rounded-full border px-2.5 py-0.75 text-micro font-semibold',
  {
    variants: {
      tone: {
        neutral: 'border-border-2 bg-surface-3 text-text-2',
        accent: 'border-accent-border bg-accent-soft text-accent',
        success: 'border-success-border bg-success-soft text-success', // step succeeded
        warning: 'border-warning-border bg-warning-soft text-warning', // waiting_approval
        danger: 'border-danger-border bg-danger-soft text-danger',     // failed
        info: 'border-info-border bg-info-soft text-info',
        violet: 'border-violet-border bg-violet-soft text-violet',     // «inferido» / premium
      },
      dashed: { true: 'border-dashed border-border-strong bg-transparent text-text-3', false: '' },
      mono: { true: 'font-mono', false: 'font-sans' },
    },
    defaultVariants: { tone: 'neutral', dashed: false, mono: false },
  },
);

type BadgeProps = Omit<React.ComponentProps<'span'>, 'color'> &
  VariantProps<typeof badgeVariants> & { dot?: boolean };

export function Badge({ className, tone = 'neutral', dashed, mono, dot, children, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ tone, dashed, mono }), className)} {...props}>
      {/* dot: span redondo aria-hidden tintado con el fg del tono */}
      {children}
    </span>
  );
}
```

(Solo clases semánticas de token — `bg-success-soft`, no `bg-green-500`; los estados usan los semánticos FIJOS, `accent` es la marca, NUNCA estado — `design-system.md` §3.3.)

**`data-slot` para estilos internos.** Cada parte de un componente compuesto lleva `data-slot="card-header"`, `data-slot="dialog-footer"`… Permite que un padre estilice partes internas (`[&_[data-slot=badge]]:opacity-50`) sin añadir props de estilo al componente. Es el mecanismo estándar del código que genera shadcn: consérvalo al editar y añádelo en partes nuevas.

**Componentes que shadcn no trae → Base UI directo.** Se crea el fichero en `components/ui/` a mano usando las primitivas de Base UI (mismo paquete que ya importan los ficheros generados — copia el import de cualquier componente existente). Dos avisos: Base UI compone con la prop `render` (no existe `asChild`, eso era Radix), y su API evoluciona — **consulta la doc actualizada vía Context7 MCP antes de escribir contra ella de memoria**.

**Trampas de a11y de Base UI descubiertas en la fase FD (heredadas por los wrappers de dominio de F0):**

1. **Una primitiva Base UI en esta RC puede NO cablear `role`/aria por sí sola** → cablearlo explícito y VERIFICAR en el árbol de accesibilidad, no asumirlo. El Tooltip necesitó `role="tooltip"` + un `id` en el popup + `aria-describedby` en el trigger a mano (Base UI no los emitía). Corolario: cuando envuelvas una primitiva, mira el árbol a11y real (CUA/testing) antes de dar por hecho que la semántica está.
2. **El accessible name no «sube» de un ancestro a un descendiente.** El `role="slider"` del Slider vive en el `<input>` anidado en el Thumb, DESCENDIENTE de Root; un `aria-label` en Root (el grupo) NO nombra el control. El Slider reenvía el label al Thumb (`getAriaLabel`) y lo quita de Root. Mismo principio para cualquier primitiva donde el rol está en una parte interna.
3. **Control etiquetado de Base UI = UN solo elemento interactivo, no un `<label>` envolviendo la Root.** El Checkbox etiquetado se renderiza como un único `<button role="checkbox">` (`nativeButton`) cuyo texto visible ES el accessible name. Envolver la Root en un `<label>` (o `Field.Label`) doble-dispara (el span togglea y el label re-activa el input oculto → net no-op: no togglea al click); y un `<label htmlFor>` hermano no puede apuntar al control porque Base UI pone el `for` en el input oculto. Patrón vinculante para cualquier control etiquetado de Base UI.
4. **Componentes que usan `Intl` en SSR deben fijar un `locale` determinista** o hay hydration mismatch (que dispara `console.error` TAMBIÉN en prod, no solo en dev). Progress fija `locale='en-US'` porque Base UI construye `aria-valuetext` con `Intl.NumberFormat`: sin locale, Node (server, p.ej. `es-ES`→"66 %" con NBSP) y el navegador (client→"66%") producen strings distintos. **Regla para F0**: cualquier componente con fecha/número/`%`/moneda formateado en SSR fija locale explícito.

## 4. Cuándo extraer un hook (y cuándo no escribir un Effect)

Criterios de react.dev, en orden de fuerza — si no cumple ninguno, no extraigas:

1. **Repetición real (2+)**: la misma lógica con estado aparece en dos componentes. No "aparecerá": aparece. Extraer al primer uso es especular.
2. **Esconder un `useEffect` de sistema externo tras una API declarativa**: cuando un efecto sincroniza con algo fuera de React (EventSource, `visibilitychange`, `localStorage`, un `<video>`), el componente no debe ver el efecto — ve un hook que describe QUÉ quiere, no cómo. `useEventSource(url)` es el ejemplo canónico del proyecto (su implementación vive en `state-and-sse.md`): el panel del run pide "los eventos de este run" y el hook esconde reconexión, backoff y cleanup.
3. **Legibilidad**: un componente donde estado, refs y efectos entrelazados sepultan el JSX mejora si la maraña se nombra (`useMatrixSelection(brief)`). Si el hook resultante no tiene un nombre honesto de una frase, la extracción era mecánica, no conceptual.

**"You Might Not Need an Effect" aplica antes que todo lo anterior.** La mayoría de efectos candidatos a hook no deberían existir:

```tsx
// ❌ Effect para derivar estado — estado duplicado que puede desincronizarse
const [estimatedCost, setEstimatedCost] = useState(0);
useEffect(() => {
  setEstimatedCost(estimateMatrixCost(matrix, recipe));
}, [matrix, recipe]);

// ✅ derivado en render; la fórmula es función pura de @ugc/core con sus propios unit tests
const estimatedCost = estimateMatrixCost(matrix, recipe);
```

- Dato derivado de props/estado → se calcula en render (el React Compiler lo memoiza).
- Reacción a una acción del usuario → en el event handler, no en un efecto que observa estado.
- Fetch de datos en un `useEffect` de cliente → casi siempre error de arquitectura en este proyecto: las lecturas llegan por RSC + api-client (`architecture.md`) y el estado vivo por SSE + store (`state-and-sse.md`).

## 5. Accesibilidad vinculante: la API de test

**Estas normas no son un extra: son el contrato con la suite de tests.** `testing/references/frontend.md` §7 ordena las queries por preferencia (`getByRole` con accessible name primero); cada norma de esta tabla existe para que esa query exista. Un componente que las incumple no se puede testear NI usar con lector de pantalla — mismo defecto, dos síntomas. Corolario: el accessible name es API pública — cambiar un `aria-label` rompe tests A PROPÓSITO; se cambia de forma deliberada, con sus tests.

| Norma (obligatoria) | Por qué | Query que habilita |
|---|---|---|
| HTML semántico primero: `button`, `a`, `nav`, `main`, `table`, `ul` — nunca `div onClick` | Rol, foco y teclado gratis; un `div` clicable no es tabulable ni tiene rol | `getByRole('button', { name: /aprobar/i })` |
| Todo input con label asociado (`<Label htmlFor>` o envolvente) | Sin label no hay accessible name → el campo es invisible para test y lector | `getByRole('textbox', { name: /url del producto/i })` |
| `aria-label` en todo botón icon-only | Un icono no da nombre accesible | `getByRole('button', { name: /cancelar run/i })` |
| Todo dialog con título accesible (`DialogTitle`; si no se ve, con clase `sr-only`) | Sin título, el dialog anuncia "diálogo" a secas y no es localizable por nombre | `getByRole('dialog', { name: /confirmar coste/i })` |
| Un `h1` por vista y jerarquía sin saltos (`h1`→`h2`→`h3`) | La estructura de headings ES la navegación del lector de pantalla | `getByRole('heading', { level: 2, name: /matriz/i })` |
| Estados como aria: `aria-expanded` (paneles/acordeones), `aria-selected` (tabs), `disabled`/`aria-disabled` | El estado visual sin aria es invisible fuera del píxel | `getByRole('tab', { selected: true })`, `expect(btn).toBeDisabled()` |
| Feedback async no urgente en `role="status"` (con `aria-label` si es un valor con nombre) | aria-live polite: anuncia sin interrumpir; localizable sin depender del texto exacto | `getByRole('status', { name: /coste estimado/i })` |
| Errores y bloqueos en `role="alert"` | aria-live assertive + los tests esperan el error con `findByRole('alert')` | `findByRole('alert')` |

Ejemplo con el envelope de error de la API (`{code, message, details}` — contrato en `@ugc/core`):

```tsx
{saveError ? (
  <div role="alert" className="text-danger">
    {saveError.message}
    {saveError.details?.suggestion ? <p>{saveError.details.suggestion}</p> : null}
  </div>
) : null}
<output role="status" aria-label="coste estimado">{formatUsd(estimatedCost)}</output>
```

Los nodos custom de React Flow no traen semántica de serie: reciben `role` y `aria-label` explícitos — el detalle en `canvas.md`.

## 6. Composición: señales de alarma

Dos olores concretos disparan la refactorización (y la lectura de la skill instalada `vercel-composition-patterns`, que es la referencia de patrones — no la reinventes aquí):

1. **Proliferación de props booleanas.** `<VariantCard showActions showCost compact isGalleryMode />` es un componente pidiendo dividirse: cada boolean multiplica por dos sus estados internos y sus tests. Si la variación es visual, es una variante `cva` con nombre (§3); si es estructural (qué partes se renderizan), es composición — el padre pasa las partes como `children`/props de slot:

```tsx
// ❌ el componente decide todo por flags
<VariantCard variant={v} showQaReport showPublishButton />

// ✅ el padre compone; VariantCard solo da el marco
<VariantCard variant={v}>
  <QaReportSummary report={v.qaReport} />
  <PublishButton variantId={v.id} />
</VariantCard>
```

2. **Prop drilling.** Un dato que atraviesa ≥2 niveles de componentes que no lo usan. Si es estado del run, la solución NO es Context ad-hoc: es leer del store Zustand con un selector en el componente que lo consume (`state-and-sse.md`). Si es estructura de UI, es composición: pasa el componente ya construido en vez del dato para construirlo abajo.

Regla de cierre: cuando un componente de checkpoint (los más grandes de la app) supere el punto en que ya no cabe en una lectura, se parte por secciones compuestas desde el padre — no por flags.

## 7. Qué NO va aquí

- **Tokens, estilos, traducción de Claude Design, qué clases semánticas existen** → `design-system.md`.
- **Páginas, layouts, server vs client, consumo de la API desde RSC** → `architecture.md`.
- **Canvas React Flow** (nodeTypes, memo, nodos custom, layout) → `canvas.md` (incluye las excepciones a la regla anti-useMemo de §1).
- **Stores Zustand, hook SSE, aplicar deltas** → `state-and-sse.md`.
- **Formularios y editores de checkpoint** (react-hook-form + zodResolver) → `forms.md`.
- **Cómo se testea cualquier cosa de este documento** → `.claude/skills/testing/references/frontend.md` (fuente de verdad; la tabla de §5 solo correlaciona norma↔query, no define estrategia de test).
