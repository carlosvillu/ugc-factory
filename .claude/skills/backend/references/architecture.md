# Arquitectura — fronteras de paquetes, puertos, módulos y contratos

Cómo se decide DÓNDE vive cada pieza del backend y con qué forma: dirección de dependencias del monorepo, puertos e inyección por factory functions, estructura de módulos de `packages/core`, convención de contratos Zod, `AppError` y los composition roots. Si dudas de en qué paquete va algo, la respuesta está aquí; si ya sabes dónde va y necesitas el detalle de SQL, jobs o handlers, ve al reference correspondiente (§8).

## Índice

1. [Dirección de dependencias](#1-dirección-de-dependencias)
2. [Puertos y el patrón withTransaction](#2-puertos-y-el-patrón-withtransaction)
3. [Módulos de `packages/core`](#3-módulos-de-packagescore)
4. [Contratos Zod](#4-contratos-zod)
5. [AppError: errores tipados de extremo a extremo](#5-apperror)
6. [Composition roots](#6-composition-roots)
7. [Exports maps JIT y aliases `@ugc/*`](#7-exports-maps-jit-y-aliases-ugc)
8. [Qué NO va aquí](#8-qué-no-va-aquí)

## 1. Dirección de dependencias

El mapa (ver diagrama del SKILL.md) cabe en tres líneas y es innegociable:

- `packages/core` → solo `zod` y `pino` (pino ÚNICAMENTE para el factory de logging compartido de T0.1; los módulos consumen el puerto `Logger`, jamás pino directo).
- `packages/db` → `core` (+ drizzle/pg). Implementa los puertos de persistencia y cola que core define.
- `apps/web` y `apps/worker` → ambos. Son composition roots: cablean, no contienen lógica de negocio. `packages/test-utils` → db+core (lo gobierna la skill `testing`, ver su `stack-setup.md`).

**Matiz vinculante que confunde a todo el mundo**: los clientes HTTP de proveedores (`FalClient`, cliente Anthropic, Firecrawl/Jina) SÍ viven en `packages/core` (PRD §9.6, T1.7). Usan `fetch` y reciben config/keys por deps — no importan nada de I/O de datos. La frontera prohibida de core es **BD y cola** (drizzle, pg, pg-boss), no la red. Por qué: el pipeline ES llamadas a proveedores; sacarlas de core partiría cada módulo en dos mitades artificiales, mientras que la BD/cola sí tiene una implementación intercambiable (Testcontainers, futura s3) que justifica el puerto.

Prohibido y vigilado: `core→db`, `core→drizzle/pg/pg-boss`, y cualquier ciclo entre paquetes o entre módulos de core — `import-x/no-cycle` (config en `tooling.md`) lo convierte en error de lint, porque un ciclo convierte dos módulos en uno sin decirlo.

## 2. Puertos y el patrón withTransaction

Un puerto es una interface de core que db (o una app) implementa. **Vive junto al módulo que lo consume** (`orchestrator/ports.ts` para StepStore/JobQueue); los transversales que consume todo core (`Logger`, `Clock`, `StorageAdapter`) viven en `packages/core/src/ports.ts`. Por qué: el puerto documenta lo que su consumidor necesita, no lo que el adaptador ofrece — colocarlo junto al consumidor evita interfaces gordas "por si acaso".

```ts
// packages/core/src/ports.ts — puertos transversales
export interface Logger {
  trace(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger; // correlación run_id/step_id/job_id (observability.md)
}

export interface Clock { now(): Date }               // inyectable ⇒ tests deterministas sin fake timers

export interface StorageAdapter {                    // T0.5: implementación local hoy, s3 mañana
  put(key: string, data: Uint8Array | ReadableStream<Uint8Array>, opts?: { mime?: string }): Promise<{ bytes: number; checksum: string }>;
  get(key: string): Promise<ReadableStream<Uint8Array>>;
  stat(key: string): Promise<{ bytes: number; checksum: string } | null>;
  delete(key: string): Promise<void>;
}
```

```ts
// packages/core/src/orchestrator/ports.ts — puertos del orquestador (§9.0)
import type { NewStepRun, StepRun, StepRunPatch } from "../contracts/step-run";
import type { EnqueueRequest } from "../jobs"; // nombre de cola + payload validado + singletonKey (jobs.md)

/** Stores ligados a UNA transacción abierta: solo existen dentro del callback de withTransaction. */
export interface TxStores {
  steps: StepStore;
  jobs: JobQueue;
  events: RunNotifier;
}

export interface StepStore {
  /** SELECT … FOR UPDATE — la fila queda bloqueada hasta el commit. */
  findForUpdate(stepId: string): Promise<StepRun | null>;
  update(stepId: string, patch: StepRunPatch): Promise<void>;
  /** Invalidación (PRD §7.1c): fila NUEVA con supersedes_id; la anterior pasa a superseded. Nunca se resetea. */
  insertSuperseding(previous: StepRun, next: NewStepRun): Promise<StepRun>;
  findDependents(stepId: string): Promise<StepRun[]>;
}

export interface JobQueue {
  /** El INSERT del job comparte transacción con la transición: pg-boss send con { db: tx } (jobs.md). */
  enqueue(req: EnqueueRequest): Promise<void>;
}

export interface RunNotifier {
  /** NOTIFY pipeline_events — Postgres lo entrega al commit, nunca antes: el SSE no ve estados sin commitear. */
  notify(runId: string): Promise<void>;
}

export type WithTransaction = <T>(fn: (stores: TxStores) => Promise<T>) => Promise<T>;
```

**El patrón**: core orquesta la transacción, db la ejecuta. El servicio de core recibe `withTransaction` como dep; db lo implementa con `db.transaction((tx) => fn(makeTxStores(tx)))`, donde `makeTxStores` construye los stores pasando `tx` como executor a los repos (convención de repos en `db.md`) y el `JobQueue` envuelve `boss.send(name, data, { db: adaptadorTx })`. Core nunca ve drizzle: solo ve stores ya ligados a la transacción.

```ts
// packages/core/src/orchestrator/transition.ts — esquema del uso
export function makeOrchestrator(deps: { withTransaction: WithTransaction; logger: Logger; clock: Clock }) {
  return {
    async transition(stepId: string, event: StepEvent): Promise<StepRun> {
      return deps.withTransaction(async ({ steps, jobs, events }) => {
        const step = await steps.findForUpdate(stepId);
        if (!step) throw new AppError("not_found", `step_run ${stepId} no existe`);
        // Función pura de la tabla §7.1; ilegal ⇒ lanza IllegalTransitionError
        // (subclase de AppError con code 'invalid_transition' — ver §5) ⇒ ROLLBACK total.
        const next = nextStatus(step.status, event);
        await steps.update(stepId, { status: next, updatedAt: deps.clock.now() });
        if (next === "succeeded") {
          // Solo un step completado desbloquea aguas abajo; y un dependiente solo arranca
          // cuando TODAS sus deps están satisfechas (awaiting_deps → pending → queued).
          for (const dep of await steps.findDependents(stepId)) {
            if (!(await allDepsSatisfied(steps, dep))) continue;
            await steps.update(dep.id, { status: "queued" });
            await jobs.enqueue({
              job: stepExecuteJob, // encolado EN LA MISMA transacción (jobs.md §5)
              payload: { run_id: step.runId, step_id: dep.id, node_key: dep.nodeKey },
              singletonKey: `${step.runId}:${dep.nodeKey}`, // anti doble-encolado
            });
          }
        }
        await events.notify(step.runId);
        return { ...step, status: next };
      });
    },
  };
}
```

Regla dura: **nunca un lock abierto durante una llamada HTTP** (SKILL.md principio 3) — la llamada a fal/Anthropic ocurre FUERA del callback, entre dos transiciones cortas (`submitting` antes, `succeed/fail` después). Los tests de todo esto: exhaustivo puro en `testing/references/unit-core.md` §4, transaccional real en `testing/references/orchestrator.md`.

## 3. Módulos de `packages/core`

Carpeta por módulo del PRD §9. Estructura canónica:

```
packages/core/src/
├─ index.ts            # raíz: re-exporta contracts + AppError + ports (lo transversal mínimo)
├─ ports.ts            # Logger, Clock, StorageAdapter
├─ contracts/          # contratos transversales del pipeline (§7.4) + envelope de error
├─ orchestrator/       # §9.0: ports.ts, state-machine.ts, transition.ts, invalidation.ts
├─ ingest/ analysis/ strategy/ scripting/ prompting/
├─ generation/ composition/ publishing/ metrics/ spend/
├─ clients/            # clientes HTTP compartidos por >1 módulo (anthropic.ts: analysis + scripting)
├─ observability/      # puerto Logger re-exportado + makeLogger (pino) + redact + serializers (observability.md)
├─ prompts/            # system prompts versionados (T1.8): brief-synthesis.v1.ts …
└─ jobs/               # registro defineJob: nombres de cola + schemas Zod de payload (jobs.md)
```

Cada módulo contiene: `index.ts` (SU API pública — es lo único que expone el subpath export, §7), `contracts.ts` (schemas Zod locales del módulo), servicios y tests co-locados (`*.test.ts`). Los clientes de UN solo módulo viven en él (`FalClient` → `generation/`, Firecrawl/Jina → `ingest/`); solo lo compartido por varios sube a `clients/`.

**Los servicios son factory functions con objeto de deps tipado.** Sin clases (la única excepción es `AppError`, §5), sin frameworks de DI, sin singletons de módulo:

```ts
// packages/core/src/analysis/brief-synthesizer.ts
import type { Clock, Logger } from "../ports";
import type { AnthropicClient } from "../clients/anthropic";
import { ProductBriefSchema, type ProductBrief } from "../contracts/product-brief";
import { productBriefJsonSchema } from "../contracts/product-brief.json-schema";
import { briefSynthesisPrompt } from "../prompts/brief-synthesis.v1";

interface BriefSynthesizerDeps { anthropic: AnthropicClient; logger: Logger; clock: Clock }

export function makeBriefSynthesizer(deps: BriefSynthesizerDeps) {
  return {
    async synthesize(input: { raw: RawContent; visual: VisualAnalysis | null; language: string }): Promise<ProductBrief> {
      const log = deps.logger.child({ module: "analysis", op: "synthesize_brief" });
      const res = await deps.anthropic.structuredOutput({
        model: "claude-sonnet-5",
        system: briefSynthesisPrompt,        // versionado + prompt caching (§13.2)
        schema: productBriefJsonSchema,      // espejo JSON Schema, NO el Zod (§4)
        input,
      });
      const parsed = ProductBriefSchema.safeParse(res.output); // la cardinalidad real se aplica AQUÍ
      if (!parsed.success) {
        log.warn({ issues: parsed.error.issues.length }, "brief inválido devuelto por el modelo");
        throw new AppError("provider_error", "el brief no cumple el contrato", z.flattenError(parsed.error));
      }
      return parsed.data;
    },
  };
}
export type BriefSynthesizer = ReturnType<typeof makeBriefSynthesizer>;
```

Por qué factories y no clases/DI: las deps son visibles y tipadas en la firma (nada se resuelve "por arte de contenedor"), un test de Vitest pasa fakes sin mockear módulos (`makeBriefSynthesizer({ anthropic: fake, logger: noopLogger, clock: fixedClock })`), y el bundler puede tree-shakear lo no usado. `ReturnType<typeof makeX>` da el tipo del servicio gratis.

## 4. Contratos Zod

Convención única en TODO el proyecto: `export const XxxSchema = z.object({...})` + `export type Xxx = z.infer<typeof XxxSchema>`. Sufijo `Schema` siempre; el tipo nunca se escribe a mano. La skill externa `zod` complementa (composición, rendimiento); esto es lo estructural:

- **`contracts/` transversal**: los contratos entre nodos del pipeline (PRD §7.4: `IntakeConfig → RawContent → VisualAnalysis → ProductBrief → BatchPlan → AdScript[] → CompiledPrompt[] → AssetSet → CompositionSpec → MasterVideo/ExportBundle → PublicationRecord → MetricSnapshot`) + el envelope de error del Apéndice E. Cruzan módulos: por eso no viven en ninguno.
- **`contracts.ts` por módulo**: lo local (warnings del BriefValidator, resultado del linter FTC, line items del estimador). Si otro módulo empieza a importarlo, muévelo a `contracts/` — es la señal de que dejó de ser local.
- **Discriminated unions** para todo canal que transporte varios tipos: payloads de jobs (registro `defineJob`, jobs.md) y eventos SSE. Por qué: `switch (ev.type)` exhaustivo con narrowing, y un evento desconocido falla en el `safeParse`, no en producción.

```ts
// packages/core/src/contracts/run-events.ts — contrato SSE (§9.0; lo consume el hook del frontend)
// `type` = nombre del evento SSE (`event:`); `data` = el JSON de su línea `data:`.
export const StepChangedSchema = z.object({
  stepId: UlidSchema, // los PKs son ULIDs (db.md §1), jamás z.uuid()
  status: StepStatusSchema,
  cost: z.number().nullable().optional(),
  outputExcerpt: z.string().nullable().optional(),
});

export const RunEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), data: RunSnapshotSchema }),      // {run, steps[]} completo
  z.object({ type: z.literal("step_changed"), data: StepChangedSchema }),
  z.object({ type: z.literal("heartbeat"), data: z.looseObject({}) }),     // mantiene viva la conexión; el shape no es contrato
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
```

- **Cardinalidades SOLO en Zod** (PRD §13.2): la API de structured outputs de Anthropic no aplica `minItems`/`maxItems` (ni `minLength`/`minimum`). `angles: z.array(AngleSchema).min(5).max(10)` es la única línea que garantiza 5–10 ángulos; el `safeParse` tras la llamada es la red de seguridad real.
- **Espejo JSON Schema** (T1.1): lo que se envía en `output_config` de Anthropic se genera con `z.toJSONSchema()` (Zod v4) y se post-procesa con un helper puro propio: `additionalProperties: false` en todo objeto (la API lo exige) y fuera los constraints de array (los ignoraría en silencio y el espejo mentiría). El espejo es un **artefacto** exportado y testeado como tal — divergencias deliberadas Zod↔espejo fijadas por test en `testing/references/unit-core.md` §3; no dupliques esos tests.

```ts
// packages/core/src/contracts/product-brief.json-schema.ts
export const productBriefJsonSchema = toAnthropicJsonSchema(z.toJSONSchema(ProductBriefSchema));
// toAnthropicJsonSchema: helper puro de core — walk que fija additionalProperties:false y poda min/maxItems
```

- **Errores de validación a `details`** con `z.flattenError(error)`: forma estable `{formErrors, fieldErrors}` que el frontend mapea a campos (decisión 7 de frontend).

## 5. AppError

Una única clase de error en `packages/core`, con `code` de unión literal. Los servicios lanzan `AppError` con code semántico — JAMÁS `throw new Error("algo falló")` ni strings sueltos: el frontend hace switch sobre `code` y el wording de `message` no es contrato (SKILL.md principio 6).

```ts
// packages/core/src/contracts/app-error.ts
export const APP_ERROR_CODES = [
  "validation_error", "not_found", "invalid_transition", "unauthorized", "invalid_signature",
  "rate_limited", "guardrail_blocked", "provider_error", "internal",
] as const;
export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

const STATUS: Record<AppErrorCode, number> = {
  validation_error: 400, unauthorized: 401, invalid_signature: 401, not_found: 404,
  invalid_transition: 409, guardrail_blocked: 422, rate_limited: 429, internal: 500, provider_error: 502,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code]; // el status deriva del code: nadie elige un HTTP status a mano
    this.details = details;
  }
}
```

| Code | Status | Cuándo |
|---|---|---|
| `validation_error` | 400 | Input que no pasa el schema Zod de la frontera (el wrapper lo genera desde ZodError, api.md) |
| `unauthorized` | 401 | Sin sesión válida (T0.4) |
| `invalid_signature` | 401 | Webhook con firma/cabeceras/timestamp inválidos (T4.2) |
| `not_found` | 404 | Agregado inexistente (run, step, asset, brief) |
| `invalid_transition` | 409 | La máquina de estados rechaza el evento (aprobar un step que no espera aprobación) |
| `guardrail_blocked` | 422 | Guardrail de negocio: linter FTC bloquea el guion, slot de prompt irresoluble |
| `rate_limited` | 429 | Rate limit propio (login T0.4) o presupuesto de spend agotado |
| `internal` | 500 | Bug nuestro; el envelope sale opaco y el detalle va SOLO al log (api.md) |
| `provider_error` | 502 | fal/Anthropic/Firecrawl falló de forma no recuperable u output fuera de contrato |

Añadir un code = ampliar la unión + la tabla `STATUS` + decidir su mapeo en el wrapper de api.md, en el mismo PR. La distinción reintentable-vs-fatal de los executors NO se codifica aquí: vive en la máquina de estados (jobs.md).

**Subclases semánticas**: cuando un módulo necesita un error atrapable por tipo, se subclasea AppError con el code fijado — la única familia de errores sigue siendo una. El caso canónico es el del orquestador, que es además el contrato que asertan los tests de `testing/references/unit-core.md` §4 y `orchestrator.md`:

```ts
// packages/core/src/orchestrator/state-machine.ts
export class IllegalTransitionError extends AppError {
  constructor(from: StepStatus, event: StepEvent["type"]) {
    super("invalid_transition", `transición ilegal: ${from} + ${event}`);
    this.name = "IllegalTransitionError";
  }
}
```

Así `expect(...).toThrow(IllegalTransitionError)` funciona en los tests, y el wrapper de la API lo mapea vía `instanceof AppError` sin caso especial.

## 6. Composition roots

Los únicos sitios del monorepo donde se instancian adaptadores reales y se cablean con servicios de core. Si estás haciendo `new`/`create*` de un cliente o pool fuera de estos dos ficheros (o de los accessors que usan), está mal colocado.

**`apps/web/src/server/context.ts`** — cablea de forma **lazy**: en Next, importar un módulo no puede abrir conexiones ni leer env (testing/references/api.md §2.1 exige `getDb()`/`setDbForTests()`; mismo patrón para pg-boss y StorageAdapter). Las factories de core son closures baratas: crear el servicio por request es gratis; lo único cacheado como singleton son las conexiones, y eso ya lo hacen los accessors.

```ts
// apps/web/src/server/context.ts
import { makeOrchestrator } from "@ugc/core/orchestrator";
import { makeWithTransaction } from "@ugc/db";
import { getBoss } from "./boss";       // accessor lazy + setBossForTests
import { getDb } from "./db";           // accessor lazy + setDbForTests (testing/api.md §2.1, literal)
import { getRequestLogger } from "./request-context"; // child por request vía AsyncLocalStorage (observability.md)
import { systemClock } from "./clock";

export function getOrchestrator() {
  return makeOrchestrator({
    withTransaction: makeWithTransaction(getDb(), getBoss()),
    logger: getRequestLogger(),
    clock: systemClock,
  });
}
```

**`apps/worker/src/bootstrap.ts`** — cablea de forma **eager** al arrancar el proceso: el worker es un daemon y fallar en el boot (env que falta, BD caída) es una feature, no un bug. Esquema (el detalle de colas, consumers y shutdown está en jobs.md):

```ts
// apps/worker/src/bootstrap.ts
export async function bootstrap() {
  const logger = makeLogger({ name: "worker", level: process.env.LOG_LEVEL ?? "info" }); // factory pino compartido T0.1 (observability.md §2)
  const pool = new Pool({ connectionString: requireEnv("DATABASE_URL") }); // el worker POSEE su pool: lo cierra en el shutdown
  const db = makeDb(pool);
  const boss = await createBossWithQueues(requireEnv("DATABASE_URL")); // createQueue idempotente + DLQ (jobs.md)
  const storage = makeLocalStorageAdapter({ root: requireEnv("ASSETS_DIR") });
  const orchestrator = makeOrchestrator({ withTransaction: makeWithTransaction(db, boss), logger, clock: systemClock });
  await registerConsumers({ boss, db, orchestrator, storage, logger }); // handlers por node_key (jobs.md)
  registerGracefulShutdown({ boss, pool, logger });                     // SIGTERM → boss.stop → pool.end (jobs.md §9)
}
```

Los tests de integración sustituyen exactamente estas costuras: `setDbForTests(testDb)` en web, `bootstrap` parametrizable en worker — por eso ningún servicio de core lee env ni crea conexiones por su cuenta.

## 7. Exports maps JIT y aliases `@ugc/*`

Los paquetes internos exportan **TypeScript fuente** — sin build, sin watch, sin cascada: un cambio en core es visible en web y worker al instante. El coste (transpilar en el consumidor) lo pagan Next y tsx/tsup, y a 4 paquetes es despreciable.

```jsonc
// packages/core/package.json (esquema; db es idéntico con sus subpaths)
{
  "name": "@ugc/core",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./contracts": "./src/contracts/index.ts",
    "./orchestrator": "./src/orchestrator/index.ts",
    "./analysis": "./src/analysis/index.ts",
    "./jobs": "./src/jobs/index.ts"
    // …un subpath por módulo del §3. NUNCA "./src/*" comodín:
    // el exports map ES el enforcement de la API pública — un import profundo a internals no resuelve
  },
  "dependencies": { "zod": "catalog:", "pino": "catalog:" } // versiones únicas vía pnpm catalogs (tooling.md)
}
```

- **Consumo**: las apps declaran `"@ugc/core": "workspace:*"` — el alias `@ugc/*` sale del workspace de pnpm, no de `paths` de tsconfig.
- **apps/web**: `transpilePackages: ["@ugc/core", "@ugc/db"]` en `next.config.ts` — Next compila el TS fuente de los workspace packages.
- **apps/worker**: `tsx watch src/main.ts` en dev; para la imagen Docker se bundlea con **tsup** con los paquetes del workspace inlineados (p. ej. `noExternal: [/^@ugc\//]`) — obligatorio porque exportan TS que Node no puede ejecutar.
- **core y db no tienen build**: su script es `typecheck: tsc --noEmit` (tsconfig extiende el base de la raíz; el reparto dev/build lo define testing `stack-setup.md` §3.4 y la orquestación `tooling.md`).

## 8. Qué NO va aquí

- **Schema Drizzle, migraciones, repos, transacciones SQL, implementación de los stores/withTransaction** → `references/db.md`.
- **defineJob, colas y políticas, consumers/executors, retries, cron, graceful shutdown** → `references/jobs.md`.
- **Route handlers, withRoute/withAuth, mapeo AppError→envelope HTTP, SSE, webhooks** → `references/api.md`.
- **Config de pino, correlación por request/job, redact** → `references/observability.md`; ESLint/typecheck/catalogs → `references/tooling.md`.
- **Tests de todo lo anterior** → skill `testing` (unit puro: `unit-core.md`; transaccional: `orchestrator.md` y `db-integration.md`). Este documento define la forma del código; cómo probarla no se decide aquí.
