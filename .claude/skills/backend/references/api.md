# API de `apps/web` — route handlers, SSE, webhooks y auth

Cómo se escribe la capa API interna de UGC Factory. La superficie (rutas, verbos, semántica) es el **Apéndice E del PRD** — este documento no la redefine, define CÓMO se implementa cada handler. Sus tests los gobierna `testing/references/api.md` (handler-level con `callRoute` + `setDbForTests`, server-level para auth/SSE): todo patrón de aquí existe para que ese harness funcione sin fricción.

## Tabla de contenidos

1. [Handler fino y HOFs componibles](#1-handler-fino-y-hofs-componibles)
2. [Envelope de errores](#2-envelope-de-errores)
3. [Accessors lazy y composition root](#3-accessors-lazy-y-composition-root)
4. [SSE: `GET /api/runs/:id/events`](#4-sse-get-apirunsidevents)
5. [Webhook de fal](#5-webhook-de-fal)
6. [Auth single-user](#6-auth-single-user)
7. [Download proxificado](#7-download-proxificado)
8. [Qué NO va aquí](#8-qué-no-va-aquí)

---

## 1. Handler fino y HOFs componibles

Un route handler hace exactamente cuatro cosas: **parsear → validar → delegar en core → serializar**. Si un `route.ts` contiene lógica de negocio (decidir transiciones, calcular costes, componer prompts), esa lógica está en el paquete equivocado: muévela a `@ugc/core` — es lo que permite testearla como unit puro y reutilizarla desde el worker.

La repetición (leer JSON, `safeParse`, mapear errores, exigir sesión) se factoriza en dos HOFs componibles en `apps/web/src/server/`. **`JSON.parse`/`schema.parse` a pelo sobre la ENTRADA (body/params) está prohibido**: siempre `safeParse` vía `withRoute`, porque un body malformado es un 400 tipado, no un 500 con stack trace. La **salida** sí se serializa con `Schema.parse` (un fallo ahí es drift servidor↔contrato — bug nuestro): envuélvelo si quieres distinguirlo, pero que acabe en el 500 opaco es correcto; lo que NUNCA debe pasar es que un parse de salida se disfrace de `validation_error` 400.

```ts
// apps/web/src/server/with-route.ts
import { z } from 'zod'
import { AppError } from '@ugc/core/contracts'
import { toErrorResponse } from './errors'

type Ctx = { params: Promise<Record<string, string>> } // params asíncrono en Next 16

export function withRoute<B = undefined, P = Record<string, string>>(
  handler: (input: { req: Request; body: B; params: P }) => Promise<Response>,
  schemas: { body?: z.ZodType<B>; params?: z.ZodType<P> } = {},
) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      const raw = await ctx.params
      const params = (schemas.params ? parseOrThrow(schemas.params, raw) : raw) as P
      const body = (schemas.body ? parseOrThrow(schemas.body, await readJson(req)) : undefined) as B
      return await handler({ req, body, params })
    } catch (err) {
      return toErrorResponse(err) // TODO error sale por aquí: envelope único, nunca un throw sin formato
    }
  }
}

// export: también lo usa el webhook de fal (§5), que no pasa por withRoute
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value)
  if (!r.success) throw new AppError('validation_error', 'payload inválido', z.flattenError(r.error))
  return r.data
}

async function readJson(req: Request): Promise<unknown> {
  try { return await req.json() } catch { throw new AppError('validation_error', 'el body no es JSON') }
}
```

```ts
// apps/web/src/server/with-auth.ts — defensa en profundidad: el handler se protege a sí mismo
// aunque proxy.ts proteja las páginas (§6). Así el 401 es testeable a nivel handler (testing §2.5).
import { AppError } from '@ugc/core/contracts'
import { requireSession } from './session'
import { toErrorResponse } from './errors'

export function withAuth<A extends unknown[]>(handler: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    if (!requireSession(req)) return toErrorResponse(new AppError('unauthorized', 'sesión requerida'))
    return handler(req, ...rest)
  }
}
```

Composición canónica — auth por fuera (un 401 no debe ni parsear el body):

```ts
// apps/web/src/app/api/steps/[id]/approve/route.ts
import { z } from 'zod'
import { StepRunSchema } from '@ugc/core/contracts'
import { withAuth, withRoute, getContext } from '@/server'

export const POST = withAuth(withRoute(async ({ params }) => {
  const { orchestrator } = getContext()
  const step = await orchestrator.transition(params.id, { type: 'approve' }) // §9.0: transición transaccional
  return Response.json(StepRunSchema.parse(step)) // serializar = contrato Zod de core, el mismo que valida api-client
}, { params: z.object({ id: UlidSchema }) })) // los PKs son ULIDs (db.md §1) — z.uuid() los rechazaría
```

La respuesta siempre se serializa con el schema de `@ugc/core` que el `api-client` del frontend usa para validar: un drift entre lo que devuelve el handler y el contrato revienta en test, no en producción.

## 2. Envelope de errores

El formato `{code, message, details?}` del Apéndice E es contrato Zod en core — el frontend hace `switch` sobre `code` y `expectApiError` (testing §2.4) asserta `status + code`; el wording de `message` **nunca** es contrato.

```ts
// packages/core/src/contracts/errors.ts
import { z } from 'zod'

export const ErrorCodeSchema = z.enum(APP_ERROR_CODES)
// La unión canónica (APP_ERROR_CODES) vive junto a AppError en architecture.md §5:
// validation_error · unauthorized · invalid_signature · not_found · invalid_transition ·
// guardrail_blocked · rate_limited · provider_error · internal.
// Unión cerrada: añadir un código es una decisión de contrato, no un string ad hoc.

export const ErrorEnvelopeSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),   // p. ej. z.flattenError() en validation_error
  request_id: z.string().optional(), // correlación: el mismo id que aparece en los logs pino
})
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>
```

| `code` | HTTP | Cuándo |
|---|---|---|
| `validation_error` | 400 | body/params que no pasan `safeParse`; `details` = `z.flattenError` |
| `unauthorized` | 401 | sin sesión o cookie inválida |
| `invalid_signature` | 401 | webhook con firma/cabeceras/timestamp inválidos |
| `not_found` | 404 | run/step/asset/brief inexistente |
| `invalid_transition` | 409 | mutación ilegal para el estado actual (§7.1) — la BD queda intacta |
| `guardrail_blocked` | 422 | guardrail de negocio: linter FTC bloquea el guion, slot irresoluble |
| `rate_limited` | 429 | rate limit del login |
| `internal` | 500 | cualquier error no tipado — mensaje **opaco**, el detalle va al log |
| `provider_error` | 502 | fal/Anthropic/Firecrawl falló de forma no recuperable u output fuera de contrato |

La tabla vive en core como `STATUS_BY_CODE` y `AppError` deriva su `status` de ella (detalle de `AppError` en `references/architecture.md`). El mapeo a `Response` está en UN sitio:

```ts
// apps/web/src/server/errors.ts
import { ZodError, z } from 'zod'
import { AppError, type ErrorEnvelope } from '@ugc/core/contracts'
import { getRequestId, getRequestLogger } from './request-context' // AsyncLocalStorage — ver observability.md

export function toErrorResponse(err: unknown): Response {
  const request_id = getRequestId() // del header entrante o randomUUID; viaja en logs Y en el envelope
  if (err instanceof AppError) {
    return Response.json(
      { code: err.code, message: err.message, details: err.details, request_id } satisfies ErrorEnvelope,
      { status: err.status },
    )
  }
  if (err instanceof ZodError) {
    // La entrada ya llega convertida a AppError por withRoute (parseOrThrow): un ZodError crudo
    // aquí es drift de SALIDA o de datos internos — bug nuestro, no culpa del cliente. 500 opaco.
    getRequestLogger().error({ err, request_id }, 'zod_contract_drift')
    return Response.json(
      { code: 'internal', message: 'error interno', request_id } satisfies ErrorEnvelope,
      { status: 500 },
    )
  }
  getRequestLogger().error({ err, request_id }, 'unhandled_route_error') // clave err: serializer de pino
  return Response.json( // 500 SIEMPRE opaco: el mensaje interno puede contener rutas, SQL o keys
    { code: 'internal', message: 'error interno', request_id } satisfies ErrorEnvelope,
    { status: 500 },
  )
}
```

## 3. Accessors lazy y composition root

Contrato con testing §2.1: importar un módulo **jamás** abre una conexión ni lee env — si `route.ts` conectara en module scope, el test no podría redirigirla al test database. **El snippet canónico de `apps/web/src/server/db.ts` (`getDb()`/`setDbForTests()`) vive en `testing/references/api.md` §2.1 — cópialo de ahí tal cual, no lo "mejores": los tests dependen de esa forma exacta.** Lo que este documento añade es la regla de extensión — mismo molde, mismo nombre de par (`getX`/`setXForTests`), para **toda** dependencia de proceso:

```ts
// apps/web/src/server/storage.ts — mismo molde; boss.ts (getBoss/setBossForTests) es idéntico
let override: StorageAdapter | undefined
let fromEnv: StorageAdapter | undefined
export function setStorageForTests(s: StorageAdapter | undefined) { override = s }
export function getStorage(): StorageAdapter {
  return override ?? (fromEnv ??= makeFsStorageAdapter({ root: process.env.ASSETS_ROOT ?? '/data/assets' }))
}
```

`apps/web/src/server/context.ts` es el **composition root** de web: cablea los servicios de core con los adaptadores de db. Se construye **en cada llamada** sobre los accessors — los factories de core son objetos con closures, baratos; memoizar instancias capturaría la BD y rompería `setDbForTests`:

```ts
// apps/web/src/server/context.ts — el wiring canónico está en architecture.md §6; aquí el esqueleto
import { makeOrchestrator } from '@ugc/core/orchestrator'
import { makeGenerationService } from '@ugc/core/generation'
import { makeWithTransaction, makeGenerationRepo } from '@ugc/db'

export function getContext() {
  const deps = { logger: getRequestLogger(), clock: systemClock }
  const orchestrator = makeOrchestrator({ withTransaction: makeWithTransaction(getDb(), getBoss()), ...deps })
  return { orchestrator, generation: makeGenerationService({ repo: makeGenerationRepo(getDb()), orchestrator, ...deps }) }
}
```

## 4. SSE: `GET /api/runs/:id/events`

Contrato de §9.0 (T0.10): `snapshot` al conectar → deltas `step_changed{stepId, status, cost, outputExcerpt}` → `heartbeat`; `id:` monotónico; `Last-Event-ID` ⇒ **re-snapshot** (nunca replay de deltas — el estado actual es la verdad, no la historia). Los tipos de evento son un discriminated union Zod en core (`RunEventSchema`), el mismo que consume el hook del frontend.

```ts
// apps/web/src/app/api/runs/[id]/events/route.ts
import { Client } from 'pg'
import { withAuth } from '@/server/with-auth'
import { getDb } from '@/server/db'

export const runtime = 'nodejs'          // streaming + pg: jamás edge
export const dynamic = 'force-dynamic'   // ruta dinámica: la respuesta es un stream vivo, sin caché

export const GET = withAuth(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id: runId } = await ctx.params
  const db = getDb()
  const heartbeatMs = Number(process.env.SSE_HEARTBEAT_MS ?? 25_000) // inyectable por env: el test server-level usa 250 (testing §3.3)
  let eventId = Number(req.headers.get('last-event-id') ?? 0) // seed desde Last-Event-ID: ids monotónicos entre reconexiones

  const encoder = new TextEncoder()
  // Conexión pg DEDICADA (connectionString): una conexión en LISTEN no sirve para queries y el pool no debe prestarla
  const listener = new Client({ connectionString: process.env.DATABASE_URL })
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`id: ${++eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      const close = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        void listener.end()      // sin esto, cada reconexión filtra una conexión pg hasta agotar Postgres
        controller.close()
      }
      req.signal.addEventListener('abort', close, { once: true }) // Next dispara abort al desconectar el cliente

      // 1) LISTEN ANTES del snapshot: ninguna transición entre la foto y la suscripción se pierde
      await listener.connect()
      listener.on('notification', (msg) => {
        if (msg.payload !== runId) return
        // El NOTIFY solo transporta run_id (§9.0): la verdad se RELEE de las tablas, nunca viaja en el payload
        void readChangedSteps(db, runId).then((deltas) => { for (const d of deltas) send('step_changed', d) })
      })
      await listener.query('LISTEN pipeline_events')

      // 2) snapshot SIEMPRE primero — también con Last-Event-ID (re-snapshot con el estado ACTUAL)
      send('snapshot', await readRunSnapshot(db, runId))

      // 3) heartbeat: mantiene vivo el paso por proxies y permite al cliente detectar streams zombis
      heartbeat = setInterval(() => send('heartbeat', { ts: Date.now() }), heartbeatMs)
    },
    cancel() { closed = true; clearInterval(heartbeat); void listener.end() }, // red de seguridad del runtime
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform', // no-transform: que ningún intermediario comprima/bufferice
      'x-accel-buffering': 'no',
    },
  })
})
```

En producción el stream atraviesa Caddy: la ruta SSE necesita `flush_interval -1` en el `reverse_proxy` (T0.13) o los eventos llegan en ráfagas bufferizadas. Eso solo es observable desplegado — lo cubre el gate CUA de T0.13, no la suite (testing §4).

## 5. Webhook de fal

`POST /api/webhooks/fal` (T4.2, §9.6). No lleva `withAuth`: su autenticación ES la firma ED25519. Reglas duras:

1. **Verificar antes de tocar nada**: cabeceras `x-fal-webhook-{request-id,user-id,timestamp,signature}` completas, timestamp dentro de ±5 min (fal reintenta 10 veces en 2 h: el rechazo debe ser determinista), firma ED25519 válida contra el JWKS de `https://rest.fal.ai/.well-known/jwks.json` **cacheado ≤24 h** en memoria (accessor con TTL, inyectable en tests — testing §2.6 asserta 1 fetch para N webhooks).
2. **El handler SOLO persiste el evento y delega en el orquestador** (idempotencia por `request_id`: releer estado + `UNIQUE fal_request_id` como red). La transición es `transition()` de §9.0, transaccional.
3. **La descarga del output SIEMPRE se encola como job del worker** (`download-output`). Un vídeo puede pesar cientos de MB y fal corta la entrega a los 15 s: descargar en el route handler garantiza timeouts y reentregas duplicadas.
4. El **builder del mensaje firmado vive en core** y lo comparten verificador y tests (testing §2.6) — dos implementaciones del layout es la receta para validar una y romper la otra. Que el layout coincida con fal real lo demuestra la verificación CUA de T4.2, no la suite.

```ts
// packages/core/src/generation/fal-webhook.ts
import { createHash } from 'node:crypto'

/** Layout documentado por fal: los 4 campos unidos por \n, con sha256(body) en hex. */
export function buildFalWebhookMessage(p: { requestId: string; userId: string; timestamp: string; body: string }): Buffer {
  const bodyHash = createHash('sha256').update(p.body, 'utf8').digest('hex')
  return Buffer.from([p.requestId, p.userId, p.timestamp, bodyHash].join('\n'), 'utf8')
}
```

```ts
// apps/web/src/app/api/webhooks/fal/route.ts
export const runtime = 'nodejs'

export const POST = async (req: Request): Promise<Response> => {
  try {
    const body = await req.text() // texto CRUDO: la firma cubre los bytes exactos, no un JSON re-serializado
    const headers = FalWebhookHeadersSchema.safeParse(Object.fromEntries(req.headers))
    if (!headers.success) throw new AppError('invalid_signature', 'cabeceras de webhook incompletas')

    const valid = await verifyFalWebhook({ ...headers.data, body }, { getJwks: getFalJwks, now: Date.now })
    if (!valid) throw new AppError('invalid_signature', 'firma o timestamp inválidos') // 401 sin tocar la BD

    let json: unknown
    try { json = JSON.parse(body) } catch { throw new AppError('validation_error', 'el body no es JSON') } // misma regla que readJson (§1)
    const event = parseOrThrow(FalWebhookPayloadSchema, json)
    await getContext().generation.handleWebhookEvent(event) // idempotente: persiste + transition() + encola download-output
    return Response.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

## 6. Auth single-user

T0.4. Piezas:

- **Password**: hash scrypt (`node:crypto`, cero dependencias) guardado en `app_setting` (`auth.password_hash`), sembrado desde env solo en el primer arranque (patrón bootstrap de §19.2). Comparación con `timingSafeEqual` — la comparación de strings filtra timing.
- **Sesión**: cookie `ugc_session` con `HttpOnly; Secure; SameSite=Lax; Path=/` y valor `exp.hmac` firmado con clave derivada de `APP_MASTER_KEY` (la ÚNICA credencial en env, §19.2). Stateless: sobrevive a reinicios del contenedor sin tabla de sesiones — single-user no necesita revocación por sesión.
- **`requireSession(req)`** lee la cookie **del propio `Request`** (no de `cookies()` de next/headers): así el 401 es testeable a nivel handler pasando o no el header `cookie` (testing §2.5).
- **Rate limit de login**: contador en memoria por IP con ventana deslizante → `AppError('rate_limited')` 429. En memoria del proceso es suficiente (single-user, un solo proceso web) y es exactamente lo que asume el test server-level (testing §3.2).
- **`proxy.ts`** (Next 16 — sustituye a `middleware.ts`) protege las **páginas**: sin cookie válida → redirect a `/login`. Hace solo el check barato (presencia + expiración de la cookie); la verificación criptográfica completa la hace `requireSession` en cada handler — por eso `withAuth` no es opcional: es la barrera real de la API, el proxy es UX.
- **Excepciones** (allowlist, nunca denylist): `/login` + `POST /api/login`, `/api/health` (monitores), `/api/webhooks/*` (su auth es la firma, §5).

```ts
// apps/web/src/server/session.ts (esqueleto; createSessionCookie emite el mismo formato exp.hmac)
import { createHmac, timingSafeEqual } from 'node:crypto'

const COOKIE = 'ugc_session'

export function requireSession(req: Request): boolean {
  const value = parseCookieHeader(req.headers.get('cookie'))[COOKIE]
  if (!value) return false
  const [exp, sig] = value.split('.')
  if (!exp || !sig || Number(exp) < Date.now()) return false
  const expected = createHmac('sha256', sessionKey()).update(exp).digest()
  const given = Buffer.from(sig, 'base64url')
  return given.length === expected.length && timingSafeEqual(given, expected)
}
```

## 7. Download proxificado

`GET /api/assets/:id/download` (T0.5, §19.2): la ÚNICA vía de salida de un asset. Nunca se expone `storage_key` ni una ruta bajo `/data/assets` — las URLs con semántica (`/api/assets/:id/download`) permiten auth, auditoría y migrar el storage a S3/R2 sin romper nada (patrón Prizmad).

```ts
// apps/web/src/app/api/assets/[id]/download/route.ts
export const GET = withAuth(withRoute(async ({ params }) => {
  const asset = await getAssetRepo(getDb()).byId(params.id)
  if (!asset) throw new AppError('not_found', 'asset inexistente')

  const stream = await getStorage().get(asset.storageKey) // ReadableStream<Uint8Array>: JAMÁS buffer completo
  return new Response(stream, {
    headers: {
      'content-type': asset.mime,
      'content-length': String(asset.bytes),          // el cliente ve progreso real de descarga
      'content-disposition': `attachment; filename="${asset.id}.${extensionFor(asset.mime)}"`,
    },
  })
}, { params: z.object({ id: UlidSchema }) }))
```

Reglas: streaming siempre (un render puede pesar cientos de MB — bufferizarlo tumba el proceso web); `content-length` desde la fila `asset` (la BD es la verdad del tamaño, y el contrato byte-exacto lo asserta el test de checksum de testing §2.5); `withAuth` obligatorio — el 401 sin sesión es parte de la verificación de T0.5.

**Excepción deliberada al "delegar en core" de §1**: el download llama al repo de lectura y al StorageAdapter directamente — es streaming puro sin ninguna decisión de negocio, y meter un servicio de core en medio solo añadiría un passthrough. Es la ÚNICA ruta con este privilegio; si algún día gana lógica (permisos por asset, watermarking), se muda a core como todo lo demás.

## 8. Qué NO va aquí

- **Consumo de esta API desde componentes/hooks** (api-client, formularios, `useEventSource`) → skill `frontend`.
- **`AppError`, contratos Zod y fronteras de paquetes en detalle** → `references/architecture.md` (aquí solo su uso desde handlers).
- **Repos, transacciones, `transition()` y el lado SQL** → `references/db.md`; los handlers solo los invocan vía core.
- **Jobs, consumers y el worker** (incluido `download-output`) → `references/jobs.md`.
- **Logging, AsyncLocalStorage y `request_id` en detalle** → `references/observability.md`.
- **Tests de todo lo anterior** (`callRoute`, `expectApiError`, server-level, contrato SSE, firma de webhooks) → `testing/references/api.md` — fuente de verdad; este documento solo garantiza que el código sea testeable con sus patrones.
