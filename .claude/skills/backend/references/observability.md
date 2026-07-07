# Observabilidad: logging estructurado y correlación (pino)

Cómo se loguea en UGC Factory: un único factory pino compartido en `@ugc/core/observability`, correlación `run_id`/`step_id`/`request_id`/`job_id` en todo log desde T0.1, redaction declarativa de secretos y errores de step persistidos para el visor del canvas (§8.2). Los tests del logging (nivel `silent`, override por env) los gobierna la skill testing (`testing/references/stack-setup.md` §7).

## Tabla de contenidos

1. [Principio: el visor del canvas debe bastar](#1-principio-el-visor-del-canvas-debe-bastar)
2. [Factory compartido en `@ugc/core/observability`](#2-factory-compartido-en-ugccoreobservability)
3. [Correlación: child loggers por job y por request](#3-correlación-child-loggers-por-job-y-por-request)
4. [Redaction declarativa en el logger base](#4-redaction-declarativa-en-el-logger-base)
5. [Serializers](#5-serializers)
6. [Errores de step para el canvas](#6-errores-de-step-para-el-canvas)
7. [Niveles y alertas operativas](#7-niveles-y-alertas-operativas)
8. [Qué NO va aquí](#8-qué-no-va-aquí)

---

## 1. Principio: el visor del canvas debe bastar

§19.1 del PRD y T0.1 del planning lo fijan desde el día 1: **todo log es JSON estructurado (pino) con correlación** `run_id`/`step_id`/`request_id`/`job_id`. La vara de calidad es operativa, no estética: cuando un step falla en producción, el visor de logs del panel del nodo (§8.2) más `step_run.error` deben bastar para diagnosticarlo — sin SSH al VPS, sin grep de texto libre. Cada regla de este documento existe para sostener esa vara:

- **Estructurado siempre**: un log sin campos no es filtrable por run. `log.info({ run_id }, 'msg')`, jamás interpolar IDs en el string.
- **Correlación por child, no a mano**: los IDs se fijan UNA vez en un `logger.child()` en la frontera (job handler, request) y viajan implícitos; repetirlos a mano en cada línea garantiza que algún día falten.
- **Secretos redactados de forma declarativa** en el base (§4): la seguridad no depende de la disciplina de cada call site.

## 2. Factory compartido en `@ugc/core/observability`

El **puerto `Logger`** (lo que consume todo el resto del código) se define en `packages/core/src/ports.ts` junto a Clock y StorageAdapter — la definición canónica y su forma exacta viven en `references/architecture.md` §2. `packages/core/src/observability/` lo re-exporta y aporta lo demás: **`makeLogger(opts)`** (el factory pino que instancian los composition roots), `REDACT_PATHS`, los serializers y `sanitizeCausedBy`. Es **la excepción documentada** a "core sin I/O": T0.1 exige un logger compartido con serializers de correlación, y duplicarlo por app garantiza drift de redaction — el riesgo que no aceptamos. La frontera se mantiene estricta: **solo `observability/` importa pino**; cualquier otro módulo de core, db o apps consume el puerto.

```ts
// packages/core/src/observability/logger.ts
import pino from 'pino'
import type { Logger } from '../ports' // puerto canónico (architecture.md §2); aquí solo se implementa

export type { Logger }

export interface MakeLoggerOptions {
  name: 'web' | 'worker'
  level: string        // el composition root pasa process.env.LOG_LEVEL ?? 'info'
  pretty?: boolean     // SOLO dev: pino-pretty es transport de desarrollo, jamás en prod
}

export function makeLogger(opts: MakeLoggerOptions): Logger {
  return pino({
    name: opts.name,
    level: opts.level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },   // §4
    serializers: { err: pino.stdSerializers.err, run: runSerializer, step: stepSerializer }, // §5
    transport: opts.pretty ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  })
}
```

Reglas:

- **El factory se invoca en el composition root** (`apps/web/src/server/context.ts`, `apps/worker/src/bootstrap.ts`), una vez por proceso, con `name: 'web' | 'worker'`. Importar el módulo no crea logger ni lee env (principio 5 de la skill: nada en module scope).
- **Nivel por env**: el root pasa `level: process.env.LOG_LEVEL ?? 'info'`. En tests `LOG_LEVEL=silent` — lo fija `.env.test` según `testing/references/stack-setup.md` §7; no lo re-decidas aquí.
- **`pretty` solo en dev** (`NODE_ENV === 'development'`): en producción el stdout JSON lo recoge Docker tal cual; pino-pretty en prod rompe el parseo estructurado.
- En producción, un `Logger` correlacionado escribe además las líneas del step en el almacén que lee el visor del canvas (detalle de implementación en F0/T0.x); el contrato de este documento es que **todo lo logueado con el child del step es atribuible a ese step**.

## 3. Correlación: child loggers por job y por request

### 3.1 Worker: child por job, inyectado por deps

Al entrar en cada handler de pg-boss se crea UN child con `{queue, job_id, run_id, step_id}` y se pasa a los servicios **por deps** (los servicios de core son factories `makeXxxService(deps)` — ver `references/architecture.md`). Nada de loggers globales dentro de servicios: el mismo servicio corre para mil jobs y cada uno debe loguear su correlación.

Los bindings canónicos del child del worker son `{queue, job_id, run_id, step_id, node_key}` — este es el conjunto que usa el consumer genérico de `references/jobs.md` §4:

```ts
// apps/worker/src/consumers/step-execute.ts (fragmento — el consumer completo vive en jobs.md §4)
await boss.work(stepExecuteJob.name, { batchSize: 1 }, async ([job]) => {
  const { run_id, step_id, node_key } = StepExecuteJobSchema.parse(job.data)
  const log = rootLogger.child({
    queue: stepExecuteJob.name,
    job_id: job.id,
    run_id,
    step_id,
    node_key,
  })
  log.info('job started')
  const executor = executors[node_key]
  await executor.run({ step, db, log, signal: job.signal })   // todo log interno sale ya correlacionado
  log.info('job finished')
})
```

### 3.2 Web: child por request + AsyncLocalStorage

En `apps/web`, el wrapper de rutas (`withRoute`, ver `references/api.md`) crea un child con `request_id` (header `x-request-id` entrante si existe — permite correlacionar con un proxy/cliente —, `crypto.randomUUID()` si no) y lo guarda en `AsyncLocalStorage`. Así **cualquier capa** (repo, servicio, accessor) loguea correlacionado sin prop drilling del logger a través de firmas que no lo necesitan.

```ts
// apps/web/src/server/request-context.ts
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Logger } from '@ugc/core/observability'

interface RequestContext { log: Logger; requestId: string }
const als = new AsyncLocalStorage<RequestContext>()

export const runWithRequestContext = <T>(ctx: RequestContext, fn: () => T): T => als.run(ctx, fn)
export const getRequestLogger = (): Logger => als.getStore()?.log ?? getRootLogger()
export const getRequestId = (): string | undefined => als.getStore()?.requestId
```

`getRootLogger()` es el accessor lazy del logger base de web (`apps/web/src/server/logger.ts`): memoiza `makeLogger({ name: 'web', level: process.env.LOG_LEVEL ?? 'info' })` en el primer uso — mismo principio que `getDb()` (nada en module scope; `references/api.md` §3).

```ts
// dentro de withRoute (esqueleto — el wrapper completo vive en references/api.md)
const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()
const log = getRootLogger().child({ request_id: requestId, route: '/api/runs/[id]/approve' })
return runWithRequestContext({ log, requestId }, async () => {
  // ... parse → auth → delegar en core → serializar
})
```

**El `request_id` se devuelve en el envelope de error** (`{code, message, details?, request_id}` — el contrato exacto lo define `references/api.md`): es el cruce cliente↔servidor. Cuando el frontend muestra "algo falló", el usuario copia el `request_id` y un filtro sobre los logs reconstruye la request completa. Los servicios de core siguen recibiendo `log` por deps (el composition root de web les pasa `getRequestLogger()`); el ALS es el mecanismo de web, no un patrón que core conozca.

## 4. Redaction declarativa en el logger base

La redaction vive en `REDACT_PATHS`, en el factory, **NUNCA ad hoc** en call sites (borrar campos a mano antes de loguear es el patrón que falla en el call site nuevo). Regla operativa: **si un secreto puede aparecer en un payload logueado, su path se añade aquí ANTES de escribir el log que lo incluye** — en el mismo commit.

```ts
// packages/core/src/observability/redact.ts
export const REDACT_PATHS = [
  // headers y credenciales de sesión
  'authorization', '*.authorization',
  'cookie', '*.cookie', 'set-cookie', '*["set-cookie"]',
  // claves de API en objetos de config / payloads
  '*.apiKey', '*.api_key', '*.token', '*.password', '*.secret',
  // keys de proveedores por nombre (§19.2: bootstrap por env, cifradas en app_setting)
  'FAL_KEY', '*.FAL_KEY',
  'ANTHROPIC_API_KEY', '*.ANTHROPIC_API_KEY',
  'FIRECRAWL_API_KEY', '*.FIRECRAWL_API_KEY',
  'APP_MASTER_KEY', '*.APP_MASTER_KEY',
]
// censor: '[REDACTED]' — se configura en makeLogger (§2)
```

Gotcha verificado (fast-redact, el motor de pino): el wildcard `*` cubre **un nivel de anidamiento**, no recursión profunda — `*.apiKey` redacta `{ fal: { apiKey } }` pero no `{ a: { b: { apiKey } } }`. Si logueas un objeto profundo con secreto anidado, añade su path explícito (`config.providers.fal.apiKey`)… o mejor, no loguees ese objeto entero (§5). La redaction de pino **solo cubre logs**: lo que se persiste en BD (p. ej. `step_run.error.caused_by`, §6) se sanitiza aparte.

## 5. Serializers

Tres reglas:

1. **`err: pino.stdSerializers.err` SIEMPRE, y la clave DEBE llamarse `err`**: `log.error({ err }, 'submit to fal failed')`. El serializer solo se aplica a esa clave; `log.error({ error })` o `log.error(err)` pierden stack, `cause` y `type` en el JSON — el visor del canvas se queda ciego.
2. **Serializers de dominio para objetos ruidosos**: un `pipeline_run` o `step_run` entero en un log son KBs de jsonb (matrix, input_refs, output_refs) que entierran la señal. Se loguea la proyección mínima y, si necesitas más, campos explícitos.

```ts
// packages/core/src/observability/serializers.ts
import type { PipelineRun, StepRun } from '../contracts'

export const runSerializer = (run: PipelineRun) => ({ id: run.id, status: run.status })
export const stepSerializer = (step: StepRun) => ({ id: step.id, node_key: step.node_key, status: step.status })
// uso: log.info({ run, step }, 'transition applied') — pino aplica el serializer por clave
```

3. **No se loguean bodies de request por defecto** (ni prompts resueltos completos, ni payloads de webhook enteros): son grandes, pueden contener secretos que ningún wildcard cubre y el dato canónico ya está en BD (`generation.resolved_prompt`, `generation.fal_status_payload`). En `debug` se loguean extractos redactados y tamaños (`{ body_bytes, keys }`), no el contenido.

## 6. Errores de step para el canvas

Cuando un step falla, loguear no basta: **el executor persiste en `step_run.error` (jsonb, §12 del PRD) un objeto estructurado** que el panel lateral del nodo muestra como "caused by" (§8.2, acciones de recuperación). El log es para el operador con contexto; `step_run.error` es lo que ve el usuario al hacer click en el nodo rojo.

```ts
// packages/core/src/contracts/step-error.ts
export const StepErrorSchema = z.object({
  message: z.string(),              // humano, accionable: 'fal devolvió FAILED tras 3 reintentos'
  code: z.string(),                 // estable, para lógica: 'fal_generation_failed' | 'step_timeout' | ...
  caused_by: z.unknown().optional() // payload del proveedor RECORTADO y sanitizado (p. ej. error de fal)
})
export type StepError = z.infer<typeof StepErrorSchema>
```

```ts
// patrón en el executor (apps/worker) — transition() lo persiste, el log lo cuenta
const stepError: StepError = {
  message: 'fal devolvió estado FAILED',
  code: 'fal_generation_failed',
  caused_by: sanitizeCausedBy(falStatusPayload),  // recorta (~2 KB) y elimina claves/URLs firmadas
}
log.error({ err, step_error_code: stepError.code }, 'step failed')
await orchestrator.transition(step.id, { type: 'fail', error: stepError })  // §9.0: misma tx que el cambio de estado
```

`sanitizeCausedBy()` (helper en `observability/`) recorta el payload a un tamaño acotado y elimina secretos: la redaction del logger (§4) NO aplica a lo que se escribe en BD, y `step_run.error` viaja al navegador vía la API. Ambas escrituras usan el mismo child correlacionado: el log y la fila cuentan la misma historia con el mismo `step_id`.

## 7. Niveles y alertas operativas

| Nivel | Cuándo | Ejemplos del dominio |
|---|---|---|
| `error` | Requiere acción humana u operativa | Step agotó `max_retries`; webhook con firma inválida; migración fallida |
| `warn` | Degradación tolerada por diseño — el sistema siguió | Fallback de Firecrawl a Jina (§ingest); retry programado tras fallo transitorio de fal; SSE reconectado |
| `info` | Transiciones e hitos: la narrativa del run | `transition applied` (pending→queued); `job started/finished`; checkpoint aprobado; worker ready |
| `debug` | Detalle para depurar, redactado y acotado | Extractos de payloads (§5.3); decisión del rate limiter; timings internos de un executor |

Criterio rápido: si nadie debe hacer nada, no es `error`; si el sistema no se degradó, no es `warn`.

**Alertas operativas** (§19.1: step colgado > timeout, webhook con firma inválida, presupuesto superado, sync de métricas fallido) se emiten como **log `error` + fila en BD** en el mismo punto de detección. El porqué: el panel de observabilidad de F8 (T8.8) y las notificaciones in-app leen **tablas, no logs** — un log no es consultable por la UI ni sobrevive a la rotación. Mismo criterio para las métricas internas de §19.1 (duración por tipo de step, tasa de fallo por modelo, discrepancia estimado-vs-real): se derivan de `step_run`/`generation`/`cost_entry`, que ya contienen timestamps y costes; los logs diagnostican, las tablas miden.

## 8. Qué NO va aquí

- **Métricas de negocio** (hook rate, thumbstop, CTR, spend — PRD §9.9/§13.3, F7) y el **panel de observabilidad** de `/settings` (§19.1, T8.8): los define el PRD; este documento solo fija que sus fuentes son tablas, no logs.
- **Coste**: toda llamada facturable se registra en el ledger `cost_entry` (§9.10, módulo `spend`); loguear el coste está bien como traza, pero el log jamás es la fuente contable.
- **El envelope de error de la API** y el wrapper `withRoute`: `references/api.md` (aquí solo su relación con `request_id`).
- **Retries, DLQ y timeouts de jobs**: `references/jobs.md`; aquí solo cómo se loguean.
- **Testing**: `LOG_LEVEL=silent` y el `.env.test` los gobierna `testing/references/stack-setup.md` §7; los asserts sobre transiciones y errores persistidos, `testing/references/orchestrator.md`.
