# pg-boss: jobs tipados, executors, cron y shutdown

> Capa: `packages/core/src/jobs` (registro) + `packages/db` (adaptador JobQueue) + `apps/worker` (consumers/executors). Sirve T0.6, T0.7b, T0.9, T4.2/T4.3, T7.1/T7.2 y T8.2 del planning.
>
> No existe skill externa de pg-boss (verificado 2026-07-07): **este documento es la fuente**. Las APIs citadas están verificadas contra `docs/api/` de https://github.com/timgit/pg-boss y contra el paquete publicado (v12.x, jul-2026). **Versión mínima: ≥12.21** (`fromDrizzle` llegó en 12.20, `perJobResults` en 12.21; `redrive()` exige ≥12.23) — el catálogo fija `^12` (tooling.md §6). Ante cualquier duda nueva, verifica ahí o vía Context7 antes de asumir — pg-boss cambia semántica entre majors.

**Contenido**: [Principio](#1-principio-pg-boss-despacha-la-verdad-vive-en-nuestras-tablas) · [Jobs tipados](#2-jobs-tipados-registro-definejob-en-packagescoresrcjobs) · [Colas](#3-colas-createqueue-explícito-en-el-bootstrap) · [Consumer genérico](#4-consumer-genérico-de-steps-t07b) · [Encolado transaccional](#5-encolado-transaccional) · [Idempotencia](#6-idempotencia-del-executor-639) · [Retries y tiempos](#7-retries-y-tiempos) · [Cron](#8-cron) · [Shutdown](#9-graceful-shutdown) · [Qué NO va aquí](#10-qué-no-va-aquí)

## 1. Principio: pg-boss despacha, la verdad vive en nuestras tablas

pg-boss es SOLO el mecanismo de ejecución (despacho, retries, backoff, cron). El estado canónico del pipeline es `pipeline_run`/`step_run`, y **toda** mutación de estado pasa por `transition()` del orquestador (PRD §9.0) — ningún handler cambia un status por su cuenta, porque dos fuentes de verdad divergen en el primer crash. Nunca leas `pgboss.job` para decidir negocio (retry counts, "¿está corriendo?"): esa tabla es un detalle de implementación del despacho.

Consecuencia innegociable: pg-boss es **at-least-once** (crashes, expiraciones y heartbeats perdidos re-entregan el mismo job) → TODO handler es idempotente por diseño (§6). Si un handler no soporta ejecutarse dos veces, está mal escrito, no "pendiente de pulir".

## 2. Jobs tipados: registro `defineJob` en `packages/core/src/jobs/`

El registro **declara** (nombre de cola, schema Zod del payload, opciones); los **handlers viven en `apps/worker`**. Core jamás importa pg-boss — la frontera prohibida de core es BD/cola (SKILL.md, principio 1).

```ts
// packages/core/src/jobs/registry.ts
import type { z } from 'zod'

export interface JobDefinition<TSchema extends z.ZodType = z.ZodType> {
  name: string                    // nombre de la cola: '<dominio>.<acción>'
  payload: TSchema
  options: {                      // config de cola (createQueue); cada job la hereda
    policy: 'standard' | 'short' | 'singleton'
    retryLimit: number
    retryDelay?: number           // segundos
    retryBackoff?: boolean
    retryDelayMax?: number        // segundos; solo aplica con retryBackoff
    expireInSeconds?: number
    heartbeatSeconds?: number
  }
}

export function defineJob<T extends z.ZodType>(def: JobDefinition<T>): JobDefinition<T> {
  return def
}

/** Lo que viaja por el puerto JobQueue (architecture.md §2): job + payload sin validar + opciones. */
export interface EnqueueRequest<T extends z.ZodType = z.ZodType> {
  job: JobDefinition<T>
  payload: z.infer<T>
  singletonKey?: string
  startAfter?: Date
}
```

```ts
// packages/core/src/jobs/step-execute.ts
import { z } from 'zod'
import { UlidSchema } from '../contracts/ids' // los PKs son ULIDs (db.md §1) — z.uuid() los rechazaría
import { defineJob } from './registry'

export const StepExecuteJobSchema = z.object({
  run_id: UlidSchema,
  step_id: UlidSchema,
  node_key: z.string(), // 'N1'…'N11', 'N7a'…'N7e', 'demo.*' (PRD §12: step_run.node_key)
})
export type StepExecuteJob = z.infer<typeof StepExecuteJobSchema>

export const stepExecuteJob = defineJob({
  name: 'step.execute',
  payload: StepExecuteJobSchema,
  options: {
    policy: 'short',          // ver §3: 'short' es lo que hace real el dedupe por singletonKey
    retryLimit: 3,
    retryBackoff: true,
    retryDelayMax: 300,
    expireInSeconds: 900,
  },
})
```

**Validación Zod en LAS DOS puntas** — al encolar (`payload.parse` en el adaptador, §5) y al consumir (`safeParse` en el handler, §4). El porqué del lado consumidor: tras un deploy pueden quedar en la cola payloads encolados por la versión anterior del código; un `safeParse` que falla convierte "undefined is not a function a mitad de executor" en un job en la DLQ con error legible.

## 3. Colas: `createQueue` explícito en el bootstrap

En v10+ las colas se crean explícitamente. El bootstrap del worker recorre el registro y garantiza cola + DLQ; idempotente con el guard `getQueue` (patrón de los docs oficiales) y `updateQueue` si la config del registro cambió (`policy`/`partition` no se pueden cambiar):

```ts
// apps/worker/src/bootstrap.ts (fragmento)
import { jobRegistry } from '@ugc/core/jobs'

for (const job of Object.values(jobRegistry)) {
  const dlq = `${job.name}.dlq`
  if (!(await boss.getQueue(dlq))) await boss.createQueue(dlq)   // la DLQ debe existir ANTES de referenciarla
  if (!(await boss.getQueue(job.name))) {
    await boss.createQueue(job.name, { ...job.options, deadLetter: dlq })
  } else {
    // policy/partition son inmutables (docs/api/queues.md): se excluyen del update
    const { policy: _policy, ...updatable } = job.options
    await boss.updateQueue(job.name, { ...updatable, deadLetter: dlq })
  }
}
```

Una cola por tipo de trabajo, con la política que su semántica exige:

| Cola | Política | Config clave | Por qué |
|---|---|---|---|
| `step.execute` | `short` + `singletonKey` | retryBackoff, retryDelayMax 300, expire 900 | Consumer genérico (T0.7b). **Trampa verificada**: en una cola `standard`, `singletonKey` NO garantiza unicidad; `short` = 1 job *en cola* por key con activos ilimitados — exactamente "no encoles dos veces el mismo step, ejecuta N a la vez" |
| `output.download` | `standard` | retryLimit 5, retryBackoff | Descarga de outputs de fal tras el webhook (PRD §9.6): cientos de MB, jamás inline en el route handler |
| `media.render` | `standard` | expire 3600, heartbeatSeconds 60, retryLimit 2 | N8/FFmpeg: minutos de CPU; el heartbeat detecta un worker muerto en ~1–2 min sin esperar el expire (§7) |
| `sweeper.tick` | `singleton` | retryLimit 0, expire 120 | Cron T0.9: `singleton` = máximo 1 barrido activo; dos barridos solapados pisándose locks es un bug, no throughput |
| `metrics.sync` | `singleton` | retryLimit 2, retryBackoff | Cron N11 (T7.1/T7.2) contra TikTok/Meta; el sync siguiente reconcilia lo que este falle |
| `retention.cleanup` | `singleton` | retryLimit 0 | Cron T8.2: borrado idempotente — mejor re-ejecutar mañana que reintentar a ciegas hoy |
| `demo.noop` | `standard` | retryLimit 3, retryBackoff | Harness de T0.6: retries/backoff observables en la verificación de gate |

Cada cola tiene su `'<queue>.dlq'`: un job que agota retries conserva payload y error consultables (autopsia + `redrive()` de vuelta a la cola origen). Una DLQ que crece es una alerta operativa, no un cubo de basura.

`apps/web` también necesita una instancia PgBoss (encolar/schedule desde `transition()` en requests): accessor lazy `getBoss()`/`setBossForTests()` — mismo contrato que `getDb()` (testing/references/api.md §2.1; ver `references/api.md` §3) — sin `work()` y con `schedule: false` en el constructor (solo el worker programa crons).

## 4. Consumer genérico de steps (T0.7b)

Un único consumer para `step.execute` que resuelve el executor por `node_key` y delega TODO cambio de estado en `transition()`. Handlers reciben `Job[]` (v10) con `batchSize: 1` — desestructura `[job]`:

```ts
// apps/worker/src/consumers/step-execute.ts
import { AppError } from '@ugc/core/contracts'
import { stepExecuteJob, StepExecuteJobSchema } from '@ugc/core/jobs'
import { executors } from '../executors'

export async function startStepConsumer({ boss, db, orchestrator, logger }: WorkerContext) {
  await boss.work(stepExecuteJob.name, { batchSize: 1 }, async ([job]) => {
    const parsed = StepExecuteJobSchema.safeParse(job.data)
    if (!parsed.success) throw new AppError('validation_error', 'payload de job inválido', z.flattenError(parsed.error)) // payload viejo/corrupto → agotará retries → DLQ
    const { run_id, step_id, node_key } = parsed.data
    const log = logger.child({ queue: stepExecuteJob.name, job_id: job.id, run_id, step_id, node_key }) // bindings canónicos: observability.md §3.1

    const executor = executors[node_key]
    if (!executor) throw new AppError('internal', `executor desconocido: ${node_key}`)

    // Re-entrega: si el step ya no está en un estado ejecutable, no-op (¡no error!).
    // isExecutable = queued | failed-reintentable (retry_count < max_retries).
    // La revalidación REAL bajo lock la hace transition(); esto solo ahorra trabajo.
    const step = await getStep(db, step_id)
    if (!isExecutable(step)) { log.info('re-entrega sobre step ya resuelto: no-op'); return }

    // orchestrator = makeOrchestrator(...) del bootstrap (architecture.md §6): transición transaccional §9.0.
    // Una re-entrega tras fallo transitorio encuentra el step en failed: se re-arma primero
    // (failed --retry--> queued, §7.1 — consume retry_count) y después arranca.
    if (step.status === 'failed') await orchestrator.transition(step_id, { type: 'retry' })
    await orchestrator.transition(step_id, { type: 'start' })       // queued→running
    try {
      const output = await executor.run({ step, db, log, signal: job.signal })
      await orchestrator.transition(step_id, { type: 'succeed', output })
    } catch (err) {
      log.error({ err }, 'executor falló')                          // la clave DEBE llamarse err
      await orchestrator.transition(step_id, { type: 'fail', error: toStepError(err) })
      throw err                                                     // pg-boss registra el intento (§7)
    }
  })
}
```

Los executors se registran por `node_key` en `apps/worker/src/executors/`:

```ts
// apps/worker/src/executors/index.ts
export const executors: Record<string, StepExecutor> = {
  'demo.sleep': demoExecutor, // flags: sleep_ms
  'demo.fail': demoExecutor,  // flags: fail_rate (verificación manual) | fail_times (tests deterministas)
  'demo.hang': demoExecutor,  // flags: hang — el sweeper de T0.9 lo necesita
  N1: makeIngestExecutor(ctx), // …N2–N11 y N7a–N7e se añaden por fase
}
```

Los executors de demo (`sleep_ms`, `fail_rate`, `hang`) son **código de producto**, no de test: son el harness de F0 que exigen las verificaciones de gate de T0.7b/T0.9/T0.11 (provocar fallos y cuelgues reales desde el canvas). Viven aquí, no en `packages/test-utils`.

## 5. Encolado transaccional

La propiedad crítica (testing/orchestrator.md §4 la protege): **el INSERT del job va en la MISMA transacción Drizzle que la transición de estado**. Esto elimina una clase entera de bugs: crash entre commit y encolado → step `queued` que nadie ejecutará jamás; encolado antes del commit sin tx compartida → rollback deja un job fantasma que ejecuta un step en estado inconsistente. Con la tx compartida ninguno de los dos mundos existe.

pg-boss lo soporta de serie: `send(name, data, { db })` acepta un adaptador `{ executeSql(text, values) }`, y trae `fromDrizzle(tx, sql)` oficial (verificado en el paquete actual, `pg-boss/dist/adapters/drizzle.js`):

```ts
// packages/db/src/adapters/job-queue.ts — adaptador tx-scoped del puerto JobQueue de core
// (lo construye makeWithTransaction con la tx abierta: db.md §5, architecture.md §2)
import { sql } from 'drizzle-orm'
import type PgBoss from 'pg-boss'
import { fromDrizzle } from 'pg-boss'
import type { JobQueue } from '@ugc/core/orchestrator'
import type { EnqueueRequest } from '@ugc/core/jobs'
import type { DbTx } from '../client'

export function makeTxJobQueue(boss: PgBoss, tx: DbTx): JobQueue {
  return {
    async enqueue(req: EnqueueRequest): Promise<void> {
      const data = req.job.payload.parse(req.payload) // validación al ENCOLAR (§2)
      await boss.send(req.job.name, data, {
        db: fromDrizzle(tx, sql), // el INSERT del job va en NUESTRA transacción
        ...(req.singletonKey && { singletonKey: req.singletonKey }),
        ...(req.startAfter && { startAfter: req.startAfter }),
      })
    },
  }
}
```

Y así lo usa `transition()` (esquema — la máquina completa está en `architecture.md`, el SQL del lock en `db.md`):

```ts
// dentro del callback de withTransaction (architecture.md §2): jobs YA está ligado a la tx
// 1. SELECT … FOR UPDATE + validación de la transición (db.md)
// 2. UPDATE step_run + resolución de depends_on → steps listos pasan a queued
for (const ready of readySteps) {
  await jobs.enqueue({
    job: stepExecuteJob,
    payload: { run_id, step_id: ready.id, node_key: ready.node_key },
    singletonKey: `${run_id}:${ready.node_key}`,
  })
}
// 3. events.notify(run_id) — pg_notify en la misma tx: solo se entrega en COMMIT
```

`singletonKey = '${run_id}:${node_key}'` es la barrera contra el **doble encolado** (webhook y sweeper decidiendo a la vez que un step está listo): con la política `short` de la cola (§3), el segundo `send` con la misma key resuelve `null` en vez de crear job — trátalo como éxito idempotente, nunca como error.

## 6. Idempotencia del executor (§6.3.9)

Patrón obligatorio para executors con trabajo externo de pago (fal.ai): la re-entrega de un job NO puede re-submitir — es la barrera contra el doble gasto (PRD §6.3.9; regresión permanente en testing/orchestrator.md §9). Tres reglas:

1. **Al (re)entrar, releer bajo `FOR UPDATE` y no-op si la transición ya se aplicó.** La revalidación bajo lock vive en `transition()`; el executor consulta además su tabla de trabajo (`generation`) por el step activo.
2. **Persistir la intención (`submitting`) ANTES de llamar a fal**, y el `request_id` + `status_url`/`response_url` inmediatamente después. Si el worker muere entre medias, la re-entrega encuentra la intención y **reanuda el seguimiento** del request existente en vez de crear otro.
3. **Dos transacciones cortas, jamás un lock abierto durante HTTP.** Un `FOR UPDATE` que espera a `queue.fal.run` serializa el worker entero y agota el pool con la latencia de un tercero.

```ts
// apps/worker/src/executors/n7-generation.ts — esquema del patrón (eventos exactos: T0.7a)
async function runGenerationStep(step: StepRun, deps: Deps) {
  // tx corta 1: decidir bajo lock
  const intent = await deps.db.transaction(async (tx) => {
    const current = await stepsRepo.getForUpdate(tx, step.id)
    if (isTerminal(current.status)) return { kind: 'noop' } as const          // re-entrega tardía
    const gen = await generationsRepo.findActiveByStep(tx, step.id)
    if (gen?.fal_request_id) return { kind: 'resume', requestId: gen.fal_request_id } as const
    const created = await generationsRepo.insert(tx, { step_id: step.id, status: 'submitting' })
    return { kind: 'submit', generationId: created.id } as const              // intención COMMITEADA
  })
  if (intent.kind === 'noop') return
  if (intent.kind === 'resume') return deps.falClient.trackRequest(intent.requestId) // seguimiento, NO re-submit

  // HTTP FUERA de toda transacción
  const submitted = await deps.falClient.submit({ /* resolved_prompt, webhookUrl… */ })

  // tx corta 2: persistir el request_id inmediatamente
  await deps.db.transaction(async (tx) => {
    await generationsRepo.recordSubmit(tx, intent.generationId, submitted)
  })
}
```

El mismo principio aplica a jobs baratos (`output.download`, `media.render`): re-entrar tiene que ser gratis (checksum ya persistido → no re-descargar; `normalized_cache_key` ya presente → no re-normalizar).

## 7. Retries y tiempos

- **La decisión reintentable-vs-fatal es de la máquina de estados, no de `retryLimit`.** `step_run.retry_count`/`max_retries` es el contador canónico (T0.9: retry automático hasta `max_retries` + retry manual por API); pg-boss aporta el *timing* y la re-entrega. El handler traduce: error transitorio (red, 5xx, timeout HTTP) → `transition('fail')` + relanzar, y la re-entrega con backoff aplica `retry` si el guard lo permite; error fatal (`AppError` no reintentable, payload inválido) → `transition('fail')` terminal, y el job debe acabar en la DLQ para autopsia — o agotando `retryLimit` (las re-entregas encuentran el step terminal y no-opean barato), o directo con `perJobResults: true` devolviendo `{ id, status: 'deadletter', output }` (≥12.21: salta los reintentos restantes).
- **Backoff exponencial para APIs externas**: `retryBackoff: true` + `retryDelayMax` (p. ej. 300 s) en `step.execute`, `output.download`, `metrics.sync`. Sin techo, el delay se dispara (`retryDelay·2^n`); sin backoff, cada glitch de fal fusila el step al tercer martillazo en 3 segundos.
- **`retryLimit` por tipo, alineado con `max_retries` del step** (mismo orden de magnitud): así el último throw deja el job en la DLQ a la vez que el step queda `failed` terminal. Las re-entregas por crash del worker no consumen `retry_count` del step pero sí `retryLimit` — margen deliberado en colas donde el crash es plausible (render).
- **Jobs largos (FFmpeg, polling de fal)**: `expireInSeconds` alto = techo duro del peor caso (un job pasa a retry/fail al superarlo, esté vivo o no) + **heartbeat periódico** para detectar el worker muerto en segundos en vez de esperar el expire: con `heartbeatSeconds` en la cola, `work()` envía los heartbeats (touch) automáticamente — esto CUMPLE el requisito de "touch periódico" acordado: pg-boss lo emite por nosotros; `boss.touch(name, jobId)` manual solo se necesita procesando con `fetch()`. Sin heartbeat, un render de 1 h con expire de 2 h tarda 2 h en detectarse muerto.
- Propaga `job.signal` (AbortSignal del job) a fetch y procesos hijos: expiración y shutdown cancelan trabajo en curso en vez de dejarlo zombi.

## 8. Cron

`boss.schedule(name, cron, data, options)` sobre colas con política `singleton` (§3): el schedule **vive en Postgres** — sobrevive reinicios y deploys, y con varias instancias solo se emite 1 job por slot (throttling interno + compensación de clock skew). El bootstrap lo declara incondicionalmente: si ya existe, `schedule()` lo actualiza (upsert por nombre; `key` para varios schedules por cola).

```ts
// apps/worker/src/bootstrap.ts (fragmento) — el web arranca con { schedule: false }
await boss.schedule(sweeperTickJob.name, '* * * * *', {}, {})                        // T0.9: barrido de timeouts
await boss.schedule(metricsSyncJob.name, '0 6 * * *', {}, { tz: 'Europe/Madrid' })   // N11 (T7.1/T7.2)
await boss.schedule(retentionJob.name, '30 4 * * *', {}, { tz: 'Europe/Madrid' })    // T8.2: retención
```

Reglas: formato de **5 campos** (precisión de minuto; los schedules se evalúan cada ~30 s, el de 6 campos con segundos se malinterpreta); el handler del cron es un job normal (idempotente, DLQ, logging). El gate de T0.9 exige `expired` en <40 s: no lo fíes solo a la granularidad del cron — el sweep es una función (`sweepExpiredSteps(db)`) invocable directa (así la testea testing/orchestrator.md §8), ajusta `cronWorkerIntervalSeconds` si hace falta, y el poller lazy en read-path (T4.2) cubre el hueco para generations colgadas.

## 9. Graceful shutdown

SIGTERM/SIGINT (deploy, `docker compose down`) → dejar de aceptar → esperar a los activos → cerrar recursos → salir. `boss.stop()` ya hace las dos primeras: deja de hacer polling y espera a los handlers activos hasta `timeout`:

```ts
// apps/worker/src/bootstrap.ts (fragmento)
const SHUTDOWN_TIMEOUT_MS = 120_000 // ≥ p99 del job más largo aceptable de perder (render N8)

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutdown: dejando de aceptar jobs')
  await boss.stop({ graceful: true, timeout: SHUTDOWN_TIMEOUT_MS }) // espera activos; close: true cierra el pool propio de pg-boss
  await pool.end()                                                  // el pool de Drizzle es nuestro: lo cerramos nosotros
  process.exit(0)
}
process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))
```

El `timeout` es un compromiso, no una garantía: un render que lo supere quedará interrumpido y **re-entregado en el próximo arranque** — por eso los handlers largos son reanudables (§6: intención persistida + caché de normalizados = la re-entrega retoma, no repite). No subas el timeout para "no perder nada": súbelo hasta donde un deploy siga siendo tolerable y confía en la idempotencia para el resto. En Docker, asegúrate de que el worker recibe la señal (proceso PID 1 vía `tsx`/binario de tsup, o `init: true`) y de que `stop_grace_period` del compose supera tu `SHUTDOWN_TIMEOUT_MS`.

## 10. Qué NO va aquí

- **SQL del lock, transacciones Drizzle, `FOR UPDATE`/`skipLocked`, repos** → `references/db.md`.
- **La máquina de estados, `transition()`, puertos e invalidación** → `references/architecture.md` (aquí solo se consume).
- **El webhook de fal y las rutas que encolan** → `references/api.md` (regla: el route handler verifica/persiste/delega; la descarga del output SIEMPRE es un job del worker).
- **Logging y correlación (`job_id`, redact)** → `references/observability.md`.
- **Tests de todo lo anterior** → `.claude/skills/testing/references/orchestrator.md`. Regla de oro que gobierna esos tests y esta capa: **pg-boss no se mockea** — su semántica (re-entrega, retries, transaccionalidad del `send` con `{ db }`) ES lo que se está testeando; mockearla es testear el mock.
