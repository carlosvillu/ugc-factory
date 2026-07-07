# Testing del orquestador y del worker pg-boss

> Capa: `packages/core/src/orchestrator` (PRD §9.0) + consumers de `apps/worker`. Sirve las verificaciones de T0.6, T0.7a, T0.7b, T0.8, T0.9, T4.3 y T4.10 del planning.

**Contenido**: [Por qué máximo rigor](#por-qué-esta-capa-exige-el-máximo-rigor) · [Ubicación y setup](#ubicación-y-setup) · [Tabla de transiciones](#1-la-tabla-de-transiciones-legales-end-to-end-ilegales-por-muestra) · [Carreras](#2-carreras-select--for-update) · [NOTIFY](#3-assertions-de-notify) · [Encolado transaccional](#4-depends_on-y-encolado-transaccional-en-pg-boss) · [Retries](#5-pg-boss-retries-y-backoff-t06) · [Checkpoints](#6-checkpoints-approveeditreject-e-invalidación-con-supersedes_id-t08) · [skip/cancel](#7-skip-y-cancel) · [Timeouts y sweeper](#8-timeouts-y-cron-de-barrido-t09) · [Idempotencia](#9-idempotencia-de-executors-t43) · [Dedup](#10-deduplicación-por-content-hash-t410) · [Mapa tarea→suite](#11-mapa-tarea--suite--evidencia)

## Por qué esta capa exige el máximo rigor

El orquestador es **la única fuente de mutación de estado del DAG**: toda transición de `step_run.status` pasa por `transition(stepId, event, { db })`, que en UNA transacción actualiza el step, resuelve `depends_on`, encola en pg-boss y emite `NOTIFY pipeline_events` (PRD §9.0). Un bug aquí no rompe una feature: **corrompe todos los runs** — steps huérfanos que nunca salen de `awaiting_deps`, doble encolado que duplica gasto real en fal.ai, checkpoints que no pausan, invalidaciones que pierden el linaje de costes. Y sus garantías son propiedades de Postgres (`SELECT … FOR UPDATE`, atomicidad de transacción, NOTIFY-que-solo-dispara-en-COMMIT) que **no existen en ningún mock**. De ahí las tres reglas de esta capa:

1. **Cero mocks de BD.** Todo test de comportamiento corre contra Postgres 16 real vía Testcontainers (setup en `db-integration.md`). Un `transition()` unit-testeado con un fake de Drizzle prueba exactamente nada: el valor está en el lock, la transacción y el NOTIFY.
2. **Cero fake timers.** pg-boss hace polling con conexiones propias y el sweeper compara `timeout_at` contra el reloj de Postgres; `vi.useFakeTimers()` solo congela el proceso de test, no la BD ni el worker. Usa timeouts reales cortos (1–2 s) y un helper `waitFor(predicate, { timeoutMs })` por polling.
3. **Determinismo en los fallos.** El flag `fail_rate` de los executors de demo (T0.7b) sirve para los scripts de verificación manual; en tests automatizados usa `fail_times: N` (falla exactamente los N primeros intentos) — un test flaky en el módulo más crítico es peor que no tener test.

Lo único que SÍ se mockea es la frontera HTTP con fal.ai (msw + fixtures de `packages/test-utils/fixtures/http/`): el orquestador debe ser verificable sin gastar un céntimo.

## Ubicación y setup

```
packages/core/src/orchestrator/*.test.ts                 # unit: cartesiano exhaustivo sobre la función pura + cierre transitivo (unit-core.md)
packages/core/test/integration/orchestrator/*.test.ts    # transition, carreras, NOTIFY, encolado transaccional
apps/worker/test/integration/*.test.ts                   # consumers reales, retries, sweeper, idempotencia, dedup
```

Cada archivo de suite pide su database aislada (clonada de la template en milisegundos, sin interferencias entre suites paralelas):

```ts
import { beforeAll, afterAll } from 'vitest'
import { createTestDatabase, insertRun, insertStep } from '@ugc/test-utils'

let db: DrizzleDb, connectionString: string, close: () => Promise<void>
beforeAll(async () => ({ db, connectionString, close } = await createTestDatabase()))
afterAll(() => close())
```

Las filas de prueba se crean con las factories **insertadoras** `insertRun`/`insertStep` (async: insertan vía `makeX` + Drizzle y devuelven la fila con id); las `makeX` puras y síncronas quedan para unit (ver `stack-setup.md` §4.3).

## 1. La tabla de transiciones: legales end-to-end, ilegales por muestra

El reparto entre capas es explícito y no se duplica: el **producto cartesiano exhaustivo** estados × eventos es **unit** sobre la función pura de la tabla (`nextStatus`/`isLegalTransition`) en `packages/core` — milisegundos, ver `unit-core.md` §4. Esta capa de integración **NO repite el cartesiano**: cubre todas las transiciones LEGALES end-to-end contra Postgres real, una muestra representativa de ilegales verificando el rollback, y los efectos transaccionales que solo existen aquí (`SELECT … FOR UPDATE`, encolado en pg-boss en la misma tx, `NOTIFY`, `supersedes_id`).

La máquina de estados de §7.1 (`awaiting_deps|pending|queued|submitting|running|waiting_approval|succeeded|failed|rejected|skipped|cancelled|expired|superseded`) vive en el código como **dato** (una constante `TRANSITIONS`), pero el test **NO la importa**: duplica a mano la lista de transiciones legales copiada del PRD. Si el test derivara sus expectativas de la misma constante que valida, no probaría nada; así, cualquier cambio en la máquina de estados rompe el test a propósito y obliga a decidir conscientemente.

```ts
// packages/core/test/integration/orchestrator/transition-table.test.ts
import { describe, it, expect } from 'vitest'
import { createTestDatabase, insertRun, insertStep } from '@ugc/test-utils'
import { transition, IllegalTransitionError } from '@ugc/core/orchestrator'

// Copia MANUAL de PRD §7.1 — la lista definitiva de eventos la fija T0.7a;
// mantén este espejo 1:1 (junto al cartesiano unit de unit-core.md) en la
// misma sesión en que cambie la máquina.
const LEGAL: Array<[from: string, event: string, to: string]> = [
  ['awaiting_deps', 'deps_satisfied', 'pending'],
  ['pending', 'enqueue', 'queued'],
  ['queued', 'start', 'running'],
  ['running', 'succeed', 'succeeded'],
  ['running', 'fail', 'failed'],
  ['running', 'require_approval', 'waiting_approval'],
  ['running', 'expire', 'expired'],  // expired es TERMINAL (§7.1: solo failed tiene retry)
  ['failed', 'retry', 'queued'], // guard: retry_count < max_retries (test aparte)
  ['waiting_approval', 'approve', 'succeeded'],
  ['waiting_approval', 'edit', 'succeeded'],   // + invalidación aguas abajo (§6)
  ['waiting_approval', 'reject', 'rejected'],
  // ... completa con skip / cancel / supersede / submitting según T0.7a
]

describe('transition(): todas las transiciones legales, end-to-end', () => {
  for (const [from, event, to] of LEGAL) {
    it(`${from} --${event}--> ${to}`, async () => {
      const run = await insertRun(db)
      const step = await insertStep(db, { runId: run.id, status: from })
      await transition(step.id, { type: event }, { db })
      expect((await getStep(db, step.id)).status).toBe(to)
    })
  }
})

describe('transition(): muestra de ilegales — el rollback se verifica', () => {
  const ILLEGAL: Array<[from: string, event: string]> = [
    ['succeeded', 'start'],    // terminal no revive
    ['pending', 'approve'],    // approve fuera de waiting_approval
    ['expired', 'retry'],      // expired es terminal: sin retry
  ]
  for (const [from, event] of ILLEGAL) {
    it(`${from} --${event}--> ILEGAL: la BD queda intacta`, async () => {
      const run = await insertRun(db)
      const step = await insertStep(db, { runId: run.id, status: from })
      const before = await getStepRaw(db, step.id) // SELECT * completo, tal cual
      await expect(transition(step.id, { type: event }, { db }))
        .rejects.toThrow(IllegalTransitionError)
      expect(await getStepRaw(db, step.id)).toEqual(before) // ni updated_at cambia
    })
  }
})
```

**El rollback se verifica, no se supone.** Para cada ilegal de la muestra: (a) la fila queda *byte a byte* idéntica (compara el `SELECT *` completo, incluido `updated_at` — detecta el bug clásico de "validar después de escribir"); (b) no aparece ningún job nuevo en `pgboss.job` (cuenta antes/después); (c) un cliente con `LISTEN` no recibe nada (test representativo en §3). ~12 legales + la muestra ilegal: baratos porque comparten database y solo crean una fila por caso — la exhaustividad ya la garantiza el cartesiano unit.

Añade también los tests de guards con contexto: `failed --retry-->` con `retry_count >= max_retries` rechaza; `require_approval` solo procede si `is_checkpoint`. Y la derivación de `pipeline_run.status` (regla §7.1.e): un step en `waiting_approval` pone el run en `waiting_approval`; todos `succeeded` → run `succeeded`.

## 2. Carreras: SELECT … FOR UPDATE

El diseño que el test protege: `transition()` adquiere el lock **y revalida el estado leído bajo el lock** (no el leído antes). El perdedor de la carrera no debe aplicar su transición dos veces ni corromper nada: debe fallar limpio con `IllegalTransitionError` cuando, al desbloquearse, el estado ya no admite su evento. Este es exactamente el escenario real webhook-de-fal (web) vs consumer (worker) llegando a la vez.

```ts
it('dos transiciones concurrentes sobre el mismo step: una gana, la otra falla limpio', async () => {
  const step = await insertStep(db, { status: 'queued' })
  // Dos pools independientes: la serialización debe venir del FOR UPDATE,
  // no de compartir conexión.
  const dbA = createDb(connectionString), dbB = createDb(connectionString)
  const results = await Promise.allSettled([
    transition(step.id, { type: 'start' }, { db: dbA }),
    transition(step.id, { type: 'start' }, { db: dbB }),
  ])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  const [ko] = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
  expect(ko.reason).toBeInstanceOf(IllegalTransitionError)
  const final = await getStep(db, step.id)
  expect(final.status).toBe('running')     // exactamente UNA aplicación
  expect(final.started_at).not.toBeNull()  // y una sola marca temporal
})
```

**Estrés de T0.7b — 20 runs concurrentes sin interbloqueos**: crea 20 runs del DAG de demo (3 steps encadenados), arranca el consumer real y espera con `waitFor` (timeout global generoso, p. ej. 30 s) a que los 20 lleguen a `succeeded`. Un deadlock aflora como error de Postgres (`40P01`) o como timeout del test. La regla de diseño que este test vigila: cuando `transition()` bloquea varias filas (step + dependientes aguas abajo), **siempre en orden determinista por id** — el interbloqueo nace de órdenes de lock distintos en transacciones cruzadas.

## 3. Assertions de NOTIFY

`NOTIFY` solo se entrega en COMMIT: el mismo test prueba el evento SSE y la transaccionalidad. Usa un `pg.Client` **dedicado** (LISTEN fija la conexión; nunca el pool de la app):

```ts
import { Client } from 'pg'

it('toda transición legal emite NOTIFY pipeline_events con el run_id; las ilegales, silencio', async () => {
  const listener = new Client({ connectionString })
  await listener.connect()
  const payloads: string[] = []
  listener.on('notification', (n) => payloads.push(n.payload ?? ''))
  await listener.query('LISTEN pipeline_events')

  const run = await insertRun(db)
  const step = await insertStep(db, { runId: run.id, status: 'pending' })
  await transition(step.id, { type: 'enqueue' }, { db })
  await waitFor(() => payloads.includes(run.id))          // llega tras el COMMIT

  await expect(transition(step.id, { type: 'approve' }, { db })).rejects.toThrow()
  await sleep(300)                                        // ventana de gracia real
  expect(payloads).toHaveLength(1)                        // el rollback no notifica
  await listener.end()
})
```

Esto es además la base del contrato SSE (T0.10): el endpoint de eventos se testea aparte (E2E), pero la garantía "un NOTIFY por transición confirmada, cero por transición fallida" se cierra aquí.

## 4. depends_on y encolado transaccional en pg-boss

La propiedad crítica: **el job aparece en pg-boss en la misma transacción que la mutación de estado, o no aparece**. Si el encolado fuera post-commit, un crash entre ambos dejaría steps `queued` que nadie ejecuta jamás; si fuera pre-commit sin transacción compartida, un rollback dejaría jobs fantasma que ejecutan steps en estado inconsistente. pg-boss permite ejecutar el INSERT del job con tu propia transacción (revisa la opción de executor/`db` de tu versión; si no la expone, INSERT directo en `pgboss.job` — lo innegociable es la atomicidad, no el mecanismo):

```ts
it('rollback de la transición ⇒ el job NO existe en pg-boss', async () => {
  const step = await insertStep(db, { status: 'pending' })
  await db.transaction(async (tx) => {
    await enqueueStepJob(tx, step)      // mismo tx que la mutación de estado
    throw new Error('boom')             // simula fallo post-encolado, pre-commit
  }).catch(() => {})
  const [{ count }] = await rawSql(db, `SELECT count(*)::int AS count FROM pgboss.job WHERE name = 'step.execute'`)
  expect(count).toBe(0)
})
```

Y el camino feliz completo, con resolución de dependencias: DAG `a → b` (b en `awaiting_deps`); llevar `a` a `succeeded` debe, en una sola llamada a `transition()`, dejar `b` en `queued` Y su job visible en `pgboss.job` Y emitir el NOTIFY. Arranca después el consumer real y verifica que `b` se ejecuta — cierra el ciclo entero encolado→despacho.

## 5. pg-boss: retries y backoff (T0.6)

En `apps/worker/test/integration/`, con el boss real apuntando a la database del test: registra el executor `noop` de demo con `fail_times: 2` y `retryLimit: 3` (retryDelay corto, 1 s), encola 10 jobs y espera a que todos acaben `completed`. Asserts: la tabla de pg-boss muestra los reintentos (`retry_count = 2` en los que fallaron), ningún job en `failed`, y el executor fue invocado exactamente `10 + 2×fallidos` veces (cuenta con un spy propio, no confíes solo en logs). El porqué: los retries de pg-boss son la red de seguridad de TODO el pipeline de generación; si el backoff no funciona, cada glitch de fal.ai se convierte en un step muerto.

## 6. Checkpoints: approve/edit/reject e invalidación con supersedes_id (T0.8)

La regla de oro de §7.1.c: **la invalidación nunca resetea filas** — crea `step_run` nuevos con `supersedes_id` y marca los antiguos `superseded`, conservando histórico y linaje de costes. El test que la protege:

```ts
it('edit en checkpoint: la fila antigua queda superseded, NUNCA se resetea', async () => {
  // DAG: cp (checkpoint) → a → b; llevar el run hasta cp = waiting_approval
  // con a y b ya ejecutados en una pasada anterior (tienen outputs y coste).
  const oldA = await getStepRaw(db, aId)
  await orchestrator.edit(cp.id, { patch: editedArtifact }, { db })

  const afterA = await getStepRaw(db, aId)
  expect(afterA.status).toBe('superseded')
  expect(afterA.output_refs).toEqual(oldA.output_refs)   // histórico intacto
  expect(afterA.cost_actual).toEqual(oldA.cost_actual)   // linaje de coste intacto
  expect(afterA.retry_count).toEqual(oldA.retry_count)   // NADA se resetea

  const newA = await findStep(db, { runId, nodeKey: 'a', supersedesId: aId })
  expect(newA.status).toBe('queued')                     // fila NUEVA: deps (cp) satisfechas ⇒ queued + job en pg-boss (misma tx)
  const newB = await findStep(db, { runId, nodeKey: 'b', supersedesId: bId })
  expect(newB.status).toBe('awaiting_deps')              // cierre transitivo completo
})
```

Completa la matriz: `approve` → `succeeded` y el run continúa sin invalidar nada (el step dependiente con deps satisfechas queda `queued` con su job visible en pg-boss en la misma transacción — nunca `pending` + job, PRD §9.0); `reject` → `rejected` sin tocar aguas abajo; el diff artefacto-IA vs editado aparece en `audit_log` (query directa); `autopilot=true` no genera `waiting_approval` salvo en nodos con override "parar siempre aquí" (los dos flags combinados, T0.8). El cierre transitivo se unit-testea además en puro (grafo en memoria, sin BD): steps aguas *arriba* jamás se invalidan, diamantes (`a→b`, `a→c`, `b,c→d`) invalidan `d` una sola vez.

## 7. skip y cancel

- `skip` sobre un nodo skippable (p. ej. N2 sin imágenes): step → `skipped` y — clave — sus dependientes lo cuentan como dependencia satisfecha; el run completa. `skip` sobre un nodo no skippable rechaza.
- `cancel` de un run en curso: todos los steps no terminales pasan a `cancelled`, el run a `cancelled`, y los jobs pendientes de pg-boss del run quedan cancelados o se vuelven no-op (el consumer, al despertar, encuentra el step `cancelled` y NO ejecuta — assert con spy sobre el executor). Un step ya `succeeded` no se toca: cancelar no reescribe historia.

## 8. Timeouts y cron de barrido (T0.9)

Los executors de demo (`sleep_ms`, `fail_times`, `hang`) existen precisamente para esto. Timeouts reales cortos, sweeper invocado como función:

```ts
it('executor colgado + timeout_at corto ⇒ expired', async () => {
  const step = await insertStep(db, {
    nodeKey: 'demo.hang', input: { hang: true },
    timeoutAt: new Date(Date.now() + 1_000),   // 1 s real, no fake timers
  })
  await enqueueAndStartWorker()
  await waitFor(async () => (await getStep(db, step.id)).status === 'running')
  await waitFor(() => Date.now() > step.timeoutAt.getTime())
  await sweepExpiredSteps(db)                  // la función del cron, directa
  expect((await getStep(db, step.id)).status).toBe('expired')
})
```

Testea el sweep como función (rápido, determinista) y, aparte, que el **schedule queda registrado** en pg-boss al arrancar el worker (query a la tabla de schedules) — la granularidad de cron de pg-boss es de minutos y esperar al disparo real en un test unitario sería lento y flaky; el disparo real se observa en la verificación de gate de T0.9 ("expired en <40 s sin intervención"). El sweeper también reconcilia generations colgadas contra fal (polling fallback): con msw devolviendo `COMPLETED` para un request "olvidado", el sweep debe cerrar la generation y transicionar el step.

## 9. Idempotencia de executors (T4.3)

Patrón §6.3.9: la intención se persiste (`submitting`) ANTES del submit, y el `request_id` inmediatamente después; un executor re-entregado **reanuda el seguimiento, no re-submite**. Es la barrera contra el doble gasto:

```ts
// apps/worker/test/integration/executor-idempotency.test.ts
import { useHttpMocks, server } from '@ugc/test-utils'
useHttpMocks()                                 // handlers por defecto; server.use = override puntual
let submits = 0
server.use(
  http.post('https://queue.fal.run/*', () => {
    submits++
    return HttpResponse.json({ request_id: 'req_1', status_url: STATUS, response_url: RESP })
  }),
  http.get(STATUS, () => HttpResponse.json({ status: 'IN_PROGRESS' })),
)
await startWorker(boss1)
await waitFor(async () => (await getGeneration(db, step.id))?.status === 'submitted')
await boss1.stop(/* sin gracia: simula el crash del worker */)

server.use(http.get(STATUS, () => HttpResponse.json({ status: 'COMPLETED' })))
await startWorker(boss2)                       // pg-boss re-entrega el job
await waitFor(async () => (await getGeneration(db, step.id))?.status === 'completed')

expect(submits).toBe(1)                        // UN solo submit a fal
expect(await countGenerations(db, step.id)).toBe(1)  // UNA sola generation
```

La verificación de gate de T4.3 repite esto en el mundo real (matar el proceso del worker durante una generación real; el billing de fal muestra 1 solo job) — esa evidencia es manual/live y se persiste en `docs/verifications/T4.3/`; el test automatizado con msw es la regresión permanente.

## 10. Deduplicación por content-hash (T4.10)

La economía Hook×Body×CTA depende de que segmentos con `(resolved_prompt, model_profile_id, inputs)` idénticos se generen UNA vez. Test de integración en el worker, con msw contando submits por prompt:

```ts
it('lote hook-testing de 3 variantes del mismo ángulo: body y CTA una sola vez', async () => {
  // 3 variantes, mismo ángulo ⇒ el ScriptWriter garantiza body/CTA textualmente
  // idénticos (T2.4) ⇒ resolved_prompt idéntico ⇒ mismo content_hash
  await runGenerationSteps(batch)   // los 3 sub-DAGs de N7, consumer real + msw
  const gens = await listGenerations(db, { batchId })
  expect(gens).toHaveLength(3 + 1 + 1)          // hooks + body + CTA, no 3× todo
  const bodyAssets = await bodyAssetIdsPerVariant(db, batchId)
  expect(new Set(bodyAssets).size).toBe(1)       // las 3 variantes comparten el asset
})
```

Añade el caso negativo (un carácter distinto en el prompt ⇒ hash distinto ⇒ nueva generation) y el de carrera: dos steps que buscan el mismo hash a la vez no deben submitir dos veces — misma disciplina FOR UPDATE / unique constraint sobre `content_hash` + estado, verificada con dos consumers concurrentes.

## 11. Mapa tarea → suite → evidencia

Toda tarea del planning cierra con su verificación de gate (backend: script observable contra el sistema levantado; evidencia SIEMPRE en `docs/verifications/<TASK-ID>/report.md` antes de marcarla). Las suites de arriba son la regresión permanente de cada una:

| Tarea | Suite de regresión | Verificación de gate (evidencia) |
|---|---|---|
| T0.6 | §5 retries/backoff | Script encola 10 `noop` con fallos; query a pg-boss muestra `completed` |
| T0.7a | §1 legales + rollback (cartesiano: unit-core §4), §3 NOTIFY | Script de secuencia legal/ilegal contra BD real + `psql` con `LISTEN pipeline_events` |
| T0.7b | §2 carreras + 20 runs | Script de concurrencia: 20 runs completan, timestamps coherentes |
| T0.8 | §6 checkpoints, §7 skip/cancel | curl approve/edit/reject + queries de `supersedes_id` y `audit_log` |
| T0.9 | §8 sweeper | Executor `hang=true`, step `expired` en <40 s sin intervención |
| T4.3 | §9 idempotencia (msw) | Kill real del worker; billing de fal = 1 job (coste real anotado) |
| T4.10 | §10 dedup | Lote hook-testing real; nº de generations y ahorro visible en `/spend` |

Regla final: cuando toques la máquina de estados, el orden es (1) actualizar PRD §7.1, (2) actualizar `TRANSITIONS` en el código, (3) actualizar los espejos de los tests (el cartesiano unit de `unit-core.md` y el `LEGAL` de §1) — en la misma sesión. Si el cartesiano unit y las legales de §1 están en verde y los tests de carrera/atomicidad pasan contra Postgres real, el resto del sistema puede confiar ciegamente en el orquestador; esa confianza es el objetivo de esta capa.
