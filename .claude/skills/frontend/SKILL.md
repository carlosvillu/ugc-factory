---
name: frontend
description: Estrategia de desarrollo frontend de UGC Factory — apps/web (Next.js App Router, React 19, Tailwind v4, shadcn/ui sobre Base UI, React Flow, Zustand, SSE). Usar SIEMPRE que se cree o modifique una página, componente, hook, store o estilo de apps/web; se traduzca el design system de Claude Design a código; se toque el canvas del pipeline, un panel de checkpoint, un formulario o el cliente SSE; se decida dónde vive un fichero de frontend o cómo se llama; o el usuario pida "haz la UI de", "crea el componente", "monta la página", "aplica el design system". Complementa (nunca sustituye) a la skill testing para todo lo relativo a tests.
---

# Estrategia de frontend — UGC Factory

Esta skill define CÓMO se desarrolla todo el frontend del proyecto (`apps/web`). Es la fuente de verdad única de arquitectura, convenciones y patrones de UI: si un cambio no encaja en lo que describe este documento y sus references, o el cambio está mal planteado o esta skill necesita una actualización deliberada (nunca las dos cosas en silencio). Los tests de todo lo que se construya aquí los define la skill `testing` (léela SIEMPRE junto a esta).

## Principios

1. **El design system vive en Claude Design y el código lo obedece.** La fuente de verdad visual es <https://claude.ai/design/p/d126b2f1-3ada-48c5-84fa-914e891fea6f>, espejada en solo-lectura en `docs/design-system/` (regenerable con la tool `DesignSync`). En código, el DS se materializa como tokens CSS (`globals.css`) + componentes en `components/ui/` que son espejo 1:1 del inventario de Claude Design (construidos en la fase FD del planning). **Usar el componente del DS es OBLIGATORIO (F0 y en adelante)**: si existe `components/ui/<x>`, usarlo es obligatorio y escribir HTML crudo estilado equivalente (`<button>` con clases, `<div role="dialog">` a mano, tabla de `<div>`s…) es un error de review que el reviewer DEBE rechazar; si no existe, se crea siguiendo las foundations del DS (y se sube a Claude Design) antes de usarlo. Los 26 componentes reales, con sus variantes, en `references/design-system.md` §4. Nadie inventa colores, radios ni espaciados: si no está en los tokens, se añade primero al DS. Detalle en `references/design-system.md`.
2. **Todo dato entra y sale por la API REST propia.** Las páginas (server components) leen haciendo fetch a la API del Apéndice E del PRD, y toda mutación es un fetch a esos mismos route handlers — sin Server Actions y sin tocar la BD desde componentes. Una sola superficie de datos, la misma que usan worker y curl, la misma que testea `testing/references/api.md`. El cliente tipado vive en `lib/api-client.ts`.
3. **Server Components por defecto; `'use client'` en las hojas.** Páginas y layouts nunca llevan `'use client'`; la frontera se pone en el componente interactivo más profundo (el canvas, un formulario). La lógica de transformación se extrae SIEMPRE a funciones puras — es lo que la skill de testing puede testear barato y lo que sobrevive a rediseños.
4. **La accesibilidad es la API de test.** Los tests consultan por rol y accessible name (`getByRole('button', { name: /aprobar/i })`): un componente sin roles/labels correctos es un componente que no se puede testear NI usar. HTML semántico primero, label en todo input, aria-label en icon-only, role="status"/"alert" para feedback asíncrono. No es un extra: es contrato.
5. **El estado en vivo tiene un dueño: el store Zustand del run.** El snapshot y los deltas SSE entran por `use-run-events` y se aplican al store del run (creado por página vía Provider, nunca global). Canvas y paneles leen del store con selectores. Nada de estado del run duplicado en useState locales.
6. **Un solo patrón por problema.** Formularios: react-hook-form + zodResolver con los schemas de `@ugc/core`. Fetching: api-client. Variantes visuales: cva. Estado compartido: Zustand. Cuando aparezca la tentación de un segundo patrón "solo para este caso", la respuesta es no (o actualizar esta skill deliberadamente).
7. **Los contratos Zod de `packages/core` son la frontera de tipos.** Los componentes reciben y emiten tipos inferidos de los contratos (`ProductBrief`, `StepRun`...), nunca shapes ad-hoc. Un cambio de contrato debe romper la compilación del frontend — esa es la señal deseada.

## Tabla de decisión: ¿qué voy a construir?

Localiza lo que estás construyendo y lee el reference indicado ANTES de escribir código:

| Vas a escribir… | Reference | Y de testing… |
|---|---|---|
| Una página/ruta nueva, un layout, decidir server vs client, consumir la API desde una página | `references/architecture.md` | `testing/references/e2e.md` |
| Un componente (de dominio o del DS), un hook, decidir dónde vive y cómo se llama | `references/components.md` | `testing/references/frontend.md` |
| Tokens, estilos, un componente nuevo del design system, traducir algo de Claude Design | `references/design-system.md` | — (lo visual se verifica en CUA) |
| El canvas de `/runs/[id]`, un nodo custom, layout del grafo, el panel lateral | `references/canvas.md` | `testing/references/frontend.md` §2–3 |
| El store del run, un store nuevo, el hook SSE, aplicar deltas al estado | `references/state-and-sse.md` | `testing/references/frontend.md` §4 |
| Un formulario o editor de checkpoint (intake, CP1/CP2/CP3, settings) | `references/forms.md` | `testing/references/frontend.md` §5–6 |
| Route handlers, SSE del servidor, auth, cualquier cosa bajo `app/api/` | skill **backend** (`references/api.md`) | `testing/references/api.md` |

Si la pieza cruza varias filas (lo normal: un checkpoint = componente + formulario + store), lee cada reference para su parte.

## Estructura canónica de `apps/web/src`

```
apps/web/src/
├─ app/                  # SOLO routing: page/layout/loading/error delgados + app/api/ (route handlers → skill backend)
├─ components/
│  ├─ ui/                # design system (fase FD): shadcn/ui sobre Base UI, espejo 1:1 de Claude Design — inventario en references/design-system.md §4
│  ├─ run-canvas/        # dominio: canvas React Flow (run-canvas.tsx, steps-to-graph.ts, nodes/…)
│  ├─ checkpoints/       # dominio: CP1–CP4 (brief-editor.tsx, matrix-panel.tsx, script-editor.tsx…)
│  ├─ intake/ gallery/ personas/ library/ metrics/ spend/ settings/
├─ hooks/                # transversales: use-event-source.ts, use-run-events.ts
├─ lib/                  # api-client.ts, format.ts, utils
├─ stores/               # run-store.ts (factory createRunStore + RunStoreProvider)
└─ server/               # SOLO backend de web: db.ts (accessor lazy), context.ts — gobernado por la skill backend
```

Reglas de dependencia (unidireccionales, sin excepciones): `components/ui` no importa de dominios ni de stores; los dominios importan de `ui`/`hooks`/`lib`/`stores`; `app/` solo compone dominios. Tests co-locados `src/**/*.test.ts(x)` como exige testing.

## Convenciones núcleo (el detalle vive en los references)

- **Nombres**: ficheros y carpetas kebab-case (`brief-editor.tsx`), exports PascalCase (`BriefEditor`), hooks camelCase con `use`. Un componente por fichero; el fichero se llama como su export.
- **React 19**: `ref` es una prop normal — `forwardRef` prohibido en código nuevo. Nada de `React.FC`. Function declarations con props tipadas. React Compiler activado: no escribas `useMemo`/`useCallback` preventivos (excepciones de React Flow en `references/canvas.md`).
- **Tailwind v4 CSS-first**: no existe `tailwind.config.js`; tokens en `globals.css` (`:root` dark por defecto + `[data-theme="light"]` + `[data-accent=…]` + `@theme inline`), volcados VERBATIM del DS. Solo clases semánticas de token (`bg-surface`, `text-text-2`); colores crudos prohibidos fuera del fichero de tokens (lint de adherencia desde TD.6).
- **Iconografía sin librerías**: el DS usa glifos Unicode (✓ ✕ ⚠ i ◆ ↺ ▼ +) y dots de estado; `lucide-react`/heroicons/icon fonts están prohibidos — sustituir los imports que genere shadcn. Emojis: nunca.
- **Sin `'use cache'`**: la app es dinámica (datos vivos por SSE); todo fetch con `cache: 'no-store'` vía api-client.
- **Imports de workspace**: `@ugc/core` para contratos y funciones puras; `@/` para `src/`. Prohibido importar `@ugc/db` desde componentes (la BD solo se toca en `app/api/` y `server/`, territorio de la skill backend).
- **Docs actualizadas**: Base UI, React Flow y Tailwind evolucionan — consulta Context7 (MCP configurado en `.mcp.json`) o `reactflow.dev/llms.txt` antes de asumir una API de memoria.

## Skills instaladas complementarias

Jerarquía: PRD/planning > skills propias (testing/frontend/backend) > skills externas. Si una skill externa contradice esto, gana esto.

| Skill | Úsala para |
|---|---|
| `vercel-react-best-practices` | Rendimiento React/Next (waterfalls, bundle, re-renders) al escribir o revisar componentes |
| `vercel-composition-patterns` | Composición cuando un componente acumula props booleanas o prop drilling |
| `web-design-guidelines` | Auditoría de calidad UI/a11y antes de cerrar una tarea con superficie visual |
| `next-dev-loop` | Verificar comportamiento runtime con `next dev` + agent-browser (complementa el gate CUA de testing) |
| `agent-browser` | El gate CUA de cierre de tarea (lo gobierna `testing/references/cua.md`) |

## Definition of Done de una pieza de frontend

1. Convenciones de esta skill respetadas (estructura, nombres, tokens, a11y).
2. Tests según la tabla de decisión de la skill `testing` (¿tiene lógica? → unit; ¿flujo? → E2E) escritos EN la misma tarea.
3. `pnpm lint && pnpm typecheck && pnpm test` en verde.
4. Si cierra una tarea del planning: gate CUA + evidencia (`testing/references/cua.md`) — sin excepciones.

## References

| Archivo | Léelo cuando… |
|---|---|
| `references/architecture.md` | Crees rutas/páginas, decidas server vs client, consumas la API desde web |
| `references/components.md` | Escribas cualquier componente o hook; dudes de nombre o ubicación |
| `references/design-system.md` | Toques tokens/estilos o traduzcas el DS de Claude Design a código |
| `references/canvas.md` | Toques el canvas React Flow, nodos custom, layout del grafo |
| `references/state-and-sse.md` | Toques el store del run, un store nuevo o el cliente SSE |
| `references/forms.md` | Escribas formularios o editores de checkpoint |
