# Testing de API routes contra BD real

Cómo testear la superficie API interna de `apps/web` (Apéndice E del PRD) contra un Postgres real de Testcontainers. Aquí no hay mocks de BD: el orquestador (§9.0) vive de `SELECT … FOR UPDATE`, transacciones y `NOTIFY`, y las mutaciones de la API (`approve/edit/reject/retry/skip/cancel`) **son** esas transacciones — mockear la BD sería testear el mock. La mecánica del contenedor, el template database y `createTestDatabase()` están en `db-integration.md`; lo que se ve desde un navegador está en `e2e.md`.

## Tabla de contenidos

1. [Estrategia en dos niveles](#1-estrategia-en-dos-niveles)
2. [Nivel 1 — handler-level](#2-nivel-1--handler-level)
   - 2.1 Requisito de diseño: BD inyectable
   - 2.2 Helper `callRoute`
   - 2.3 Ejemplo: mutaciones del orquestador
   - 2.4 Errores tipados `{code, message, details}`
   - 2.5 Download proxificado (T0.5)
   - 2.6 Webhook de fal con firma ED25519 (T4.2)
3. [Nivel 2 — server-level](#3-nivel-2--server-level)
   - 3.1 Arranque del servidor real
   - 3.2 Auth, cookies httpOnly y rate limit (T0.4)
   - 3.3 Contrato SSE (T0.10)
4. [Qué NO se testea aquí](#4-qué-no-se-testea-aquí)

---

## 1. Estrategia en dos niveles

| | Nivel 1 · handler-level | Nivel 2 · server-level |
|---|---|---|
| Qué se ejecuta | El route handler exportado (`GET`/`POST` de `route.ts`), invocado en el proceso del test con `new Request()` | Un servidor Next real (`next start`) en otro proceso, atacado con `fetch` |
| BD | `createTestDatabase()` inyectada | `DATABASE_URL` del test database pasada al proceso del servidor |
| Middleware de Next | **NO se ejecuta** | Sí (auth completo, cookies, redirects) |
| msw | Funciona (mismo proceso): JWKS, Anthropic, fal | **No intercepta** (otro proceso) — evita endpoints que llamen fuera, o apunta el server a `startFakeExternalApis()` (`@ugc/test-utils/fake-apis`) vía env |
| Velocidad | ms por test | segundos de arranque por suite (+ `next build` previo) |
| Ubicación | `apps/web/test/integration/api/**/*.test.ts` | `apps/web/test/integration/server/**/*.test.ts` |

**El nivel 1 es el default.** Cubre CRUD (`POST /api/runs`, `GET/PATCH /api/briefs/:id`), todas las mutaciones del orquestador, el webhook de fal y el contrato del download. Es rápido, depurable y el fallo señala directamente al handler. Usa el nivel 2 **solo** para lo que el nivel 1 no puede reproducir con fidelidad: el middleware de auth completo, atributos reales de cookies httpOnly, el rate limit de login (T0.4) y el streaming SSE (T0.10) — donde el valor está precisamente en que la respuesta atraviese el runtime HTTP real de Next sin buffering.

Ambos niveles corren bajo `pnpm test:integration` (necesitan el testcontainer). Nada de esto gasta dinero: las APIs de pago van con msw + fixtures de `packages/test-utils/fixtures/http/`; el webhook usa claves generadas en el test.

## 2. Nivel 1 — handler-level

### 2.1 Requisito de diseño: BD inyectable

Importar `route.ts` ejecuta su module scope. Si el handler creara la conexión al importarse (leyendo env en top-level), el test no podría redirigirla al test database. Regla: **ninguna conexión en module scope**; los handlers obtienen la BD de un accessor lazy con override para tests.

```ts
// apps/web/src/server/db.ts
import { createDb, type Db } from '@ugc/db'

let override: Db | undefined
let fromEnv: Db | undefined

/** Solo para tests. En producción nunca se llama. */
export function setDbForTests(db: Db | undefined) { override = db }

export function getDb(): Db {
  if (override) return override
  fromEnv ??= createDb(process.env.DATABASE_URL!)
  return fromEnv
}
```

El mismo criterio aplica a cualquier dependencia de proceso (StorageAdapter con su directorio raíz por env, cliente pg-boss): lazy + override. El camino de producción no cambia (primera llamada crea desde env); el de test es explícito.

### 2.2 Helper `callRoute`

En App Router el handler recibe `(request, ctx)` donde `ctx.params` es asíncrono en las versiones actuales de Next. Centraliza esa forma en UN helper: si Next cambia la firma, se toca un solo fichero.

```ts
// apps/web/test/helpers/call-route.ts
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>

export async function callRoute(
  handler: Handler,
  path: string,
  { params = {}, json, ...init }: RequestInit & { params?: Record<string, string>; json?: unknown } = {},
): Promise<Response> {
  const req = new Request(`http://test.local${path}`, {
    ...init,
    ...(json !== undefined && {
      body: JSON.stringify(json),
      headers: { 'content-type': 'application/json', ...init.headers },
    }),
  })
  return handler(req, { params: Promise.resolve(params) })
}
```

`new Request()` estándar basta casi siempre (`NextRequest` lo extiende); si un handler usa helpers de cookies de `NextRequest`, construye un `NextRequest` en ese test concreto.

### 2.3 Ejemplo: mutaciones del orquestador

El patrón para `approve/edit/reject/retry/skip/cancel` es siempre el mismo: **sembrar el estado con factories → llamar al handler → assertar la respuesta Y las filas**. El contrato real de estas rutas es el efecto transaccional en la BD (§9.0), no el 200.

```ts
// apps/web/test/integration/api/steps-approve.test.ts
import { beforeAll, afterAll, expect, test } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { stepRun } from '@ugc/db/schema'
import { createTestDatabase, insertRun, insertStep } from '@ugc/test-utils'
import { setDbForTests } from '@/server/db'
import { POST as approve } from '@/app/api/steps/[id]/approve/route'
import { callRoute } from '../../helpers/call-route'
import { expectApiError } from '../../helpers/expect-api-error'

let ctx: Awaited<ReturnType<typeof createTestDatabase>>
beforeAll(async () => { ctx = await createTestDatabase(); setDbForTests(ctx.db) })
afterAll(async () => { setDbForTests(undefined); await ctx.close() })

const getStep = (id: string) =>
  ctx.db.select().from(stepRun).where(eq(stepRun.id, id)).then(r => r[0])

test('approve: waiting_approval → succeeded, desbloquea deps y encola en pg-boss', async () => {
  const run = await insertRun(ctx.db, { autopilot: false })
  const cp1 = await insertStep(ctx.db, { runId: run.id, nodeKey: 'N3', status: 'waiting_approval', isCheckpoint: true })
  const next = await insertStep(ctx.db, { runId: run.id, nodeKey: 'N4', status: 'awaiting_deps', dependsOn: [cp1.id] })

  const res = await callRoute(approve, `/api/steps/${cp1.id}/approve`, { method: 'POST', params: { id: cp1.id } })

  expect(res.status).toBe(200)
  expect((await getStep(cp1.id)).status).toBe('succeeded')
  expect((await getStep(next.id)).status).toBe('queued')
  // §9.0: el encolado ocurre en la MISMA transacción que la transición (queued ⇔ hay job).
  const jobs = await ctx.db.execute(sql`select 1 from pgboss.job where data->>'stepId' = ${next.id}`)
  expect(jobs.rows).toHaveLength(1)
})

test('approve sobre un step que no espera aprobación: 409 tipado sin tocar la BD', async () => {
  const run = await insertRun(ctx.db)
  const step = await insertStep(ctx.db, { runId: run.id, status: 'running' })
  const res = await callRoute(approve, `/api/steps/${step.id}/approve`, { method: 'POST', params: { id: step.id } })
  await expectApiError(res, 409, 'invalid_transition')
  expect((await getStep(step.id)).status).toBe('running')
})
```

Con el mismo molde: `edit` asserta la fila nueva con `supersedes_id` (la vieja pasa a `superseded`, **nunca** se resetea) y el diff en `audit_log`; `retry` asserta `retry_count` y el re-encolado; `cancel` los steps activos a `cancelled`. Que pg-boss tenga su schema en el test database es responsabilidad del template (ver `db-integration.md`).

### 2.4 Errores tipados `{code, message, details}`

El formato de error del Apéndice E es superficie de API: la UI hace `switch` sobre `code`. Asserta **status + code + presencia de message**, jamás el texto (el wording cambia sin ser breaking change).

```ts
// apps/web/test/helpers/expect-api-error.ts
import { expect } from 'vitest'

export async function expectApiError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status)
  const body = await res.json()
  expect(body).toMatchObject({ code, message: expect.any(String) })
  return body // para assertar details cuando aporte (p. ej. issues de Zod)
}
```

Mínimos por ruta nueva: body inválido → `400` `validation_error` con `details` derivado de Zod; recurso inexistente → `404` `not_found`; transición ilegal → `409` `invalid_transition`. Estos tres casos son baratos a nivel 1 y son exactamente lo que el canvas necesita para mostrar errores accionables (§8.2).

### 2.5 Download proxificado (T0.5)

El contrato: streaming byte-exacto (checksum), headers correctos y nunca exponer la ruta cruda de storage (§19.2).

```ts
import { createHash, randomBytes } from 'node:crypto'
import { GET as download } from '@/app/api/assets/[id]/download/route'

test('descarga con checksum idéntico al asset', async () => {
  const bytes = randomBytes(1024 * 1024)
  const asset = await seedAssetFile(ctx, { bytes })   // escribe vía StorageAdapter (dir temporal) + fila en asset

  const res = await callRoute(download, `/api/assets/${asset.id}/download`, { params: { id: asset.id } })

  expect(res.status).toBe(200)
  const body = Buffer.from(await res.arrayBuffer())
  expect(createHash('sha256').update(body).digest('hex')).toBe(asset.checksum)
  expect(res.headers.get('content-length')).toBe(String(asset.bytes))
})
```

El **401 sin sesión** depende de dónde viva el check: el middleware NO corre a nivel 1. Recomendado (defensa en profundidad, §19.2): el handler valida sesión él mismo con un `requireSession(req)` que lee la cookie del `Request` — entonces el 401 se testea a nivel 1 pasando (o no) el header `cookie`. El paso por el middleware real se cubre una vez, a nivel 2 (§3.2); no dupliques cada caso en ambos niveles.

### 2.6 Webhook de fal con firma ED25519 (T4.2)

No necesitas fal para testear el verificador: genera un par de claves de test y sirve su JWKS con msw. Regla de oro: el test **firma con el mismo builder de mensaje que usa el verificador de producción** (`@ugc/core`) — no reimplementes el layout del mensaje en el test o acabarás validando dos implementaciones distintas. Que el layout coincida con el de fal real lo demuestra la verificación CUA de T4.2 (webhook real en el VPS), no esta suite.

```ts
// packages/test-utils/src/fal-webhook.ts
import { generateKeyPairSync, sign } from 'node:crypto'
import { buildFalWebhookMessage } from '@ugc/core/generation' // el MISMO que usa el verificador (vive en el módulo generation)

export function makeFalKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { privateKey, jwk: publicKey.export({ format: 'jwk' }) } // { kty: 'OKP', crv: 'Ed25519', x }
}

export function signFalWebhook(privateKey: any, p: { requestId: string; userId: string; timestamp: number; body: string }) {
  const message = buildFalWebhookMessage(p)
  return {
    'x-fal-webhook-request-id': p.requestId,
    'x-fal-webhook-user-id': p.userId,
    'x-fal-webhook-timestamp': String(p.timestamp),
    'x-fal-webhook-signature': sign(null, message, privateKey).toString('hex'),
  }
}
```

```ts
// apps/web/test/integration/api/webhook-fal.test.ts
import { http, HttpResponse } from 'msw'
import { useHttpMocks, makeFalKeypair, signFalWebhook, insertGeneration } from '@ugc/test-utils'
import { POST as falWebhook } from '@/app/api/webhooks/fal/route'

const { privateKey, jwk } = makeFalKeypair()
const forged = makeFalKeypair() // otra clave: firma criptográficamente válida pero NO en el JWKS
// useHttpMocks registra beforeAll/afterEach/afterAll y falla ante peticiones no manejadas;
// el override sirve el JWKS con la clave generada en ESTE test.
useHttpMocks(
  http.get('https://rest.fal.ai/.well-known/jwks.json', () => HttpResponse.json({ keys: [jwk] })),
)

function post(body: string, headers: Record<string, string>) {
  return callRoute(falWebhook, '/api/webhooks/fal', { method: 'POST', body, headers })
}

test('firma válida: persiste el evento, delega en el orquestador y encola la descarga', async () => {
  const gen = await insertGeneration(ctx.db, { status: 'in_progress' }) // fija fal_request_id
  const body = JSON.stringify({ request_id: gen.falRequestId, status: 'OK', payload: { video: { url: 'https://fal.media/x.mp4' } } })
  const res = await post(body, signFalWebhook(privateKey, { requestId: gen.falRequestId, userId: 'u', timestamp: nowSec(), body }))
  expect(res.status).toBe(200)
  expect((await getGeneration(gen.id)).status).toBe('completed')
  // La descarga del output es un job del worker (§9.6), NUNCA se hace en el handler:
  expect(await countJobs(ctx.db, 'download-output', gen.id)).toBe(1)
})

test('firma forjada: 401 y la BD queda intacta', async () => {
  const gen = await insertGeneration(ctx.db, { status: 'in_progress' })
  const body = JSON.stringify({ request_id: gen.falRequestId, status: 'OK' })
  const before = await snapshotCounts(ctx.db) // filas de generation + pgboss.job
  const res = await post(body, signFalWebhook(forged.privateKey, { requestId: gen.falRequestId, userId: 'u', timestamp: nowSec(), body }))
  await expectApiError(res, 401, 'invalid_signature')
  expect(await snapshotCounts(ctx.db)).toEqual(before)
  expect((await getGeneration(gen.id)).status).toBe('in_progress')
})

test('replay del mismo request_id: idempotente, no duplica nada', async () => {
  // ...misma petición válida dos veces → 200 ambas; countJobs sigue en 1;
  // generation.fal_request_id UNIQUE (§12) es la red de seguridad, el handler el primer filtro.
})

test('timestamp fuera de ±5 min: rechazado sin tocar la BD', async () => {
  // ...firma VÁLIDA pero timestamp = nowSec() - 360 → 401 typed; counts intactos.
  // fal reintenta 10 veces en 2 h: el rechazo debe ser determinista, no dependiente de estado.
})
```

Extra que merece un test: la **caché del JWKS ≤24 h** — un contador en el handler de msw debe registrar 1 sola petición tras N webhooks.

## 3. Nivel 2 — server-level

### 3.1 Arranque del servidor real

Un servidor por suite (fichero de test), con su propio database del template: aislamiento total y compatible con la paralelización de Vitest. Requiere `next build` previo (el script `test:integration` de `apps/web` lo garantiza; en CI se construye una vez). Mantén POCAS suites de nivel 2 — es la razón de que el nivel 1 sea el default.

```ts
// apps/web/test/helpers/server.ts
import { spawn } from 'node:child_process'

export async function startWebServer(env: Record<string, string>) {
  const port = 3100 + Math.floor(Math.random() * 500)
  const proc = spawn('pnpm', ['--filter', '@ugc/web', 'exec', 'next', 'start', '-p', String(port)], {
    env: { ...process.env, SSE_HEARTBEAT_MS: '250', ...env }, // intervalos inyectables por env (ver 3.3)
    stdio: 'pipe',
  })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/api/health`)).ok, { timeoutMs: 30_000 })
  return { baseUrl: `http://127.0.0.1:${port}`, stop: () => proc.kill('SIGTERM') }
}
```

```ts
const ctx = await createTestDatabase()
const server = await startWebServer({ DATABASE_URL: ctx.connectionString })
// El test siembra y muta por ctx.db; el servidor ve los mismos datos: es el MISMO Postgres.
```

### 3.2 Auth, cookies httpOnly y rate limit (T0.4)

```ts
test('API sin sesión → 401; login deja cookie httpOnly que abre el paso', async () => {
  expect((await fetch(`${server.baseUrl}/api/runs`, { method: 'POST' })).status).toBe(401)

  const res = await fetch(`${server.baseUrl}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  })
  const setCookie = res.headers.get('set-cookie')!
  expect(setCookie).toMatch(/httponly/i) // el atributo se asserta parseando el header:
  // que el navegador lo respete no es nuestro test (eso es E2E)

  const cookie = setCookie.split(';')[0]
  expect((await fetch(`${server.baseUrl}/api/runs/${runId}`, { headers: { cookie } })).status).toBe(200)
})

test('rate limit de login: N fallos → 429 tipado', async () => {
  let last: Response
  for (let i = 0; i < 6; i++) last = await postLogin(server.baseUrl, 'wrong-password')
  await expectApiError(last!, 429, 'rate_limited')
})
```

El estado del rate limiter vive en el proceso del servidor: por eso cada suite arranca servidor propio (sin orden entre tests que se contaminan). El redirect a `/login` de las páginas HTML y el flujo visual de login pertenecen a `e2e.md`.

### 3.3 Contrato SSE (T0.10)

Se testea con `fetch` streaming + `AbortController` — no con `EventSource` (en Node no permite header `cookie` y su auto-reconexión esconde justo lo que queremos assertar). Dos reglas de diseño que este test impone al producto: (a) el **intervalo de heartbeat es inyectable por env** (`SSE_HEARTBEAT_MS`) — no hay fake timers a través de procesos y esperar 25 s reales es inaceptable; (b) el delta se provoca con una **transición real** vía el orquestador de `@ugc/core` contra el mismo Postgres — así el test cubre el camino completo `transition → NOTIFY → LISTEN → frame SSE` cruzando procesos.

```ts
// apps/web/test/helpers/sse.ts
export type SseEvent = { id?: string; event: string; data: any }

export async function collectSse(url: string, opts: {
  headers?: Record<string, string>
  onEvent?: (e: SseEvent) => void
  until: (events: SseEvent[]) => boolean
  timeoutMs?: number
}): Promise<SseEvent[]> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10_000)
  const events: SseEvent[] = []
  try {
    const res = await fetch(url, { headers: { accept: 'text/event-stream', ...opts.headers }, signal: ac.signal })
    if (!res.headers.get('content-type')?.includes('text/event-stream')) throw new Error('no es un stream SSE')
    const decoder = new TextDecoder()
    let buf = ''
    for await (const chunk of res.body! as any) {
      buf += decoder.decode(chunk, { stream: true })
      let sep: number
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const ev = parseSseFrame(buf.slice(0, sep)) // líneas id:/event:/data: → JSON.parse(data)
        buf = buf.slice(sep + 2)
        events.push(ev); opts.onEvent?.(ev)
      }
      if (opts.until(events)) { ac.abort(); break }
    }
  } catch (err) { if (!ac.signal.aborted) throw err } // el abort propio no es un fallo
  finally { clearTimeout(timer) }
  return events
}
```

```ts
// apps/web/test/integration/server/sse-contract.test.ts
import { transition } from '@ugc/core/orchestrator'

test('snapshot al conectar → delta por transición real → heartbeat → reconexión con Last-Event-ID', async () => {
  const { run, steps } = await seedDemoRun(ctx.db) // 3 steps en queued (start es legal desde queued)
  const url = `${server.baseUrl}/api/runs/${run.id}/events`

  // Conectar; disparar la transición SOLO tras recibir el snapshot (evita la carrera conexión/NOTIFY)
  const events = await collectSse(url, {
    headers: { cookie },
    onEvent: e => { if (e.event === 'snapshot') void transition(steps[0].id, { type: 'start' }, { db: ctx.db }) },
    until: evs => evs.some(e => e.event === 'step_changed') && evs.some(e => e.event === 'heartbeat'),
  })

  expect(events[0].event).toBe('snapshot')                    // SIEMPRE lo primero al conectar
  expect(events[0].data.steps).toHaveLength(3)
  const delta = events.find(e => e.event === 'step_changed')!
  expect(delta.data).toMatchObject({ stepId: steps[0].id, status: 'running' })
  const ids = events.map(e => Number(e.id))
  expect([...ids].sort((a, b) => a - b)).toEqual(ids)         // id: monotónico (contrato §9.0)

  // Reconexión: Last-Event-ID → re-snapshot que refleja el estado ACTUAL (no repite deltas perdidos)
  const again = await collectSse(url, {
    headers: { cookie, 'last-event-id': String(ids.at(-1)) },
    until: evs => evs.length >= 1,
  })
  expect(again[0].event).toBe('snapshot')
  expect(again[0].data.steps.find((s: any) => s.id === steps[0].id).status).toBe('running')
})
```

El heartbeat se asserta implícitamente en el `until` (con `SSE_HEARTBEAT_MS=250` llega en <1 s). Si el stream se cuelga sin heartbeats, el `timeoutMs` del helper falla el test: eso ES el bug que el heartbeat existe para detectar.

## 4. Qué NO se testea aquí

- **Todo lo que implica un navegador** → `e2e.md` (Playwright en `apps/web/e2e/`): canvas cambiando de color en vivo, botones de checkpoint, redirect visual a login, que el navegador respete `httpOnly`, la auto-reconexión de `EventSource`, descargas por click.
- **SSE a través de Caddy** (`flush_interval -1`, T0.13): solo observable en despliegue real; se cubre en el gate CUA de la tarea con evidencia en `docs/verifications/<TASK-ID>/`.
- **Que fal firme como asumimos**: la suite valida nuestro verificador contra nuestro builder; el emparejamiento con el mundo real lo prueba la verificación de T4.2 (webhook real en el VPS) y, si hiciera falta repetirlo, un `*.live.test.ts` opt-in.
- **UI de las páginas** que consumen estas APIs: aquí solo el contrato HTTP; la integración visual es de `e2e.md`.
