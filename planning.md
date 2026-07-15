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
| F2 | Estrategia y guiones (incluye Personas v1 y recetas) | Brief → matriz con coste estimado → guiones aprobados en CP3 | ✅ |
| F3 | Galería y compilador | Templates facetados + compilador que produce `resolvedPrompt` auditables | ☐ |
| F4 | Generación fal | Todos los assets de una variante generados de verdad vía fal.ai | ☐ |
| F5 | Composición y export | Anuncio completo 9:16 con captions karaoke, C2PA y QA descargable | ☐ |
| F6 | Publicación | Variante publicada en TikTok/IG y ad draft creado desde la herramienta | ☐ |
| F7 | Medición y flywheel | Métricas por variante en el dashboard + kill/scale + scoring realimentado | ☐ |
| F8 | Operación y extensiones | Backups, retención, presets por plataforma, observabilidad, MCP (backlog) | ☐ |

**Hitos de valor real** (el producto es útil antes de terminar): tras F1 ya analiza productos; tras F2 ya escribe guiones utilizables a mano; tras F4+F5 ya fabrica anuncios completos; F6–F7 cierran el loop.

---

## F0 — Fundaciones

El corazón de esta fase es el **orquestador** (§9.0): la máquina de estados transaccional del DAG. Todo lo demás del producto se cuelga de él. Al cerrar F0 no hay ninguna feature de negocio, pero el esqueleto completo (pipeline visual con checkpoints en el VPS) funciona con steps de demo. Nota transversal: desde que T0.4 esté cerrada, los scripts/curl de cualquier verificación se autentican primero (login + cookie de sesión).

#### T0.1 · Monorepo y esqueleto de proyectos [x] 2026-07-07 — PASS, ver docs/verifications/T0.1/ (coste $0)
- **Depende de**: —
- **Entrega**: pnpm workspaces con `apps/web` (Next.js App Router + Tailwind), `apps/worker` (Node TS), `packages/core`, `packages/db`; tsconfig/eslint/prettier compartidos; **logging estructurado (pino)** con campos de correlación (`run_id`/`step_id`/`request_id`) desde el día 1; script `pnpm dev` levanta web y worker.
- **Subtareas**:
  - [x] Inicializar workspaces y los 4 paquetes con sus builds.
  - [x] `packages/core`: carpeta `contracts/` con un primer schema Zod trivial compartido e importado desde web y worker.
  - [x] Logger pino compartido con serializers de correlación.
  - [x] Página raíz de Next con "UGC Factory" y healthcheck `/api/health`; el worker arranca y loggea "worker ready".
- **Verificación**: `pnpm build && pnpm dev` → `curl localhost:3000/api/health` devuelve `{ok:true}` y el log del worker muestra "worker ready" en JSON estructurado. Un cambio en un tipo de `packages/core` rompe la compilación de ambas apps (se comprueba a propósito).

#### T0.2 · Docker Compose de desarrollo con Postgres [x] 2026-07-08 — PASS, ver docs/verifications/T0.2/ (coste $0)
- **Depende de**: T0.1, TD.7 *(dependencia de orden, no técnica: el usuario decidió el 2026-07-07 que la fase FD se construye entera antes de continuar F0)*
- **Entrega**: `docker-compose.dev.yml` con `postgres:16` (volumen persistente) y variables de entorno de conexión.
- **Subtareas**:
  - [x] Compose + `.env.example` documentado.
  - [x] Web y worker se conectan al arrancar (ping de conexión en el healthcheck).
- **Verificación**: `docker compose -f docker-compose.dev.yml up -d` → `/api/health` devuelve `{ok:true, db:true}`; parar Postgres hace que devuelva `db:false` sin tumbar la app.

#### T0.3 · Drizzle + primera migración [x] 2026-07-08 — PASS, ver docs/verifications/T0.3/ (coste $0)
- **Depende de**: T0.2
- **Entrega**: Drizzle configurado en `packages/db`; migración inicial con `project`, `app_setting`, `audit_log`; script `db:migrate` con lock en el arranque de web (§18.2).
- **Subtareas**:
  - [x] Schema Drizzle + generación de migraciones + runner.
  - [x] Repos tipados mínimos (create/get project).
- **Verificación**: `pnpm db:migrate` sobre BD vacía crea las tablas (visible con `psql \dt`); crear un project vía un script de smoke y leerlo de vuelta.

#### T0.4 · Auth single-user [x] 2026-07-10 — PASS, ver docs/verifications/T0.4/ (coste $0)
- **Depende de**: T0.3
- **Entrega**: login con password (hash en `app_setting`), sesión con cookie httpOnly, middleware que protege todas las rutas salvo login/health/webhooks; rate limit de login.
- **Mockup**: `docs/mockups/auth.html` (layout dos paneles). **Desviación acordada 2026-07-09** (README de mockups + journal): el mockup dibuja un producto multi-usuario (signup, correo, passkey, ¿olvidaste?, recordar sesión); UGC Factory es mono-usuario (PRD §19.2), así que `/login` reproduce **el layout** pero cablea **solo** password + Entrar + error/rate-limit. Signup/correo/passkey/recordar quedan FUERA de alcance por diseño — el reviewer no debe exigirlas.
- **Playwright permanente**: esta tarea activa el harness (`apps/web/playwright.config.ts` + stack E2E) y deja `apps/web/e2e/auth.spec.ts` (redirect sin sesión, error/rate-limit, login y sesión tras reload) y `apps/web/e2e/design-system.spec.ts` (backfill de FD: `/design-system` abre y los switchers de tema/acento/densidad siguen operables) dentro de `pnpm test:e2e`.
- **Verificación**: en navegador, acceder a `/` sin sesión redirige a login; password incorrecto 3 veces → rate limit visible; con password correcto se entra y la cookie sobrevive a un refresh.

#### T0.5 · StorageAdapter local + download proxificado [x] 2026-07-10 — PASS, ver docs/verifications/T0.5/ (coste $0)
- **Depende de**: T0.3, T0.4 *(la Verificación exige 401 sin sesión: usa el middleware de auth de T0.4, no un check ad-hoc)*
- **Entrega**: interfaz `StorageAdapter` (put/get/stat/delete) con implementación filesystem (`/data/assets`), tabla `asset` (subset mínimo: id, kind, storage_key, mime, bytes, checksum) y endpoint `GET /api/assets/:id/download` (streaming, autenticado, nunca ruta cruda; §19.2).
- **Playwright permanente**: `apps/web/e2e/assets-download.spec.ts` prepara un asset real, descarga el stream autenticado y verifica checksum; sin `storageState`, el mismo endpoint devuelve 401 sin exponer la ruta de storage.
- **Verificación**: subir un fichero con un script de smoke → aparece en `/data/assets` con su fila en `asset` → descargarlo por `/api/assets/:id/download` con checksum idéntico; sin sesión, el endpoint devuelve 401.

#### T0.6 · pg-boss operativo en el worker [x] 2026-07-08 — PASS, ver docs/verifications/T0.6/ (coste $0)
- **Depende de**: T0.3
- **Entrega**: pg-boss inicializado; job de demo `noop` con retries/backoff; helper `enqueue()` en `packages/core`.
- **Verificación**: encolar 10 jobs `noop` con 30 % de fallo configurado → el log muestra ejecuciones y reintentos; la tabla de pg-boss muestra todos en `completed` al final.

#### T0.7a · Máquina de estados transaccional [x] 2026-07-08 — PASS, ver docs/verifications/T0.7a/ (coste $0)
- **Depende de**: T0.6
- **Entrega**: migración de `pipeline_run` + `step_run` completas (§12, incl. `supersedes_id` y enums de §7.1) y el núcleo del módulo `orchestrator` (§9.0): `transition(stepId, event)` transaccional (`SELECT … FOR UPDATE`), tabla de transiciones válidas, resolución de `depends_on` y encolado en pg-boss **dentro de la misma transacción**, y `NOTIFY pipeline_events`.
- **Subtareas**:
  - [x] Migración + enums.
  - [x] `transition()` + tests unitarios exhaustivos (toda transición ilegal rechaza).
  - [x] Resolución de dependencias + encolado transaccional + NOTIFY.
- **Verificación**: script contra la BD real que ejecuta una secuencia de transiciones legales e ilegales: las legales dejan las filas con los estados/timestamps esperados, las ilegales lanzan error sin tocar la BD; en una sesión `psql` con `LISTEN pipeline_events` se ve el NOTIFY de cada transición.

#### T0.7b · Runs, consumer genérico y executors de demo [x] 2026-07-08 — PASS, ver docs/verifications/T0.7b/ (coste $0)
- **Depende de**: T0.7a
- **Entrega**: creación de run desde una definición de DAG (nodos + depends_on; estados iniciales `awaiting_deps`/`pending`), endpoint `POST /api/runs`, consumer genérico de pg-boss que ejecuta el executor registrado por `node_key` y llama a `transition`, y **executors de demo con flags configurables** (`sleep_ms`, `fail_rate`, `hang` — necesarios para verificar timeouts y retries después).
- **Deuda heredada de T0.7a (precondición de que los retries funcionen) — RESUELTA en T0.7b**: `StepPatch` se extendió con `incrementRetryCount` (traducido a `retry_count = retry_count + 1` en el UPDATE, atómico bajo el lock). `failStep()` (core) evalúa `retry_count < max_retries` bajo el lock y, con margen, dispara `retry` incrementando en la misma tx; agotado ⇒ `failed` terminal. Verificado: un step `demo.fail` con `failRate=1` agota a `retry_count=3`/`failed` sin bucle infinito; K<max converge a `succeeded` con `retry_count=K`. (Bug de boot de web —resolución de la carpeta de migraciones bajo Turbopack, wiring de T0.3— aflorado y arreglado en esta tarea con el wrapper `apps/web/scripts/dev.mjs`; recordatorio para T0.13: el wrapper es dev-only.)
- **Verificación**: `POST /api/runs` con el DAG de demo → los 3 steps pasan `pending→queued→running→succeeded` en orden (filas con timestamps coherentes); 20 runs concurrentes completan sin interbloqueos ni estados corruptos (script de concurrencia).

#### T0.8 · Checkpoints, aprobación, invalidación, skip y cancel [x] 2026-07-10 — PASS, ver docs/verifications/T0.8/ (coste $0)
- **Depende de**: T0.7b
- **Entrega**: soporte `is_checkpoint` (estado `waiting_approval`), endpoints `approve/edit/reject` + `POST /api/steps/:id/skip` y `POST /api/runs/:id/cancel` (transiciones `skipped`/`cancelled`), invalidación de sub-grafo con `supersedes_id` (nunca reset de filas), flag `autopilot` con override por nodo, y **escritura en `audit_log` del diff artefacto-IA vs artefacto-editado** en cada edit/approve/reject (§19.1).
- **Verificación**: run de demo con checkpoint → se pausa; `approve` reanuda; `edit` crea nueva fila del step aguas abajo con `supersedes_id` (la antigua queda `superseded`) y el diff aparece en `audit_log` (query); `skip` sobre un nodo skippable lo salta y el run completa; `cancel` detiene un run en curso; con `autopilot=true` no hay pausas y el override "parar siempre aquí" gana.

#### T0.9 · Timeouts, retries y cron de barrido [x] 2026-07-10 — PASS, ver docs/verifications/T0.9/ (coste $0)
- **Depende de**: T0.7b
- **Entrega**: `timeout_at` por step (por tipo de nodo), ~~cron pg-boss~~ **barrido por `setInterval` en el worker (5 s)** que expira steps colgados (`expired`), retry manual (`POST /api/steps/:id/retry`) y automático hasta `max_retries`. *(Desviación deliberada del literal "cron pg-boss" — regla 6, 2026-07-10: el cron de pg-boss tiene precisión de minuto (schedules evaluadas cada ~30 s) y no cumpliría el `<40 s` de la Verificación con timeout de 10 s; el barrido va como timer del worker. Mismo gate que pg-boss: solo corre con BD alcanzable, se limpia en `boss.stop`.)*
- **Verificación**: un executor de demo con `hang=true` y timeout de 10 s → el step pasa a `expired` en <40 s sin intervención; `retry` sobre un step con `fail_rate=1` forzado a 0 lo re-ejecuta y completa.

#### T0.10 · SSE sobre LISTEN/NOTIFY [x] 2026-07-10 — PASS, ver docs/verifications/T0.10/ (coste $0)
- **Depende de**: T0.7b
- **Entrega**: `GET /api/runs/:id/events` (route handler Node streaming): evento `snapshot` al conectar, deltas `step_changed` vía LISTEN/NOTIFY, `heartbeat` cada 25 s, `id:` monotónico + re-snapshot con `Last-Event-ID` (§9.0); contrato de eventos en `packages/core`.
- **Verificación**: `curl -N /api/runs/:id/events` durante un run de demo → snapshot, deltas por transición y heartbeats visibles; matar y reabrir el curl con `Last-Event-ID` re-sincroniza sin perder el estado final.

#### T0.11 · Canvas React Flow v1 [x] 2026-07-10 — PASS (7/7 comportamientos CUA en navegador), ver docs/verifications/T0.11/ (coste $0)
- **Depende de**: T0.8, T0.9, T0.10
- **Entrega**: página `/runs/[id]` con grafo (layout automático dagre/elkjs), nodos con estado/color/duración (y coste si existe), panel lateral al click con **visor de logs, errores y output/artefacto JSON genérico del step** (§8.2), botones de checkpoint (aprobar/editar/rechazar), retry, skip, cancelar lote y toggle autopilot.
- **Mockup**: `docs/mockups/runs-id.html` (variante 1b · cockpit denso). El layout parte de ese mockup; el reviewer rechaza una página que se desvíe sin acuerdo (ver `.claude/skills/frontend`).
- **Playwright permanente**: `apps/web/e2e/runs-canvas.spec.ts` cubre cambios de estado por SSE sin reload, visor de output/error, approve/edit/reject, retry, skip, cancel y autopilot con override; usa executors de demo deterministas y estados observables, no colores CSS.
- **Verificación**: en el navegador, lanzar el run de demo y **ver los nodos cambiar de color en vivo**; aprobar el checkpoint desde el panel; provocar un fallo (`fail_rate=1`) y ver el error en el visor de logs del nodo; retry con éxito; cancelar otro run en curso desde el botón; activar el toggle autopilot desde la cabecera y ver un run completar sin pausas (con el candado "parar siempre aquí" respetado); skip de un nodo skippable desde el panel — todo operado desde la UI, no vía API.

#### T0.12 · Ledger de gasto (esqueleto) [x] 2026-07-10 — PASS, ver docs/verifications/T0.12/ (coste $0)
- **Depende de**: T0.7b
- **Entrega**: tablas `cost_entry` y `budget`; helper `recordCost()`; página `/spend` v1 con totales por día/proveedor y alerta in-app al superar el presupuesto. (El panel completo — vistas por proyecto/lote/tier, freno, email — llega en T7.7.)
- **Mockup**: `docs/mockups/spend.html` (variante 8a · presupuesto + ledger por proveedor). El layout parte de ese mockup; el reviewer rechaza una página que se desvíe sin acuerdo (ver `.claude/skills/frontend`).
- **Playwright permanente**: `apps/web/e2e/spend.spec.ts` siembra importes propios del spec y comprueba totales por día/proveedor y alerta de presupuesto desde `/spend`.
- **Verificación**: tras 3 runs de demo con costes ficticios **elegidos por el verifier** (no los fixtures del implementer), `/spend` muestra la suma exacta esperada; un presupuesto de prueba por debajo del gasto dispara la alerta in-app.

#### T0.13 · Despliegue inicial en VPS [x] 2026-07-14 — PASS (verifier independiente, evidencia en docs/verifications/T0.13/), coste $0
- **Depende de**: T0.11, T0.4 *(la Verificación incluye "login funciona")*; ⚠ VPS contratado y dominio con DNS apuntando al VPS (los aporta el usuario)
- **Entrega**: `docker-compose.prod.yml` (web standalone, worker, postgres; volumen `/data/assets` worker rw + **web rw** —ver reconciliación abajo—; §18), `DEPLOY.md`, deploy por `git pull && docker compose up -d --build`, cron de `pg_dump` diario.
- **Reconciliación PRD §18 (2026-07-14, regla 6) — web monta `/data/assets` RW, no `ro`**: el PRD decía «toda escritura la hace el worker», pero eso se escribió antes de que existieran los uploads. Hoy **tres rutas de web escriben** en el StorageAdapter (`POST /api/assets`, `POST /api/personas/:id/reference-images`, y el `storage.delete()` al borrar una persona): son subidas del USUARIO desde el navegador y, en una app mono-usuario, encolarlas al worker sería complejidad sin dueño. Con `ro` esas tres rutas mueren con **EROFS** en producción. Se alinea el despliegue con lo construido. *(Nota de verificación: un `ro→rw` puede seguir fallando si el dueño del volumen compartido quedó mal en su primera inicialización — se verifica **subiendo un fichero de verdad**, no con un código HTTP.)* *(Ajuste menor 2026-07-14, regla 6: el TLS/reverse-proxy NO va en el compose del proyecto — el VPS es multi-proyecto y trae un **Caddy central** (`~/infra/caddy`, contenedor `edge-caddy`; guía canónica en `~/AGENTS.md` del VPS) que termina TLS para todos los subdominios. El compose publica web SOLO en `127.0.0.1:3100` (bloque 3100–3109 reservado en el registro de puertos) y el site file `~/infra/caddy/sites/ugc.carlosvillu.dev.caddy` lleva el `flush_interval -1` de la ruta SSE y la sobrescritura de `x-forwarded-for`. Cloudflare proxied delante del origen ⇒ la IP real del cliente llega en `CF-Connecting-IP`.)*
- **Deuda de T0.4 — trust boundary de `x-forwarded-for` (RESOLVER AQUÍ)**: el rate-limit del login (`clientIp` en `apps/web/src/server/rate-limit.ts`) usa la 1.ª IP de `x-forwarded-for`, que es **client-controllable** hasta que Caddy la reescriba. Sin trust boundary, un atacante rota el header y bombea el rate-limit (fuerza bruta ilimitada). Caddy debe **sobrescribir** (no *append*) `x-forwarded-for` con la IP real del socket, y la app debe confiar SOLO en el hop de Caddy (no en el header crudo del cliente). Sin esto, la protección de fuerza bruta del login mono-usuario queda hueca en cuanto el VPS es público. Verificarlo en la Verificación (ver abajo).
- **Deuda de T0.3/T0.14 — `next start` (PROD) NO ARRANCA hoy (RESOLVER AQUÍ; causa raíz confirmada 2026-07-11)**: el arranque de producción crashea en `instrumentation.register()` con `ERR_INVALID_ARG_TYPE: path must be of type string. Received type number`. **Causa**: `migrationsFolder()` (`packages/db/src/migrate.ts`) prefiere `UGC_DB_MIGRATIONS_DIR` y, si falta, cae a `require.resolve('@ugc/db/package.json')` — que **bajo el bundle de Turbopack devuelve un ID numérico de módulo virtual**, no una ruta. `apps/web/scripts/dev.mjs` inyecta esa var **solo para `next dev`**: `next start` no pasa por el wrapper ⇒ prod nunca ha arrancado (no es regresión de T0.14). **Fix validado empíricamente sin tocar código**: con `UGC_DB_MIGRATIONS_DIR=<repo>/packages/db/drizzle` en el entorno, `next start` arranca limpio, migra y sirve (`/api/health` → `{"ok":true,"db":true}`, `/` → 307 `/login`); log en `docs/verifications/T0.14/prod-web-fixed.log`. Es el único landmine de `require.resolve` en el boot de prod. **Dos caminos, elegir aquí**: (A) *mínimo, cero código* — setear `UGC_DB_MIGRATIONS_DIR` en el env del contenedor y garantizar que `packages/db/drizzle` esté en la imagen (**ojo con `output: 'standalone'`: hay que copiar esa carpeta explícitamente**); conserva la migración on-boot con advisory lock de T0.3. (B) *toca el diseño de T0.3* — sacar las migraciones de `instrumentation` a un paso de deploy (`pnpm db:migrate`, Node puro donde `require.resolve` sí resuelve), dejando `instrumentation` con guards/seeds; más ortodoxo en Docker pero renuncia al lock on-boot. Sea cual sea, **la Verificación debe ejercitar `docker compose up` real** (ver abajo), no solo `next dev`. **Alcance de lo confirmado**: el landmine es de *web* (el bundle de Turbopack); `apps/worker` comparte `@ugc/db` pero no migra ni pasa por Turbopack ⇒ en principio no le afecta, pero **verificar también el boot del worker en modo prod** (no se ha probado).
- **Playwright permanente**: no añade comportamiento de producto nuevo; `auth.spec.ts` y `runs-canvas.spec.ts` conservan login/SSE localmente. TLS, Caddy, volúmenes y backup se protegen con smoke de despliegue reproducible y la Verificación externa, porque no caben honestamente en el stack Playwright efímero.
- **Verificación**: desde fuera del VPS, `https://<dominio>` sirve la app con certificado válido (⇒ el arranque de web en modo producción funciona de verdad, cerrando la deuda de arriba); login funciona; un run de demo completo corre en el VPS con el canvas actualizándose en vivo (SSE atraviesa Caddy); forzar el cron de backup → aparece el dump fechado y `pg_restore --list` lo lee sin error.

#### T0.14 · Credenciales cifradas y /settings [x] 2026-07-11 — PASS, ver docs/verifications/T0.14/ (coste $0)
- **Depende de**: T0.4; ⚠ API key real de fal para esta verificación (las de Anthropic y Firecrawl llegan con T1.7/T1.4) — las aporta el usuario ✓ aportada 2026-07-11
- **Entrega**: módulo de secretos (§13.1/§19.2): API keys en `app_setting` cifradas at-rest (AEAD simétrico AES-256-GCM vía `node:crypto`, clave derivada de `APP_MASTER_KEY` por scrypt con salt propio `ugc-secrets-v1` — distinto del salt de sesión; reconciliado el 2026-07-11 desde "libsodium sealed box" del borrador, ver §19.2), bootstrap desde env en el primer arranque, y página `/settings` para editar keys, presets, idiomas, umbrales y apariencia del design system (tema/acento/densidad — añadido menor 2026-07-07 al crearse la fase FD; hasta entonces la app fija dark/indigo/balanced).
- **Playwright permanente**: `apps/web/e2e/settings.spec.ts` usa claves dummy contra providers fake y cubre guardar/editar secretos enmascarados y persistencia tras reload de tema, acento y densidad; el cifrado at-rest queda en integración de BD, no se simula en navegador.
- **Verificación**: guardar la key de fal desde `/settings` → reiniciar el contenedor de Postgres y los procesos web/worker → la key sigue funcionando; en `psql`, el valor almacenado es un blob cifrado (no aparece la key en claro en ningún `SELECT`); borrar la env var tras el bootstrap no rompe nada; cambiar tema/acento/densidad desde `/settings` se aplica en vivo y persiste tras un reload.

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

#### TD.7 · Skill frontend cerrada contra la realidad + E2E de fase [x] 2026-07-08 — PASS (E2E automatizable + OK visual del usuario), ver docs/verifications/TD.7/
- **Depende de**: TD.4, TD.6
- **Entrega**: skill `frontend` actualizada con el inventario definitivo de `components/ui/` (los ~26 con sus variantes reales) en `references/design-system.md`/`components.md`, obligatoriedad explícita («si existe el componente del DS, usarlo es obligatorio; HTML crudo estilado equivalente = error de review») y ajustes descubiertos durante la fase anotados en el journal.
- **Regresión Playwright posterior**: al aprobarse la regla de tests permanentes el 2026-07-10, T0.4 asume el backfill `apps/web/e2e/design-system.spec.ts`; no se reabre retroactivamente TD.7 ni se finge que el spec existía durante su PASS.
- **Verificación (E2E de fase)**: recorrido CUA completo de `/design-system` — dark, light y 2 acentos — con evidencia visual en `docs/verifications/TD.7/`; `pnpm gate` verde; y **revisión humana final del showcase** (parada de fin de fase: el usuario da el OK visual).

---

## F1 — Análisis (URL/texto → ProductBrief)

#### T1.1 · Contratos del análisis en `packages/core` [x] 2026-07-10 — PASS, ver docs/verifications/T1.1/ (coste $0)
- **Depende de**: T0.1
- **Entrega**: Zod schemas de `RawContent`, `VisualAnalysis` y `ProductBrief` (con las divergencias del Apéndice A: `platform=manual`, `source_url` nullable, cardinalidades en Zod) + espejo JSON Schema para `output_config` de Anthropic + fixtures de test.
- **Verificación**: suite de tests con fixtures válidos e inválidos (brief sin ángulos, URL en modo manual, etc.) pasa; el JSON Schema generado se valida contra un validador draft 2020-12.

#### T1.2 · Migraciones de análisis [x] 2026-07-10 — PASS, ver docs/verifications/T1.2/ (coste $0)
- **Depende de**: T1.1, T0.3
- **Entrega**: tablas `url_analysis`, `product_brief`, `brand_kit` (§12, con `domain` nullable y `source`).
- **Verificación**: migración aplica sobre BD limpia y `psql \d` muestra tablas/columnas/enums esperados; insertar 2 filas de `brand_kit` con `domain NULL` entra sin conflicto y 2 con el mismo dominio falla la segunda con error de constraint (UNIQUE parcial verificado).

#### T1.3 · Fast path determinista de ingesta [x] 2026-07-10 — PASS (3 URLs reales + fallback), ver docs/verifications/T1.3/ (coste $0)
- **Depende de**: T1.2
- **Entrega**: clasificador de URL (regex §7.2 N1), cliente Shopify `.json`, parsers JSON-LD (`Product/Offer/AggregateRating`) y OpenGraph, merge a `RawContent`; normalizador de URL + content_hash; manejo de 404/401 del `.json` con fallback transparente.
- **Verificación**: contra 3 URLs reales (1 Shopify, 1 con JSON-LD, 1 solo-OG), el `RawContent` persistido contiene título/precio/imágenes correctos comprobados a mano contra la página; una URL cuyo `{url}.json` responde 404/401 degrada al parser JSON-LD/OG de forma transparente (sin error visible ni fila rota).

#### T1.4 · Cliente Firecrawl + fallback Jina [x] 2026-07-11 — PASS (red real oatly.com), ver docs/verifications/T1.4/ (coste ~$0,001)
- **Depende de**: T1.3, T0.5, T0.12, T0.14 *(el screenshot se persiste como `asset` y se descarga por el endpoint de T0.5)*; ⚠ API key de Firecrawl (la aporta el usuario) ✓ aportada 2026-07-11
- **Entrega**: cliente `/v2/scrape` con `formats: [markdown, images, branding, product, screenshot]` + `onlyMainContent` + `proxy: auto`; fallback a Jina Reader si Firecrawl falla; screenshot persistido como `asset`; créditos registrados en `cost_entry`.
- **Coste estimado**: ~$0,30 (créditos Firecrawl de varios scrapes de prueba)
- **Verificación**: analizar una landing real JS-heavy → `url_analysis.raw_content` contiene markdown legible, ≥3 imágenes y branding con paleta; el screenshot se descarga por `GET /api/assets/:id/download` (T0.5) y coincide con la landing; con la key de Firecrawl inválida, Jina produce al menos el markdown; los créditos aparecen en `/spend`.

#### T1.5 · Mini-crawl de páginas internas [x] 2026-07-11 — PASS (red real ollie.com/oatly.com, 2 ciclos: FAIL#1 onlyMainContent→fix→PASS), ver docs/verifications/T1.5/ (coste ~$0,013)
- **Depende de**: T1.4
- **Entrega**: descubrimiento de hasta 3 URLs same-domain (`/reviews`, `/faq`, `/about` y variantes por idioma) + scrape ligero + anexión al `RawContent` (§9.1).
- **Coste estimado**: ~$0,10
- **Verificación**: sobre una tienda real con página de reviews, el markdown anexado contiene texto de reviews reconocible; sobre una landing sin esas páginas, el paso termina en `skipped` sin error.

#### T1.6 · Entrada por texto libre [x] 2026-07-10 — PASS (CUA navegador + logs + psql), ver docs/verifications/T1.6/ (coste $0)
- **Depende de**: T1.2, T0.5
- **Entrega**: formulario de intake modo "texto libre" (descripción + upload opcional de imágenes), `RawContent` sintético (`source=manual`), caché por hash del texto (§7.4).
- **Playwright permanente**: `apps/web/e2e/intake-manual.spec.ts` cubre envío de texto con y sin imágenes, validación visible del formulario y reutilización observable de una entrada repetida usando fixtures locales.
- **Verificación**: crear un análisis solo con un párrafo y 2 imágenes → `url_analysis` en `done` sin ninguna llamada de scraping (logs); repetir el mismo texto reutiliza la caché (sin fila nueva).

#### T1.7 · Cliente Anthropic + VisualAnalyzer [x] 2026-07-11 — PASS (coste $0.01<$0.02 + skipped automatizado; ≥7/8 juicio humano OK del usuario), ver docs/verifications/T1.7/
- **Depende de**: T1.4, T1.6, T0.14; ⚠ API key de Anthropic (la aporta el usuario) ✓ aportada 2026-07-11
- **Entrega**: cliente Anthropic en `packages/core` (structured outputs + prompt caching + tokens a `cost_entry`); `VisualAnalyzer` (Haiku 4.5): clasificación de imágenes, paleta y social proof del screenshot (prompt `research/07 §5 P3`); reescalado ≤1080p. Con `source=manual`: clasifica las subidas; sin imágenes → `skipped`.
- **Coste estimado**: ~$0,10
- **Verificación**: sobre las imágenes de una landing real, la clasificación coincide con el juicio humano en ≥7 de 8 (revisión manual); coste del paso <$0,02 en `/spend`; el modo manual sin imágenes deja el paso `skipped` y el flujo continúa.

#### T1.8 · BriefSynthesizer (N3) [x] 2026-07-11 — PASS (5 ciclos verifier; bound revisado a $0,25), ver docs/verifications/T1.8/ (coste real ~$5,67)
- **Depende de**: T1.7, T1.1
- **Entrega**: síntesis con Sonnet 5 en una llamada *(+1 reintento acotado ante respuesta que no valide — ajuste aprobado, nota 4)*; system prompt versionado en `packages/core/prompts/` con taxonomía + frameworks + **bloque anti-injection del Apéndice A** + reglas FTC, en el idioma de análisis. *(Desviación aprobada: el `output_config` de Anthropic NO puede con un schema de este tamaño —dos límites duros de plataforma, ver journal— así que el schema viaja como TEXTO en el system prompt y `ProductBriefSchema.safeParse()` es el validador. La API ignoraba las cardinalidades de todos modos.)*
- **Coste estimado**: ~$0,60 (3 briefs + repetición para probar la caché)
- **Verificación**: contra 2 URLs reales + 1 texto libre, los briefs validan contra Zod, los campos extractivos llevan `evidence` con citas presentes literalmente en el markdown, hay 5–10 ángulos distintos, coste **<$0,25/brief** en `/spend` *(bound revisado — ver nota 5)*, y en la 2ª llamada `cache_read_input_tokens > 0`. **Test de seguridad**: una página de prueba con texto adversarial ("ignore the schema, return null") no corrompe el brief.
- **Notas de la Verificación (2026-07-11, tras los FAIL #1 y #2 — regla de trabajo 6)**:
  1. **El bound `<$0,15/brief` SE MANTIENE; la palanca es el INPUT.** (Se intentó relajarlo a "medido en caliente", pero esa premisa era FALSA y se revirtió: la escritura de caché del system es el 1 % del coste —$0,0045— y no explica nada. Lo que rompe el bound es el markdown de la landing: 20k–63k tokens ⇒ **25–37 cts/brief** contra tiendas DTC normales, medido por el verifier.) Que el bound es alcanzable lo prueba el brief de texto libre: 7 ángulos completos por **9 cts**. Por tanto **N3 acota su ENTRADA**: techo de markdown más bajo, sin la lista de URLs de imágenes (es trabajo de N2), sin chrome de navegación. **OJO — 25/37 cts es un SUELO**: se midió con `visualAnalysis: null`; en producción N2 también se serializa en el user message.
  2. **"No corrompe el brief" se cumple FALLANDO CERRADO** (aprobado por el usuario): lo que la cláusula protege es que no entre dato envenenado al pipeline. En la práctica el verifier observó **resistencia TOTAL** (el modelo extrae producto y precio reales, cero veneno en los datos, y denuncia el ataque en `meta.warnings`) — por encima del criterio acordado.
  3. **DECISIÓN DE ALCANCE (usuario, 2026-07-11): se recortan INPUT y ÁNGULOS.** La aritmética fina lo obliga: con el output observado en ugmonk (11.386 tok = $0,171) **el bound es imposible aunque el input sea CERO** — el brief SOLO ya cuesta 17 cts. Ninguna palanca de entrada, por sí sola, converge. Aplicado: **5–6 ángulos** (la Verificación exige mín. 5; contrato de T1.1 INTACTO, sigue aceptando 5–10), `MAX_MARKDOWN_CHARS` 120k→**20k chars** (el ratio real es ~2,2 chars/token, no 4), `MAX_TOKENS` 12k→16k. **La palanca DOMINANTE resultó ser otra**: el bloque VISUAL ANALYSIS pesaba **10.996 tok = 38 % del input** (117 imágenes clasificadas) → `trimVisualAnalysis()` lo poda a las útiles para vídeo (1.126 tok). Resultado medido sobre la landing que costaba 37 cts: **12,7–13,7 cts** (−63 % de input).
  4. **DECISIÓN DE ALCANCE (usuario, 2026-07-11): se ACEPTA un REINTENTO (×1)** ante `parse_error` por deriva de enums del modelo — **modifica la Entrega literal ("en una llamada")**, que pasa a ser "en una llamada, con un reintento acotado ante respuesta que no valide". Motivo: sin él, una llamada YA PAGADA que derive en un enum da cero briefs. **Coste medido de esa rama: 32–38 cts** (el verifier lo midió sobre datos reales; la estimación previa de $0,26 salía de una medición en caliente). Es el techo EXCEPCIONAL, no el caso normal. El reintento está acotado correctamente: solo ante `parse_error` (NUNCA `api_error` — un 400 es determinista y repetirlo es quemar dinero), y el `cost_entry` SUMA los dos intentos (el contador no miente). Se descartó COERCIONAR el enum (reescribir en silencio un `awareness_level` cambiaría la segmentación de forma invisible: es inventar producto).
  5. **DECISIÓN DE ALCANCE (usuario, 2026-07-11, tras el 3er FAIL): el bound sube de $0,15 a $0,25/brief** (PRD criterio O1 editado). **No era un bug: era una tensión de diseño.** Con la entrada ya optimizada al máximo, el presupuesto de salida bajo $0,15 son **4.115 tokens** y el brief más austero que el sistema sabe escribir (5 ángulos, sin relleno) pesa **6.884–8.076 tok = 1,7× el presupuesto**. **$0,15 + Sonnet 5 ($15/MTok out) + el tamaño del contrato de T1.1 NO CABEN JUNTOS**: solo se pueden tener dos de los tres. Se eligió mantener Sonnet 5 (la síntesis es la pieza más inteligente del pipeline) y el contrato íntegro. Coste real: **19 cts en frío / 16 en caliente** (la caché ephemeral dura ~5 min → la mayoría de análisis pagan la escritura fría). Alternativas descartadas: Haiku 4.5 (~4–6 cts pero riesgo real de briefs peores, y contradice PRD §9.2) y adelgazar el contrato de T1.1 (ya verificado y consumido por matriz/guiones aguas abajo).

#### T1.9 · BriefValidator + BrandKit [x] 2026-07-11 — PASS, ver docs/verifications/T1.9/ (coste real $0,00)
- **Depende de**: T1.8
- **Entrega**: validador con perfiles `url`/`manual` (§9.2: precio N1==N3, hero image, hooks ≤12 palabras, `suggested_assets ∈ assets.images` con poda + warning, cardinalidades) y upsert de `brand_kit` por dominio con reutilización (§9.1).
- **Coste estimado**: ~$0,40 (2 análisis del mismo dominio) — **REAL: $0,00**. El estimado era erróneo por exceso: T1.9 es lógica DETERMINISTA (sin LLM) y el dedup "a nivel de datos" se verifica contra el UNIQUE parcial de Postgres con timestamps inyectados; **no hay que comprar dos análisis** (regla 5, recalibración). Presupuestar $0 a las verificaciones de idempotencia/caché futuras.
- **Verificación** (a nivel de datos, sin UI): un brief con precio discrepante produce el warning tipado y gana el precio del fast path; en modo manual sin hero image, el validador emite el warning tipado `needs_user_decision: missing_hero_image` en la salida, el brief queda válido y el paso NO falla; analizar 2 URLs del mismo dominio extrae el BrandKit una sola vez (timestamps).
- **Notas de alcance (T1.10a/T1.10b heredan esto)**:
  - Los warnings tipados viven en un contrato NUEVO (`contracts/brief-warning.ts`, union discriminada por `code`); `ProductBrief.meta.warnings` (`string[]`) es OTRA cosa (observabilidad del sintetizador) y el schema de T1.1 NO se tocó. **No se persisten**: viajan en el retorno del validador. Quién los lleva a CP1 lo decide T1.10a/T1.10b.
  - ~~`ok` se DERIVA de los warnings (`isBlockingWarning`)…~~ **ELIMINADO EN T1.15**: ningún warning invalida ya el brief. El validador no devuelve `ok`, y `isBlockingWarning`/`BLOCKING_WARNING_CODES` se borraron con su maquinaria (el Set quedaba vacío ⇒ mecanismo muerto). El patrón —la severidad viaja CON el warning, `ok` se DERIVA, jamás se acumula en paralelo— sigue siendo el bueno si algún día vuelve a hacer falta.
  - ~~**Divergencia deliberada con `testing/unit-core.md` §5**~~ **RESUELTA EN T1.15, y a favor de la skill**: la skill pedía "url sin hero → error" y T1.9 divergió con un warning bloqueante; T1.15 elimina el fallo duro entero (es decisión de CP1 en los dos perfiles) y **actualiza la skill** (`unit-core.md` §5) al contrato nuevo. Ya no hay divergencia.
  - ⚠ **Deuda abierta**: `registrableDomain` (heurística last-two-labels) pasa a ser la clave ABSOLUTA del dedup de `brand_kit` → `marca-a.co.uk` y `marca-b.co.uk` colapsan a `co.uk` ⇒ **contaminación cruzada de identidad de marca** entre comerciantes (paleta/tipografía/tono alimentan los guiones; `reused:true` es el camino feliz, sin error). Mitigación: PSL embebida antes del primer dominio con sufijo compuesto.
  - Los hooks reales de Sonnet 5 **incumplen** el techo de ≤12 palabras (8 `hook_too_long` sobre los briefs auténticos de T1.8): CP1 mostrará estos warnings en la mayoría de análisis reales. Si resulta ruidoso, la palanca es el prompt de N3, no el techo del validador.

#### T1.10a · N1–N3 como nodos reales del DAG [x] 2026-07-12 — PASS, ver docs/verifications/T1.10a/ (coste real $0,27)
- **Depende de**: T1.9, T0.11
- **Entrega**: executors reales de N1 (ingesta con fast path/scrape/mini-crawl/texto libre y caché), N2 (visual, con skip) y N3 (síntesis + validación) registrados en el orquestador; definición del DAG de análisis; formulario de intake en modo URL (N0 mínimo: URL + config del lote) — página nueva sin mockup: layout a acordar con el usuario antes de implementarla (regla 7).
- **Coste estimado**: ~$0,25
- **Playwright permanente**: `apps/web/e2e/analysis-pipeline.spec.ts` usa Firecrawl/Anthropic fake y cubre intake URL → N1/N2/N3 en el canvas, output JSON de N3 y el camino de texto libre sin imágenes con N2 en `skipped`.
- **Verificación**: pegar una URL real en el intake → los nodos N1→N2→N3 progresan en el canvas en vivo y el brief JSON aparece como output del nodo N3 en el panel genérico; con texto libre sin imágenes, N2 aparece `skipped` en el grafo.
- **Notas de cierre**:
  - Layout acordado con el usuario (regla 7): `/analyses/new` YA existía (T1.6, texto libre) → se extendió con **TABS del DS**, «Desde URL» por defecto. No era página nueva.
  - **`skip_inapplicable`**: evento NUEVO en la máquina de estados (PRD §7.1/§7.2: «skipped = nodo no aplicable, p. ej. N2 sin imágenes»). T0.11 solo había cableado el `skip` de USUARIO (desde `awaiting_deps`/`pending`); faltaba el auto-skip del nodo inaplicable. **Deliberadamente DISTINTO del `skip` de usuario**: reutilizarlo habría permitido a un usuario abandonar vía `POST /api/steps/:id/skip` un step EN VUELO ya pagado (`skipStep` no valida estados por su cuenta: su única guardia es la tabla). 3 tests lo blindan.
  - **Bug latente cazado en review**: las deps se resolvían por `node_key`, que **NO identifica una fila** — `insertSuperseding` (T0.8) crea filas nuevas con el MISMO `node_key`, así que al editar en CP1 el pipeline podía leer el output de un step `superseded`, en silencio. Ahora el CONSUMER las resuelve por los **ULIDs de `dependsOn`** y se las entrega al executor. Test permanente contra Postgres real.
  - **N3 declaraba `dependsOn:['N2']` pero LEÍA también N1**: dependencia real sin declarar. Corregido a `['N1','N2']`.
  - `PermanentStepError`: los fallos DETERMINISTAS de N3 (refused / brief que no supera T1.9) cierran `failed` **sin retry** — antes reintentaban 3× pagando Sonnet 5 cada vuelta (~$0,60 quemados para acabar igual).
  - Paquete nuevo **`@ugc/services`** (los 5 servicios que combinan red + persistencia + registro de coste; los invocan route handlers Y executors). Frontera escrita en `backend/references/architecture.md` §1.

#### T1.10b · CP1: editor de brief [x] 2026-07-12 — PASS, ver docs/verifications/T1.10b/ (coste real $0,33; pipeline 119,9 s; lote $0,21)
- **Depende de**: T1.10a
- ✅ **LOS DOS BLOQUEOS DE T1.10a, CERRADOS** (evidencia: `docs/verifications/T1.10b/report.md`):
  1. ~~**El pipeline tarda 116,7 s y la Verificación de abajo exige <90 s.**~~ → **RESUELTO 2026-07-12: el bound sube a <180 s** (decisión del usuario, «esperamos sin problemas»; PRD O1 actualizado con su nota). **Verificado: 119,9 s** (N1 29,5 · N2 11,2 · **N3 79,2** — sigue dominando N3). No se optimizó nada, como se decidió.
  2. ~~**No hay atribución de coste por run** (`cost_entry.step_run_id = NULL` → el canvas mostraba $0,00 con 20 cts gastados).~~ → **RESUELTO**: los servicios reciben `stepRunId` y el orquestador hace el rollup a `step_run.cost_actual` (`rollupStepCost`, llamado por el consumer ANTES de la transición de cierre, que es la que dispara el NOTIFY). **Verificado: 4/4 filas nuevas de `cost_entry` con `step_run_id` NOT NULL y el KPI del canvas muestra «Coste real $0.21»**; triple concordancia `cost_actual` == ledger step a step == `/spend`.
- **Entrega**: panel de CP1 con el brief editable campo a campo, badges extraído/inferido (`evidence`/`confidence`), gestión de warnings (incl. petición bloqueante de imágenes o derivación a packshot-IA en modo manual), aprobación que persiste `product_brief` versionado + `edited_by_user`; endpoint standalone `GET/PATCH /api/briefs/:id` (editar un brief aprobado fuera de un run activo, Apéndice E).
- **Mockup**: `docs/mockups/brief-editor.html` (variante 3a · formulario en tarjetas + rail de trazabilidad). El layout parte de ese mockup; el reviewer rechaza una página que se desvíe sin acuerdo (ver `.claude/skills/frontend`).
- **Coste estimado**: ~$0,50
- **Playwright permanente**: `apps/web/e2e/brief-editor.spec.ts` cubre badges/evidence, warnings, edición y versionado standalone; `apps/web/e2e/phases/f1-brief.spec.ts` conserva el journey mockeado intake → N1–N3 → CP1 → aprobar y avanzar. Ambos llevan `@f1`; el segundo además `@phase`.
- **Verificación (E2E de la fase, criterio O1)**: en el navegador — URL real → N1/N2/N3 → editar un beneficio y un hook en CP1 → aprobar → brief versionado (v1 IA, v2 editado) y el run avanza; pipeline **<180 s** (sin contar la edición) *(bound revisado en T1.10a: el real es 116,7 s, dominado por N3 — ver nota de O1 en el PRD)* y **<$0,25** *(bound revisado en T1.8 — ver su nota 5; ojo: este es el coste del pipeline COMPLETO N1+N2+N3; medido en T1.10a: **$0,20** con URL real, así que entra)*. Después, editar el brief aprobado vía `/api/briefs/:id` sin run activo crea v3. Los badges extraído/inferido muestran su `evidence` (cita) en el editor; un análisis en modo manual sin imágenes muestra en CP1 la petición bloqueante de imágenes con la derivación a packshot-IA.

---

## F1b — Deuda de cierre de F1 (acordada con el usuario el 2026-07-12, antes de entrar en F2)

> Las tres salen de hallazgos REALES de F1 (verifier de T1.10b, pase de altitud de `simplify`, y uso manual del usuario). Se hacen **antes de F2** porque las tres se abaratan cuanto antes se hagan: el DS afecta a todas las páginas que vengan, el canal de decisiones lo estrenarán CP2/CP3/CP4, y el bug del puerto muerde cada vez que se levanta la app. Ninguna gasta APIs de pago.

#### T1.12 · Contraste WCAG AA de los tokens semánticos en tema claro [x] 2026-07-12 — PASS (2 ciclos), ver docs/verifications/T1.12/ (coste $0)
- **Depende de**: —
- **Resultado**: **5 familias** arregladas (no 3: `warning` era la peor, 1,99:1, y `danger` también fallaba — el verifier de T1.10b solo midió las que CP1 usa). Variante light en `[data-theme=light]`, hecha en **Claude Design** y bajada con DesignSync. Medido en navegador: CP1 `✓ extraído` **4,28 → 4,91:1**, `inferido` **4,90:1**; las 25 celdas (5 tonos × 5 superficies) pasan; dark sin regresión.
- **La ronda 1 FALLÓ y la lección vale más que la tarea** (`report-fail-1.md`): calibré los tonos contra **una superficie idealizada (#fff) y con margen cero** (4,52–4,60) → en el navegador daban **3,9–4,3**, porque un badge casi nunca está sobre blanco puro (en CP1 vive en un `fieldset --surface-2`; en el showcase, sobre `--bg-subtle`) y el navegador **rasteriza a canales enteros** (la aritmética en float leía ~0,03 de más). **Aislar el token de la superficie sobre la que se pinta es EL MISMO error que causó el bug original, un nivel más abajo.** Ronda 2: calibrado contra la **PEOR** superficie (`--surface-3`) con margen (≥4,60) y redondeo entero.
- **`--success-on` INVIERTE en light** (casi-negro → blanco): es el texto sobre el relleno SÓLIDO `--success` (botón «Aprobar y continuar» de CP1, `checkpoint-banner`, `step-panel` — 3 sitios). Con el verde nuevo el casi-negro daba **2,45:1**. **Arreglar el badge sin esto habría ROTO el botón** — un bug de contraste cambiado por otro.
- **Origen**: verificación de T1.10b. Los badges de procedencia dan **2,28:1** («✓ extraído»), **2,54–2,72:1** («inferido») y **2,13:1** («on_page») en tema LIGHT, contra el umbral **4,5:1** de WCAG AA. En dark pasan (6,38–8,07:1). **NO es un bug de T1.10b**: el verifier lo reprodujo en `/design-system` con los mismos ratios malos (1,96–2,48:1) — el defecto está en los **tokens del DS** (`--violet`/`--success`/`--info` sin variante light), no en el código que los consume (`brief-editor.tsx` usa la primitiva `Badge` sin hardcodear color). Es **el mismo agujero que TD.7 cerró para otra familia de tokens**.
- **Entrega**: variante light de los tokens semánticos afectados (al menos `--violet`, `--success`, `--info` y sus `-soft`/`-border`) que cumpla AA sobre su fondo real. El DS es la fuente de verdad visual y vive en Claude Design: **el cambio se hace ALLÍ y se baja con `DesignSync`** — `docs/design-system/` es un espejo de solo lectura y `globals.css` deriva de él (jamás se editan a mano). Si el arreglo exige una decisión de diseño (p. ej. el violeta AA se ve distinto), se para y se pregunta.
- **Verificación**: en `/design-system` y en CP1 (`/runs/:id` con N3 pausado), en tema **light**, los badges `success`/`violet`/`info` miden **≥4,5:1** con un medidor de contraste real (no a ojo), y **siguen ≥4,5:1 en dark**; evidencia con los ratios medidos antes/después en `docs/verifications/T1.12/`. Ninguna otra página del DS regresiona (recorrido CUA del showcase en ambos temas).

#### T1.11 · Canal de decisiones del checkpoint [x] 2026-07-12 — PASS (1 ciclo), ver docs/verifications/T1.11/ (coste $0)
- **Depende de**: T1.10b
- **Resultado**: tabla `checkpoint_decision` (`step_run_id` UNIQUE + FK CASCADE, `kind` TEXTO —no enum—, `decision` jsonb opaco). `POST /api/steps/:id/{approve,edit}` aceptan una `decision` opcional que se persiste **en la MISMA tx** que la transición (`withDomainTransaction`). CP1 lo estrena. Verificado en navegador: la decisión queda en BD asociada al step de CP1, sobrevive a un reload, y **una transición fallida no deja fila** (comprobado de DOS formas); la rama URL aprueba sin fila (no una fila vacía «por si acaso»).
- **La genericidad es REAL, no nominal** (trazado capa por capa por el pase de altitud): añadir la decisión de CP2 cuesta **1 línea** (un miembro nuevo en `CheckpointDecisionSchema`) — sin migración, sin tocar el repo, sin tocar los route handlers. Hay un test de integración que persiste `{kind:'matrix'}` contra Postgres real para que la afirmación sea **falsable**. **Si en T2.3 añadir un miembro obliga a tocar el repo o las rutas, la genericidad era nominal.**
- **Deuda anotada para T2.3 (corrección del diagnóstico)**: lo que se apila en los route handlers **NO es la decisión** (`persistCheckpointDecision` se queda en UNA llamada para siempre) **sino el EFECTO DE DOMINIO** (`approveBriefForStep`, y en T2.3 «crea las `ad_variant` en `planned`»). Pide un registro **forma-del-artefacto → efecto** en `apps/web/src/server/` (la discriminación por SCHEMA ya existe: `parseBriefOutput`). Se paga barato en T2.3 migrando UN efecto, no cuatro en F4.
- **Origen**: pase de altitud de `simplify` sobre T1.10b. La `ImageDecision` de CP1 (`upload_images` | `ai_packshot`) **es `useState` local y no sale del cliente** (grep: solo existe en `brief-editor.tsx`, su test y su tipo). Habilita el botón de aprobar y **se evapora**. No es un bug de T1.10b (su Verificación solo exige *mostrar* la petición con su derivación, y quien consume la decisión es **N7a = T4.4**, en F4), pero destapa que **el seam de aprobación transporta un ARTEFACTO y no una DECISIÓN** — y un checkpoint humano produce las dos cosas. Sin canal, CP2 (qué variantes generar), CP3 (aprobar guiones) y CP4 (QA) improvisarán cada uno el suyo y en F4 habrá que armonizar tres apaños.
- **Entrega**: canal GENÉRICO para la decisión de un checkpoint: `POST /api/steps/:id/approve` (y `/edit`) acepta una `decision` opcional que se **persiste en la MISMA transacción** que la transición, reutilizando `withDomainTransaction` (T1.10b — el pase de altitud lo declaró «a la altura correcta, escala a F2–F4 tal cual»). **NUNCA en `output_refs`**: el artefacto tiene autor, y colar ahí una decisión humana rompería el linaje IA→humano que `audit_log` compara (§19.1); además la decisión vive lo que vive el STEP, no la fila versionada del brief (que se puede editar luego por `PATCH /api/briefs/:id`, fuera de todo run, donde una `image_decision` no significa nada). CP1 lo ESTRENA persistiendo su decisión de imágenes.
- **Límite de alcance (NO adelantar F4)**: esta tarea crea el CANAL y CP1 lo estrena. **NO** cablea la subida de imágenes ni genera packshots: el consumo real es **T4.4 (N7a)**, que además creará el flag `synthetic_product`. Si al implementar aparece la tentación de "ya que estamos", se para.
- **Deuda menor que entra aquí** (toca los mismos ficheros): `PATCH /api/briefs/:id` descarta claves desconocidas **en silencio** (Zod strip por defecto) → una edición con un typo se pierde sin aviso. Candidato a `.strict()`.
- **Playwright permanente**: el spec de CP1 (`apps/web/e2e/brief-editor.spec.ts`) extiende su caso del modo manual: elegir «Generar packshot con IA» → aprobar → la decisión **queda persistida y es legible** tras recargar (hoy se evapora).
- **Verificación**: en el navegador, un análisis manual SIN imágenes → CP1 → elegir «Generar packshot con IA» → aprobar → la decisión está **en la BD** (`SELECT` que la muestre, asociada al step del checkpoint) y sobrevive a un reload; y si la transición del checkpoint falla, la decisión **no** queda persistida (atomicidad: mismo criterio que la v2 huérfana que cerró T1.10b). Aprobar sin decisión (el caso de la rama URL, que no la necesita) sigue funcionando igual.

#### T1.13 · Base URL del fetch de servidor + navegación global [x] 2026-07-12 — PASS (1 ciclo), ver docs/verifications/T1.13/ (coste $0)
- **Depende de**: —
- **Resultado**: `resolveServerBaseUrl(env)` con precedencia `INTERNAL_API_URL` (override) > `http://localhost:${PORT}` (DERIVADA del puerto real) > `3000`. **Verificado reproduciendo el caso del usuario**: `env -u INTERNAL_API_URL PORT=3001 pnpm dev` con **nada escuchando en el 3000** → `/spend` y `/settings` renderizan con datos reales (antes: 500). Nav global (topbar del mockup 2a): Inicio/Canvas/Gasto activos; Biblioteca/Galería/Métricas visibles pero deshabilitados con el motivo en el **nombre accesible**; `lib/routes.ts` como fuente de verdad única (la home DERIVA sus tarjetas de ahí → activar un destino en F2 es **darle `href`**). Route group `(app)`: ninguna URL cambió; `/login` fuera (sin nav).
- **LA MULETA ERA EL PROBLEMA**: el bug sobrevivió a F0 y F1 enteras porque **el stack E2E fijaba `INTERNAL_API_URL` a mano** — el test que debía cazarlo era el que lo tapaba. Retirada, + guard permanente (`e2e-stack-honesty.test.ts`) que impide reponerla.
- **El chequeo de RANGO del puerto se probó y se DESCARTÓ** (lo pedí yo y estaba mal): `PORT=99999` → Next **ni arranca** (rama inalcanzable); `PORT=0` → Next **SÍ arranca** en un puerto efímero (verificado: 64834) y el rango lo mandaba al 3000 → **el mismo 500 que la tarea elimina**. Lección: **`process.env.PORT` no es «el puerto del servidor», es «el puerto que se PIDIÓ»** — con `PORT=0` difieren y ninguna validación del env lo arregla (el puerto real solo existe en el socket). Queda solo la validación de FORMA.
- **Deuda del DS anotada** (no es de esta tarea): los items *idle* de la topbar dan **3,81:1** en dark (<4,5 AA) por el token compartido `--text-3` (mismo valor en dark y light), que ya se usa igual en **15 sitios previos**. El estado ACTIVO —la señal que T1.13 introduce— pasa holgado (14,58). Los deshabilitados están exentos (WCAG 1.4.3, componentes inactivos).
- **Origen**: uso manual del usuario (2026-07-12), levantando la app para ver la UI. Dos cosas, ambas de F0:
  1. **`apps/web/src/lib/api-client.ts:26` tiene `http://localhost:3000` HARDCODEADO** en `base()`. Las páginas server-component (`/spend`, `/settings`) necesitan URL absoluta al renderizar en servidor y se la piden al 3000 — pero el 3000 lo ocupa otro proyecto del usuario y **este repo sirve en el 3001** → 404 → **500**. El mecanismo correcto YA EXISTE al lado (`api-server.ts:23`: `process.env.INTERNAL_API_URL ?? …`); lo que falla es el fallback. **Ningún test lo caza** porque el stack E2E **fijaba `INTERNAL_API_URL` a mano** — o sea, **el test que debía cazar el bug era el que lo tapaba**: **otra vez el entorno de test más cómodo que la realidad** (van **CINCO**: T1.8, T1.9, T1.11, T1.12 y esta). El patrón está ya escrito como **principio 9 de la skill `testing`** (con sus tres formas y el control negativo obligatorio) y como regla de revisión en `dev-loop` §5a.
  2. **La home es un placeholder SIN NAVEGACIÓN**: hoy la app solo es navegable escribiendo las URLs a mano. No hay ninguna tarea de layout/nav global en el planning — es un hueco del plan, no un bug.
- **Entrega**: (a) el base URL del fetch de servidor se **deriva del puerto real** (`process.env.PORT`) en vez de asumir el 3000, con `INTERNAL_API_URL` como override explícito; (b) navegación global mínima: la home enlaza a las páginas que existen (`/analyses/new`, `/spend`, `/settings`, `/design-system`) y hay una forma de volver. **Parte del mockup si existe uno de layout**; si no, es la propuesta más sobria que respete el DS (el `ds-reviewer` la revisa).
- **Playwright permanente**: un spec que levante el web en un puerto **DISTINTO del 3000** y compruebe que `/spend` y `/settings` renderizan (hoy darían 500). Es el test que faltaba: sin él, el bug vuelve.
- **Verificación**: con el dev server en **3001** y sin exportar `INTERNAL_API_URL` a mano, `/spend` y `/settings` cargan correctamente en el navegador; y desde la home se llega a las páginas existentes sin escribir ninguna URL.

---

## F1c — Deuda del primer uso real (acordada con el usuario el 2026-07-13, antes de seguir con F2)

> Las cuatro salen del **primer uso real del usuario** (2026-07-13): dos análisis por URL sobre webs de servicio (relatio.chat, stayforlong.com) — **ambos muertos en N3 con `missing_hero_image`** — más tres fricciones de UI detectadas en el mismo uso. Diagnóstico completo en la sesión: dos causas distintas para el mismo error (un filtro de extensiones obsoleto que descartaba las imágenes ANTES de la visión, y una decisión de PRD que trataba «web sin packshot» como fallo terminal). T1.14 y T1.15 gastan API real en su verificación (~$0,30 c/u estimado); T1.16 y T1.17 son $0.

#### T1.14 · El filtro de imágenes deja fuera AVIF y las URLs sin extensión [x] 2026-07-13 — PASS (1 ciclo), ver docs/verifications/T1.14/ (coste real $0,16)
- **Depende de**: —
- **Resultado**: `sendableProductImageUrls` → `fetchableProductImageUrls`: pasa toda URL http(s) cuyo pathname no sea `.svg`; el gate real es el par **fetch+decode** que ya existía (sharp decodifica AVIF y re-codifica todo a PNG). **Antes/después CONTROLADO**: N1 scrapeó las MISMAS 2 URLs `.avif` en el run muerto del usuario (`01KXD1MM3ENG6QNZ43YY7M1P6V`) y en el del verifier (`01KXD5XD4AWWRAM28W7EDJTMDT`) — la única variable es el filtro. N2: `images: []` → **2 clasificadas**, `hero_image_url: null` → `mobile-app.avif`. Coste **$0,16** < $0,25.
- **relatio.chat dejó de ser un caso de T1.15**: Haiku clasificó una de sus imágenes como `hero`, así que el run completó 3/3 tras aprobar CP1. T1.15 sigue siendo necesaria — su caso vivo es stayforlong.com (`01KXD1SPQ8EYKDZ4QXWD3WWX1Z`), donde SÍ hay imágenes clasificadas y NINGUNA es hero.
- **Añadido en REVIEW (`simplify`, ángulo eficiencia)**: el preparador PARA al llegar a `MAX_PRODUCT_IMAGES` (8) supervivientes. Consecuencia directa de relajar el filtro: antes la lista llegaba corta (solo raster), ahora una web Next.js emite decenas de `/_next/image?url=…` → sin el corte, 30 fetches + 30 re-codificaciones de sharp para que el analyzer tirara 22. El tope se exporta desde core (una sola fuente de verdad, no un número duplicado). Control negativo hecho: desactivar el corte pone el test en rojo (12 fetches en vez de 8).
- **Origen**: uso real 2026-07-13. Run `01KXD1MM3ENG6QNZ43YY7M1P6V` (relatio.chat): N1 scrapeó 2 imágenes, ambas `.avif` → `sendableProductImageUrls` (`packages/services/src/visual-analyze.ts:109`, regex `jpe?g|png|gif|webp`) las descartó → Haiku recibió 0 imágenes → `hero_image_url: null` → N3 FAIL. Run `01KXD1SPQ8EYKDZ4QXWD3WWX1Z` (stayforlong.com): el mismo filtro descartó 1 de 4 (`/_next/image?url=…`, el patrón estándar de toda web Next.js). **El filtro es un vestigio**: protegía los bloques `image/url` de la API de Anthropic (que no acepta AVIF/SVG), pero desde el fix de coste de T1.7 TODAS las imágenes se descargan y se re-codifican a PNG con `sharp` (que decodifica AVIF) — el gate real ya es «¿fetch OK y decodifica?», y ese camino ya dropea corruptos sin hueco posicional.
- **Entrega**: relajar `sendableProductImageUrls` a lo que de verdad hay que excluir ANTES del fetch: solo http(s) (fuera `data:`/`blob:`) y exclusión explícita de SVG por extensión (sharp lo rasterizaría, pero un logo vectorial no es una imagen de producto). Todo lo demás pasa y lo decide el par fetch+decode existente. Renombrar/redocumentar la función para que el comentario no vuelva a justificar el filtro con un argumento («la API no lo acepta») que ya no aplica al camino real.
- **Tests**: unit del filtro con los DOS casos reales (URL `.avif` y URL `/_next/image?url=…` sin extensión → ambas PASAN; `data:`, `blob:` y `.svg` → fuera), e integración del preparador con bytes AVIF reales de fixture → la imagen sobrevive re-codificada a PNG (principio 9 de testing: el fixture cómodo —un `.png` de toda la vida— es el que tapaba esto).
- **Verificación**: análisis por URL REAL de `https://relatio.chat` → N2 clasifica ≥1 imagen (hoy: 0) y el panel del nodo N2 muestra `images` no vacío; coste del pipeline dentro del bound de T1.10a (<$0,25). Evidencia con el `output_refs` de N2 antes/después.

#### T1.15 · Perfil `url` sin hero image: decisión de CP1, no fallo del run [x] 2026-07-13 — PASS (1 ciclo), ver docs/verifications/T1.15/ (coste real $0,18)
- **Depende de**: T1.11
- **Resultado**: verificado con el MISMO input que el run muerto del usuario (`01KXD1SPQ8EYKDZ4QXWD3WWX1Z`, es.stayforlong.com): el run nuevo (`01KXDDNG2BR2YK8BCS90540T9T`) **llega a CP1** en vez de morir en N3, ofrece las 2 candidatas con su clasificación de N2 (`lifestyle · broll`), se promueve una a hero, se aprueba y **los 3 steps completan**. Coste **$0,18** (< cap $1).
- **LOS DOS CANALES, no uno**: la DECISIÓN → `checkpoint_decision` del step de CP1 (`promote_scraped` + `hero_image_url`); el ARTEFACTO → `product_brief` **v2**, `edited_by_user: true`, `approved`, con `assets.hero_image_url` = la imagen elegida (la v1 de la IA se conserva `draft` con hero null). Comprobado en BD que las dos URLs coinciden.
- **La maquinaria bloqueante se ELIMINÓ ENTERA** (no se dejó un Set vacío): `BLOCKING_WARNING_CODES`, `isBlockingWarning`, `MissingHeroImageWarningSchema`, el `ok` de `ValidateBriefResult` y el `PermanentStepError` de N3. Con el único código bloqueante fuera, el mecanismo estaba muerto. **La divergencia con `testing/unit-core.md` §5 que T1.9 anotó queda RESUELTA a favor de la skill** (que pedía no matar el run), y la skill se actualizó al contrato nuevo.
- **Hallazgo de ALTITUD (pase de review), arreglado en la capa correcta**: `POST /api/steps/:id/approve` ACEPTABA una decisión `promote_scraped` y la persistía, mientras `approveBriefForStep` solo marcaba el v1 aprobado → **decisión que dice «promoví esta imagen» contra un brief con `hero_image_url: null`**: los dos canales contradiciéndose, y N7a descubriéndolo en F4 gastando en fal.ai. El único guard vivía en un `if` del componente React (protege a UN llamante). Ahora `/approve` **rechaza `promote_scraped` con 400** (promover ES una edición ⇒ `/edit`), con test de control negativo. El reroute del cliente pasa a ser comodidad de UX, no la garantía.
- **Deuda que ESTA tarea destapa → T1.18** (no la cierra: su cláusula se cumple entera): una candidata puede ser **inservible** y aun así promovible (ver T1.18).

#### T1.18 · Una candidata a hero que no se puede descargar no debe ofrecerse [x] 2026-07-13 — PASS (2 ciclos), ver docs/verifications/T1.18/ (coste real $0,18)
- **Depende de**: T1.15
- **Resultado**: proxy de miniaturas `GET /api/thumbnails?url=&briefId=` (el SERVIDOR baja lo que el navegador no puede) + la primitiva `Image` del DS materializada + los DOS `<img>` crudos del proyecto migrados. En CP1: si el servidor tampoco puede bajarla → «⚠ no disponible» (no el icono roto) y **botón de promover DESHABILITADO** con el motivo en el nombre accesible; la candidata **sigue visible** (la galería no miente por omisión). **Lo que se PERSISTE no cambia**: el hero es la URL del CDN, no el proxy (verificado en BD: `apunta_al_PROXY=f`).
- **La seguridad del proxy es la decisión de la tarea** (revisión adversarial: sin bypass): **allowlist POR DATOS** (solo sirve URLs que estén en el `product_brief` de ESE `briefId` — igualdad exacta de string, sin ventana TOCTOU), **`redirect: 'error'`** (una URL allowlistada que redirija a `169.254.169.254` es el ataque de verdad; sin esto la allowlist no valdría nada), solo http(s), y **techo de bytes en dos capas** (`Content-Length` declarado + corte por streaming: el proyecto ya tenía esa disciplina en la ENTRADA con `readJson`, y este endpoint abría la SALIDA). **El residuo de SSRF es un ORÁCULO CIEGO, no exfiltración**: como el proxy re-codifica SIEMPRE con sharp (⇒ PNG) y nunca reenvía bytes crudos, un `169.254.169.254` devuelve JSON → no decodifica → 502. Eso mata además por construcción el content-type confusion (un SVG con script sale rasterizado).
- **FAIL de la ronda 1 — LA PRIMITIVA ROMPÍA LAS IMÁGENES CACHEADAS**: `Image` salía de `loading` **solo por el evento `onLoad`**… que **no vuelve a dispararse si la imagen ya está completa cuando React engancha el handler**. Medido en el DOM: `complete: true, naturalWidth: 1638, status: "loading", opacity: 0` ⇒ **la imagen se descargó y el usuario no la ve JAMÁS**. Reproducido en **build de producción** (no era artefacto de dev). Se comió las referencias de `persona-detail`; CP1 se libró **por casualidad** (su `src` es un `blob:` creado tras el montaje). Fix: reconciliar contra el DOM real con un ref callback (`complete && naturalWidth>0 ⇒ loaded`; `complete && naturalWidth===0 ⇒ error`, que es también el camino del centinela de CP1) + `key={src}`.
- **UNDÉCIMA del principio 9, y la más silenciosa**: **1243 tests verdes no vieron nada** porque en tests y en E2E las imágenes se cargan **siempre frescas, nunca de caché** — el arnés jamás reproduce el estado en el que el bug vive. Y **la primitiva no tenía NI UN test**. Ahora tiene 6, con el fixture forzando los bits REALES (`complete`/`naturalWidth`). Control negativo (hecho por el implementer, por mí y por el verifier): sin la reconciliación, 4 de 6 en rojo.
- **Honestidad de arnés que merece quedar escrita**: el implementer añadió un assert e2e para el bug, le pasó el control negativo, **siguió verde con el bug puesto** (porque `/api/assets/:id/download` sirve `no-store` ⇒ el navegador nunca cachea ⇒ el evento siempre llega) y, en vez de dejar un test que finge cubrirlo, **documentó en el spec que ese bloque NO lo reproduce, con la prueba**, señalando al unit como guardián real. El verifier lo validó y además probó el camino cacheado **en un navegador real** con el endpoint que sí cachea (`/api/thumbnails`): `complete: true` ya al montar ⇒ el evento no llegaría ⇒ el fix lo resuelve. *Un test que declara su alcance vale más que uno que se cuelga una medalla.*
- **Cómo se verificó** (anotado a petición del verifier): el sitio HA DERIVADO — hoy N3 emite las URLs directas de `static.stayforlong.com` (200 para todos) y la del 403 ya no aparece sola; además esa URL responde hoy **202 con `x-amzn-waf-action: challenge`**, no 403. La cláusula se verificó **inyectando** la URL inservible como prep de escenario (allowlist + `output_refs`) y restaurando después (0 filas residuales). El proxy la rechaza igual (sin píxeles no hay hero) y el log distingue ya `upstream_status`/`content_type` de unos bytes corruptos.
- **Deuda del DS anotada** (`ds-reviewer`, LIMPIO por lo demás): para deshabilitar una candidata inservible, el consumidor le pasa a `Image` un `src` imposible que fuerza su estado de error. Es contract-legal (no inventa props) pero delata que **a `Image` le falta una ENTRADA para que el llamador dirija el estado de error** (no un `onError`, que es una SALIDA y aquí no sirve: el consumidor ya sabe el veredicto por su propio probe). Candidata a llevar a Claude Design. También: `Image.prompt.md` dice «45°» donde `Image.jsx` implementa `135deg` — inconsistencia del propio DS, a corregir en el próximo `DesignSync`.
- **Origen**: verificación de T1.15 (2026-07-13), confirmado a mano: de las 2 candidatas de es.stayforlong.com, la de `/_next/image?url=…` devuelve **403 Forbidden** a cualquier fetch fuera de su web (curl y navegador real; la de `static.stayforlong.com` da 200). Efectos: (a) en CP1 su `<img>` se ve ROTA — justo en la galería cuyo propósito es «elige con criterio»; (b) **sigue siendo promovible**, así que si el usuario la elige se persisten decisión + brief v2 con un hero que **nadie podrá descargar**, y quien lo descubre es **N7a (T4.4, F4) pagando fal.ai**. Es el fallo diferido y caro que la familia F1c existe para eliminar, reaparecido un nivel más abajo. Es el SEAM T1.14/T1.15: T1.14 dejó pasar las URLs `/_next/image` (correcto: el WORKER sí las descarga, con sus headers), pero el NAVEGADOR del usuario no — el mismo mecanismo que ayudó a N2 engaña a CP1. *La lección, otra vez el principio 9: «se puede descargar» no es una propiedad de la URL, es una propiedad de QUIÉN la descarga.*
- **Entrega**: que CP1 no ofrezca como promovible una imagen que el sistema no puede usar. **CAMINO ELEGIDO POR EL USUARIO (2026-07-13): (a) el proxy de miniaturas** — las candidatas de CP1 se sirven por el proxy de assets propio (T0.5 ya proxifica descargas), que es quien SÍ puede bajarlas (el 403 es del navegador, no del servidor). Arregla las dos mitades del problema con un solo mecanismo: la miniatura deja de verse rota Y deja de haber candidatas inservibles. *(La opción (b) —que N2 marcara en el contrato qué imágenes bajó— se descarta: era más barata pero solo arreglaba el filtrado, dejando la miniatura rota.)* **No inventar un tercer canal**: la clasificación de N2 ya viaja con cada imagen. Si al implementar aparece una candidata que ni el PROXY puede bajar (la url está muerta de verdad), esa sí se excluye de la galería con el motivo en el nombre accesible.
- **Nota para T4.4 (N7a)**: aunque esto se arregle aquí, **re-validar el hero promovido antes de gastar en fal.ai** (una URL que hoy responde 200 puede no hacerlo dentro de una semana). Defensa en profundidad, no redundancia.
- **⚡ El DS YA TIENE LA PRIMITIVA (el usuario la añadió el 2026-07-13, bajada al espejo con `DesignSync`)**: `components/structure/Image` (`docs/design-system/components/structure/Image.{jsx,d.ts,prompt.md}`) — marco neutro con `ratio` para reservar la caja, `radius`/`fit`/`bordered`, y **estado de ERROR de primera clase**: si la imagen no carga muestra el placeholder aprobado (trama diagonal `--surface-3`/`--stripe`) con «⚠ no disponible» en `--danger`. **Materializarla en `apps/web/src/components/ui/image.tsx` es parte de ESTA tarea** (hoy no existe: el `<img>` crudo con el `eslint-disable` de `no-img-element` está en `HeroCandidateOption` y en `persona-detail.tsx` — los dos sitios que el `ds-reviewer` señaló como «a la tercera, primitiva»). **Los dos consumidores actuales se migran a ella.** Esto CIERRA la deuda del DS que anotó el `ds-reviewer` en T1.15 y da gratis la mitad visual del problema: una miniatura que no carga deja de ser un icono roto del navegador y pasa a ser el estado de error del sistema.
- **Playwright permanente**: un caso en `brief-editor.spec.ts` donde una de las candidatas del fixture es inservible → CP1 **no la ofrece** (o la ofrece deshabilitada con el motivo en el nombre accesible); la promovible sigue funcionando.
- **Verificación**: análisis por URL REAL de `https://es.stayforlong.com` (el mismo caso) → en CP1 **ninguna candidata ofrecida tiene la miniatura rota**, y la imagen que da 403 no es promovible; promover la que sí sirve sigue completando el run. Evidencia con el `curl` del 403 y la captura de la galería.
- **Origen**: uso real 2026-07-13, run de stayforlong.com: Haiku clasificó honestamente las 3 imágenes que le llegaron (sello de award `unusable`, about-us y banner `broll`) → sin hero → N3 FAIL terminal con la síntesis de Sonnet **ya pagada** y sin nada que el usuario pueda hacer salvo leer logs. El fallo duro se diseñó para e-commerce («scrapeé una tienda y no salió ni una foto» = algo va mal), pero el uso real incluye webs de servicio/SaaS donde no tener packshot es lo normal. El mecanismo bueno YA EXISTE en perfil `manual`: warning `needs_user_decision` → el brief llega a CP1 → el usuario sube fotos o deriva a packshot IA (canal de decisiones de T1.11). **Cambio de alcance MENOR anotado en PRD §7.2 N3 y §9.2 (regla de trabajo 6, misma sesión).**
- **Entrega**: (a) en `brief-validator.ts`, perfil `url` sin hero usable emite `needs_user_decision` (reason `missing_hero_image`) igual que `manual` — deja de existir código bloqueante y `ok:false` para este caso (si `BLOCKING_WARNING_CODES` queda vacío, se elimina con su maquinaria: no dejar un mecanismo muerto «por si acaso»); (b) el editor de CP1, en la rama URL, muestra la petición de decisión que ya muestra en manual, añadiendo la opción de **promover a hero una de las imágenes scrapeadas** (las `broll` de N2) además de subir fotos o derivar a packshot IA; la decisión viaja por el canal de T1.11 (`checkpoint_decision`), NUNCA en `output_refs`. **Límite de alcance (no adelantar F4)**: elegir/subir/derivar se PERSISTE como decisión; el consumo real (generar el packshot, usar la imagen promovida como frame i2v) sigue siendo de N7a=T4.4.
- **Tests**: unit del validador (perfil `url` sin hero → `ok:true` + `needs_user_decision`; con hero → sin warning); actualizar los que asertaban `ok:false` **con justificación en el journal y el commit** (regla de oro 5: no es debilitar un test, es un cambio de contrato acordado y anotado en PRD).
- **Playwright permanente**: `brief-editor.spec.ts` extiende su caso: análisis con brief SIN hero en rama url → CP1 muestra las 3 opciones → promover una imagen scrapeada → aprobar → la decisión queda en BD y el hero del brief aprobado es la imagen elegida.
- **Verificación**: análisis por URL REAL de `https://es.stayforlong.com` (el caso que falló) → el run YA NO muere en N3: llega a CP1 con el aviso de imagen, se elige una opción, se aprueba y el run completa; la decisión está en `checkpoint_decision` asociada al step de CP1. Evidencia: el mismo input que el run muerto `01KXD1SPQ8EYKDZ4QXWD3WWX1Z`, ahora con brief aprobado.

#### T1.16 · Nodos con título humano + visor modal del output JSON [x] 2026-07-13 — PASS (2 ciclos), ver docs/verifications/T1.16/ (coste $0)
- **Depende de**: —
- **Resultado**: títulos humanos en canvas e inspector (clave en badge mono; el accessible name sigue siendo el `node_key` CRUDO = la API de los tests, intacta), patrón `N3 · CP1` mientras el checkpoint espera, modal del artefacto con el JSON completo resaltado + copiar, y controles de zoom/fit con re-encuadre. Verificado en navegador con un brief REAL: la caja del panel muestra **200 chars exactos sin `angles`**, la modal **6.837–17.534 chars** que re-parsean como JSON válido.
- **Los títulos los tenía YA el Design System, y nadie lo había mirado**: `PipelineNode.prompt.md` y `PipelineScreen.jsx` usaban `code`+`title` (`code="N3 · CP1" title="ProductBrief"`) desde TD.4. El implementer había inventado paráfrasis razonables («Síntesis del brief») hasta que se lo señalé. Alineados con el DS; única divergencia deliberada: N4 «Estrategia del lote» (PRD §7.2 > DS, anotado en el código).
- **HALLAZGO DE REVIEW (altitud): el visor de error PROMETÍA completitud y entregaba 200 chars.** El botón decía «Ver el error completo» y pintaba el mismo recorte del SSE. La justificación («no hay endpoint y esta tarea no crea APIs») era falsa: **el dato ya estaba en la fila** — `stepRowColumns` simplemente no proyectaba `error` (el `sseColumns` de al lado sí). Arreglado con una lectura de PRESENTACIÓN nueva (`findStepDetail`, hermana de `readRunSnapshot`), **sin tocar el puerto `StepRow` del orquestador** (meter `error` ahí habría contaminado un contrato de dominio con una necesidad de pantalla) y sin engordar el SSE. Y muerde donde más duele: los `PermanentStepError` de N3 con config inválida son **volcados de Zod de varios KB** — el visor estaba roto justo en la clase de fallo que originó esta fase.
- **DÉCIMA instancia del principio 9, y la más didáctica**: el test e2e del error usaba un mensaje corto (`/fallo inyectado/i`) que **cabía en 200 chars** ⇒ *no podía ponerse rojo por el bug*. El test del output, en cambio, estaba bien hecho (asertaba un campo MÁS ALLÁ del carácter 200). Rehecho como espejo del bueno: error largo con forma de volcado de Zod + centinela al final. Trampa que costó un ciclo: **Postgres normaliza el orden de claves del jsonb**, así que «centinela en la última clave» salía el primero — vive ahora en el último elemento de un array.
- **FAIL de la ronda 1 (contraste), y la lección vale más que la tarea**: las claves del JSON usaban `text-accent` — **un color de MARCA no es un color de TEXTO**. `--accent` no tiene par de tema (mismo hex en claro y oscuro) **y lo elige el usuario** (indigo/emerald/amber/cyan) ⇒ un hex único legible a 4,5:1 sobre `#1a1a1d` **y** sobre `#f7f7f9` es *geométricamente imposible*. Fallaba en **4 de las 8 combinaciones tema × acento** (2,01–3,39). Es la familia de T1.12 un nivel más abajo. Fix: claves a `--text` (lo informativo de un JSON es el TIPO DEL VALOR, no la clave), puntuación a `--text-2`, y **un CTA hermano con el mismo bug que ni el verifier ni yo habíamos visto** (`text-accent`, 3,20). Todo ≥4,72 y **ratios idénticos con los 4 acentos**.
- **Guard permanente que MIDE, no que comprueba nombres** (`json-token-palette.test.ts`): parsea los hexes REALES de `globals.css` (si el DS recalibra, el test se entera solo) y calcula el ratio de cada clase × {dark,light} × {`--surface`,`--surface-2`}; + guard de nombre (ninguna clase puede contener `accent`); + un CONTROL que verifica que los tokens tumbados SIGUEN cayendo bajo AA con esa misma métrica (sin él, la matriz podría medir mal y pasar por casualidad). Control negativo hecho por mí y por el verifier, por separado: reponer el bug da **exactamente 3,39/3,20**.

#### T1.19 · El flaky de `runs-canvas.spec.ts › cancelar OTRO run en curso` [x] 2026-07-13 — PASS (1 ciclo), ver docs/verifications/T1.19/ (coste $0)
- **Depende de**: —
- **Resultado**: **10/10 pasadas consecutivas de `pnpm test:e2e` en verde** (56 tests cada una), ejecutadas por el bucle. Antes caía ≈1 de cada 3. `retries` sigue en **0** en local; ningún test borrado, skipeado ni debilitado; **no** se serializó la suite.
- **EL FLAKY NO ERA EL QUE CREÍAMOS — y eso es la lección**: el planning y CUATRO entradas de journal culpaban a `cancelar OTRO run en curso`. **El culpable era el test VECINO del mismo fichero (`autopilot`).** Nadie lo había diagnosticado; solo se había reintentado. *Reintentar un flaky no es solo tapar el fallo: es perpetuar un diagnóstico falso.*
- **Veredicto: TEST MAL ESCRITO, no bug de producto** (con traza del rojo capturado): el test asertaba `data-run-autopilot` en el DOM, que solo prueba **el optimismo del cliente** (`setAutopilot` corre ANTES de que el PATCH resuelva). Bajo carga, el `PATCH /api/runs/:id` tardó **5.689 ms** (compilación en frío) y N1 llegó al checkpoint con `autopilot=false` **todavía en la BD** ⇒ el run pausó. **El orquestador hizo exactamente lo que debía** (`shouldPause` lee la BD en el instante del checkpoint); el test apostaba a que le daba tiempo. Reescrito sin reloj: se asserta contra `GET /api/runs/:id` (la verdad del servidor), no contra el píxel.
- **Otras 3 carreras corregidas** (sin ellas, 10 verdes es inalcanzable): (1) `spend.spec.ts` no era una ventana temporal sino **estado global compartido** — `/spend` agrega la tabla `cost_entry` ENTERA y otros specs le insertaban filas por debajo; fix estructural (proyecto Playwright con `dependencies`), no serializar; (2) `brief-editor.spec.ts` re-resolvía un locator contra un conjunto que **crece asíncronamente** (elegía una candidata y clicaba en otra); (3) upload de personas con el `expect` de 15 s infrapresupuestado (el DOM seguía subiendo a los 47 s) → timeouts **localizados**, no una subida global.
- **`support/http.ts` NO es `retries`** (verificado leyéndolo): reintenta **solo cortes de transporte** (una petición que murió antes de llegar a la app); **cualquier respuesta HTTP —incluido un 500— se devuelve intacta**, así que no puede tapar un bug de producto.
- **Origen**: lo pidió el verifier de T1.16 y tiene razón: el spec falla intermitentemente (1 de cada ~3 ejecuciones completas) desde antes de F1c y **ensucia el gate de todas las demás tareas** — en T1.15 y T1.16 hubo que distinguir a mano «rojo real» de «rojo fantasma». La regla de oro 5 del arnés dice que **un test flaky se arregla o se borra con causa raíz, no se reintenta**: llevamos varias tareas reintentándolo.
- **Entrega**: causa raíz (sospecha: carrera entre el `cancel` y el SSE del OTRO run; puede ser el test o puede ser el producto — si es el producto, es un bug de verdad y esta tarea lo cobra). Arreglarlo o borrarlo con justificación explícita en el journal.
- **Verificación**: `pnpm test:e2e` **10 ejecuciones consecutivas en verde** (o el spec eliminado con su causa raíz escrita). Sin `retries` en la config: reintentar es tapar.
- **Origen**: uso real 2026-07-13, dos fricciones del canvas: (1) los nodos solo muestran su `node_key` (`N1`, `N2`…) — el usuario no puede saber qué hace cada nodo sin el PRD delante; (2) el output del inspector se ve cortado y no hay forma de leerlo entero — y NO es solo CSS: el panel pinta `outputExcerpt`, que la proyección SSE **ya trunca en servidor** (deliberadamente delgada).
- **Entrega**: (a) mapa `nodeKey → título humano` en el frontend (fuente única en `run-canvas/`, p. ej. N1 «Ingesta de la página», N2 «Análisis visual», N3 «Síntesis del brief», N4 «Matriz del lote»…, cubriendo N0–N11 y CPs del §7.2), mostrado como texto principal del nodo y del inspector con la clave como badge mono secundario (la clave sigue siendo el accessible name de los tests — API estable); (b) la caja de output del inspector es clicable → `Dialog` grande del DS que pide el output COMPLETO a `GET /api/steps/:id` (ya existe) y lo pinta como JSON formateado con resaltado de sintaxis (tokens del DS, ambos temas), scroll y botón copiar; mismo trato para el visor de error. Sin API nueva y sin engordar la proyección SSE.
- **Deuda añadida por el verifier de T1.14** (misma familia, se paga aquí): con el editor de CP1 abierto, el lienzo de React Flow se comprime a ~255 px y **N2/N3 quedan fuera de la vista**; `fitView` solo actúa en el montaje y **no hay controles de zoom/fit**, así que hay que panear a mano para ver que N2 existe. Entra en esta tarea: controles de zoom/fit visibles (los `<Controls/>` de React Flow o equivalente del DS) y re-fit cuando cambia el tamaño del lienzo.
- **Playwright permanente**: `runs-canvas.spec.ts` extiende: el nodo N2 muestra su título humano; click en la caja de output → modal con el JSON completo (un campo que el excerpt trunca es visible en la modal) → copiar y cerrar; con CP1 abierto, N2 sigue alcanzable (fit/zoom).
- **Verificación**: en el navegador, en un run real: los nodos muestran títulos legibles en canvas e inspector; la modal muestra el output ÍNTEGRO y formateado de un step cuyo excerpt está truncado; el `ds-reviewer` pasa sobre la superficie nueva.

#### T1.17 · Listado de runs [x] 2026-07-13 — PASS (1 ciclo), ver docs/verifications/T1.17/ (coste $0)
- **Depende de**: T1.13
- **Resultado**: `GET /api/runs` (paginado, orden DESC) + página `/runs` (tabla con `MetricsTable`/`Badge` del DS) + «Runs» en la nav global. Verificado con los **4 runs reales** de la BD: los 2 completados y **los 2 muertos, con su estado y su gasto real**. Click en fila → canvas. Sin doble resaltado en la nav (se arregló al añadir la entrada).
- **`pipeline_run.status` NO SE MANTIENE — los 4 runs dicen `pending`**, incluidos los que completaron y los que murieron (hueco preexistente, deuda diferida de T0.8). El listado **DERIVA** el estado de los steps (`deriveRunStatus`, puro y testeado en core), con precedencia `failed > cancelled > waiting_approval > running > succeeded > pending` y `superseded` filtrado. Pintar la columna a pelo habría mentido en **el 100 % de las filas**.
- **BUG DE DINERO REAL, cazado en review y arreglado aquí**: `step_run.cost_actual` **se queda NULL cuando un step FALLA** (el rollup solo corre al cerrar bien). Los N3 muertos tienen esa columna a NULL **habiendo quemado 13 y 16 céntimos de Sonnet**. El implementer lo esquivó en el listado (usa el ledger `cost_entry → step_run → run_id`)… **pero la cabecera del canvas SÍ sumaba esa columna: llevaba mostrando `$0.00` en los dos runs muertos del usuario.** Arreglado: `runLedgerCost` es ahora la única fuente de coste real, y la consumen listado y detalle (no pueden contradecirse). Control negativo hecho por mí y por el verifier: reponer el `reduce` da literalmente `expected '$0.00…' to contain '$0.13'`.
- **Tradeoff declarado y verificado**: el total de la cabecera es una **foto REST al cargar**, no un contador vivo (`costActualCents` no viaja por SSE). En runs terminales —los que se auditan— es exacto al céntimo. Hacerlo vivo exige coste honesto en el SSE ⇒ **T1.20**.
- **Un comentario que MENTÍA** (pase de simplificación): `deriveCurrentStep` decía «comparten la tabla de abajo» con `deriveRunStatus` — falso, cada una tenía su copia privada de la precedencia. Desincronizarlas habría hecho que una fila dijera «en curso» con el paso vacío, **en silencio**. Unificadas en una `PRECEDENCE`, con el test de emparejamiento que faltaba. *Un comentario que afirma un invariante que el código no cumple es peor que no tenerlo: el siguiente lector confía y no verifica.*
- **Eficiencia**: el orden pasó a `ORDER BY id DESC` — `pipeline_run` **no tiene más índice que la PK**, así que ordenar por `created_at` era un seq scan + sort en cada carga. Los ULID son monotónicos con el tiempo ⇒ el orden es idéntico (verificado contra los 4 runs) y lo sirve el btree de la PK.

#### T1.20 · El coste por step miente (y ahora se ve, porque la cabecera ya no) [x] 2026-07-14 — PASS, ver docs/verifications/T1.20/ (coste $0)
- **Depende de**: T1.17
- **Resultado**: se eligió la vía **(a)** y se implementó en el sitio más profundo posible: el rollup del coste real dejó de vivir en el consumer del worker (que solo ve los cierres que él provoca) y pasó al **embudo único `applyTransition`**, gateado por `settlesCost(event)` = `setsFinishedAt` ∪ `{reach_checkpoint}`, en la MISMA transacción. Cubre los ~11 caminos de cierre **por construcción, no por enumeración** (fail, expire, cancel, reject, supersede, skip, approve…). Verificado que no hay bypass: el único escritor de `step_run.status` es `updateStep`, alcanzable solo desde `applyTransition`.
- **Frontera de core**: entra por un puerto nuevo `CostStore` (par de `AuditStore`). La garantía «el rollup NUNCA tumba una transición» **no puede darla un try/catch de JS** (en Postgres un statement que falla deja la tx abortada: 25P02, y se llevaría por delante el `pg_notify` y el COMMIT): la da un **SAVEPOINT** en el adaptador, que es la única capa que puede. Core declara el contrato; `packages/db` lo cumple. Hay test que lo muerde (fuerza un overflow de int4 en el SQL real y exige que el step CIERRE igual).
- **El agregado**: `pipeline_run.total_cost_actual` **sí** se mantiene ahora (recomputado del ledger, no sumando la proyección de los steps: sumar la copia heredaría sus mentiras). `pipeline_run.status` **queda como deuda viva** de T0.8 — decidir el estado agregado en cada transición no es trivial (carreras) y no se forzó; `deriveRunStatus` sigue siendo el oráculo.
- **Backfill** (migración `0013`): arreglar el código no repara los datos históricos. Recomputa desde el ledger, idempotente, y **no inventa datos**: un step sin cargos se queda **NULL** («no se sabe»), no 0 («ejecutó y no gastó»). Los dos runs muertos del usuario vuelven a mostrar sus 16¢ y 13¢.
- **La cláusula «est. —» se cumple literalmente**: `formatCostSplit` solo cae al estimado cuando `costActual` es NULL, y ya no lo es ⇒ el nodo enseña el dinero. (`cost_estimated` sigue sin escribirla nadie: es OTRA columna y otra tarea — ver deuda abajo.)
- **Origen**: verificación de T1.17. Al arreglar la cabecera del canvas (que ya muestra el gasto real del ledger) queda a la vista la misma mentira **una capa más abajo**: los NODOS siguen pintando `step_run.cost_actual`, que es **NULL en un step que falló habiendo gastado**. Resultado HOY, en la misma pantalla: la cabecera del run muerto dice **$0,13** y su nodo N3 dice **$0,00 / est. —**. Dos cifras contradictorias, y la del nodo es la falsa. El SSE sirve esa columna por step (`steps.repo.ts:377`), así que la raíz está en el stream, no en la UI.
- **Entrega**: que el coste por step que viaja en el SSE sea el REAL (del ledger), no la columna que se queda NULL al fallar. Decidir la vía: (a) que el rollup escriba `cost_actual` **también** cuando el step falla (arregla la columna en origen — pero toca el consumer/orquestador); o (b) que la proyección del SSE lea el ledger por step (no toca el orquestador, pero mete un join en el camino caliente del stream). **Argumentar la elección**: (a) es la correcta de fondo (una columna que existe debe decir la verdad) y además arregla `pipeline_run.total_cost_actual` de paso; (b) es más barata pero deja la columna mintiendo para el siguiente que la lea.
- **Y de paso, el agregado**: si se elige (a), evaluar si el orquestador puede mantener también `pipeline_run.status`/`total_cost_actual` (la deuda de T0.8 que T1.17 tuvo que rodear). `deriveRunStatus` (core, puro, testeado) queda como **el oráculo** contra el que validar la columna. Los tres lectores del dato falso están inventariados: `runs.repo.ts:45,49`, `api/runs/[id]/route.ts`, `api-client.ts` (hoy nadie los pinta, pero están expuestos en la API).
- **Verificación**: en el canvas de un run REAL que falló habiendo gastado (los dos del usuario sirven: `01KXD1MM3ENG6QNZ43YY7M1P6V` y `01KXD1SPQ8EYKDZ4QXWD3WWX1Z`), **el nodo N3 muestra el dinero que gastó** (no $0,00 ni «est. —»), y la suma de los nodos **cuadra con la cabecera y con el ledger** al céntimo. Control negativo: reponer la lectura de la columna y ver el test en rojo.
- **Origen**: uso real 2026-07-13: tras lanzar un run, no hay forma de volver a él ni de ver los anteriores — solo existe `/runs/[id]` y ni siquiera hay `GET /api/runs` de listado. La nota 2 de T1.13 ya declaró el hueco de navegación; el dashboard completo es T5.10 (F5), demasiado lejos para algo que bloquea el uso diario.
- **Entrega**: `GET /api/runs` (paginado simple, orden desc por creación; por run: id, fecha, origen/URL del análisis, estado agregado, coste actual, paso actual o error) + página `/runs` con la tabla (primitivas del DS, estados con los mismos tokens del canvas, fila → enlace al canvas) + entrada «Runs» activa en la nav global de T1.13 (`lib/routes.ts`). Alcance mínimo deliberado: sin filtros, sin búsqueda, sin acciones de fila — eso es T5.10.
- **Playwright permanente**: spec nuevo `runs-list.spec.ts`: dos runs de demo → `/runs` los lista en orden, muestra estados distintos (uno `failed`, uno `succeeded`), y el click navega a su canvas.
- **Verificación**: en el navegador, `/runs` muestra los runs reales existentes en la BD local (incluidos los dos muertos del 2026-07-13) con estado y coste, y desde la nav global se llega sin escribir URLs; click en uno → su canvas.

---

## F2 — Estrategia y guiones (incluye Personas v1 y recetas)

> Personas y recetas viven aquí (no en F3) porque CP2 las necesita. Ajuste anotado en PRD §21.

#### T2.0 · Personas v1 (modelo, CRUD y seed manual) [x] 2026-07-12 — PASS, ver docs/verifications/T2.0/ (coste $0)
- **Depende de**: T0.3, T0.5
- **Entrega**: migración de `persona` (§12, con `voice_map {locale: {provider, voiceId}}`), página `/personas` con CRUD (demografía, personalidad, wardrobeNotes), upload manual de imágenes de referencia (validación ≥2K), endpoint de candidatas por `avatar_hint`; seed manual de 2 personas (es/en) con imágenes subidas a mano. (La generación IA de referencias y el preview de voz llegan en F4.)
- **Mockup**: `docs/mockups/personas.html` (variante 6c · ficha inmersiva · refs grandes + voz por idioma). El layout parte de ese mockup; el reviewer rechaza una página que se desvíe sin acuerdo (ver `.claude/skills/frontend`).
- **Playwright permanente**: `apps/web/e2e/personas.spec.ts` cubre CRUD, voice map es/en, upload ≥2K y rechazo visible de una imagen <2K; usa fixtures locales y no generación IA.
- **Deuda heredada de T2.1**: `ad_variant.persona_id` quedó como **texto nullable SIN FK** (la tabla `persona` no existía al migrar). Esta tarea, que la crea, **debe añadir la FK** (`ON DELETE set null`: borrar una persona no borra los anuncios que ya hizo).
- **Verificación**: crear una persona con 2 imágenes ≥2K y voice_map es/en desde el navegador; el endpoint de candidatas devuelve la persona correcta para un `avatar_hint` compatible y ninguna para uno incompatible; una imagen <2K es rechazada con mensaje claro.

#### T2.1 · Migraciones de lote + seeds de hooks, CTAs y recetas [x] 2026-07-12 — PASS, ver docs/verifications/T2.1/ (coste $0)
- **Depende de**: T0.3
- **Entrega**: tablas `hook_line`, `cta_line`, `ad_batch`, `ad_variant` (enum con estado **`scripted`** añadido tras `planned` — alineación anotada en PRD §12), `ad_script`, **`recipe`**; seed de ~40 hook lines y ~15 CTA lines por idioma (es/en, redacción propia) y **seed de las 3 recetas por tier con los costes del Apéndice B**; validador de seeds integrado en `pnpm gate` (no hay CI remota — decisión 2026-07-07).
- **Verificación**: `pnpm seed` puebla librerías y recetas; el validador (dentro de `pnpm gate`) falla con un fixture inválido (hook sin ángulo o >12 palabras; receta sin coste); `SELECT` de `recipe` muestra los 3 tiers con estimaciones que cuadran con el Apéndice B.

#### T2.2 · Compositor de matriz (N4) + estimador de coste [x] 2026-07-13 — PASS, ver docs/verifications/T2.2/ (coste $0)
- **Depende de**: T2.1, T2.0, T1.10b
- **Entrega**: `BatchPlan` (contrato Zod): ángulos × hooks (brief + librería) × personas × duración (preset §8.4) × idiomas × tier; modo hook-testing con body/CTA compartidos por ángulo (§7.5); estimador de coste basado en `recipe` con desglose por variante.
- **Verificación**: para un brief real, componer una matriz 2 ángulos × 3 hooks × 1 persona × es+en → 12 variantes con coste estimado desglosado que cuadra a mano con las recetas del Apéndice B (±10 %).

#### T2.3 · CP2: UI de matriz y confirmación de gasto [x] 2026-07-14 — PASS, ver docs/verifications/T2.3/ (coste real $0,70 — todo de N3 en los 5 runs de la verificación; N4 es $0)
- **Depende de**: T2.2
- **Entrega**: panel de CP2: selección de ángulos (cards con hooks del brief), **selector de personas sugeridas por `avatar_hint`** (T2.0), preset de duración/objetivo, tier, idiomas, coste total estimado en grande, confirmación que crea las `ad_variant` en `planned`.
- **Mockup**: `docs/mockups/batch-matrix.dc.html` (Claude Design, 2026-07-14). Dos desviaciones acordadas contra el CONTRATO (el mockup se equivocaba): sus presets eran 12/28/48 s → los reales son **12/30/45** (`strategy/presets.ts`), y dibujaba un checkbox por HOOK → `ComposeMatrixInput` acepta `angleIndices` + `hooksPerAngle` (los hooks se MUESTRAN, se selecciona el ángulo). Su `<script>` traía un modelo de coste INVENTADO: **no se portó ni una línea** (todo el dinero sale de `estimateBatchCost` sobre la tabla `recipe`).
- **Playwright permanente**: `apps/web/e2e/batch-matrix.spec.ts` cubre selección de ángulos/persona/idiomas, recálculo al cambiar tier y confirmación con el número exacto de variantes visible tras crear el lote.
- **Implementación**: CP2 es el **step N4 del DAG** (§7.1.b: cada checkpoint es un `waiting_approval` de un step), no una página aparte. N4 es determinista y **$0**. Lleva **`checkpointConfig: { alwaysPause: true }`** — el override de §7.1.b, ejemplificado en el PRD justo con CP2: sin él, con autopilot ON el step pasaba a `succeeded`, `/approve` nunca se llamaba y el run terminaba **sin lote y sin que nadie autorizara un céntimo**.
- **Verificación**: en navegador, cambiar tier de Test a Standard actualiza el coste al vuelo; el selector muestra las personas compatibles con el segmento; aprobar crea exactamente las variantes de la matriz (filas con `filename_code` únicos y legibles).

#### T2.4 · ScriptWriter (N5) [x] 2026-07-15 — PASS, ver docs/verifications/T2.4/ (coste real ~$1,30 vs $0,50 estimado: el ciclo FAIL→fix→re-verify, no una sola verificación; juicio humano «es suenan nativos» = PASS)
- **Depende de**: T2.2
- **Entrega**: generación de guiones con Sonnet 5 (sin sampling params; diversidad por prompt): modo normal (1 guion/variante) y modo hook-testing (1 body+CTA por ángulo + N hooks encajados, §9.4); `scenes[]` con timing duro (`word_count ÷ 2.5`), `subtitles[]`, CTA por objetivo, idioma destino nativo (§17).
- **Coste estimado**: ~$0,50 (12 guiones + reintentos)
- **Deuda heredada de T2.1 — CONTRATO, no sugerencia**: al sustituir los `{placeholder}` de un hook de librería por valores del brief, el renderizador **DEBE truncar cada valor al presupuesto de palabras de su placeholder** (`PLACEHOLDER_WORD_BUDGET` en `packages/core/src/library/placeholders.ts`: `{pain}`=6, `{benefit}`=4, `{product}`=3, `{category}`=2). Ese presupuesto es lo que T2.1 usó para validar el techo de 12 palabras sobre el **peor caso renderizado**; si T2.4 sustituye sin truncar, el techo vuelve a mentir —ya en el anuncio emitido— porque `ProductBriefSchema` declara `product.name`/`benefits[].benefit`/`pain_points[].pain` como `z.string()` **sin `.max()`**.
- **Deuda heredada de T2.2 — `PlannedHook.text` NO ESTÁ TRADUCIDO** (lo cazó el verifier de T2.2 con un brief real): el compositor copia los `hook_examples` del brief tal cual a **todas** las variantes, incluidas las de `language: 'en'` — y el brief está en el idioma en que se generó (normalmente `es`). Así que **una variante en inglés llega a N5 con el texto del hook en español**. Es correcto por contrato (§17 asigna el «idioma destino nativo» a ESTA tarea, no a N4), pero significa que **`hook.text` es una SEMILLA en el idioma del brief, no un texto listo para usar**: si el ScriptWriter lo encaja literal, el anuncio en inglés sale con el gancho en español. La variante sí trae su `language` correcto — es el campo que manda.
- **Verificación**: para la matriz de T2.2, los 12 guiones validan contra Zod; los de es suenan nativos (revisión humana); en hook-testing los bodies de las variantes del mismo ángulo son **textualmente idénticos** (diff vacío); `est_seconds` ≤ **techo del preset (§8.4: hook-test 15 s)** en todos —el techo del rango, no el objetivo; ver la aclaración objetivo-vs-techo del PRD §8.4, editada en esta tarea (2026-07-15) porque el presupuesto de hook-test da 12,0 s con margen cero— **y un `est_seconds` de 17 s (fuera de rango) SÍ es rechazado por el validador** (el bound sigue mordiendo, no es un assert decorativo); **un hook de librería con `{pain}` renderizado contra un brief cuyo `pain` tiene 12 palabras produce un hook de ≤12 palabras habladas** (el truncado al presupuesto se aplica de verdad); **el guion de una variante `language: 'en'` compuesta desde un brief en español está ÍNTEGRAMENTE en inglés — hook incluido** (no se cuela la semilla en español).

#### T2.5 · Guardrails FTC + linter de claims [x] 2026-07-15 — PASS (2 ciclos verifier: FAIL#1 testimonial sonaba a cliente real → fix del conflicto prompt §7↔§8 → PASS), ver docs/verifications/T2.5/ (coste real ~$0,16)
- **Depende de**: T2.4
- **Entrega**: reglas de §15.1 en el prompt (roles honestos, reformulación testimonial y founder) + linter determinista post-generación (claims de `banned_or_risky_claims`, primera persona de compra, afirmaciones founder) que **bloquea con explicación y sugerencia** (§15.2).
- **Coste estimado**: ~$0,15
- **Verificación**: pedir ángulo "testimonial" produce un guion creator-style demo sin "I bought this"; un claim médico prohibido inyectado a mano dispara el bloqueo con sugerencia compliant; el ángulo founder-origin llega reformulado en tercera persona.

#### T2.6 · CP3: editor de guiones (+ puente N5→CP3) [x] 2026-07-15 — PASS (E2E de fase F2, journey LIVE oatly.com; 6 variantes `scripted` + `edited_by_user` en la editada + bloqueo server-side probado con POST directo), ver docs/verifications/T2.6/ (coste real $0,64)
- **Depende de**: T2.3, T2.4, T2.5
- **Entrega**: panel de CP3: lista de variantes con su guion, edición por escena y de hook/CTA, re-lint al guardar, aprobación por variante o del lote.
- **AMPLIACIÓN DE ALCANCE (2026-07-15, regla 6, decisión del usuario)**: la Verificación exige el journey URL→CP1→CP2→CP3→6 variantes `scripted`, pero el run terminaba en CP2 — no existía el puente que ejecuta N5 (ScriptWriter, T2.4), persiste los `ad_script`, ni crea el checkpoint CP3. T2.6 lo construye. Diseño (pase de `feature-dev:code-architect`, verificado contra el código; NO toca el orquestador genérico): **N5 corre como el primer step (isCheckpoint, alwaysPause) de un RUN DE LOTE NUEVO** (`batchRunDefinition`, hermano de `analysisRunDefinition`), arrancado con `createRun` DENTRO de la misma tx de la aprobación de CP2 (`createBatchForStep` pasa a recibir el `withTransaction` del scope). El **executor N5** (worker, molde de N1-N4) llama `runWriteScripts` (que ya existe, T2.4), corre `lintScript` (T2.5) sobre cada guion v1 y persiste `ad_script` v1 con `guardrail_flags`; idempotencia de dinero por `step_run.id` (como N3) ⇒ **migración menor: `ad_script.origin_step_id`** (hoy no existe; `product_brief` sí lo tiene). CP3 pausa en `waiting_approval`; el cliente navega al run nuevo (`nextRunId` en la respuesta de `/approve`). El efecto de dominio de CP3 (`approveScriptsForStep`) aplica los veredictos por-variante en UNA tx: edita (v2 `edited_by_user`) + re-lint SERVER-SIDE + set `ad_variant.scripted` SOLO si no queda flag `blocking` (el guard vive en el servidor, no en el botón). Aprobación por-variante = veredictos dentro de UN payload `decision` (`kind:'scripts'`), no multi-POST. Esto es N5 (guionización, aguas arriba de generación); N6/N7 (T3.5/T4.11) quedan FUERA.
- **Coste estimado**: ~$0,50
- **Playwright permanente**: `apps/web/e2e/script-editor.spec.ts` cubre edición, re-lint con bloqueo y aprobación individual/del lote; `apps/web/e2e/phases/f2-scripts.spec.ts` conserva el journey mockeado CP1 → CP2 → CP3 con seis variantes en `scripted`. Ambos llevan `@f2`; el segundo además `@phase`.
- **Verificación (E2E de la fase)**: URL real → CP1 → CP2 (matriz 6 variantes) → CP3: editar el hook de una variante, aprobar todo → las 6 `ad_variant` quedan en estado **`scripted`** (valor literal en BD), con `ad_script` versionado (`edited_by_user` en la editada). Criterio O2: interacción total <5 min.

---

## F2b — Deuda destapada por la verificación de T2.3 (acordada con el usuario el 2026-07-14)

> Sale de la verificación de T2.3: el verifier analizó `https://www.dr-squatch.com/products/pine-tar-bar-soap` (un jabón) y obtuvo briefs de **«Topi Tanpa Bingkai»** (una gorra) y **«selayar88»** (una plataforma de juegos indonesia). **El scraper NO tiene ningún bug**: ese dominio está secuestrado y sirve spam SEO, la URL de producto devuelve **`301 → https://www.dr-squatch.com/`**, y el pipeline analizó fielmente lo que la web le dio. Verificado a mano con `curl` (UA de Chrome real): `HTTP=200`, `final=https://www.dr-squatch.com/`, `<title>SELAYAR88 : Tempat Seru Bermain…</title>`.
>
> **El defecto NUESTRO es otro, y es real**: el usuario pide analizar UNA página y el sistema analiza OTRA **sin decírselo**. La URL final post-redirección **se descarta** en los tres caminos de ingesta (`urlNormalized` es `normalizeUrl(rawUrl)`: la URL PEDIDA, no la servida), así que ni el brief, ni CP1, ni la BD registran que hubo un salto. No es exclusivo de un dominio comprometido: pasa con **productos descatalogados** (redirigen a la home o a la categoría) y con dominios caducados — casos normales del uso real.
>
> **Alcance honesto**: se arregla el subconjunto **detectable** (URL pedida ≠ URL analizada). NO se intenta el caso general «el contenido es incorrecto / el dominio está comprometido»: eso no tiene ground truth y fingir que se resuelve sería peor que no tocarlo. Severidad: **arista real y recurrente, no incendio** — F1 se verificó bien contra URLs reales (oatly.com, ollie.com); esta URL la eligió el verifier y el dominio está genuinamente secuestrado.

#### T2.7 · Una redirección silenciosa no puede cambiar lo que el usuario pidió analizar [x] 2026-07-14 — PASS, ver docs/verifications/T2.7/ (coste real $0,36 vs $0,20 estimado: la Verificación exige DOS análisis reales completos)
- **Depende de**: T1.11 (el canal de decisiones de checkpoint), T1.15 (que fijó el precedente: «web sin hero» no es fallo terminal sino decisión de CP1)
- **Resultado**: `RawContent` guarda las DOS URLs (`url` + `urlFinal`); `detectRedirectMismatch` (core) marca con criterio estrecho **`host_changed`** / **`path_to_root`** / **`path_diverged`**; CP1 lo avisa con `Alert` del DS y **no bloquea**. **LOS TRES CAMINOS DE INGESTA, VERIFICADOS CONTRA EL SERVICIO REAL (no contra las docs)**: fast path → `response.url`; **Firecrawl → `metadata.url`, NUNCA `metadata.sourceURL`** (que ECHOEA la pedida pese al nombre); **Jina → NO-DETECTOR** (su `URL Source:` también ecoea la pedida: sirviendo la home, sigue diciendo la URL del producto) ⇒ `urlFinal = null`, sin dato no se inventa un aviso.
- **Recalibración de coste (regla 5)**: una Verificación que exige 2 análisis reales completos cuesta **~$0,35–0,40**, no $0,20. Anotado para futuras estimaciones.
- **Origen**: verificación de T2.3 (2026-07-14). Diagnóstico verificado con `curl` en la sesión, no inferido.
- **Entrega**:
  1. **CAPTURAR la URL final** (hoy se tira, y sin ella la comprobación es imposible: este es el paso 1). En los **tres** caminos, que la exponen de forma distinta: el **fast path** (fetch directo, T1.3) la trae gratis en `response.url`; **Firecrawl** la publica en `metadata.sourceURL` + `metadata.statusCode` (hoy nuestro tipo de su respuesta **solo declara `metadata.creditsUsed`** y descarta el resto); el **fallback Jina** hay que ver qué expone (si no la expone, se declara y se documenta — un camino que no puede detectarlo es un hecho, no un fallo a tapar). Persistirla en el `RawContent` (`url_analysis`) junto a la pedida.
  2. **Detectar el mismatch con criterio ESTRECHO** — o esto se convierte en una máquina de falsos positivos. Las redirecciones benignas son la norma (`http→https`, `www`, barra final, canonicalización, locale/geo) y **no se marcan**. Lo que SÍ se marca: **cambio de host**, y **ruta profunda → raíz desnuda** (el caso de dr-squatch: `/products/pine-tar-bar-soap` → `/`).
  3. **Mostrarlo en CP1**, que es el suelo honesto y la mitad que de verdad importa: «Analizado: `dr-squatch.com/` — **redirigido desde** `/products/pine-tar-bar-soap`». Convierte un fallo tragado en un hecho visible y deja que lo cace el humano, que es exactamente para lo que existe el checkpoint.
- **Decisión de producto a tomar EN la tarea (y anotar en el PRD, como hizo T1.15)**: ¿un mismatch **avisa** (el run sigue, CP1 lo enseña, el humano decide) o **bloquea** (el run para)? **Recomendación: avisar**, por el precedente de T1.15 — matar el run le quita al humano la decisión que el checkpoint existe para darle, y hay redirecciones legítimas que solo un humano puede juzgar (un producto renombrado). El bloqueo heurístico es opcional encima de ese suelo, no en su lugar.
  - **DECIDIDO (2026-07-14, en la implementación de T2.7): AVISA, NO BLOQUEA.** El run sigue; CP1 pinta el aviso «Se analizó otra página» con la URL pedida y la servida; aprobar sigue habilitado (`requiresDecision: false`, a diferencia de `needs_user_decision`). Warning tipado `url_redirected` (`reason: host_changed | path_to_root`) emitido por el `BriefValidator` — determinista, gratis y **superviviente al camino de reuso del brief** de N3, que revalida. Anotado en PRD §7.2 (fila N1), §9.1 (bullet «URL pedida vs URL servida») y §9.2 (BriefValidator).
  - **HALLAZGO 1 — Firecrawl (verificado contra la API real, 1 crédito, 2026-07-14)**: el campo con la URL final **NO es `metadata.sourceURL`** (que ECHOEA la pedida, pese al nombre), sino **`metadata.url`**. Sobre `.../products/pine-tar-bar-soap`: `{"sourceURL": ".../products/pine-tar-bar-soap", "url": "https://www.dr-squatch.com/", "statusCode": 200}`. Un fixture construido desde las docs (cuyo ejemplo no tiene redirección) habría dejado la suite verde con la feature rota en producción.
  - **HALLAZGO 2 — el fallback Jina NO PUEDE detectar el mismatch (verificado contra `r.jina.ai` real, 2026-07-14)**: su preámbulo también ECHOEA la pedida. Pidiendo la URL viva del jabón devuelve `Title: SELAYAR88…` (¡el título de la HOME!) junto a `URL Source: …/products/pine-tar-bar-soap` (la PEDIDA). O sea, sirve la home y sigue diciendo que la fuente es el producto. Ese camino queda **declarado NO-DETECTOR**: `urlFinal = null` (dato no observado), nunca la pedida —que AFIRMARÍA que no hubo salto—. Impacto acotado: Jina solo entra si Firecrawl falla.
  - **AMPLIACIÓN del criterio (review)**: `path_to_root` no bastaba — los descatalogados también redirigen **a la categoría** (`/products/x` → `/collections/y`: mismo host, path no vacío ⇒ se tragaba). El discriminador es el **directorio PADRE**, no el último segmento: se avisa cuando el padre pedido NO es sufijo del padre final (`reason: path_diverged`), lo que caza la categoría y la home y deja callado el **rename del slug** (`/products/serum` → `/products/serum-v2`) y el **prefijo de locale** — las dos redirecciones legítimas más frecuentes, que un criterio de "cambió el slug" habría convertido en ruido.
- **Coste estimado**: ~$0,20 (la verificación necesita ≥2 análisis reales con API)
- **Tests**: unit del comparador con los casos REALES en ambas direcciones — benignos que NO deben avisar (`http→https`, `www.`, barra final, `?utm_*`) y malignos que SÍ (`/products/x` → `/`, cambio de host); integración del ingester con un servidor de fixture que emite un `301` a la raíz → el `RawContent` guarda las DOS URLs y marca el mismatch. **El fixture cómodo aquí sería una redirección benigna: el principio 9 de la skill `testing` exige el caso que muerde.**
- **Verificación**: análisis por URL de una página que redirige a la raíz (`https://www.dr-squatch.com/products/pine-tar-bar-soap` sirve hoy como caso vivo; si el dominio se limpia, vale cualquier producto descatalogado que redirija) → **CP1 muestra visiblemente que se analizó otra URL**, con la pedida y la final; en BD, `url_analysis` guarda las dos. Y el control negativo: un análisis de una URL que solo redirige `http→https` **NO** dispara ningún aviso (la señal no puede ser ruido).

---

## F3 — Galería de prompts y compilador

#### T3.1 · Migraciones y modelo de galería [x] 2026-07-15 — PASS, ver docs/verifications/T3.1/ (coste $0)
- **Depende de**: T0.3
- **Entrega**: tablas `prompt_template` (facetas GIN, `perf`, `usage_count`), `prompt_version`, `guard_pack` (con `key`, `vertical?`, `platform?`), `model_profile` (capabilities con refImages/refVideos/refAudios, `cost` multi-unidad) (§12).
- **Verificación**: migración aplica (`psql \d`); con ≥1.000 filas sintéticas sembradas para el test (o `SET enable_seqscan=off`), una consulta por facetas combinadas muestra Bitmap Index Scan sobre el GIN en el EXPLAIN y devuelve exactamente las filas esperadas.

#### T3.2 · Seed pipeline con validador en el gate [x] 2026-07-15 — PASS, ver docs/verifications/T3.2/ (coste $0)
- **Depende de**: T3.1
- **Entrega**: `packages/core/gallery-seed/*.json` + `pnpm seed:gallery` (upsert idempotente) + validador integrado en `pnpm gate` (campos requeridos, slugs únicos, slots resolubles contra §10.4, `guardPackIds` existentes, `enumValues` para enums; no hay CI remota); los fixtures incluyen **2–3 templates mínimos de prueba** (los usará la verificación de T3.5).
- **Verificación**: romper un fixture a propósito (slot inexistente `{producto.nombre}`) hace fallar `pnpm gate` con mensaje claro; el seed corre dos veces sin duplicar filas.

#### T3.3 · Guard packs (redacción propia) [x] 2026-07-15 — PASS, ver docs/verifications/T3.3/ (coste $0)
- **Depende de**: T3.2
- **Entrega**: packs `general`, `fidelity`, `platform.{tiktok,reels}` y verticales (beauty, finance, health, apps, food, fashion) con líneas de redacción propia (§10.1) + regla de lookup (§9.5).
- **Verificación**: el lookup para brief vertical beauty + plataforma tiktok devuelve exactamente {general, fidelity, vertical.beauty, platform.tiktok}; ninguna línea del seed coincide textualmente con las librerías de Cliprise: clonar los repos públicos (`cliprise/awesome-ai-ugc-video-prompts`, `cliprise/awesome-ai-video-ads-prompts`) y contrastar por n-gramas/grep, con el output del contraste en la evidencia.

#### T3.4 · Model profiles seed + verificación de catálogo [x] 2026-07-15 — PASS (15/15 OK contra fal real, control negativo probado, coste $0), ver docs/verifications/T3.4/
- **Depende de**: T3.1, T2.1 *(recalibra las `recipe` sembradas en T2.1)*
- **`[verificar]` de §13.1 CERRADOS (regla 3, anotados en PRD §13.1)**: OmniHuman $0,14→$0,16/s; ace-step ~$0,005→$0,0002/s; LatentSync $0,20/vídeo; sync-lipsync v2 $3/min, v2 pro $5/min; Veo 3.1 base $0,20/s. Recipes recableadas a endpoints reales; horquillas COGS-30s sin cambio (dentro del Apéndice B).
- **Entrega**: seed de `model_profile` (catálogo §13.1: endpoints completos, capabilities, costes) y comando `pnpm fal:verify` que contrasta cada perfil contra la model page/`llms.txt` de fal (marca `verified_at`/desviaciones) y **recalibra los costes de las `recipe`** con los datos verificados (regla de trabajo 5).
- **Verificación**: `pnpm fal:verify` corre contra fal.ai real y reporta OK o divergencia por perfil; introducir un precio falso en el seed hace que lo detecte; las recetas quedan recalculadas si hubo cambios.

#### T3.5 · Compilador de prompts (N6) [x] 2026-07-15 — PASS (3 goldens char-a-char + CLI grep "no deformation" + slot irresoluble accionable; motor completo, executor N6 esqueleto), ver docs/verifications/T3.5/ (coste $0)
- **Depende de**: T3.3, T2.4
- **Entrega**: motor en `packages/core`: selección determinista de template por facetas + scoring (§9.3), interpolación de variables canónicas (§10.4) desde brief/persona/hook/cta/campaign, inyección obligatoria de beats + fidelity guards + guard packs + anti-estilo, validación de resolución completa, `resolvedPrompt` persistido por escena; registro del executor N6 en el orquestador.
- **Verificación**: golden files (3 combinaciones brief-fixture × template × persona comparadas carácter a carácter) en verde; un script CLI compila una variante real (con los templates de prueba de T3.2) e imprime el `resolvedPrompt` — `grep` confirma "no deformation" y el guard del vertical; un slot irresoluble produce error accionable (qué variable, de qué fuente). La inspección en canvas se verifica en T4.11.

#### T3.6 · Model adapters [x] 2026-07-15 — PASS, ver docs/verifications/T3.6/
- **Depende de**: T3.5, T3.4
- **Entrega**: adapters por familia (Seedance `@image/@video/@audio`; Kling referencias y voice control; Veo/Wan; imagen Seedream/NB2 edit) que transforman prompt canónico + assets al payload del endpoint respetando `capabilities`.
- **Verificación**: golden files de payloads por adapter **más asserts semánticos** (los goldens solos son autorreferenciales): el payload de Kling incluye la imagen de referencia cuando `capabilities.refImages>0`, el de Seedance usa la sintaxis `@image/@video/@audio`, y aspect/duración usan los nombres y enums exactos del `model_profile`; un template que excede `maxDuration` produce el troceo de escenas esperado (§7.5) en el plan de generación, no un error en runtime.

#### T3.7 · Seed inicial de templates (lote 1: ~50)
- **Depende de**: T3.5
- **Entrega**: ~50 templates propios (es/en) cubriendo formatos y ángulos de mayor uso, siguiendo la anatomía §10.3, en `draft` (pasan a `published` con thumbnail en T4.12). Ampliación a ~150 en T8.6.
- **Verificación**: validador en verde; 5 templates elegidos al azar **por el verifier** cumplen los 14 puntos de la anatomía §10.3 (checklist manual); la búsqueda facetada devuelve candidatos para cada ángulo del brief de prueba.

#### T3.8 · UI de galería
- **Depende de**: T3.7
- **Entrega**: `/gallery` con navegación facetada, ficha de template (body con slots resaltados, beats, guards, versiones con diff), editor con validación de slots en vivo, estados draft/review/published. (El botón "probar template" llega en T4.12 con FalClient.)
- **Mockup**: `docs/mockups/gallery.html` (variante 5a · rejilla facetada + filtros). El layout parte de ese mockup; el reviewer rechaza una página que se desvíe sin acuerdo (ver `.claude/skills/frontend`).
- **Playwright permanente**: `apps/web/e2e/gallery.spec.ts` cubre filtros combinados, ficha, slots resaltados, validación en vivo y creación de una versión con diff visible.
- **Verificación**: en navegador, filtrar por 2 facetas; editar un template introduciendo un slot inválido muestra el error en vivo; guardar crea `prompt_version` v2 con diff visible contra v1.

---

## F4 — Generación fal.ai

#### T4.1 · FalClient + upload de inputs con caché
- **Depende de**: T0.7b, T0.5, T3.4, T0.12, T0.14 *(usa la tabla `asset` y el storage de T0.5)*
- **Entrega**: cliente sobre `@fal-ai/client`: submit a `queue.fal.run` (persistencia `submitting`→`submitted` con `request_id`/`status_url`/`response_url`; §9.6), subida de inputs vía fal storage con caché `(asset_id, checksum)` → `asset.fal_url`, rate limiter (~8 concurrentes) y manejo de 429/`Retry-After`; tabla `generation` completa.
- **Coste estimado**: ~$0,15
- **Verificación**: generar una imagen barata real (FLUX.2 dev, <$0,05) end-to-end por polling → `generation` completa, coste real en `/spend`, PNG en storage propio; subir el mismo input dos veces reutiliza `fal_url` (un solo upload: `asset.fal_uploaded_at` no cambia en la 2ª pasada, además de los logs).

#### T4.2 · Webhook de fal con firma ED25519
- **Depende de**: T4.1, T0.13
- **Entrega**: `POST /api/webhooks/fal`: verificación ED25519 contra JWKS (caché ≤24 h) + timestamp ±5 min + idempotencia por `request_id`; el handler persiste el evento y delega en el orquestador; la **descarga del output se encola como job del worker** (§9.6).
- **Coste estimado**: ~$0,15
- **Verificación**: en el VPS (o local con cloudflared), una generación real completa vía webhook sin polling ("webhook verified" en logs); un POST forjado devuelve 401 sin tocar la BD; reenviar el mismo webhook no duplica nada.

#### T4.3 · Polling fallback + reconciliación idempotente
- **Depende de**: T4.1
- **Entrega**: poller lazy en read-path + integración con el sweeper (reconciliar generations colgadas contra fal, expirar por tipo); executor idempotente (§6.3.9).
- **Coste estimado**: ~$0,20
- **Verificación**: con webhooks deshabilitados (dev local), una generación real completa vía polling; matar el worker durante una generación y reiniciar retoma el seguimiento **sin re-submit** (el billing de fal muestra 1 solo job).

#### T4.4 · N7a: product shots con referencias reales
- **Depende de**: T4.1, T3.6
- **Entrega**: executor N7a: `fal-ai/bytedance/seedream/v4.5/edit` con fotos hero del brief como referencia (fallback `fal-ai/nano-banana-2/edit`), 2–3 shots 9:16; ruta packshot-IA si no hay fotos (decisión de CP1, marcada `synthetic_product=true`).
- **Coste estimado**: ~$0,50 (shots por las dos rutas: referencias y packshot-IA)
- **Verificación**: con fotos reales de un producto propio, los shots muestran **el producto real reconocible** (label/forma a juicio humano) en escenario UGC 9:16; el flujo sin fotos produce packshots razonables con el flag persistido.

#### T4.5 · N7b: TTS + word timestamps
- **Depende de**: T4.1, T2.0, T2.4 *(usa guiones reales con `scenes[]` de T2.4)*
- **Entrega**: executor TTS por escena según receta y `voice_map` de la Persona; **cierre de deuda `[verificar]`**: si los endpoints TTS devuelven word timestamps nativos; si no, ASR `fal-ai/elevenlabs/speech-to-text` encadenado; `word_timestamps` persistidos.
- **Coste estimado**: ~$0,30 (TTS + ASR de 2 guiones)
- **Verificación**: para un guion es y otro en, los audios suenan correctos en idioma y voz esperados; los word timestamps cubren el 100 % de las palabras y, medidos contra el onset visible en un editor de waveform (Audacity/`ffmpeg astats`) en 3 palabras concretas, difieren <±100 ms; resultado del `[verificar]` anotado en `model_profile` y en PRD §13.1.

#### T4.6 · Preview de voz en CP2/CP3
- **Depende de**: T4.5, T2.3, T2.6 *(el botón ▶ vive en los paneles de CP2/CP3)*
- **Entrega**: muestras de voz por Persona/idioma (generadas una vez, cacheadas) escuchables en CP2/CP3 **antes** de gastar render (§8.3 — por eso esta tarea va antes que el resto de N7).
- **Coste estimado**: ~$0,20 (muestras que quedan cacheadas)
- **Playwright permanente**: `apps/web/e2e/voice-preview.spec.ts` usa audio fixture/provider fake y comprueba reproducción desde CP2 y CP3, cambio de idioma/Persona y reutilización de la muestra sin una segunda generación.
- **Verificación**: botón ▶ junto a cada Persona reproduce su voz en el idioma de la variante; reproducirla 5 veces no añade coste (caché comprobada en `/spend`).

#### T4.7 · N7c: clip de avatar
- **Depende de**: T4.5
- **Entrega**: executor avatar por tier: Kling AI Avatar v2 Std (imagen de Persona + audio TTS del hook; duración = audio), VEED Avatars en Test (voz propia, timestamps vía ASR del clip; §7.5), OmniHuman en Premium (audio ≤30 s validado).
- **Coste estimado**: ~$2 (clips es+en en los tres tiers de avatar)
- **Verificación**: clip real de la Persona hablando el hook con lipsync aceptable a juicio humano (es y en); duración = audio ±0,3 s; en Test, el ASR produce timestamps del clip VEED.

#### T4.8 · N7d: b-roll por escena
- **Depende de**: T4.4, T3.6
- **Entrega**: executor b-roll: 1 generación por escena (§7.5), i2v desde keyframes (Kling v3/Wan 2.6) o R2V (Seedance 2.0) si el producto aparece en escena; troceo de escenas > maxDuration; **cierre de deuda**: enums de `aspect_ratio` de cada modelo integrado.
- **Coste estimado**: ~$4 (presupuesto §7.5 de una variante Standard)
- **Verificación**: para una variante de conversión (21–34 s) se generan exactamente los clips del presupuesto §7.5 (1 avatar + 2 b-roll), 9:16 720p+, producto fiel en las escenas R2V; enums anotados en `model_profile`.

#### T4.9 · N7e: bed musical IA
- **Depende de**: T4.1
- **Entrega**: executor música (ace-step) por mood/duración; **cierre de deuda**: precio real de ace-step.
- **Coste estimado**: ~$0,30
- **Verificación**: bed de 30 s con el mood pedido (a juicio humano), coste registrado, `audio_source=ai_bed` en la variante.

#### T4.10 · Deduplicación de generación
- **Depende de**: T4.5, T4.7, T4.8
- **Entrega**: content-hash `(resolved_prompt, model_profile_id, inputs)` en `generation`; los executors consultan antes de submit y reutilizan assets completados (§9.6).
- **Coste estimado**: ~$5
- **Verificación**: lote hook-testing de 3 variantes del mismo ángulo → body y CTA se generan **una sola vez** (nº de generations = hooks + body + CTA + shots, no 3× todo); ahorro visible en `/spend`.

#### T4.11 · Sub-DAG de N7 en el canvas + E2E de fase
- **Depende de**: T4.4, T4.6, T4.7, T4.8, T4.9, T4.10, T0.11
- **Entrega**: nodo compuesto N7 por variante (expandible a N7a–N7e) con thumbnails/players por asset; N6 visible con su `resolvedPrompt`; coste estimado vs real por sub-step; retry granular.
- **Coste estimado**: ~$6 (variante completa + retries)
- **Playwright permanente**: `apps/web/e2e/phases/f4-generation.spec.ts` (`@f4 @phase`) usa fal fake y conserva expansión N7a–N7e, previews, `resolvedPrompt`, coste por sub-step, fallo determinista y retry granular sin reiniciar los hermanos sanos.
- **Verificación (E2E de la fase)**: desde el canvas, una variante real completa N6→N7 con todos los assets reproducibles en el panel y el `resolvedPrompt` inspeccionable en N6; coste real del lote difiere <15 % del estimado de CP2; retry de un sub-step fallado funciona.

#### T4.12 · Generación de Personas, thumbnails y "probar template"
- **Depende de**: T4.1, T3.8, T2.0 *(T3.7 implícito vía T3.8; los thumbnails y el botón "probar template" viven en la UI de galería)*
- **Entrega**: generación IA de imágenes de referencia de Personas (FLUX.2/NB2: mismo sujeto, 2–3 encuadres, ≥2K) con curación manual; seed hasta 10–20 Personas (es/en); job de thumbnails de galería que promociona templates `draft→published`; botón **"probar template"** en la ficha (`generation` con `step_run_id` NULL, coste registrado).
- **Coste estimado**: ~$5 (referencias de 10–20 Personas + ~50 thumbnails + prueba de template)
- **Playwright permanente**: `apps/web/e2e/gallery-generation.spec.ts` usa fal fake y cubre curación de referencias, thumbnails publicados y "probar template" con preview/coste visibles; la fidelidad de Personas reales queda en el gate CUA.
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
- **Verificación**: normalizar los assets reales de una variante → ffprobe de cada salida cumple el perfil exacto (script de asserts); segunda ejecución = 100 % cache hits (0 trabajos ffmpeg en logs y mtime de los normalizados intacto); un clip 16:9 de prueba queda crop-to-fill sin letterbox.

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
- **Verificación** (a nivel de datos): la fila `qa_report` de una variante real contiene todos los checks en `pass` (query); `c2patool <master> --info` muestra el manifest con `trainedAlgorithmicMedia`; subir el fichero a mano a TikTok (borrador) no produce warnings de formato — paso manual del usuario (revisión humana): el bucle deja el master listo y pide este juicio.

#### T5.6 · CP4: revisión de variantes
- **Depende de**: T5.5, T0.11
- **Entrega**: panel de QA con player, overlay de safe zones conmutable (TikTok/Meta/Universal), resultados del QA, acciones aprobar/rechazar/regenerar (rechazo → `rejected`; regenerar → run `kind=regen`).
- **Coste estimado**: ~$2 (la regeneración de guion re-genera assets)
- **Playwright permanente**: `apps/web/e2e/variant-review.spec.ts` usa masters sintéticos y cubre player, overlays, QA, aprobar/rechazar y regenerar hasta mostrar un master nuevo.
- **Verificación**: aprobar 2 variantes y rechazar 1 desde el navegador actualiza los estados de las `ad_variant` (query en BD; el reflejo en `/library` se verifica en T5.7); "regenerar guion" crea el run parcial que termina en un master nuevo pasando por QA otra vez.

#### T5.7 · Export bundle + biblioteca
- **Depende de**: T5.5, T5.6
- **Entrega**: bundle por variante aprobada (MP4 + JSON: `ad_caption` ≤100 chars sin @/#/links, `brand_name` ≤20, hook/ángulo/duración/objetivo/plataforma, flags AIGC, `audio_source` + checklist §15.4); **export dual con/sin bed** cuando el lote declara destino orgánico+paid (re-mux de audio, §14); `/library` con filtros, linaje completo y descarga.
- **Mockup**: `docs/mockups/library.html` (variante 4c · foco de preview + linaje + safe zones). El layout de `/library` parte de ese mockup; el reviewer rechaza una página que se desvíe sin acuerdo (ver `.claude/skills/frontend`).
- **Playwright permanente**: `apps/web/e2e/library.spec.ts` cubre filtros, preview, linaje hasta hook/template y descarga del bundle verificando checksum; incluye el caso dual con/sin bed mediante fixtures media.
- **Verificación**: descargar un bundle y validar el JSON contra su schema (caption dentro de límites — test); un lote destino "ambos" produce las dos versiones de audio del mismo master sin re-encode de vídeo (timestamps de ffmpeg lo confirman); el linaje en la UI llega del master hasta el hook line y el `template@version` exactos.

#### T5.8 · Regeneración parcial optimizada
- **Depende de**: T5.6, T4.10
- **Entrega**: flujo CU4: clonar variante, regenerar solo el nodo cambiado + N8 + N9, reutilizando caché de normalizados y dedupe.
- **Coste estimado**: ≤$0,50 (cota del propio criterio 22.4)
- **Playwright permanente**: `apps/web/e2e/partial-regeneration.spec.ts` usa providers fake y cubre cambiar CTA desde una variante aprobada, progreso del run parcial, master nuevo y conservación visible de assets/nodos no afectados.
- **Verificación (criterio 22.4)**: cambiar el CTA de una variante aprobada produce un master nuevo en <2 min de reloj y <$0,50 de coste registrado.

#### T5.9 · E2E de la fase (criterios 22.1, 22.2 y 22.8)
- **Depende de**: T5.7, T4.11 *(el E2E de F5 presupone el de F4 y arrastra CP2/CP3 vía T4.6)*
- **Entrega**: prueba guiada completa documentada en `VERIFY.md` con los números reales obtenidos.
- **Coste estimado**: ≤$15 (cota del propio criterio 22.1)
- **Playwright permanente**: `apps/web/e2e/phases/f5-export.spec.ts` (`@f5 @phase`) conserva a coste cero el journey mockeado lote → generación → CP4 → QA → biblioteca → bundle íntegro, incluyendo texto libre sin imágenes y packshot sintético; coste/tiempo y naturalidad de voces se verifican solo en el cierre real.
- **Verificación**: (a) URL real → ≥6 variantes aprobadas (2 ángulos × 3 hooks) de 15–30 s en es+en, captions karaoke correctas, C2PA firmado, coste del lote <$15 en tier Test, <45 min de reloj con checkpoints atendidos; (b) **texto libre con 0 imágenes**: párrafo → decisión packshot-IA en CP1 → al menos 1 variante aprobada con `synthetic_product=true`; (c) **criterio 22.8**: las voces de las variantes es y en son nativas y corresponden al `voice_map` de su Persona (revisión humana de 1 variante por idioma).

#### T5.10 · Dashboard y vista de proyecto
- **Depende de**: T5.7, T2.3 *("lanzar un lote" exige CP2)*
- **Entrega**: `/` (dashboard: proyectos, lotes activos, gasto del mes, alertas) y `/projects/[id]` (briefs, lotes, variantes y métricas del proyecto) + CRUD mínimo de proyectos (§8.1).
- **Mockup**: `docs/mockups/dashboard.html` (variante 2a · resumen clásico · KPIs + lotes + panel lateral). El layout de `/` parte de ese mockup; el reviewer rechaza una página que se desvíe sin acuerdo (ver `.claude/skills/frontend`).
- **Playwright permanente**: `apps/web/e2e/dashboard.spec.ts` cubre CRUD mínimo de proyectos, lanzamiento de lote, lote activo/gasto del mes en `/` y briefs/variantes con estados correctos en `/projects/[id]`.
- **Verificación**: crear un proyecto desde la UI, lanzar un lote en él → el dashboard muestra el lote activo y el gasto del mes del proyecto; `/projects/[id]` lista sus briefs y variantes con estados correctos.

---

## F6 — Publicación

> Toda capacidad de F6 tiene modo degradado manual (export + checklist + guía) para no bloquear si las apps de developer están en revisión (§13.3).

#### T6.1 · Conexión de cuentas (OAuth) ⚠
- **Depende de**: T0.13, T0.14; ⚠ apps de developer TikTok y Meta + cuenta TikTok propia + cuenta Instagram Business vinculada a página de Facebook (todo lo aporta el usuario)
- **Entrega**: flujos OAuth de TikTok y Meta/Instagram; `platform_account` con tokens cifrados, refresh automático y estado en `/settings`.
- **Playwright permanente**: `apps/web/e2e/settings-connections.spec.ts` usa servidores OAuth fake y cubre conectar, callback, estado activo, refresh y revocación reflejada como error; la conexión a cuentas reales queda en la Verificación.
- **Verificación**: conectar las cuentas reales desde `/settings` → activas con sus scopes; revocar desde la plataforma se refleja como `error` al siguiente uso.

#### T6.2 · Checklist de publicación + CP5 + música propia
- **Depende de**: T5.7
- **Entrega**: checklist interactivo por plataforma generado del bundle (§15.4: toggle AIGC —con aviso de reset al duplicar campañas—, música según `audio_source`, Spark si aplica) + CP5 opcional; upload de pista propia licenciada (`audio_source=own_license`, asset `music_bed` seleccionable en la matriz).
- **Playwright permanente**: `apps/web/e2e/publishing-checklist.spec.ts` cubre reglas Spark/AIGC por `audio_source`, upload y selección de música propia y pausa/reanudación de CP5 en modo degradado manual.
- **Verificación**: el checklist de una variante con `audio_source=native_trending` **bloquea** la opción Spark con explicación; el de una con bed IA la permite; subir una pista propia y usarla en un lote produce el master con esa música y `own_license` persistido; con CP5 activado, el flujo de publicación (en el modo degradado manual de esta tarea) se pausa en el checkpoint y al confirmar se reanuda.

#### T6.3 · Publicación orgánica TikTok
- **Depende de**: T6.1, T6.2
- **Entrega**: publicación vía Content Posting API (o flujo guiado paso a paso si la app no está audited), con caption y disclosure; `publication` con `external_post_id`.
- **Playwright permanente**: `apps/web/e2e/publish-tiktok.spec.ts` usa TikTok fake y cubre publicar desde la app, caption/disclosure, estado e ID externo, además del flujo guiado degradado cuando la API se declara no auditada.
- **Verificación**: una variante aprobada aparece publicada en el perfil real de TikTok con su caption; la fila `publication` guarda ID externo y estado.

#### T6.4 · Publicación Reels (Instagram)
- **Depende de**: T6.1, T6.2
- **Entrega**: publicación de Reels vía Instagram Graph API en la cuenta Business propia.
- **Playwright permanente**: `apps/web/e2e/publish-reels.spec.ts` usa Instagram fake y cubre publicación desde la app, progreso, resultado e ID externo persistido.
- **Verificación**: el Reel aparece en la cuenta real con el caption esperado; `publication` registrada.

#### T6.5 · Ads en borrador (TikTok Ads + Meta Marketing API) ⚠
- **Depende de**: T6.1, T6.2; ⚠ cuenta de TikTok Ads Manager y cuenta publicitaria de Meta (Business Manager) creadas por el usuario
- **Entrega**: upload de creative + creación de ad en borrador en ambas plataformas; **cierre de deuda `[verificar]`**: existencia del flag AIGC en cada API (si no existe, el checklist mantiene el paso manual obligatorio; resultado anotado también en PRD §13.3).
- **Playwright permanente**: `apps/web/e2e/ad-drafts.spec.ts` usa TikTok/Meta fake y cubre creación de ambos borradores, creative correcto, estados/IDs visibles y el fallback de checklist para el flag AIGC según capability fixture.
- **Verificación**: el borrador aparece en TikTok Ads Manager y en Meta Ads Manager vinculado al vídeo correcto; el resultado de la verificación del flag AIGC queda documentado.

#### T6.6 · Trending Sound Advisor
- **Depende de**: T6.2
- **Entrega**: lectura de TikTok Creative Center (Popular Music) con filtro de disponibilidad comercial; sugerencias por mood; guía in-app del flujo "añadir sonido nativo al publicar" (restricción de cuentas Business documentada, §14); export con music headroom; **deuda `[verificar]`**: limitaciones de música en cuentas Business de Instagram.
- **Playwright permanente**: `apps/web/e2e/sound-advisor.spec.ts` usa catálogo fake y cubre filtros comerciales, sugerencias por mood, selección, guía y bloqueo coherente de Spark para sonido no-CML.
- **Verificación**: para una variante destino orgánico, el Advisor lista sonidos trending reales con su flag comercial; elegir uno no-CML marca `audio_source=native_trending` y el checklist bloquea Spark (coherencia con T6.2).

#### T6.7 · Flujo Spark documentado
- **Depende de**: T6.3
- **Entrega**: guía interactiva del Spark code (ventanas 7/30/60/365; recomendación ventana ≥ campaña), captura de `spark_code` + `spark_auth_expires_at`, alerta de renovación a N días de expirar.
- **Playwright permanente**: `apps/web/e2e/spark-guide.spec.ts` cubre selección de ventana, cálculo/persistencia de expiración y alerta con reloj controlado.
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
- **Playwright permanente**: `apps/web/e2e/metrics-import.spec.ts` usa APIs fake y un export CSV fixture para cubrir mapeo guiado, importación, errores de columnas y snapshots visibles sin duplicados.
- **Verificación**: forzar el job de sync sobre los posts ya publicados en F6 → views/likes aparecen al momento y coinciden con la app de TikTok/IG; un CSV con el formato real de Ads Manager (fixture cuyo formato se contrasta con un export real cuando exista) importa sin errores y sus filas aparecen como snapshots; el schedule (≤24 h) queda registrado en pg-boss.

#### T7.3 · Métricas derivadas y dashboard
- **Depende de**: T7.1, T7.2
- **Entrega**: cálculo por plataforma (Meta hook rate 3s/impr; TikTok thumbstop 2s/impr y 6s-rate; hold rate) con la no-comparabilidad explícita (§9.9); `/metrics` por variante/hook/ángulo/persona con linaje clicable.
- **Mockup**: `docs/mockups/metrics.html` (variante 7a · KPIs + tabla por variante). El layout de `/metrics` parte de ese mockup; el reviewer rechaza una página que se desvíe sin acuerdo (ver `.claude/skills/frontend`).
- **Playwright permanente**: `apps/web/e2e/metrics.spec.ts` siembra snapshots conocidos y cubre agregaciones por variante/hook/ángulo/persona, distinción explícita TikTok/Meta y navegación por linaje.
- **Verificación**: los derivados de un snapshot conocido cuadran a mano; la vista "por hook" agrega correctamente las variantes que comparten `hook_line_id`.

#### T7.4 · Reglas kill/scale ⚠
- **Depende de**: T7.3; ⚠ modo auto: requiere un ad de prueba activo con presupuesto real bajo (lo crea el usuario)
- **Entrega**: `experiment_rule` por lote (métrica correcta por plataforma, umbral, ventana 24–48 h, acción kill/scale/notify, modo manual/auto); evaluador cron; acciones ejecutables.
- **Playwright permanente**: `apps/web/e2e/experiment-rules.spec.ts` usa snapshots y platform APIs fake para cubrir creación/edición de reglas, propuesta manual y ejecución auto visible; la pausa real con presupuesto queda en la Verificación.
- **Verificación**: con snapshots inyectados, una variante bajo el umbral a las 48 h genera la propuesta de kill; en modo auto (ad de prueba de bajo presupuesto) la pausa se ejecuta de verdad en la plataforma.

#### T7.5 · Flywheel: PerfStats y recomendador
- **Depende de**: T7.3
- **Entrega**: agregación periódica a `hook_line.perf`, `prompt_template.perf`, `persona.perf` y por framework; el recomendador de N4/CP2 ordena por score (con mínimo de muestra).
- **Playwright permanente**: `apps/web/e2e/batch-matrix.spec.ts` se amplía para comprobar en CP2 el orden y score históricos de hooks, y que snapshots fixture que invierten el ranking cambian el orden visible.
- **Verificación (criterio 22.6)**: tras un lote medido, CP2 del siguiente lote muestra los hooks reordenados con su hook rate histórico; el orden cambia si se inyecta un snapshot que invierte el ranking.

#### T7.6 · Conciliación de gasto
- **Depende de**: T0.12, T4.11 *(necesita gasto real acumulado; la conciliación completa llega con la actividad de F4/F5)*
- **Entrega**: vista de conciliación en `/spend`: coste interno vs facturas reales (fal, Anthropic, Firecrawl) con captura manual mensual.
- **Playwright permanente**: `apps/web/e2e/spend-reconciliation.spec.ts` cubre captura mensual, comparación por proveedor y desviación calculada con ledger/facturas fixture.
- **Verificación (criterio 22.7)**: para un mes con actividad, la desviación ledger vs facturas es <10 % (documentado en la vista).

#### T7.7 · Panel de gasto completo
- **Depende de**: T5.10, T0.12
- **Entrega**: vistas por proyecto/lote/tier, **coste medio por variante aprobada** (incluye descartes), alertas 70/90/100 % con email opcional, y **freno** que bloquea la creación de lotes nuevos al superar el presupuesto (§16.2, O9, D5).
- **Playwright permanente**: `apps/web/e2e/spend-budget.spec.ts` cubre vistas y coste medio con datos conocidos, alertas por umbral, bloqueo de lote y override explícito; el envío se prueba contra mailer fake.
- **Verificación**: con un presupuesto bajo forzado, intentar crear un lote muestra el bloqueo con mensaje y opción de override explícito; el email de alerta llega (o aparece en el log del mailer en modo dev); el coste medio por variante aprobada cuadra a mano con el ledger; las vistas por proyecto/lote/tier muestran cifras que cuadran con una query directa a `cost_entry`.

---

## F8 — Operación y extensiones (backlog priorizado)

#### T8.1 · Backups completos y restore ensayado ⚠
- **Depende de**: T0.13; ⚠ destino externo de backups (bucket S3/B2 u otro host) contratado por el usuario
- **Entrega**: `pg_dump` diario + restic de `/data/assets` (excluyendo regenerables) a destino externo; **ensayo de restore documentado**.
- **Verificación**: restaurar el backup en un contenedor limpio y arrancar la app: proyectos, briefs y masters íntegros (checksum de 3 masters al azar).

#### T8.2 · Retención y monitor de disco
- **Depende de**: T5.7
- **Entrega**: política configurable (borrar intermedios de variantes rechazadas a los 30 días; conservar masters y linaje) + job de limpieza + alerta de disco >80 %.
- **Playwright permanente**: `apps/web/e2e/settings-retention.spec.ts` cubre configuración/persistencia de la política y alerta visible con umbral forzado; la selección exacta de ficheros borrados queda en integración del job.
- **Verificación**: forzar la política sobre datos de prueba borra exactamente lo esperado y nunca un master; la alerta se dispara con un umbral bajo forzado.

#### T8.3 · Presets de export por plataforma
- **Depende de**: T5.5
- **Entrega**: render dedicado TikTok vs Reels (safe zones, duración y caption style propios) + preset HQ 1440×2560 para Meta; la caché de normalizados distingue perfiles (`normalized_cache_key` ya lo soporta).
- **Verificación**: la misma variante exporta dos masters cuyos captions respetan la safe zone específica de cada plataforma (script de asserts sobre los .ass).

#### T8.4 · A/B de receta por idioma (lipsync)
- **Depende de**: T5.9
- **Entrega**: comparación sistemática TTS+avatar vs Kling 3.0 voice control para es (y siguientes locales); receta por defecto por locale fijada en BD (§17).
- **Coste estimado**: ~$3 (3 pares de clips A/B)
- **Verificación**: informe con 3 pares de clips comparados y decisión registrada en `recipe` por locale.

#### T8.5 · Superficie MCP
- **Depende de**: T5.9
- **Entrega**: MCP server (patrón Prizmad, `research/04 §1`) con tools `analyze_url`, `create_batch`, `get_batch_status` (long-poll con progreso), `list_variants`, `get_download_url`.
- **Coste estimado**: ~$0,50 (análisis + lote hasta CP2)
- **Verificación**: desde Claude Code, `create_batch` sobre una URL real lanza un lote visible en el canvas y `get_batch_status(wait:true)` reporta el progreso por pasos.

#### T8.6 · Ampliación de galería a ~150 templates + idiomas adicionales
- **Depende de**: T4.12
- **Entrega**: cobertura completa de la matriz formato × hook × vertical; hook/cta libraries en el siguiente idioma priorizado.
- **Coste estimado**: ~$2 (thumbnails del lote nuevo)
- **Verificación**: para cualquier combinación ángulo×formato del brief de prueba existe ≥1 template publicado; validador en verde.

#### T8.7 · Remotion caption layer premium (opcional)
- **Depende de**: T5.4
- **Entrega**: evaluación (licencia $0,01/render + $100/mes mín.) y, si compensa, integración como estilo de captions premium.
- **Verificación**: decisión documentada; si se integra, un master con captions Remotion pasa el QA.

#### T8.8 · Observabilidad completa
- **Depende de**: T0.11, T0.14, T4.2, T7.2 *(webhook forjado ⇒ endpoint de T4.2; panel en `/settings` ⇒ T0.14; alerta de sync fallido ⇒ T7.2)*
- **Entrega**: panel de métricas internas (duración por tipo de step, tasa de fallo por modelo/endpoint, discrepancia estimado-vs-real, profundidad de cola) en `/settings` y alertas operativas restantes (webhook con firma inválida, sync de métricas fallido) (§19.1).
- **Playwright permanente**: `apps/web/e2e/settings-observability.spec.ts` siembra métricas/eventos conocidos y cubre estadísticas del panel y alertas por webhook inválido y sync fallido.
- **Verificación**: enviar un webhook forjado → la alerta aparece; el panel muestra estadísticas reales calculadas desde las tablas (contrastadas a mano con una query).

---

## Reglas de trabajo

1. **Orden**: el grafo `Depende de` manda (la numeración es orientativa); entre fases se puede adelantar trabajo que no dependa de lo pendiente, pero una fase solo se cierra cuando su E2E final pasa.
2. **Definición de hecho**: subtareas completas + verificación ejecutada y anotada (fecha + resultado + coste real si aplica) + sin regresión del E2E de la fase anterior.
3. **Deudas `[verificar]`**: cada una se cierra en la tarea que la nombra y el resultado se anota también en el PRD para mantenerlo veraz.
4. **Los E2E de fase son sagrados**: T1.10b, T2.6, T4.11, T5.9 y los criterios de §22 del PRD son la vara de "funciona en el mundo real"; no se marcan por aproximación.
5. **Costes**: toda tarea que llame a APIs de pago anota el coste real observado; si difiere >25 % del estimado, se recalibra la `recipe`/estimador en la misma tarea.
6. **Cambios de alcance**: si una tarea revela que el PRD necesita ajuste (como ya pasó con Personas→F2 o el estado `scripted`), se edita el PRD en la misma sesión y se anota en ambos documentos.
7. **Mockups de página**: cada página con pantalla propia tiene un mockup aprobado en `docs/mockups/` (catálogo en `docs/mockups/README.md`, elegido por el usuario 2026-07-08). La tarea que la desarrolla lo referencia con una línea `- **Mockup**: docs/mockups/<x>.html`, y su desarrollo **parte de ese mockup** (construido con los componentes `components/ui/` del DS, no reinventado). Una página que se desvíe del mockup sin acuerdo explícito es un error de review (obligatoriedad en `.claude/skills/frontend`). Páginas nuevas sin mockup: se acuerda el layout con el usuario antes de implementarlas.
8. **Las cláusulas deterministas de una Verificación se quedan como tests** (auditoría DoD 2026-07-09): todo check automatizable y gratuito de un DoD (asserts de ffprobe, parsers de `.ass`, validadores de schema/seeds, linters, golden files) se codifica como test permanente dentro de `pnpm gate` en la misma tarea — así el "sin regresión" de la regla 2 es ejecutable y gratis para siempre. Las cláusulas con APIs de pago o juicio humano quedan one-shot con su evidencia en `docs/verifications/`.
9. **Coste estimado por tarea** (auditoría DoD 2026-07-09): toda tarea cuya verificación consuma APIs de pago lleva una línea `- **Coste estimado**` — es la base del cap ×3 del bucle. Si una tarea sin estimado resulta necesitar APIs de pago, el bucle la trata como parada de gasto (no improvisa el presupuesto).
10. **Playwright permanente por tarea web**: toda tarea cuya Entrega añada o modifique comportamiento operable en navegador declara una línea `- **Playwright permanente**` con el fichero exacto y los comportamientos protegidos. El spec se crea o actualiza en esa misma tarea, usa providers fake/fixtures para ser determinista y gratuito, y queda en `pnpm test:e2e`; el CUA puntual de cierre demuestra aceptación real, pero **no sustituye** esta regresión automatizada. Los E2E de fase viven además en `apps/web/e2e/phases/` con tags `@fN @phase`. Una excepción por infraestructura o proveedor real debe quedar escrita en la tarea junto con la capa permanente alternativa; nunca se omite en silencio.
