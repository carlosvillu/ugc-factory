# Planning — UGC Factory

> Plan de ejecución del `PRD.md` (v1, aprobado 2026-07-06). Fases → tareas → subtareas.
>
> **Filosofía baby steps**: cada tarea es autocontenida (se empieza y se termina en una sesión de trabajo), deja el sistema en un estado funcional (nunca a medias), y termina con una **verificación en el mundo real**: una acción concreta con un resultado observable que demuestra sin lugar a dudas que funciona — no "el código compila", sino "hago X y veo Y". Ninguna verificación depende de piezas que aún no se hayan construido en el momento de la tarea.
>
> Convenciones: `[ ]` pendiente · `[x]` hecha (marcar al completar, con fecha) · **Depende de** lista los IDs que deben estar hechos antes (el orden real lo dicta este grafo, no la numeración) · ⚠ marca prerequisitos externos que debe hacer el usuario · las referencias `§` apuntan al PRD; las `research/` a los informes. Los ítems `[verificar]` del PRD se cierran dentro de la tarea que integra ese componente.

## Estado global

| Fase | Nombre | Entrega observable al cerrar la fase | Estado |
|---|---|---|---|
| F0 | Fundaciones | Un DAG de demo corre en el canvas en el VPS con checkpoints, SSE, credenciales y gasto registrado | ☐ |
| FD | Design system | `/design-system` muestra tokens y ~26 componentes fieles a Claude Design (dark/light, 4 acentos), lint de adherencia activo y skill frontend actualizada — se ejecuta tras T0.1, antes de continuar F0 | ☐ |
| F1 | Análisis | URL real (o texto libre) → ProductBrief editable aprobado en CP1 | ☐ |
| F2 | Estrategia y guiones (incluye Personas v1 y recetas) | Brief → matriz con coste estimado → guiones aprobados en CP3 | ☐ |
| F3 | Galería y compilador | Templates facetados + compilador que produce `resolvedPrompt` auditables | ☐ |
| F4 | Generación fal | Todos los assets de una variante generados de verdad vía fal.ai | ☐ |
| F5 | Composición y export | Anuncio completo 9:16 con captions karaoke, C2PA y QA descargable | ☐ |
| F6 | Publicación | Variante publicada en TikTok/IG y ad draft creado desde la herramienta | ☐ |
| F7 | Medición y flywheel | Métricas por variante en el dashboard + kill/scale + scoring realimentado | ☐ |
| F8 | Operación y extensiones | Backups, retención, presets por plataforma, observabilidad, MCP (backlog) | ☐ |

**Hitos de valor real** (el producto es útil antes de terminar): tras F1 ya analiza productos; tras F2 ya escribe guiones utilizables a mano; tras F4+F5 ya fabrica anuncios completos; F6–F7 cierran el loop.

---

## F0 — Fundaciones

El corazón de esta fase es el **orquestador** (§9.0): la máquina de estados transaccional del DAG. Todo lo demás del producto se cuelga de él. Al cerrar F0 no hay ninguna feature de negocio, pero el esqueleto completo (pipeline visual con checkpoints en el VPS) funciona con steps de demo.

#### T0.1 · Monorepo y esqueleto de proyectos [x] 2026-07-07 — PASS, ver docs/verifications/T0.1/ (coste $0)
- **Depende de**: —
- **Entrega**: pnpm workspaces con `apps/web` (Next.js App Router + Tailwind), `apps/worker` (Node TS), `packages/core`, `packages/db`; tsconfig/eslint/prettier compartidos; **logging estructurado (pino)** con campos de correlación (`run_id`/`step_id`/`request_id`) desde el día 1; script `pnpm dev` levanta web y worker.
- **Subtareas**:
  - [x] Inicializar workspaces y los 4 paquetes con sus builds.
  - [x] `packages/core`: carpeta `contracts/` con un primer schema Zod trivial compartido e importado desde web y worker.
  - [x] Logger pino compartido con serializers de correlación.
  - [x] Página raíz de Next con "UGC Factory" y healthcheck `/api/health`; el worker arranca y loggea "worker ready".
- **Verificación**: `pnpm build && pnpm dev` → `curl localhost:3000/api/health` devuelve `{ok:true}` y el log del worker muestra "worker ready" en JSON estructurado. Un cambio en un tipo de `packages/core` rompe la compilación de ambas apps (se comprueba a propósito).

#### T0.2 · Docker Compose de desarrollo con Postgres
- **Depende de**: T0.1, TD.7 *(dependencia de orden, no técnica: el usuario decidió el 2026-07-07 que la fase FD se construye entera antes de continuar F0)*
- **Entrega**: `docker-compose.dev.yml` con `postgres:16` (volumen persistente) y variables de entorno de conexión.
- **Subtareas**:
  - [ ] Compose + `.env.example` documentado.
  - [ ] Web y worker se conectan al arrancar (ping de conexión en el healthcheck).
- **Verificación**: `docker compose -f docker-compose.dev.yml up -d` → `/api/health` devuelve `{ok:true, db:true}`; parar Postgres hace que devuelva `db:false` sin tumbar la app.

#### T0.3 · Drizzle + primera migración
- **Depende de**: T0.2
- **Entrega**: Drizzle configurado en `packages/db`; migración inicial con `project`, `app_setting`, `audit_log`; script `db:migrate` con lock en el arranque de web (§18.2).
- **Subtareas**:
  - [ ] Schema Drizzle + generación de migraciones + runner.
  - [ ] Repos tipados mínimos (create/get project).
- **Verificación**: `pnpm db:migrate` sobre BD vacía crea las tablas (visible con `psql \dt`); crear un project vía un script de smoke y leerlo de vuelta.

#### T0.4 · Auth single-user
- **Depende de**: T0.3
- **Entrega**: login con password (hash en `app_setting`), sesión con cookie httpOnly, middleware que protege todas las rutas salvo login/health/webhooks; rate limit de login.
- **Verificación**: en navegador, acceder a `/` sin sesión redirige a login; password incorrecto 3 veces → rate limit visible; con password correcto se entra y la cookie sobrevive a un refresh.

#### T0.5 · StorageAdapter local + download proxificado
- **Depende de**: T0.3
- **Entrega**: interfaz `StorageAdapter` (put/get/stat/delete) con implementación filesystem (`/data/assets`), tabla `asset` (subset mínimo: id, kind, storage_key, mime, bytes, checksum) y endpoint `GET /api/assets/:id/download` (streaming, autenticado, nunca ruta cruda; §19.2).
- **Verificación**: subir un fichero con un script de smoke → aparece en `/data/assets` con su fila en `asset` → descargarlo por `/api/assets/:id/download` con checksum idéntico; sin sesión, el endpoint devuelve 401.

#### T0.6 · pg-boss operativo en el worker
- **Depende de**: T0.3
- **Entrega**: pg-boss inicializado; job de demo `noop` con retries/backoff; helper `enqueue()` en `packages/core`.
- **Verificación**: encolar 10 jobs `noop` con 30 % de fallo configurado → el log muestra ejecuciones y reintentos; la tabla de pg-boss muestra todos en `completed` al final.

#### T0.7a · Máquina de estados transaccional
- **Depende de**: T0.6
- **Entrega**: migración de `pipeline_run` + `step_run` completas (§12, incl. `supersedes_id` y enums de §7.1) y el núcleo del módulo `orchestrator` (§9.0): `transition(stepId, event)` transaccional (`SELECT … FOR UPDATE`), tabla de transiciones válidas, resolución de `depends_on` y encolado en pg-boss **dentro de la misma transacción**, y `NOTIFY pipeline_events`.
- **Subtareas**:
  - [ ] Migración + enums.
  - [ ] `transition()` + tests unitarios exhaustivos (toda transición ilegal rechaza).
  - [ ] Resolución de dependencias + encolado transaccional + NOTIFY.
- **Verificación**: script contra la BD real que ejecuta una secuencia de transiciones legales e ilegales: las legales dejan las filas con los estados/timestamps esperados, las ilegales lanzan error sin tocar la BD; en una sesión `psql` con `LISTEN pipeline_events` se ve el NOTIFY de cada transición.

#### T0.7b · Runs, consumer genérico y executors de demo
- **Depende de**: T0.7a
- **Entrega**: creación de run desde una definición de DAG (nodos + depends_on; estados iniciales `awaiting_deps`/`pending`), endpoint `POST /api/runs`, consumer genérico de pg-boss que ejecuta el executor registrado por `node_key` y llama a `transition`, y **executors de demo con flags configurables** (`sleep_ms`, `fail_rate`, `hang` — necesarios para verificar timeouts y retries después).
- **Verificación**: `POST /api/runs` con el DAG de demo → los 3 steps pasan `pending→queued→running→succeeded` en orden (filas con timestamps coherentes); 20 runs concurrentes completan sin interbloqueos ni estados corruptos (script de concurrencia).

#### T0.8 · Checkpoints, aprobación, invalidación, skip y cancel
- **Depende de**: T0.7b
- **Entrega**: soporte `is_checkpoint` (estado `waiting_approval`), endpoints `approve/edit/reject` + `POST /api/steps/:id/skip` y `POST /api/runs/:id/cancel` (transiciones `skipped`/`cancelled`), invalidación de sub-grafo con `supersedes_id` (nunca reset de filas), flag `autopilot` con override por nodo, y **escritura en `audit_log` del diff artefacto-IA vs artefacto-editado** en cada edit/approve/reject (§19.1).
- **Verificación**: run de demo con checkpoint → se pausa; `approve` reanuda; `edit` crea nueva fila del step aguas abajo con `supersedes_id` (la antigua queda `superseded`) y el diff aparece en `audit_log` (query); `skip` sobre un nodo skippable lo salta y el run completa; `cancel` detiene un run en curso; con `autopilot=true` no hay pausas y el override "parar siempre aquí" gana.

#### T0.9 · Timeouts, retries y cron de barrido
- **Depende de**: T0.7b
- **Entrega**: `timeout_at` por step (por tipo de nodo), cron pg-boss que expira steps colgados (`expired`), retry manual (`POST /api/steps/:id/retry`) y automático hasta `max_retries`.
- **Verificación**: un executor de demo con `hang=true` y timeout de 10 s → el step pasa a `expired` en <40 s sin intervención; `retry` sobre un step con `fail_rate=1` forzado a 0 lo re-ejecuta y completa.

#### T0.10 · SSE sobre LISTEN/NOTIFY
- **Depende de**: T0.7b
- **Entrega**: `GET /api/runs/:id/events` (route handler Node streaming): evento `snapshot` al conectar, deltas `step_changed` vía LISTEN/NOTIFY, `heartbeat` cada 25 s, `id:` monotónico + re-snapshot con `Last-Event-ID` (§9.0); contrato de eventos en `packages/core`.
- **Verificación**: `curl -N /api/runs/:id/events` durante un run de demo → snapshot, deltas por transición y heartbeats visibles; matar y reabrir el curl con `Last-Event-ID` re-sincroniza sin perder el estado final.

#### T0.11 · Canvas React Flow v1
- **Depende de**: T0.8, T0.9, T0.10
- **Entrega**: página `/runs/[id]` con grafo (layout automático dagre/elkjs), nodos con estado/color/duración (y coste si existe), panel lateral al click con **visor de logs y errores del step** (§8.2), botones de checkpoint (aprobar/editar/rechazar), retry, skip, cancelar lote y toggle autopilot.
- **Verificación**: en el navegador, lanzar el run de demo y **ver los nodos cambiar de color en vivo**; aprobar el checkpoint desde el panel; provocar un fallo (`fail_rate=1`) y ver el error en el visor de logs del nodo; retry con éxito; cancelar otro run en curso desde el botón.

#### T0.12 · Ledger de gasto (esqueleto)
- **Depende de**: T0.7b
- **Entrega**: tablas `cost_entry` y `budget`; helper `recordCost()`; página `/spend` v1 con totales por día/proveedor y alerta in-app al superar el presupuesto. (El panel completo — vistas por proyecto/lote/tier, freno, email — llega en T7.7.)
- **Verificación**: tras 3 runs de demo con coste ficticio, `/spend` muestra la suma exacta esperada; un presupuesto de prueba por debajo del gasto dispara la alerta in-app.

#### T0.13 · Despliegue inicial en VPS
- **Depende de**: T0.11
- **Entrega**: `docker-compose.prod.yml` (web standalone, worker, postgres, caddy con TLS y `flush_interval -1` en la ruta SSE; volumen `/data/assets` worker rw + web ro; §18), `DEPLOY.md`, deploy por `git pull && docker compose up -d --build`, cron de `pg_dump` diario.
- **Verificación**: desde fuera del VPS, `https://<dominio>` sirve la app con certificado válido; login funciona; un run de demo completo corre en el VPS con el canvas actualizándose en vivo (SSE atraviesa Caddy); forzar el cron de backup → aparece el dump fechado y `pg_restore --list` lo lee sin error.

#### T0.14 · Credenciales cifradas y /settings
- **Depende de**: T0.4
- **Entrega**: módulo de secretos (§13.1/§19.2): API keys en `app_setting` cifradas at-rest (libsodium sealed box; la master key es la única credencial en env), bootstrap desde env en el primer arranque, y página `/settings` para editar keys, presets, idiomas, umbrales y apariencia del design system (tema/acento/densidad — añadido menor 2026-07-07 al crearse la fase FD; hasta entonces la app fija dark/indigo/balanced).
- **Verificación**: guardar la key de fal desde `/settings` → reiniciar contenedores → la key sigue funcionando; en `psql`, el valor almacenado es un blob cifrado (no aparece la key en claro en ningún `SELECT`); borrar la env var tras el bootstrap no rompe nada.

---

## FD — Design system (la piedra angular de toda UI)

La fuente de verdad visual es el proyecto **«UGC Factory Design System» de Claude Design** (<https://claude.ai/design/p/d126b2f1-3ada-48c5-84fa-914e891fea6f>), espejado en solo-lectura en `docs/design-system/` (regenerable con la tool `DesignSync`; el espejo JAMÁS se edita a mano). Esta fase lo materializa en código: tokens en `globals.css` + componentes en `apps/web/src/components/ui/` (shadcn/ui sobre Base UI + cva + Tailwind v4) fieles 1:1, showcase en `/design-system` y adherencia forzada por lint. Cómo se traduce lo gobierna la skill frontend (`references/design-system.md`).

Decisiones del usuario (2026-07-07): la fase se ejecuta tras T0.1 y **antes** de continuar F0 (por eso T0.2 depende de TD.7) · los 5 componentes de producto se crean ya, como presentacionales puros · las primitivas que el DS no define se crean siguiendo sus foundations y se **suben** a Claude Design · obligatoriedad de uso = skill frontend + reglas ESLint. Las pantallas de `ui_kits/` quedan **fuera** de esta fase (el usuario las traspasará en su momento). Coste estimado de la fase: $0 (sin APIs de pago).

#### TD.1 · Tokens del DS, fuentes Geist y showcase `/design-system` [x] 2026-07-07 — PASS, ver docs/verifications/TD.1/
- **Depende de**: T0.1
- **Entrega**: `globals.css` con TODOS los tokens del espejo (`docs/design-system/tokens/*.css` + sombras/stripe de `colors.css`) volcados tal cual — hex y naming 1:1 (`--bg`, `--surface{,-2,-3}`, `--text{,-2,-3,-4}`, `--border*`, `--accent*`, semánticos fijos, `--violet*`, `--stripe`, `--shadow-*`, `--r-*`, motion, densidad `--ui-fs`), dark por defecto + `[data-theme="light"]` + acentos `[data-accent="emerald|amber|cyan"]`, mapeados en `@theme inline`; Geist y Geist Mono self-hosted (cierra la nota ⚠ de fuentes del readme del DS); página `/design-system` con specimens de fundaciones (colores, tipografía, spacing, radios, sombras, glifos) y switchers de tema/acento/densidad.
- **Subtareas**:
  - [x] Volcado de los 5 ficheros de tokens a los 3 bloques canónicos de `globals.css`.
  - [x] Geist/Geist Mono self-hosted con variables `--font-sans`/`--font-mono`.
  - [x] Ruta `/design-system` con specimens y switchers funcionales (tema, acento, densidad).
- **Verificación**: en el navegador, `/design-system` muestra los specimens; los switchers cambian tema/acento/densidad en vivo; comparación visual CUA contra `docs/design-system/guidelines/*.card.html` sin desviaciones perceptibles.

#### TD.2 · Primitivas core y formularios [x] 2026-07-07 — PASS, ver docs/verifications/TD.2/
- **Depende de**: TD.1
- **Entrega**: `button`, `input`, `textarea`, `select`, `checkbox`, `switch`, `slider` en `components/ui/` — generados con shadcn sobre Base UI y ajustados 1:1 al espejo (`components/{core,forms}/` — `.jsx` como spec de variantes, `.prompt.md` como intención): mismos nombres de variantes/tamaños/estados (Button: `primary|secondary|ghost|danger|danger-ghost` × `sm|md|lg` + `loading` + `icon`), glifos Unicode en lugar de lucide (el DS prohíbe librerías de iconos); secciones nuevas en `/design-system`.
- **Verificación**: CUA compara las secciones con `buttons.card.html` y `form-fields.card.html` en dark Y light: variantes y estados hover/focus/disabled/loading fieles; todos los controles operables por rol y accessible name.
  - **Nota (cambio menor, 2026-07-07, regla 6)**: las `*.card.html` del espejo son **inejecutables** (cargan `../../_ds_bundle.js`, ausente del dump read-only → renderizan en blanco). En TD.2–TD.5 la comparación CUA se hace contra las **specs `.jsx`** que esas cards importan (misma fuente, mismo estado inicial) + **medición de dimensiones/estados en runtime**, no A/B pixel contra la card. Aplica a toda la fase FD (TD.1 topó con lo mismo).

#### TD.3 · Feedback, navegación y datos [x] 2026-07-07 — PASS, ver docs/verifications/TD.3/
- **Depende de**: TD.2
- **Entrega**: `badge`, `alert`, `empty-state`, `tabs`, `metrics-table` en `components/ui/`, fieles al espejo (`components/{feedback,navigation,data}/`); secciones en `/design-system`.
- **Verificación**: CUA vs `badges-alerts.card.html`, `empty-state.card.html`, `tabs.card.html` y `metrics-table.card.html` (dark y light); tabs operables por teclado.

#### TD.4 · Primitivas fuera del DS + subida a Claude Design [x] 2026-07-08 — PASS (cláusula 1 verifier + cláusula 2/upload bucle), ver docs/verifications/TD.4/
- **Depende de**: TD.3
- **Entrega**: `dialog`, `sheet`, `alert-dialog`, `toast`, `tooltip`, `skeleton`, `progress`, `card`, `separator` siguiendo las foundations del DS (hairlines 1 px, radios 5/7/10 px, focus ring único, sin glassmorphism ni gradientes, glifos Unicode); secciones en `/design-system`; subida de los 9 al proyecto de Claude Design en su formato (`.jsx` + `.d.ts` + `.prompt.md` + card) vía `DesignSync`, para que el DS siga siendo inventario completo (decisión 2026-07-07). Si el subagente no tiene acceso a `DesignSync`, la subida la ejecuta el bucle principal en el CLOSE.
- **Verificación**: CUA revisa las secciones nuevas en dark y light (coherencia con las foundations); `DesignSync list_files` muestra los ficheros nuevos en el proyecto y el espejo local se regenera incluyéndolos.
  - **Nota (clarificación menor 2026-07-07, regla 6)**: el warning dev-only de Base UI Toast (`flushSync` en `ToastRoot`, react-dom lo strippea en prod) NO bloquea el PASS de la cláusula CUA — deuda upstream, consola limpia confirmada contra `next build && next start`. Ver la excepción estrecha en `testing/references/cua.md` §Paso 3. La **cláusula 2 (upload a DesignSync + espejo regenerado)** se ejecuta al final de la fase FD, cuando el usuario autorice DesignSync con `/design-login` (decisión 2026-07-07): hasta entonces TD.4 permanece con la cláusula 1 verificada y la 2 pendiente.

#### TD.5 · Componentes de producto (presentacionales puros) [x] 2026-07-08 — PASS, ver docs/verifications/TD.5/
- **Depende de**: TD.3
- **Entrega**: `pipeline-node`, `checkpoint-banner`, `variant-card`, `spend-ledger`, `safe-zone-overlay` en `components/ui/` como presentacionales PUROS (props planas; prohibido importar tipos de dominio de `@ugc/core` — las features de F0 los envolverán), fieles a `components/product/` del espejo, incl. `pulseRing` en estados activos y el hatch diagonal como placeholder 9:16; secciones en `/design-system`.
- **Verificación**: CUA vs `pipeline-node.card.html` y `variant-spend-safezone.card.html` (dark y light); el pulso se apaga con `prefers-reduced-motion` sin perder el estado visible.

#### TD.6 · Lint de adherencia al DS [x] 2026-07-08 — PASS, ver docs/verifications/TD.6/
- **Depende de**: TD.5
- **Entrega**: reglas ESLint (`eslint.config.ts`, scope `apps/web`) que prohíben: clases de paleta cruda de Tailwind (`bg-blue-500`…), colores/valores arbitrarios en `className` (`bg-[#…]`, `rounded-[10px]`) fuera de `globals.css`, e imports de `@radix-ui/*`, `lucide-react` o cualquier librería de iconos (adaptando las ideas de `_adherence.oxlintrc.json` del proyecto de Claude Design a nuestro flat config).
- **Verificación**: un fichero de prueba con `bg-blue-500`, `text-[#fff]` e `import { X } from 'lucide-react'` hace fallar `pnpm lint` con mensajes que nombran la regla violada; al retirarlo, `pnpm gate` queda verde.

#### TD.7 · Skill frontend cerrada contra la realidad + E2E de fase
- **Depende de**: TD.4, TD.6
- **Entrega**: skill `frontend` actualizada con el inventario definitivo de `components/ui/` (los ~26 con sus variantes reales) en `references/design-system.md`/`components.md`, obligatoriedad explícita («si existe el componente del DS, usarlo es obligatorio; HTML crudo estilado equivalente = error de review») y ajustes descubiertos durante la fase anotados en el journal.
- **Verificación (E2E de fase)**: recorrido CUA completo de `/design-system` — dark, light y 2 acentos — con evidencia visual en `docs/verifications/TD.7/`; `pnpm gate` verde; y **revisión humana final del showcase** (parada de fin de fase: el usuario da el OK visual).

---

## F1 — Análisis (URL/texto → ProductBrief)

#### T1.1 · Contratos del análisis en `packages/core`
- **Depende de**: T0.1
- **Entrega**: Zod schemas de `RawContent`, `VisualAnalysis` y `ProductBrief` (con las divergencias del Apéndice A: `platform=manual`, `source_url` nullable, cardinalidades en Zod) + espejo JSON Schema para `output_config` de Anthropic + fixtures de test.
- **Verificación**: suite de tests con fixtures válidos e inválidos (brief sin ángulos, URL en modo manual, etc.) pasa; el JSON Schema generado se valida contra un validador draft 2020-12.

#### T1.2 · Migraciones de análisis
- **Depende de**: T1.1, T0.3
- **Entrega**: tablas `url_analysis`, `product_brief`, `brand_kit` (§12, con `domain` nullable y `source`).
- **Verificación**: migración aplica sobre BD limpia y `psql \d` muestra tablas/columnas/enums esperados; insertar 2 filas de `brand_kit` con `domain NULL` entra sin conflicto y 2 con el mismo dominio falla la segunda con error de constraint (UNIQUE parcial verificado).

#### T1.3 · Fast path determinista de ingesta
- **Depende de**: T1.2
- **Entrega**: clasificador de URL (regex §7.2 N1), cliente Shopify `.json`, parsers JSON-LD (`Product/Offer/AggregateRating`) y OpenGraph, merge a `RawContent`; normalizador de URL + content_hash; manejo de 404/401 del `.json` con fallback transparente.
- **Verificación**: contra 3 URLs reales (1 Shopify, 1 con JSON-LD, 1 solo-OG), el `RawContent` persistido contiene título/precio/imágenes correctos comprobados a mano contra la página.

#### T1.4 · Cliente Firecrawl + fallback Jina
- **Depende de**: T1.3, T0.12, T0.14
- **Entrega**: cliente `/v2/scrape` con `formats: [markdown, images, branding, product, screenshot]` + `onlyMainContent` + `proxy: auto`; fallback a Jina Reader si Firecrawl falla; screenshot persistido como `asset`; créditos registrados en `cost_entry`.
- **Verificación**: analizar una landing real JS-heavy → `url_analysis.raw_content` contiene markdown legible, ≥3 imágenes y branding con paleta; el screenshot se descarga por `GET /api/assets/:id/download` (T0.5) y coincide con la landing; con la key de Firecrawl inválida, Jina produce al menos el markdown; los créditos aparecen en `/spend`.

#### T1.5 · Mini-crawl de páginas internas
- **Depende de**: T1.4
- **Entrega**: descubrimiento de hasta 3 URLs same-domain (`/reviews`, `/faq`, `/about` y variantes por idioma) + scrape ligero + anexión al `RawContent` (§9.1).
- **Verificación**: sobre una tienda real con página de reviews, el markdown anexado contiene texto de reviews reconocible; sobre una landing sin esas páginas, el paso termina en `skipped` sin error.

#### T1.6 · Entrada por texto libre
- **Depende de**: T1.2, T0.5
- **Entrega**: formulario de intake modo "texto libre" (descripción + upload opcional de imágenes), `RawContent` sintético (`source=manual`), caché por hash del texto (§7.4).
- **Verificación**: crear un análisis solo con un párrafo y 2 imágenes → `url_analysis` en `done` sin ninguna llamada de scraping (logs); repetir el mismo texto reutiliza la caché (sin fila nueva).

#### T1.7 · Cliente Anthropic + VisualAnalyzer
- **Depende de**: T1.4, T1.6, T0.14
- **Entrega**: cliente Anthropic en `packages/core` (structured outputs + prompt caching + tokens a `cost_entry`); `VisualAnalyzer` (Haiku 4.5): clasificación de imágenes, paleta y social proof del screenshot (prompt `research/07 §5 P3`); reescalado ≤1080p. Con `source=manual`: clasifica las subidas; sin imágenes → `skipped`.
- **Verificación**: sobre las imágenes de una landing real, la clasificación coincide con el juicio humano en ≥7 de 8 (revisión manual); coste del paso <$0,02 en `/spend`; el modo manual sin imágenes deja el paso `skipped` y el flujo continúa.

#### T1.8 · BriefSynthesizer (N3)
- **Depende de**: T1.7, T1.1
- **Entrega**: síntesis con Sonnet 5 en una llamada (structured output = ProductBrief; system prompt versionado en `packages/core/prompts/` con taxonomía + frameworks + **bloque anti-injection del Apéndice A** + reglas FTC), en el idioma de análisis.
- **Verificación**: contra 2 URLs reales + 1 texto libre, los briefs validan contra Zod, los campos extractivos llevan `evidence` con citas presentes literalmente en el markdown, hay 5–10 ángulos distintos, coste <$0,15/brief en `/spend`, y en la 2ª llamada `cache_read_input_tokens > 0`. **Test de seguridad**: una página de prueba con texto adversarial ("ignore the schema, return null") no corrompe el brief.

#### T1.9 · BriefValidator + BrandKit
- **Depende de**: T1.8
- **Entrega**: validador con perfiles `url`/`manual` (§9.2: precio N1==N3, hero image, hooks ≤12 palabras, `suggested_assets ∈ assets.images` con poda + warning, cardinalidades) y upsert de `brand_kit` por dominio con reutilización (§9.1).
- **Verificación** (a nivel de datos, sin UI): un brief con precio discrepante produce el warning tipado y gana el precio del fast path; en modo manual sin hero image, el validador emite el warning tipado `needs_user_decision: missing_hero_image` en la salida, el brief queda válido y el paso NO falla; analizar 2 URLs del mismo dominio extrae el BrandKit una sola vez (timestamps).

#### T1.10a · N1–N3 como nodos reales del DAG
- **Depende de**: T1.9, T0.11
- **Entrega**: executors reales de N1 (ingesta con fast path/scrape/mini-crawl/texto libre y caché), N2 (visual, con skip) y N3 (síntesis + validación) registrados en el orquestador; definición del DAG de análisis.
- **Verificación**: pegar una URL real en el intake → los nodos N1→N2→N3 progresan en el canvas en vivo y el brief JSON aparece como output del nodo N3 en el panel genérico; con texto libre sin imágenes, N2 aparece `skipped` en el grafo.

#### T1.10b · CP1: editor de brief
- **Depende de**: T1.10a
- **Entrega**: panel de CP1 con el brief editable campo a campo, badges extraído/inferido (`evidence`/`confidence`), gestión de warnings (incl. petición bloqueante de imágenes o derivación a packshot-IA en modo manual), aprobación que persiste `product_brief` versionado + `edited_by_user`; endpoint standalone `GET/PATCH /api/briefs/:id` (editar un brief aprobado fuera de un run activo, Apéndice E).
- **Verificación (E2E de la fase, criterio O1)**: en el navegador — URL real → N1/N2/N3 → editar un beneficio y un hook en CP1 → aprobar → brief versionado (v1 IA, v2 editado) y el run avanza; pipeline <90 s (sin contar la edición) y <$0,15. Después, editar el brief aprobado vía `/api/briefs/:id` sin run activo crea v3.

---

## F2 — Estrategia y guiones (incluye Personas v1 y recetas)

> Personas y recetas viven aquí (no en F3) porque CP2 las necesita. Ajuste anotado en PRD §21.

#### T2.0 · Personas v1 (modelo, CRUD y seed manual)
- **Depende de**: T0.3, T0.5
- **Entrega**: migración de `persona` (§12, con `voice_map {locale: {provider, voiceId}}`), página `/personas` con CRUD (demografía, personalidad, wardrobeNotes), upload manual de imágenes de referencia (validación ≥2K), endpoint de candidatas por `avatar_hint`; seed manual de 2 personas (es/en) con imágenes subidas a mano. (La generación IA de referencias y el preview de voz llegan en F4.)
- **Verificación**: crear una persona con 2 imágenes ≥2K y voice_map es/en desde el navegador; el endpoint de candidatas devuelve la persona correcta para un `avatar_hint` compatible y ninguna para uno incompatible; una imagen <2K es rechazada con mensaje claro.

#### T2.1 · Migraciones de lote + seeds de hooks, CTAs y recetas
- **Depende de**: T0.3
- **Entrega**: tablas `hook_line`, `cta_line`, `ad_batch`, `ad_variant` (enum con estado **`scripted`** añadido tras `planned` — alineación anotada en PRD §12), `ad_script`, **`recipe`**; seed de ~40 hook lines y ~15 CTA lines por idioma (es/en, redacción propia) y **seed de las 3 recetas por tier con los costes del Apéndice B**; validador de seeds en CI.
- **Verificación**: `pnpm seed` puebla librerías y recetas; el validador falla en CI con un fixture inválido (hook sin ángulo o >12 palabras; receta sin coste); `SELECT` de `recipe` muestra los 3 tiers con estimaciones que cuadran con el Apéndice B.

#### T2.2 · Compositor de matriz (N4) + estimador de coste
- **Depende de**: T2.1, T2.0, T1.10b
- **Entrega**: `BatchPlan` (contrato Zod): ángulos × hooks (brief + librería) × personas × duración (preset §8.4) × idiomas × tier; modo hook-testing con body/CTA compartidos por ángulo (§7.5); estimador de coste basado en `recipe` con desglose por variante.
- **Verificación**: para un brief real, componer una matriz 2 ángulos × 3 hooks × 1 persona × es+en → 12 variantes con coste estimado desglosado que cuadra a mano con las recetas del Apéndice B (±10 %).

#### T2.3 · CP2: UI de matriz y confirmación de gasto
- **Depende de**: T2.2
- **Entrega**: panel de CP2: selección de ángulos (cards con hooks del brief), **selector de personas sugeridas por `avatar_hint`** (T2.0), preset de duración/objetivo, tier, idiomas, coste total estimado en grande, confirmación que crea las `ad_variant` en `planned`.
- **Verificación**: en navegador, cambiar tier de Test a Standard actualiza el coste al vuelo; el selector muestra las personas compatibles con el segmento; aprobar crea exactamente las variantes de la matriz (filas con `filename_code` únicos y legibles).

#### T2.4 · ScriptWriter (N5)
- **Depende de**: T2.2
- **Entrega**: generación de guiones con Sonnet 5 (sin sampling params; diversidad por prompt): modo normal (1 guion/variante) y modo hook-testing (1 body+CTA por ángulo + N hooks encajados, §9.4); `scenes[]` con timing duro (`word_count ÷ 2.5`), `subtitles[]`, CTA por objetivo, idioma destino nativo (§17).
- **Verificación**: para la matriz de T2.2, los 12 guiones validan contra Zod; los de es suenan nativos (revisión humana); en hook-testing los bodies de las variantes del mismo ángulo son **textualmente idénticos** (diff vacío); `est_seconds` ≤ duración objetivo en todos.

#### T2.5 · Guardrails FTC + linter de claims
- **Depende de**: T2.4
- **Entrega**: reglas de §15.1 en el prompt (roles honestos, reformulación testimonial y founder) + linter determinista post-generación (claims de `banned_or_risky_claims`, primera persona de compra, afirmaciones founder) que **bloquea con explicación y sugerencia** (§15.2).
- **Verificación**: pedir ángulo "testimonial" produce un guion creator-style demo sin "I bought this"; un claim médico prohibido inyectado a mano dispara el bloqueo con sugerencia compliant; el ángulo founder-origin llega reformulado en tercera persona.

#### T2.6 · CP3: editor de guiones
- **Depende de**: T2.3, T2.4, T2.5
- **Entrega**: panel de CP3: lista de variantes con su guion, edición por escena y de hook/CTA, re-lint al guardar, aprobación por variante o del lote.
- **Verificación (E2E de la fase)**: URL real → CP1 → CP2 (matriz 6 variantes) → CP3: editar el hook de una variante, aprobar todo → las 6 `ad_variant` quedan en estado **`scripted`** (valor literal en BD), con `ad_script` versionado (`edited_by_user` en la editada). Criterio O2: interacción total <5 min.

---

## F3 — Galería de prompts y compilador

#### T3.1 · Migraciones y modelo de galería
- **Depende de**: T0.3
- **Entrega**: tablas `prompt_template` (facetas GIN, `perf`, `usage_count`), `prompt_version`, `guard_pack` (con `key`, `vertical?`, `platform?`), `model_profile` (capabilities con refImages/refVideos/refAudios, `cost` multi-unidad) (§12).
- **Verificación**: migración aplica (`psql \d`); con ≥1.000 filas sintéticas sembradas para el test (o `SET enable_seqscan=off`), una consulta por facetas combinadas muestra Bitmap Index Scan sobre el GIN en el EXPLAIN y devuelve exactamente las filas esperadas.

#### T3.2 · Seed pipeline con validador en CI
- **Depende de**: T3.1
- **Entrega**: `packages/core/gallery-seed/*.json` + `pnpm seed:gallery` (upsert idempotente) + validador en CI (campos requeridos, slugs únicos, slots resolubles contra §10.4, `guardPackIds` existentes, `enumValues` para enums); los fixtures incluyen **2–3 templates mínimos de prueba** (los usará la verificación de T3.5).
- **Verificación**: romper un fixture a propósito (slot inexistente `{producto.nombre}`) hace fallar el CI con mensaje claro; el seed corre dos veces sin duplicar filas.

#### T3.3 · Guard packs (redacción propia)
- **Depende de**: T3.2
- **Entrega**: packs `general`, `fidelity`, `platform.{tiktok,reels}` y verticales (beauty, finance, health, apps, food, fashion) con líneas de redacción propia (§10.1) + regla de lookup (§9.5).
- **Verificación**: el lookup para brief vertical beauty + plataforma tiktok devuelve exactamente {general, fidelity, vertical.beauty, platform.tiktok}; ninguna línea coincide textualmente con las de Cliprise (revisión manual del seed).

#### T3.4 · Model profiles seed + verificación de catálogo
- **Depende de**: T3.1
- **Entrega**: seed de `model_profile` (catálogo §13.1: endpoints completos, capabilities, costes) y comando `pnpm fal:verify` que contrasta cada perfil contra la model page/`llms.txt` de fal (marca `verified_at`/desviaciones) y **recalibra los costes de las `recipe`** con los datos verificados (regla de trabajo 5).
- **Verificación**: `pnpm fal:verify` corre contra fal.ai real y reporta OK o divergencia por perfil; introducir un precio falso en el seed hace que lo detecte; las recetas quedan recalculadas si hubo cambios.

#### T3.5 · Compilador de prompts (N6)
- **Depende de**: T3.3, T2.4
- **Entrega**: motor en `packages/core`: selección determinista de template por facetas + scoring (§9.3), interpolación de variables canónicas (§10.4) desde brief/persona/hook/cta/campaign, inyección obligatoria de beats + fidelity guards + guard packs + anti-estilo, validación de resolución completa, `resolvedPrompt` persistido por escena; registro del executor N6 en el orquestador.
- **Verificación**: golden files (3 combinaciones brief-fixture × template × persona comparadas carácter a carácter) en verde; un script CLI compila una variante real (con los templates de prueba de T3.2) e imprime el `resolvedPrompt` — `grep` confirma "no deformation" y el guard del vertical; un slot irresoluble produce error accionable (qué variable, de qué fuente). La inspección en canvas se verifica en T4.11.

#### T3.6 · Model adapters
- **Depende de**: T3.5, T3.4
- **Entrega**: adapters por familia (Seedance `@image/@video/@audio`; Kling referencias y voice control; Veo/Wan; imagen Seedream/NB2 edit) que transforman prompt canónico + assets al payload del endpoint respetando `capabilities`.
- **Verificación**: golden files de payloads por adapter; un template que excede `maxDuration` produce el troceo de escenas esperado (§7.5) en el plan de generación, no un error en runtime.

#### T3.7 · Seed inicial de templates (lote 1: ~50)
- **Depende de**: T3.5
- **Entrega**: ~50 templates propios (es/en) cubriendo formatos y ángulos de mayor uso, siguiendo la anatomía §10.3, en `draft` (pasan a `published` con thumbnail en T4.12). Ampliación a ~150 en T8.6.
- **Verificación**: validador en verde; 5 templates al azar cumplen los 14 puntos de la anatomía §10.3 (checklist manual); la búsqueda facetada devuelve candidatos para cada ángulo del brief de prueba.

#### T3.8 · UI de galería
- **Depende de**: T3.7
- **Entrega**: `/gallery` con navegación facetada, ficha de template (body con slots resaltados, beats, guards, versiones con diff), editor con validación de slots en vivo, estados draft/review/published. (El botón "probar template" llega en T4.12 con FalClient.)
- **Verificación**: en navegador, filtrar por 2 facetas; editar un template introduciendo un slot inválido muestra el error en vivo; guardar crea `prompt_version` v2 con diff visible contra v1.

---

## F4 — Generación fal.ai

#### T4.1 · FalClient + upload de inputs con caché
- **Depende de**: T0.7b, T3.4, T0.12, T0.14
- **Entrega**: cliente sobre `@fal-ai/client`: submit a `queue.fal.run` (persistencia `submitting`→`submitted` con `request_id`/`status_url`/`response_url`; §9.6), subida de inputs vía fal storage con caché `(asset_id, checksum)` → `asset.fal_url`, rate limiter (~8 concurrentes) y manejo de 429/`Retry-After`; tabla `generation` completa.
- **Verificación**: generar una imagen barata real (FLUX.2 dev, <$0,05) end-to-end por polling → `generation` completa, coste real en `/spend`, PNG en storage propio; subir el mismo input dos veces reutiliza `fal_url` (un solo upload en logs).

#### T4.2 · Webhook de fal con firma ED25519
- **Depende de**: T4.1, T0.13
- **Entrega**: `POST /api/webhooks/fal`: verificación ED25519 contra JWKS (caché ≤24 h) + timestamp ±5 min + idempotencia por `request_id`; el handler persiste el evento y delega en el orquestador; la **descarga del output se encola como job del worker** (§9.6).
- **Verificación**: en el VPS (o local con cloudflared), una generación real completa vía webhook sin polling ("webhook verified" en logs); un POST forjado devuelve 401 sin tocar la BD; reenviar el mismo webhook no duplica nada.

#### T4.3 · Polling fallback + reconciliación idempotente
- **Depende de**: T4.1
- **Entrega**: poller lazy en read-path + integración con el sweeper (reconciliar generations colgadas contra fal, expirar por tipo); executor idempotente (§6.3.9).
- **Verificación**: con webhooks deshabilitados (dev local), una generación real completa vía polling; matar el worker durante una generación y reiniciar retoma el seguimiento **sin re-submit** (el billing de fal muestra 1 solo job).

#### T4.4 · N7a: product shots con referencias reales
- **Depende de**: T4.1, T3.6
- **Entrega**: executor N7a: `fal-ai/bytedance/seedream/v4.5/edit` con fotos hero del brief como referencia (fallback `fal-ai/nano-banana-2/edit`), 2–3 shots 9:16; ruta packshot-IA si no hay fotos (decisión de CP1, marcada `synthetic_product=true`).
- **Verificación**: con fotos reales de un producto propio, los shots muestran **el producto real reconocible** (label/forma a juicio humano) en escenario UGC 9:16; el flujo sin fotos produce packshots razonables con el flag persistido.

#### T4.5 · N7b: TTS + word timestamps
- **Depende de**: T4.1, T2.0
- **Entrega**: executor TTS por escena según receta y `voice_map` de la Persona; **cierre de deuda `[verificar]`**: si los endpoints TTS devuelven word timestamps nativos; si no, ASR `fal-ai/elevenlabs/speech-to-text` encadenado; `word_timestamps` persistidos.
- **Verificación**: para un guion es y otro en, los audios suenan correctos en idioma y voz esperados; los word timestamps cubren el 100 % de las palabras y, medidos contra el onset visible en un editor de waveform (Audacity/`ffmpeg astats`) en 3 palabras concretas, difieren <±100 ms; resultado del `[verificar]` anotado en `model_profile` y en PRD §13.1.

#### T4.6 · Preview de voz en CP2/CP3
- **Depende de**: T4.5
- **Entrega**: muestras de voz por Persona/idioma (generadas una vez, cacheadas) escuchables en CP2/CP3 **antes** de gastar render (§8.3 — por eso esta tarea va antes que el resto de N7).
- **Verificación**: botón ▶ junto a cada Persona reproduce su voz en el idioma de la variante; reproducirla 5 veces no añade coste (caché comprobada en `/spend`).

#### T4.7 · N7c: clip de avatar
- **Depende de**: T4.5
- **Entrega**: executor avatar por tier: Kling AI Avatar v2 Std (imagen de Persona + audio TTS del hook; duración = audio), VEED Avatars en Test (voz propia, timestamps vía ASR del clip; §7.5), OmniHuman en Premium (audio ≤30 s validado).
- **Verificación**: clip real de la Persona hablando el hook con lipsync aceptable a juicio humano (es y en); duración = audio ±0,3 s; en Test, el ASR produce timestamps del clip VEED.

#### T4.8 · N7d: b-roll por escena
- **Depende de**: T4.4, T3.6
- **Entrega**: executor b-roll: 1 generación por escena (§7.5), i2v desde keyframes (Kling v3/Wan 2.6) o R2V (Seedance 2.0) si el producto aparece en escena; troceo de escenas > maxDuration; **cierre de deuda**: enums de `aspect_ratio` de cada modelo integrado.
- **Verificación**: para una variante de conversión (21–34 s) se generan exactamente los clips del presupuesto §7.5 (1 avatar + 2 b-roll), 9:16 720p+, producto fiel en las escenas R2V; enums anotados en `model_profile`.

#### T4.9 · N7e: bed musical IA
- **Depende de**: T4.1
- **Entrega**: executor música (ace-step) por mood/duración; **cierre de deuda**: precio real de ace-step.
- **Verificación**: bed de 30 s con el mood pedido, coste registrado, `audio_source=ai_bed` en la variante.

#### T4.10 · Deduplicación de generación
- **Depende de**: T4.5, T4.7, T4.8
- **Entrega**: content-hash `(resolved_prompt, model_profile_id, inputs)` en `generation`; los executors consultan antes de submit y reutilizan assets completados (§9.6).
- **Verificación**: lote hook-testing de 3 variantes del mismo ángulo → body y CTA se generan **una sola vez** (nº de generations = hooks + body + CTA + shots, no 3× todo); ahorro visible en `/spend`.

#### T4.11 · Sub-DAG de N7 en el canvas + E2E de fase
- **Depende de**: T4.4, T4.6, T4.7, T4.8, T4.9, T4.10, T0.11
- **Entrega**: nodo compuesto N7 por variante (expandible a N7a–N7e) con thumbnails/players por asset; N6 visible con su `resolvedPrompt`; coste estimado vs real por sub-step; retry granular.
- **Verificación (E2E de la fase)**: desde el canvas, una variante real completa N6→N7 con todos los assets reproducibles en el panel y el `resolvedPrompt` inspeccionable en N6; coste real del lote difiere <15 % del estimado de CP2; retry de un sub-step fallado funciona.

#### T4.12 · Generación de Personas, thumbnails y "probar template"
- **Depende de**: T4.1, T3.7, T2.0
- **Entrega**: generación IA de imágenes de referencia de Personas (FLUX.2/NB2: mismo sujeto, 2–3 encuadres, ≥2K) con curación manual; seed hasta 10–20 Personas (es/en); job de thumbnails de galería que promociona templates `draft→published`; botón **"probar template"** en la ficha (`generation` con `step_run_id` NULL, coste registrado).
- **Verificación**: 10 Personas activas con referencias consistentes (mismo sujeto a juicio humano); los ~50 templates quedan `published` con thumbnail en `/gallery` (ninguno publicado sin thumbnail); "probar template" genera un clip/imagen barata visible en la ficha con su coste en `/spend`.

---

## F5 — Composición, QA y export

#### T5.1 · Imagen Docker del worker de render
- **Depende de**: T0.13
- **Entrega**: imagen del worker con ffmpeg (libass/libfreetype), ffprobe, fuentes OFL (TikTok Sans, Poppins, Noto fallback) y `c2patool`; healthcheck de capacidades.
- **Verificación**: `docker exec worker ffmpeg -filters | grep sidechaincompress` OK; `c2patool --version` responde; `fc-list` muestra TikTok Sans.

#### T5.2 · Normalización canónica con caché (vídeo + audio)
- **Depende de**: T5.1, T4.5, T4.7, T4.8
- **Entrega**: normalizador por asset (1080×1920 scale-to-fill+crop, 30 fps, H.264 CRF 23 `yuv420p`, `setsar=1`, `-an`) + pista de audio canónica (AAC 48 kHz estéreo), extracción de voz de clips con audio embebido (VEED/voz nativa), `normalized_cache_key` = checksum + params (§9.7).
- **Verificación**: normalizar los assets reales de una variante → ffprobe de cada salida cumple el perfil exacto (script de asserts); segunda ejecución = 100 % cache hits (0 trabajos ffmpeg en logs); un clip 16:9 de prueba queda crop-to-fill sin letterbox.

#### T5.3 · Concat + mezcla de audio
- **Depende de**: T5.2
- **Entrega**: ensamblado por `CompositionSpec`: concat demuxer `-c copy` + voz por segmento + bed con `volume` 0,2–0,3, `sidechaincompress`, `afade` out y `loudnorm` I=-14.
- **Verificación**: master intermedio de una variante real sin glitches en los cortes; `ffmpeg -af ebur128` mide −14 LUFS ±1; el ducking es audible y visible en la waveform.

#### T5.4 · Subtítulos ASS karaoke
- **Depende de**: T5.2
- **Entrega**: generador de `.ass` desde word timestamps: preset **karaoke** (1–4 palabras/página, `\k`) y **subtitle** (3–7 palabras/2 líneas); estilos TikTok Sans blanco+contorno y caja opaca (BorderStyle) para Reels; posicionamiento como constraint dentro de safe zone (§9.7, Apéndice C); fallback de fuente por script.
- **Verificación**: vídeo real con captions donde el highlight coincide con la palabra hablada (revisión visual de 3 muestras); un script parsea el `.ass` y confirma que ningún evento posiciona texto fuera del área 875×978; texto no latino renderiza con la fuente fallback.

#### T5.5 · Pase final, export master y QA automático
- **Depende de**: T5.3, T5.4
- **Entrega**: encode final único (mix + burn-in; `-c:a copy` si el audio no cambió) al preset master (Apéndice C) + thumbnail + firma **C2PA** + validador QA (ffprobe, duración, LUFS, tamaño, captions-in-safe-zone) → `qa_report`.
- **Verificación** (a nivel de datos): la fila `qa_report` de una variante real contiene todos los checks en `pass` (query); `c2patool <master> --info` muestra el manifest con `trainedAlgorithmicMedia`; subir el fichero a mano a TikTok (borrador) no produce warnings de formato.

#### T5.6 · CP4: revisión de variantes
- **Depende de**: T5.5, T0.11
- **Entrega**: panel de QA con player, overlay de safe zones conmutable (TikTok/Meta/Universal), resultados del QA, acciones aprobar/rechazar/regenerar (rechazo → `rejected`; regenerar → run `kind=regen`).
- **Verificación**: aprobar 2 variantes y rechazar 1 desde el navegador actualiza estados y biblioteca; "regenerar guion" crea el run parcial que termina en un master nuevo pasando por QA otra vez.

#### T5.7 · Export bundle + biblioteca
- **Depende de**: T5.5, T5.6
- **Entrega**: bundle por variante aprobada (MP4 + JSON: `ad_caption` ≤100 chars sin @/#/links, `brand_name` ≤20, hook/ángulo/duración/objetivo/plataforma, flags AIGC, `audio_source` + checklist §15.4); **export dual con/sin bed** cuando el lote declara destino orgánico+paid (re-mux de audio, §14); `/library` con filtros, linaje completo y descarga.
- **Verificación**: descargar un bundle y validar el JSON contra su schema (caption dentro de límites — test); un lote destino "ambos" produce las dos versiones de audio del mismo master sin re-encode de vídeo (timestamps de ffmpeg lo confirman); el linaje en la UI llega del master hasta el hook line y el `template@version` exactos.

#### T5.8 · Regeneración parcial optimizada
- **Depende de**: T5.6, T4.10
- **Entrega**: flujo CU4: clonar variante, regenerar solo el nodo cambiado + N8 + N9, reutilizando caché de normalizados y dedupe.
- **Verificación (criterio 22.4)**: cambiar el CTA de una variante aprobada produce un master nuevo en <2 min de reloj y <$0,50 de coste registrado.

#### T5.9 · E2E de la fase (criterios 22.1, 22.2 y 22.8)
- **Depende de**: T5.7
- **Entrega**: prueba guiada completa documentada en `VERIFY.md` con los números reales obtenidos.
- **Verificación**: (a) URL real → ≥6 variantes aprobadas (2 ángulos × 3 hooks) de 15–30 s en es+en, captions karaoke correctas, C2PA firmado, coste del lote <$15 en tier Test, <45 min de reloj con checkpoints atendidos; (b) **texto libre con 0 imágenes**: párrafo → decisión packshot-IA en CP1 → al menos 1 variante aprobada con `synthetic_product=true`.

#### T5.10 · Dashboard y vista de proyecto
- **Depende de**: T5.7
- **Entrega**: `/` (dashboard: proyectos, lotes activos, gasto del mes, alertas) y `/projects/[id]` (briefs, lotes, variantes y métricas del proyecto) + CRUD mínimo de proyectos (§8.1).
- **Verificación**: crear un proyecto desde la UI, lanzar un lote en él → el dashboard muestra el lote activo y el gasto del mes del proyecto; `/projects/[id]` lista sus briefs y variantes con estados correctos.

---

## F6 — Publicación

> Toda capacidad de F6 tiene modo degradado manual (export + checklist + guía) para no bloquear si las apps de developer están en revisión (§13.3).

#### T6.1 · Conexión de cuentas (OAuth) ⚠
- **Depende de**: T0.13, T0.14; ⚠ apps de developer TikTok y Meta creadas por el usuario
- **Entrega**: flujos OAuth de TikTok y Meta/Instagram; `platform_account` con tokens cifrados, refresh automático y estado en `/settings`.
- **Verificación**: conectar las cuentas reales desde `/settings` → activas con sus scopes; revocar desde la plataforma se refleja como `error` al siguiente uso.

#### T6.2 · Checklist de publicación + CP5 + música propia
- **Depende de**: T5.7
- **Entrega**: checklist interactivo por plataforma generado del bundle (§15.4: toggle AIGC —con aviso de reset al duplicar campañas—, música según `audio_source`, Spark si aplica) + CP5 opcional; upload de pista propia licenciada (`audio_source=own_license`, asset `music_bed` seleccionable en la matriz).
- **Verificación**: el checklist de una variante con `audio_source=native_trending` **bloquea** la opción Spark con explicación; el de una con bed IA la permite; subir una pista propia y usarla en un lote produce el master con esa música y `own_license` persistido.

#### T6.3 · Publicación orgánica TikTok
- **Depende de**: T6.1, T6.2
- **Entrega**: publicación vía Content Posting API (o flujo guiado paso a paso si la app no está audited), con caption y disclosure; `publication` con `external_post_id`.
- **Verificación**: una variante aprobada aparece publicada en el perfil real de TikTok con su caption; la fila `publication` guarda ID externo y estado.

#### T6.4 · Publicación Reels (Instagram)
- **Depende de**: T6.1, T6.2
- **Entrega**: publicación de Reels vía Instagram Graph API en la cuenta Business propia.
- **Verificación**: el Reel aparece en la cuenta real con el caption esperado; `publication` registrada.

#### T6.5 · Ads en borrador (TikTok Ads + Meta Marketing API)
- **Depende de**: T6.1, T6.2
- **Entrega**: upload de creative + creación de ad en borrador en ambas plataformas; **cierre de deuda `[verificar]`**: existencia del flag AIGC en cada API (si no existe, el checklist mantiene el paso manual obligatorio; resultado anotado también en PRD §13.3).
- **Verificación**: el borrador aparece en TikTok Ads Manager y en Meta Ads Manager vinculado al vídeo correcto; el resultado de la verificación del flag AIGC queda documentado.

#### T6.6 · Trending Sound Advisor
- **Depende de**: T6.2
- **Entrega**: lectura de TikTok Creative Center (Popular Music) con filtro de disponibilidad comercial; sugerencias por mood; guía in-app del flujo "añadir sonido nativo al publicar" (restricción de cuentas Business documentada, §14); export con music headroom; **deuda `[verificar]`**: limitaciones de música en cuentas Business de Instagram.
- **Verificación**: para una variante destino orgánico, el Advisor lista sonidos trending reales con su flag comercial; elegir uno no-CML marca `audio_source=native_trending` y el checklist bloquea Spark (coherencia con T6.2).

#### T6.7 · Flujo Spark documentado
- **Depende de**: T6.3
- **Entrega**: guía interactiva del Spark code (ventanas 7/30/60/365; recomendación ventana ≥ campaña), captura de `spark_code` + `spark_auth_expires_at`, alerta de renovación a N días de expirar.
- **Verificación**: registrar un spark code real de un post propio → la fecha de expiración se calcula bien y la alerta (fecha forzada) se dispara.

---

## F7 — Medición y flywheel

#### T7.1 · Sync de métricas de ads ⚠
- **Depende de**: T6.5; ⚠ ≥1 ad activado con presupuesto real por el usuario en Ads Manager (o una campaña con histórico ya existente en la cuenta)
- **Entrega**: cron pg-boss contra TikTok Reporting API y Meta Insights → `metric_snapshot` por publicación/día, idempotente por `(publication_id, date)`.
- **Verificación** (inmediata, sin esperas): ejecutar el sync manualmente sobre una campaña con histórico existente → el snapshot de una **fecha pasada** coincide con Ads Manager (±2 % por ventanas de atribución); re-ejecutar el sync no duplica filas; el schedule del cron queda registrado en pg-boss (query).

#### T7.2 · Sync de métricas orgánicas + import CSV
- **Depende de**: T6.3, T6.4
- **Entrega**: TikTok Display API (`video.list` stats) e Instagram insights para posts orgánicos; import CSV manual con mapeo de columnas guiado.
- **Verificación**: forzar el job de sync sobre los posts ya publicados en F6 → views/likes aparecen al momento y coinciden con la app de TikTok/IG; un CSV real de Ads Manager importa sin errores y sus filas aparecen como snapshots; el schedule (≤24 h) queda registrado en pg-boss.

#### T7.3 · Métricas derivadas y dashboard
- **Depende de**: T7.1, T7.2
- **Entrega**: cálculo por plataforma (Meta hook rate 3s/impr; TikTok thumbstop 2s/impr y 6s-rate; hold rate) con la no-comparabilidad explícita (§9.9); `/metrics` por variante/hook/ángulo/persona con linaje clicable.
- **Verificación**: los derivados de un snapshot conocido cuadran a mano; la vista "por hook" agrega correctamente las variantes que comparten `hook_line_id`.

#### T7.4 · Reglas kill/scale
- **Depende de**: T7.3
- **Entrega**: `experiment_rule` por lote (métrica correcta por plataforma, umbral, ventana 24–48 h, acción kill/scale/notify, modo manual/auto); evaluador cron; acciones ejecutables.
- **Verificación**: con snapshots inyectados, una variante bajo el umbral a las 48 h genera la propuesta de kill; en modo auto (ad de prueba de bajo presupuesto) la pausa se ejecuta de verdad en la plataforma.

#### T7.5 · Flywheel: PerfStats y recomendador
- **Depende de**: T7.3
- **Entrega**: agregación periódica a `hook_line.perf`, `prompt_template.perf`, `persona.perf` y por framework; el recomendador de N4/CP2 ordena por score (con mínimo de muestra).
- **Verificación (criterio 22.6)**: tras un lote medido, CP2 del siguiente lote muestra los hooks reordenados con su hook rate histórico; el orden cambia si se inyecta un snapshot que invierte el ranking.

#### T7.6 · Conciliación de gasto
- **Depende de**: T0.12 (ejecutable desde el cierre de F4/F5)
- **Entrega**: vista de conciliación en `/spend`: coste interno vs facturas reales (fal, Anthropic, Firecrawl) con captura manual mensual.
- **Verificación (criterio 22.7)**: para un mes con actividad, la desviación ledger vs facturas es <10 % (documentado en la vista).

#### T7.7 · Panel de gasto completo
- **Depende de**: T5.10, T0.12
- **Entrega**: vistas por proyecto/lote/tier, **coste medio por variante aprobada** (incluye descartes), alertas 70/90/100 % con email opcional, y **freno** que bloquea la creación de lotes nuevos al superar el presupuesto (§16.2, O9, D5).
- **Verificación**: con un presupuesto bajo forzado, intentar crear un lote muestra el bloqueo con mensaje y opción de override explícito; el email de alerta llega (o aparece en el log del mailer en modo dev); el coste medio por variante aprobada cuadra a mano con el ledger.

---

## F8 — Operación y extensiones (backlog priorizado)

#### T8.1 · Backups completos y restore ensayado
- **Depende de**: T0.13
- **Entrega**: `pg_dump` diario + restic de `/data/assets` (excluyendo regenerables) a destino externo; **ensayo de restore documentado**.
- **Verificación**: restaurar el backup en un contenedor limpio y arrancar la app: proyectos, briefs y masters íntegros (checksum de 3 masters al azar).

#### T8.2 · Retención y monitor de disco
- **Depende de**: T5.7
- **Entrega**: política configurable (borrar intermedios de variantes rechazadas a los 30 días; conservar masters y linaje) + job de limpieza + alerta de disco >80 %.
- **Verificación**: forzar la política sobre datos de prueba borra exactamente lo esperado y nunca un master; la alerta se dispara con un umbral bajo forzado.

#### T8.3 · Presets de export por plataforma
- **Depende de**: T5.5
- **Entrega**: render dedicado TikTok vs Reels (safe zones, duración y caption style propios) + preset HQ 1440×2560 para Meta; la caché de normalizados distingue perfiles (`normalized_cache_key` ya lo soporta).
- **Verificación**: la misma variante exporta dos masters cuyos captions respetan la safe zone específica de cada plataforma (script de asserts sobre los .ass).

#### T8.4 · A/B de receta por idioma (lipsync)
- **Depende de**: T5.9
- **Entrega**: comparación sistemática TTS+avatar vs Kling 3.0 voice control para es (y siguientes locales); receta por defecto por locale fijada en BD (§17).
- **Verificación**: informe con 3 pares de clips comparados y decisión registrada en `recipe` por locale.

#### T8.5 · Superficie MCP
- **Depende de**: T5.9
- **Entrega**: MCP server (patrón Prizmad, `research/04 §1`) con tools `analyze_url`, `create_batch`, `get_batch_status` (long-poll con progreso), `list_variants`, `get_download_url`.
- **Verificación**: desde Claude Code, `create_batch` sobre una URL real lanza un lote visible en el canvas y `get_batch_status(wait:true)` reporta el progreso por pasos.

#### T8.6 · Ampliación de galería a ~150 templates + idiomas adicionales
- **Depende de**: T4.12
- **Entrega**: cobertura completa de la matriz formato × hook × vertical; hook/cta libraries en el siguiente idioma priorizado.
- **Verificación**: para cualquier combinación ángulo×formato del brief de prueba existe ≥1 template publicado; validador en verde.

#### T8.7 · Remotion caption layer premium (opcional)
- **Depende de**: T5.4
- **Entrega**: evaluación (licencia $0,01/render + $100/mes mín.) y, si compensa, integración como estilo de captions premium.
- **Verificación**: decisión documentada; si se integra, un master con captions Remotion pasa el QA.

#### T8.8 · Observabilidad completa
- **Depende de**: T0.11
- **Entrega**: panel de métricas internas (duración por tipo de step, tasa de fallo por modelo/endpoint, discrepancia estimado-vs-real, profundidad de cola) en `/settings` y alertas operativas restantes (webhook con firma inválida, sync de métricas fallido) (§19.1).
- **Verificación**: enviar un webhook forjado → la alerta aparece; el panel muestra estadísticas reales calculadas desde las tablas (contrastadas a mano con una query).

---

## Reglas de trabajo

1. **Orden**: el grafo `Depende de` manda (la numeración es orientativa); entre fases se puede adelantar trabajo que no dependa de lo pendiente, pero una fase solo se cierra cuando su E2E final pasa.
2. **Definición de hecho**: subtareas completas + verificación ejecutada y anotada (fecha + resultado + coste real si aplica) + sin regresión del E2E de la fase anterior.
3. **Deudas `[verificar]`**: cada una se cierra en la tarea que la nombra y el resultado se anota también en el PRD para mantenerlo veraz.
4. **Los E2E de fase son sagrados**: T1.10b, T2.6, T4.11, T5.9 y los criterios de §22 del PRD son la vara de "funciona en el mundo real"; no se marcan por aproximación.
5. **Costes**: toda tarea que llame a APIs de pago anota el coste real observado; si difiere >25 % del estimado, se recalibra la `recipe`/estimador en la misma tarea.
6. **Cambios de alcance**: si una tarea revela que el PRD necesita ajuste (como ya pasó con Personas→F2 o el estado `scripted`), se edita el PRD en la misma sesión y se anota en ambos documentos.
