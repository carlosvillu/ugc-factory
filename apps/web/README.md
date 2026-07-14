# `@ugc/web`

**La aplicación Next.js: la interfaz _y_ la API.** App Router, React 19, Tailwind v4, shadcn/ui sobre Base UI, React Flow y Zustand.

Un solo proceso sirve la UI, los _route handlers_ de la API, el stream SSE y los webhooks. Para una herramienta mono-usuario, separar front y back solo añadiría piezas que operar.

## Comandos

```bash
pnpm dev              # desde la raíz: arranca web + worker
pnpm --filter @ugc/web dev        # solo la web (localhost:3000)
pnpm --filter @ugc/web test       # vitest
pnpm --filter @ugc/web test:e2e   # Playwright
```

> El script `dev` no llama a `next dev` directamente: pasa por `scripts/dev.mjs`, un wrapper que inyecta la ruta absoluta de las migraciones. Bajo Turbopack, el `require.resolve` que las localiza devuelve un identificador numérico en vez de una ruta, y el arranque revienta. Es también el motivo de que **el build de producción (`next start`) no arranque todavía**: la causa está diagnosticada y el fix validado, pero se aplica en la tarea del despliegue.

Hay tres scripts de _smoke_ contra el mundo real, útiles para verificar a mano:

```bash
pnpm --filter @ugc/web smoke:assets      # sube un fichero, lo descarga, compara checksum
pnpm --filter @ugc/web smoke:ingest      # INGEST_URL=... → fast path (Shopify/JSON-LD/OG). Red real
pnpm --filter @ugc/web smoke:firecrawl   # FIRECRAWL_URL=... → scrape real. CUESTA DINERO
```

## Las páginas

| Ruta             | Qué es                                                                        |
| ---------------- | ----------------------------------------------------------------------------- |
| `/login`         | Auth mono-usuario (contraseña + cookie firmada)                               |
| `/`              | Home                                                                          |
| `/analyses/new`  | Intake: pega una URL o escribe el producto en texto libre                     |
| `/analyses/[id]` | El análisis y su brief                                                        |
| `/runs`          | Listado de ejecuciones del pipeline                                           |
| **`/runs/[id]`** | **El canvas.** El grafo de nodos en vivo: estado, coste, outputs, checkpoints |
| `/personas`      | La librería de avatares                                                       |
| `/spend`         | El ledger de gasto                                                            |
| `/settings`      | Claves de proveedor (se guardan cifradas en BD) y preferencias                |
| `/design-system` | Las ~26 primitivas del design system, en vivo                                 |

## La API

Todo `route handler` pasa por `withRoute` (auth, logging con contexto de petición, y serialización del error a un `ErrorEnvelope` tipado). **La UI nunca lee la base de datos directamente**: siempre a través de esta API.

| Endpoint                                           | Métodos                                        |
| -------------------------------------------------- | ---------------------------------------------- |
| `/api/health`                                      | `GET`                                          |
| `/api/login`                                       | `POST`                                         |
| `/api/analyses`                                    | `POST`                                         |
| `/api/runs` · `/api/runs/[id]`                     | `GET`, `POST` · `GET`, `PATCH`                 |
| **`/api/runs/[id]/events`**                        | `GET` — **SSE**: snapshot + deltas + heartbeat |
| `/api/runs/[id]/cancel`                            | `POST`                                         |
| `/api/steps/[id]`                                  | `GET`                                          |
| `/api/steps/[id]/{approve,edit,reject,skip,retry}` | `POST` — las operaciones de checkpoint         |
| `/api/briefs/[id]`                                 | `GET`, `PATCH`                                 |
| `/api/assets` · `/api/assets/[id]/download`        | `POST` (multipart) · `GET`                     |
| `/api/personas` · `/api/personas/[id]`             | `GET`, `POST` · `GET`, `PATCH`, `DELETE`       |
| `/api/personas/candidates`                         | `GET`                                          |
| `/api/settings`                                    | `GET`, `PATCH`                                 |
| `/api/spend`                                       | `GET`                                          |

## El canvas y el realtime

Es la pieza que define el producto. `src/components/run-canvas/` traduce las filas de `step_run` a un grafo de React Flow (con layout automático vía dagre) y lo mantiene vivo:

**Postgres `NOTIFY` → el handler SSE → `useRunEvents` → un reductor de eventos → el store de Zustand → el canvas.** El servidor manda un snapshot al conectar y luego solo deltas; el cliente reconecta solo y reconcilia. No hay _polling_.

Cuando un step entra en `waiting_approval`, el nodo cambia de color y el panel lateral ofrece editar el artefacto y continuar. El editor del brief (`src/components/checkpoints/brief-editor.tsx`) es el checkpoint mejor acabado: edición campo a campo con las marcas de _extraído_ vs _inferido_.

## Estructura

- `src/app/` — páginas (grupo `(app)`) y `api/`
- `src/components/` — `ui/` (design system), `run-canvas/`, `checkpoints/`, `intake/`, `personas/`, `runs/`, `settings/`, `spend/`
- `src/server/` — la capa de API compartida: `withRoute`, sesión, rate-limit, errores, acceso a BD y a la cola
- `src/hooks/` + `src/stores/` — el cliente SSE y el estado del canvas
- `e2e/` — Playwright, con proveedores externos falsos: determinista y gratis

## Convenciones

- **Todo pasa por la API.** Sin _server actions_, sin lecturas directas a BD desde los componentes.
- **Los componentes salen del design system.** HTML crudo donde ya existe una primitiva es un error de review.
- Cada página con pantalla propia parte de un mockup aprobado en `docs/mockups/`.
