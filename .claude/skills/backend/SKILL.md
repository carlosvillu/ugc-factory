---
name: backend
description: Estrategia de desarrollo backend de UGC Factory — packages/core (contratos Zod, lógica pura, puertos, orquestador), packages/db (Drizzle + Postgres 16), apps/worker (pg-boss + FFmpeg) y la capa API de apps/web (route handlers, SSE, webhooks, auth). Incluye el análisis estático y tooling del monorepo (ESLint, Prettier, typecheck, knip, lefthook, catalogs). Usar SIEMPRE que se cree o modifique un contrato, módulo de core, tabla/migración/repo, job o consumer, route handler, webhook, logger, o configuración de lint/typecheck/hooks; se decida en qué paquete vive una pieza; o el usuario pida "crea el endpoint", "añade la tabla", "haz el executor", "configura el linter". Complementa (nunca sustituye) a la skill testing para todo lo relativo a tests.
---

# Estrategia de backend — UGC Factory

Esta skill define CÓMO se desarrolla todo el backend del proyecto: `packages/core`, `packages/db`, `apps/worker` y la capa API de `apps/web`. Es la fuente de verdad única de fronteras, convenciones y patrones de servidor: si un cambio no encaja en lo que describe este documento y sus references, o el cambio está mal planteado o esta skill necesita una actualización deliberada (nunca las dos cosas en silencio). Los tests de todo lo que se construya aquí los define la skill `testing` (léela SIEMPRE junto a esta).

## Principios

1. **core define, db implementa, las apps cablean.** `packages/core` contiene contratos Zod, lógica pura y **puertos** (interfaces); no importa drizzle, pg ni ningún I/O de datos — sus dependencias de runtime son zod y pino (pino solo para el factory de logging compartido de T0.1: los módulos consumen el puerto `Logger`, nunca pino directo). Los clientes HTTP de proveedores (fal, Anthropic, Firecrawl) sí viven en core (PRD §9.6, T1.7): usan fetch y reciben su config por deps — la frontera prohibida es la BD/cola, no la red. `packages/db` implementa los puertos de persistencia con Drizzle y depende de core. Las apps son composition roots (`apps/web/src/server/context.ts`, `apps/worker/src/bootstrap.ts`) que instancian adaptadores y los inyectan. Esta dirección es lo que permite unit tests puros de la máquina de estados e integración real con Testcontainers (testing/principio 3).
2. **El estado canónico vive en nuestras tablas, no en la cola.** pg-boss solo despacha ejecución; la verdad del pipeline es `pipeline_run`/`step_run` y toda mutación pasa por `transition()` del orquestador (§9.0), transaccional (`SELECT … FOR UPDATE` + encolado + NOTIFY en la MISMA transacción). Ningún handler cambia estados por su cuenta.
3. **Todo es idempotente porque todo se re-entrega.** pg-boss es at-least-once y fal reintenta webhooks 10 veces: cada executor y cada webhook handler, al (re)entrar, relee el estado real con FOR UPDATE y hace no-op si la transición ya se aplicó. La intención se persiste ANTES de la llamada externa (`submitting`), y nunca se mantiene un lock abierto durante una llamada HTTP.
4. **Los contratos Zod son la frontera universal.** Entre nodos del pipeline (§7.4), en cada payload de job, en cada request/response de la API y en cada evento SSE hay un schema de `packages/core` con sufijo `Schema` y su tipo inferido. Se valida con `safeParse` en toda frontera de entrada; los datos internos ya validados viajan tipados.
5. **Ninguna conexión en module scope.** BD, pg-boss y StorageAdapter se obtienen de accessors lazy con override para tests (`getDb()`/`setDbForTests()` — contrato exigido por testing/references/api.md §2.1). Importar un módulo jamás abre una conexión ni lee env.
6. **Errores tipados de extremo a extremo.** `AppError {code, message, details?, status}` en core; los wrappers de la API lo mapean al envelope `{code, message, details}` del Apéndice E. El frontend hace switch sobre `code`: el wording de `message` nunca es contrato.
7. **Observabilidad desde el día 1.** Todo log es pino estructurado con correlación (`run_id`/`step_id`/`request_id`/`job_id`); los secretos se redactan de forma declarativa en el logger base. Si un step falla en producción, el visor del canvas debe bastar para diagnosticarlo.
8. **El análisis estático es un gate, no una sugerencia.** `pnpm lint` (typescript-eslint strict-type-checked), `pnpm typecheck` y prettier son gate de merge; `no-floating-promises` es error innegociable (un await perdido en el worker = job "completado" antes de terminar FFmpeg).

## Tabla de decisión: ¿qué voy a construir?

Localiza lo que estás construyendo y lee el reference indicado ANTES de escribir código:

| Vas a escribir… | Reference | Y de testing… |
|---|---|---|
| Un paquete/módulo nuevo, un puerto, un servicio de core, decidir dónde vive algo | `references/architecture.md` | `testing/references/unit-core.md` |
| Un contrato Zod nuevo o un cambio de contrato | `references/architecture.md` §contratos | `testing/references/unit-core.md` |
| Una tabla, migración, repo, query, transacción, índice | `references/db.md` | `testing/references/db-integration.md` |
| La máquina de estados, `transition()`, invalidación, checkpoints | `references/architecture.md` + `references/db.md` | `testing/references/orchestrator.md` |
| Un job nuevo, un consumer/executor del worker, cron, retries, shutdown | `references/jobs.md` | `testing/references/orchestrator.md` |
| Un route handler, SSE, webhook, auth, el envelope de errores | `references/api.md` | `testing/references/api.md` |
| Logging, correlación, redaction, métricas internas | `references/observability.md` | — |
| ESLint/Prettier/typecheck/knip/lefthook/catalogs, un script raíz | `references/tooling.md` | `testing/references/ci.md` |
| Un cliente de API externa (fal, Anthropic, Firecrawl, TikTok/Meta) | `references/architecture.md` §puertos | `testing/references/external-apis.md` |

## Mapa de paquetes y dirección de dependencias

```
                    ┌────────────────────┐
                    │   packages/core     │  contratos Zod · lógica pura · puertos ·
                    │   (dep: zod, pino)  │  orquestador · clientes HTTP · prompts
                    └─────────▲──────────┘
                              │ implementa puertos / usa contratos
                    ┌─────────┴──────────┐
                    │    packages/db      │  schema Drizzle · migraciones · repos ·
                    │    (dep: core)      │  adaptadores (StepStore, JobQueue…)
                    └─────▲───────▲──────┘
            composition   │       │   composition
                 root     │       │      root
        ┌─────────────────┴─┐   ┌─┴──────────────────┐
        │ apps/web           │   │ apps/worker        │
        │ server/context.ts  │   │ src/bootstrap.ts   │
        │ (API + SSE + auth) │   │ (consumers + FFmpeg)│
        └────────────────────┘   └────────────────────┘
```

`packages/test-utils` depende de db+core (lo gobierna testing). Prohibido: core→db, core→drizzle, ciclos entre paquetes (`import-x/no-cycle` lo vigila).

## Módulos de `packages/core`

Carpeta por módulo del PRD §9, cada una con `index.ts` (API pública, expuesta como subpath export), `contracts.ts` (schemas Zod del módulo) y servicios como factory functions con objeto de deps tipado — sin clases (salvo `AppError`), sin frameworks de DI:

```
packages/core/src/
├─ contracts/       # contratos transversales del pipeline (§7.4) + envelope de error
├─ orchestrator/    # §9.0: máquina de estados, transition(), invalidación, puertos StepStore/JobQueue
├─ ingest/ analysis/ strategy/ scripting/ prompting/ generation/ composition/ publishing/ metrics/ spend/
├─ clients/         # clientes HTTP compartidos por >1 módulo (anthropic); los de un solo módulo viven en él
├─ observability/   # puerto Logger re-exportado + makeLogger (pino) + redact + serializers
├─ prompts/         # system prompts versionados (T1.8)
└─ jobs/            # registro defineJob: nombres de cola + schemas de payload (los handlers viven en apps/worker)
```

## Convenciones núcleo (el detalle vive en los references)

- **Nombres**: ficheros kebab-case; schemas `XxxSchema` + `type Xxx = z.infer<…>`; repos `<agregado>.repo.ts`; puertos sustantivos (`StepStore`, `JobQueue`, `FalClient`); factories `makeXxxService(deps)`.
- **Exports JIT**: los paquetes internos exportan TS fuente (`"." → ./src/index.ts` + subpaths por módulo). Next los consume con `transpilePackages`; el worker corre con tsx en dev y se bundlea con tsup para Docker. Imports profundos a internals: prohibidos por el exports map.
- **Migraciones**: `drizzle-kit generate` + SQL committeado + `migrate()` con lock en el arranque (§18.2). `push` prohibido fuera de prototipado local sin datos.
- **Jobs**: nombres de cola y payloads (Zod) en `core/jobs`; colas creadas explícitamente con política + DLQ; encolado transaccional con `{ db }` sobre la tx de Drizzle; `singletonKey` = `${run_id}:${node_key}`.
- **Secretos**: solo `APP_MASTER_KEY` en env (§19.2); el resto cifrado en `app_setting`. Jamás se loggea un secreto (redact) ni viaja al navegador.
- **Docs actualizadas**: Drizzle y pg-boss evolucionan rápido (Drizzle 0.x→1.0 cambia las relations) — consulta Context7 (MCP en `.mcp.json`) o los docs oficiales antes de asumir una API. Las skills `postgres-drizzle` y `supabase-postgres-best-practices` complementan aquí.

## Skills instaladas complementarias

Jerarquía: PRD/planning > skills propias (testing/frontend/backend) > skills externas. Si una skill externa contradice esto, gana esto.

| Skill | Úsala para |
|---|---|
| `supabase-postgres-best-practices` | Diseño de queries/índices/locking en Postgres 16 (es genérica, no requiere Supabase) |
| `postgres-drizzle` | Patrones Drizzle y la distinción 0.x vs 1.0 (relations, drizzle-kit) |
| `pnpm` | Workspaces, catalogs, CI con pnpm 10/11 |
| `zod` | Reglas de composición y rendimiento de schemas al escribir contratos |

Pendiente: skill local de **pg-boss** (no existe ninguna en el ecosistema) — generarla cuando exista `apps/worker` (p. ej. `npx skilld add npm:pg-boss`); hasta entonces, `references/jobs.md` + docs oficiales vía Context7.

## Definition of Done de una pieza de backend

1. Convenciones de esta skill respetadas (fronteras, puertos, contratos, idempotencia, logging).
2. Tests según la tabla de decisión de la skill `testing` (¿lógica pura? → unit; ¿toca Postgres/orquestador? → integración con Testcontainers) escritos EN la misma tarea.
3. `pnpm lint && pnpm typecheck && pnpm test` en verde.
4. Si cierra una tarea del planning: verificación real (script/curl observable o CUA si hay UI) + evidencia (`testing/references/cua.md`) — sin excepciones.

## References

| Archivo | Léelo cuando… |
|---|---|
| `references/architecture.md` | Crees módulos/puertos/servicios/contratos o dudes de en qué paquete va algo |
| `references/db.md` | Toques schema, migraciones, repos, transacciones o el lado SQL del orquestador |
| `references/jobs.md` | Toques pg-boss: jobs, consumers, executors, cron, retries, shutdown |
| `references/api.md` | Escribas route handlers, SSE, webhooks, auth o el envelope de errores |
| `references/observability.md` | Toques logging, correlación, redaction o métricas internas |
| `references/tooling.md` | Toques ESLint/Prettier/typecheck/knip/lefthook/catalogs o scripts raíz |
