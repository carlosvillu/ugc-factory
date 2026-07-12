# Arquitectura de apps/web — rutas, server/client y datos

Cómo se estructura `apps/web` (Next.js 16 App Router): qué páginas existen, dónde va la frontera server/client y por dónde entran y salen TODOS los datos. Las reglas de estructura de carpetas y dependencias viven en el SKILL.md; aquí está el detalle de aplicarlas al routing y al data fetching.

## Índice

1. [Rutas y `app/`](#1-rutas-y-app)
2. [Server vs Client Components](#2-server-vs-client-components)
3. [Datos: todo vía API REST propia](#3-datos-todo-vía-api-rest-propia)
4. [Por qué NO Server Actions ni lecturas directas a BD](#4-por-qué-no-server-actions-ni-lecturas-directas-a-bd)
5. [Qué NO va aquí](#5-qué-no-va-aquí)

---

## 1. Rutas y `app/`

### 1.1 Mapa de rutas (PRD §8.1) → ficheros

| Ruta | Fichero | Dominio que compone |
|---|---|---|
| `/` | `app/(app)/page.tsx` | Home: accesos a lo que existe. Los KPIs/lotes del mockup llegan en T5.10 |
| `/analyses/new` | `app/(app)/analyses/new/page.tsx` | Intake del análisis, 2 modos (`components/intake/`) |
| `/analyses/[id]` | `app/(app)/analyses/[id]/page.tsx` | Análisis creado/reutilizado (T1.6) |
| `/projects/[id]` | `app/(app)/projects/[id]/page.tsx` | Proyecto: briefs, lotes, variantes, métricas |
| `/runs/[id]` | `app/(app)/runs/[id]/page.tsx` | ★ Canvas del pipeline (`components/run-canvas/`) |
| `/library` | `app/(app)/library/page.tsx` | Biblioteca de variantes (`components/library/`) |
| `/gallery` | `app/(app)/gallery/page.tsx` | Galería de prompts (`components/gallery/`) |
| `/personas` | `app/(app)/personas/page.tsx` | Librería de personas (`components/personas/`) |
| `/metrics` | `app/(app)/metrics/page.tsx` | Dashboard de performance (`components/metrics/`) |
| `/spend` | `app/(app)/spend/page.tsx` | Panel de gasto (`components/spend/`) |
| `/settings` | `app/(app)/settings/page.tsx` | Credenciales, presets, umbrales (`components/settings/`) |
| `/design-system` | `app/(app)/design-system/page.tsx` | Showcase de tokens y componentes (FD) |
| `/login` | `app/login/page.tsx` | Login single-user (T0.4) — fuera de todo grupo, sin nav |

### 1.2 Route groups: `(app)` (todo lo autenticado) vs `login`

> **Reescrito en T1.13.** Esta sección describía un grupo `(dashboard)` con **nav LATERAL** (`<SideNav/>`) y `runs/[id]` **fuera** del grupo. El código real hace las tres cosas al revés, y a propósito: el **mockup vinculante** del dashboard (`docs/mockups/dashboard.html`, variante 2a — skill §4b) dibuja una **topbar HORIZONTAL**, no un rail lateral. Manda el mockup (jerarquía PRD/planning > skills), así que la skill se actualiza para no seguir publicando un layout que nadie va a construir.

```
app/
├─ (app)/                  # grupo con el CHROME GLOBAL compartido
│  ├─ layout.tsx           # <AppNav/> (topbar) + región de contenido scrollable
│  ├─ page.tsx             # /
│  ├─ analyses/new/  analyses/[id]/
│  ├─ runs/[id]/           # DENTRO del grupo: el canvas cuelga de la topbar
│  │  ├─ page.tsx
│  │  ├─ loading.tsx       # skeleton del canvas
│  │  └─ error.tsx
│  ├─ library/  gallery/  personas/  metrics/  spend/  settings/  design-system/
├─ login/page.tsx          # FUERA del grupo: sin sesión, sin nav
├─ api/                    # route handlers → skill backend (references/api.md)
└─ layout.tsx              # root: html/body, tokens, fuentes
```

Por qué **`/runs/[id]` SÍ va dentro del grupo**: la topbar es el chrome global de la app y el canvas no es una excepción — sin ella, la página del run sería un callejón sin salida (hoy no tiene ninguna forma de volver). El viewport se reparte en el layout (`h-dvh` en columna flex; el hijo, `min-h-0 flex-1`), así que el canvas ocupa **todo el alto restante bajo la topbar** y sigue siendo full-bleed: `run-shell` usa `h-full`, no `h-dvh` — quien fija el viewport es el layout, no la página. No hace falta ningún `if` condicional en el layout.

**`/login` queda fuera** porque no hay sesión que navegar: enseñar «Inicio · Canvas · …» a quien el proxy va a rebotar sería enlazar a páginas prohibidas. La protección de rutas NO se hace en layouts: vive en `proxy.ts` (Next 16 sustituye a `middleware.ts`) y en los propios handlers — territorio de la skill backend.

**Los destinos de la nav no se declaran en el componente**: viven en `lib/routes.ts` (label, `href`, `matches`, `pending`, `description`), la fuente de verdad que comparten la topbar y las tarjetas de la home. Dos reglas que salieron de T1.13 y que valen para toda superficie de navegación:

- **Los destinos de fases futuras se MUESTRAN, deshabilitados** (el mockup los tiene): `aria-disabled`, fuera del orden de tabulación, sin `href`, y con el motivo **en el nombre accesible** (`aria-label="Biblioteca · llega en la fase F2 (guiones y variantes)"`) — no solo en un `title`, que únicamente aparece con el hover del ratón. Activar uno cuando cierre su fase es **darle `href`**: aparece solo en la nav Y en la home.
- **«Resaltado» y «página actual» son DOS preguntas, no un booleano.** El resaltado VISUAL usa prefijos de área (`isHighlighted`: `/runs/x` resalta «Canvas»); `aria-current="page"` exige **igualdad exacta** (`isCurrentPage`). Fusionarlas hace que el lector de pantalla anuncie «Canvas, página actual» dentro de un run, cuando activar ese enlace te llevaría a un formulario de intake vacío.

### 1.3 `page/layout/loading/error` delgados

- **`page.tsx`**: `await params` → fetch vía api-client → componer componentes de dominio. Objetivo ~20 líneas; CERO lógica de transformación (va a funciones puras, §2.3) y CERO JSX de presentación más allá de componer. Por qué: una página delgada no necesita tests propios — su contenido lo cubren los tests del dominio y el E2E de la ruta.
- **`layout.tsx`**: estructura + providers compartidos. Nunca fetch de datos que solo usa una página hija.
- **`loading.tsx`**: skeleton con componentes del DS (`components/ui/skeleton.tsx`). Existe en toda ruta que hace fetch — el streaming de RSC lo muestra gratis mientras la página espera a la API.
- **`error.tsx`**: la ÚNICA pieza de `app/` que lleva `'use client'` (lo exige Next). Pinta el mensaje del error + botón reset; sin lógica de recuperación propia.

### 1.4 Async request APIs (Next 16): `await` SIEMPRE

En Next 16 `params`, `searchParams`, `cookies()` y `headers()` son asíncronos. Tipa `params` como `Promise<...>` y haz `await` sin excepción — el acceso síncrono está eliminado, no deprecado:

```tsx
// app/(app)/library/page.tsx
interface LibraryPageProps {
  searchParams: Promise<{ status?: string; project?: string }>;
}

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const { status, project } = await searchParams;
  const variants = await api.get(
    `/api/variants?${new URLSearchParams({ ...(status && { status }), ...(project && { project }) })}`,
    AdVariantListSchema,
  );
  return <VariantGrid variants={variants} />;
}
```

Los filtros de listados (estado de variante, proyecto) van en `searchParams`, no en estado de cliente: URL compartible y el E2E de testing puede navegar directo al estado filtrado.

## 2. Server vs Client Components

### 2.1 Reglas prácticas

1. **Páginas y layouts son Server Components SIEMPRE.** Nunca `'use client'` en un fichero de `app/` (excepción única: `error.tsx`).
2. **`'use client'` en el componente interactivo más profundo** — el canvas, el formulario, el player. No en su contenedor "por si acaso": cada nivel que marcas como client arrastra todo su subárbol de imports al bundle.
3. **Children pattern para providers**: un provider client (`RunStoreProvider`, `ThemeProvider`) recibe `children` y NO los convierte en client — los RSC pasan a través como contenido ya renderizado. Es la forma de tener store Zustand por página sin renunciar a que la página sea RSC.
4. **Props serializables = objetos de contratos Zod.** La frontera RSC→client solo transporta JSON plano: pasa `RunSnapshot`, `StepRun`, `ProductBrief` (tipos inferidos de `@ugc/core`), nunca funciones, class instances ni shapes ad-hoc. Si necesitas pasar un callback hacia abajo, la frontera está mal puesta: baja el `'use client'` o mueve el estado al store.
5. **Client-only real (React Flow) se resuelve con un wrapper client**, no con `dynamic(..., { ssr: false })` en la página — eso está prohibido dentro de un RSC. `RunCanvas` es un client component que se auto-monta tras hidratar; la página lo compone como a cualquier otro.

### 2.2 Ejemplo canónico: `runs/[id]/page.tsx`

```tsx
// app/runs/[id]/page.tsx — RSC delgado: fetch → provider → shell → dominio
import { notFound } from 'next/navigation';
import { RunSnapshotSchema } from '@ugc/core/contracts';
import { ApiError } from '@/lib/api-client';
import { api } from '@/lib/api-server';
import { RunStoreProvider } from '@/stores/run-store';
import { RunShell } from '@/components/run-canvas/run-shell';

interface RunPageProps {
  params: Promise<{ id: string }>;
}

export default async function RunPage({ params }: RunPageProps) {
  const { id } = await params;

  let snapshot;
  try {
    snapshot = await api.get(`/api/runs/${id}`, RunSnapshotSchema);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e; // el resto lo captura error.tsx
  }

  return (
    <RunStoreProvider initial={snapshot}>
      <RunShell runId={id} />
    </RunStoreProvider>
  );
}
```

```tsx
// apps/web/src/components/run-canvas/run-shell.tsx — el ÚNICO sitio que monta el SSE
'use client';
import { useRunEvents } from '@/hooks/use-run-events';
import { RunCanvas } from './run-canvas';
import { StepPanel } from './step-panel';

export function RunShell({ runId }: { runId: string }) {
  const { status } = useRunEvents(runId); // SSE → store (state-and-sse.md §5); se monta UNA vez
  return (
    <div className="flex h-dvh">
      <RunCanvas />          {/* sin props: lee del store (canvas.md §5) */}
      <StepPanel />
      <output role="status" aria-label="conexión" className="sr-only">{status}</output>
    </div>
  );
}
```

El RSC hace el fetch inicial (snapshot con el que se pinta el primer frame del canvas, sin flash de loading en cliente); `RunStoreProvider` (client, children pattern) crea el store por página con ese `initial`; `RunShell` (client) monta `useRunEvents` una única vez y compone canvas + panel, que leen del store con selectores. Detalle del store y SSE en `references/state-and-sse.md`; del canvas, en `references/canvas.md`.

Si una página necesita varios recursos, lánzalos en paralelo (`Promise.all`) — un `await` secuencial por recurso es el waterfall clásico que `vercel-react-best-practices` te va a señalar.

### 2.3 Lógica fuera de los componentes

Los server components async NO se pueden renderizar con Testing Library (testing/references/frontend.md §1). La regla es estructural, no de tests: **toda transformación de datos vive en funciones puras** y el componente solo las llama.

- **Dónde**: la lógica extraída de un **server component** va a `lib/` o a `packages/core` (es la regla de testing/frontend.md §1 — un RSC no importa de carpetas de componentes); la lógica de un **client component** se co-loca junto a él (`components/run-canvas/steps-to-graph.ts`); lo que también use el backend/worker, a `packages/core`.
- **Por qué**: una función pura `aggregateSpendByProject(entries: CostEntry[])` se testea como unit sin jsdom en milisegundos; la misma lógica inline en el RSC del dashboard es intesteable salvo por E2E. Además sobrevive a cualquier rediseño del componente.

## 3. Datos: todo vía API REST propia

**Decisión vinculante**: las páginas leen haciendo fetch a la API interna (Apéndice E del PRD) y toda mutación es un fetch a esos mismos route handlers. En web NO hay DAL, NO hay Server Actions, NO hay `'use cache'` (app dinámica: datos vivos por SSE). La única pieza que implementa esto es `lib/api-client.ts` — nadie escribe `fetch` a mano contra la API.

### 3.1 Spec de `lib/api-client.ts`

| Aspecto | Regla |
|---|---|
| Dos entradas | `lib/api-client.ts` (isomorfo, importable desde `'use client'`) y `lib/api-server.ts` (`import 'server-only'`, SOLO para RSC). `next/headers` es server-only a nivel de grafo de módulos: un módulo compartido con client components no puede importarlo ni dinámicamente. |
| Base URL | **En servidor (RSC y jsdom): `resolveServerBaseUrl(process.env)` — función pura, PRECEDENCIA `INTERNAL_API_URL` (override explícito: otro host/proxy) > `http://localhost:${PORT}` (DERIVADA del puerto real: el web se llama A SÍ MISMO, y `PORT` es la var que Next lee para elegir puerto) > `http://localhost:3000` (default de Next).** Corregido en **T1.13**: la base estaba HARDCODEADA al 3000 y cualquier arranque en otro puerto tumbaba con 500 todas las páginas RSC — y ningún test lo cazaba porque el stack E2E fijaba `INTERNAL_API_URL` a mano (la muleta se retiró: el stack sirve en :3100 y ejercita la derivación). Del `PORT` se valida la FORMA (dígitos: un `PORT=abc` daría una URL inválida), **nunca el RANGO** — `PORT=99999` impide que Next arranque (⇒ el resolver jamás se llama con él) y rechazar `PORT=0` sería peor que no validar: Next SÍ arranca con él (en un puerto EFÍMERO) y caer al 3000 reintroduciría el mismo 500. La lección: **`process.env.PORT` no es «el puerto del servidor», es «el puerto que se PIDIÓ»** — con `PORT=0` difieren, y ninguna validación del env puede arreglarlo (el puerto real solo existe en el socket). `PORT=0` es **no soportado**: el proyecto es self-hosted de puerto fijo. En cliente: rutas RELATIVAS (`''`) — la base es el propio origin y `PORT` no significa nada ahí; el guard de `typeof window` va PRIMERO. En jsdom el fetch de Node exige URL absoluta (testing/frontend.md §6) y los handlers msw usan patrones `*/api/...`, así que el puerto resuelto da igual. |
| Auth | `api-server` reenvía la cookie de sesión con `cookies()` de `next/headers` (el fetch de RSC no la propaga solo). En cliente el navegador la manda gratis. |
| Cache | `cache: 'no-store'` SIEMPRE, fijado por el cliente — nadie lo decide por llamada. |
| Validación | Toda respuesta se parsea con el schema Zod de `@ugc/core` que se le pasa. Respuesta que no cumple el contrato = error, no datos corruptos aguas abajo. |
| Errores | HTTP no-ok → parsea el envelope `{code, message, details?}` (contrato Zod de core) y lanza `ApiError` tipada con `code`, `status` y `details`. |

```ts
// apps/web/src/lib/api-client.ts — núcleo isomorfo; lo importan los client components
import { z } from 'zod';
import { ErrorEnvelopeSchema, type ErrorEnvelope } from '@ugc/core/contracts';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorEnvelope['code'],
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Base de SERVIDOR por precedencia (T1.13): `resolveServerBaseUrl(env)` — función PURA sobre el
// env, definida en el propio api-client.ts (no se copia su cuerpo aquí: la tabla de arriba es el
// contrato; el código es el código). Su precedencia se testea en api-client.test.ts.
//
// En navegador: relativa (el origin propio). En jsdom (tests) o servidor: absoluta (el fetch de
// Node la exige — testing/frontend.md §6). El guard de `typeof window` va PRIMERO: `PORT` es
// config del PROCESO servidor y no significa nada en cliente.
const base = () =>
  typeof window === 'undefined' || process.env.NODE_ENV === 'test'
    ? resolveServerBaseUrl(process.env)
    : '';

export async function apiFetch<S extends z.ZodType>(
  path: string,
  schema: S,
  init: RequestInit & { baseUrl?: string } = {},
): Promise<z.infer<S>> {
  const { baseUrl, ...rest } = init;
  const res = await fetch(`${baseUrl ?? base()}${path}`, { ...rest, cache: 'no-store' });

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const envelope = ErrorEnvelopeSchema.safeParse(body);
    if (envelope.success) {
      throw new ApiError(envelope.data.code, envelope.data.message, res.status, envelope.data.details);
    }
    throw new ApiError('internal', `Respuesta sin envelope de ${path}`, res.status);
  }

  return schema.parse(await res.json()) as z.infer<S>;
}

const json = (body: unknown, method: string): RequestInit => ({
  method,
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
});

export const api = {
  get: <S extends z.ZodType>(path: string, schema: S) => apiFetch(path, schema),
  post: <S extends z.ZodType>(path: string, schema: S, body: unknown) => apiFetch(path, schema, json(body, 'POST')),
  patch: <S extends z.ZodType>(path: string, schema: S, body: unknown) => apiFetch(path, schema, json(body, 'PATCH')),
  del: <S extends z.ZodType>(path: string, schema: S) => apiFetch(path, schema, { method: 'DELETE' }), // CRUD de galería/personas (Apéndice E)
};
```

```ts
// apps/web/src/lib/api-server.ts — SOLO server components: cookie de sesión + base interna
import 'server-only';
import { cookies } from 'next/headers';
import type { z } from 'zod';
import { apiFetch } from './api-client';

async function serverFetch<S extends z.ZodType>(path: string, schema: S, init: RequestInit = {}) {
  const cookieHeader = (await cookies()).toString(); // hace la página dinámica: correcto, sin 'use cache' todo es dinámico
  return apiFetch(path, schema, {
    ...init,
    baseUrl: resolveServerBaseUrl(process.env), // T1.13: NUNCA un puerto hardcodeado
    headers: { ...init.headers, ...(cookieHeader && { cookie: cookieHeader }) },
  });
}

export const api = {
  get: <S extends z.ZodType>(path: string, schema: S) => serverFetch(path, schema),
  // post/patch/del: mismo molde que api-client, envolviendo serverFetch
};
```

Regla de imports: los RSC importan `api` de `@/lib/api-server`; los client components, de `@/lib/api-client`. `import 'server-only'` convierte el error de importar el módulo equivocado en fallo de build, no de runtime.

### 3.2 Uso: un GET (RSC) y un POST (client)

```tsx
// GET desde un server component — app/(app)/spend/page.tsx
import { SpendLedgerSchema } from '@ugc/core/contracts';
import { api } from '@/lib/api-server';
import { aggregateByProvider } from '@/lib/spend'; // función pura consumida por RSC: vive en lib/ (§2.3)
import { SpendTable } from '@/components/spend/spend-table';

export default async function SpendPage() {
  const ledger = await api.get('/api/spend', SpendLedgerSchema);
  return <SpendTable rows={aggregateByProvider(ledger)} />;
}
```

```ts
// POST desde un client component — aprobar un checkpoint (CP1–CP4)
'use client';
import { StepRunSchema } from '@ugc/core/contracts';
import { api, ApiError } from '@/lib/api-client';
import { useRunStore } from '@/stores/run-store';

export function useApproveStep() {
  const applyStepChanged = useRunStore((s) => s.applyStepChanged);

  return async function approveStep(stepId: string) {
    try {
      const step = await api.post(`/api/steps/${stepId}/approve`, StepRunSchema, {});
      // El SSE traerá el delta igualmente; aplicarlo ya elimina el lag percibido.
      applyStepChanged({ stepId: step.id, status: step.status, cost: step.costActual, outputExcerpt: step.outputExcerpt });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invalid_transition') {
        return; // otro cliente aprobó antes; el snapshot SSE ya lo reflejará
      }
      throw e;
    }
  };
}
```

El `code` tipado de `ApiError` es la rama de decisión de la UI: `validation_error` → errores de campo con `details` (patrón completo en `references/forms.md`), `guardrail_blocked` → alert accesible con la sugerencia, resto → error genérico. Nunca hagas branch sobre `message` (texto para humanos, cambia sin aviso).

## 4. Por qué NO Server Actions ni lecturas directas a BD

Decisión del usuario: **una sola superficie de datos**. La API REST del Apéndice E es la que consume el navegador, la que consume el worker, la que golpeas con `curl` en las verificaciones de tarea y la que testea `testing/references/api.md` contra Postgres real. Server Actions (o un DAL con lecturas Drizzle en RSC) crearían una segunda superficie con su propia auth, su propia validación y su propio hueco de tests — cada mutación existiría dos veces o, peor, solo en la versión que la suite de API no ve. El coste real es un hop HTTP interno en cada lectura de RSC (el web se llama a sí mismo): milisegundos en loopback/red de compose, irrelevante para una app single-user self-hosted. Se aceptó el hop a cambio de que "funciona por curl" y "funciona en la UI" sean literalmente la misma afirmación.

Corolario: si al escribir una página sientes la necesidad de un dato que la API no expone, la tarea tiene una subtarea de backend (nuevo endpoint en el Apéndice E, skill backend) — no un atajo a `@ugc/db` desde web.

## 5. Qué NO va aquí

- **Route handlers, SSE de servidor, auth, `proxy.ts`, todo bajo `app/api/` y `server/`** → skill **backend**, `references/api.md`.
- **Componentes y hooks (nombres, ubicación, patrones)** → `references/components.md`.
- **Store del run, `use-run-events`, cliente SSE** → `references/state-and-sse.md`.
- **Formularios y mapeo del envelope a errores de campo** → `references/forms.md`.
- **Tests de páginas y componentes** → skill **testing**: `references/frontend.md` (jsdom) y `references/e2e.md` (Playwright); el cierre de tarea siempre pasa por `references/cua.md`.
