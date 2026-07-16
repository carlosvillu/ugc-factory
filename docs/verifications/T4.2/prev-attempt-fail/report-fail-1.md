# Verificación T4.2 — Webhook de fal con firma ED25519

- **Tarea**: T4.2 · Webhook de fal con firma ED25519 (`planning.md` L563-567)
- **Fecha**: 2026-07-16
- **Ejecutor**: verifier (contexto fresco) · sistema local + cloudflared (túnel a :3000 vía proxy de captura)
- **Sistema**: commit `29ad60c` (diff de T4.2 sin commitear en el árbol) · docker compose dev (Postgres 16) + `pnpm dev` (web :3000 + worker) + seeds `seed:gallery` (model_profile=16, incl. `fal-ai/flux-2`)

## Verificación esperada (literal de planning.md)
> en el VPS (o local con cloudflared), una generación real completa vía webhook sin polling ("webhook verified" en logs); un POST forjado devuelve 401 sin tocar la BD; reenviar el mismo webhook no duplica nada.

## Veredicto

**FAIL** — La generación real vía webhook NO completa: el webhook auténtico de fal se **rechaza con 400 `validation_error`** en el `safeParse` del payload (nunca alcanza el handler), la generación queda colgada en `submitted` para siempre, y no hay "webhook verified", ni job `output.download`, ni asset, ni coste registrado. Causa raíz: el schema del payload no acepta la forma REAL de fal.

**La firma ED25519 y el manejo del JWKS SÍ conforman con fal** (el fixture real congelado verifica verde). El único defecto es el schema Zod del payload.

## Causa raíz (cláusula 1)

fal envía, en un webhook de ÉXITO (`"status": "OK"`), el campo **`"error": null`**. El schema lo declara:

```ts
// packages/core/src/generation/fal-webhook-payload.ts:28
error: z.string().optional(),   // acepta string | undefined, NO null
```

`z.string().optional()` = `string | undefined`; **rechaza `null`**. Por tanto `FalWebhookPayloadSchema.safeParse` falla con `invalid_type` en `error`, el route handler devuelve 400 `validation_error` (route.ts:66) y `handleFalWebhookEvent` (persistir + encolar descarga) **jamás se invoca**.

Reproducido contra el body REAL capturado (`webhook-1-body.raw`):
```
schema.safeParse.success: false
ISSUES: [{ "expected": "string", "code": "invalid_type", "path": ["error"],
           "message": "Invalid input: expected string, received null" }]
```

**Fix (del implementer, 1 línea)**: `error: z.string().nullish()` (o `.nullable().optional()`). Probado contra el body real -> `success: true`. NO lo apliqué (el verifier no arregla código de producto).

## Resultado observado vs esperado

| # | Cláusula | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|---|
| 1 | Generación real completa vía webhook sin polling | submit->webhook->"webhook verified"->`output.download` (job worker)->`completed`->coste en /spend | fal generó la imagen y POSTeó el webhook (6 reintentos), **todos 400 `validation_error`**. Generación colgada en `submitted`. Sin "webhook verified", sin download, sin asset, sin cost_entry. | proxy.log, dev-server.log (`POST /api/webhooks/fal 400`), db-state.txt, webhook-1-body.raw | FAIL |
| 1b | La firma ED25519 conforma con fal (discriminador de conformance) | `verifyFalWebhook(headersReales, bytesReales, jwksReal)` = `{ok:true}` | `{ok:true}` — el webhook REAL de fal verifica verde. Fixture congelado y test PERMANENTE en verde. | fal-webhook.fixture.test.ts (verde), jwks-real.json, webhook-1-headers.json | PASS |
| 2 | POST forjado -> 401 sin tocar la BD | 401 + conteos de fila idénticos | 401 `invalid_signature`; generation/asset/cost_entry = 4/14/28 antes y después (idénticos) | forged-post (abajo) | PASS |
| 3 | Reenviar el mismo webhook no duplica | Exactamente 1 asset, 1 cost, 1 descarga tras reenvío | **BLOQUEADA / no ejecutable**: la idempotencia vive en `handleFalWebhookEvent`, que nunca se alcanza (el payload se rechaza antes en `safeParse`). Nada completó -> nada que duplicar. Inalcanzable detrás de la cláusula 1. | — | BLOQUEADA |

## Pasos ejecutados

1. Gate previo (`pnpm gate`) -> **verde** (exit 0, `pre-gate.log`).
2. `docker compose -f docker-compose.dev.yml up -d` + `pnpm db:migrate` + `pnpm seed:gallery` + `pnpm dev` -> `/api/health` = `{"ok":true,"db":true}`. Boot fresco confirmado (dev-server.log: "Ready in 485ms", "startup migrations applied", "worker ready", consumer `output.download` registrado en boss.ts:122).
3. Proxy de captura (`capture-proxy.mjs`, :8799 -> :3000) + cloudflared túnel `https://mixture-county-strongly-rendered.trycloudflare.com` -> verificado que túnel->proxy->:3000 llega a `/api/health`.
4. Conteos BEFORE submit: generation=3 asset=14 cost_entry=28.
5. `WEBHOOK_URL=https://<túnel>/api/webhooks/fal pnpm --filter @ugc/web smoke:generate:webhook` -> generation `01KXNFEBGCCZX83JZDTD85PZVH`, fal_request_id `019f6af7-3088-7f03-b97d-84fec4a3ce12`, status `submitted` (smoke-submit.txt).
6. Espera de completion (10 min): el proxy capturó **6 webhooks** de fal (reintenta ~cada 60-120s), **los 6 respondidos con 400 `validation_error`**. Status jamás salió de `submitted`.
7. Inspección del body crudo capturado -> `"error": null`. Reproducido el fallo de schema. Verificado que `.nullish()` lo arregla.
8. Verificado que la firma REAL conforma: `verifyFalWebhook` = `{ok:true}` contra headers/bytes/JWKS reales. Fixture congelado y des-skippeado -> test verde.
9. Cláusula 2 (forjado -> 401): ejecutada, PASS.
10. Descargado el PNG real (1024x1024, 1069610 bytes) desde la URL del payload.
11. Teardown: cloudflared + proxy + `pnpm dev` matados; :3000 y :8799 libres.

## Evidencia cláusula 2 (forged POST -> 401, DB intacta)

```
BEFORE forged: generation=4 asset=14 cost_entry=28
POST /api/webhooks/fal  (4 headers x-fal-webhook-*, timestamp fresco, firma hex bogus)
  -> HTTP 401  {"code":"invalid_signature","message":"firma o timestamp de webhook inválidos"}
AFTER forged:  generation=4 asset=14 cost_entry=28   -> DB UNTOUCHED (idénticos) OK
```
(generation=4 porque la fila `submitted` colgada de la cláusula 1 ya existía; el forjado no añadió ninguna.)

## Estado de la generación colgada (manifestación del bug)

```
id=01KXNFEBGCCZX83JZDTD85PZVH  status=submitted  cost_actual=NULL  completed_at=NULL
assets para esta generación = 0
cost_entry para esta generación = 0
```

## Fixture real de fal congelado (evidencia permanente — RELLENADO POR EL VERIFIER)

`packages/core/src/generation/fal-webhook.fixture.test.ts` — des-skippeado y relleno con el webhook REAL:
- `REAL_HEADERS`: los 4 `x-fal-webhook-*` reales (requestId, userId `github|179462`, timestamp `1784206014`, signature hex 128 chars).
- `REAL_RAW_BODY`: los 564 bytes CRUDOS exactos del POST de fal (byte a byte, sin re-serializar).
- `REAL_JWKS`: las 2 claves ED25519 de `https://rest.fal.ai/.well-known/jwks.json` en ese momento.
- `now` fijado a `1784206014*1000` para que la ventana +-5 min no caduque el fixture.

Resultado: **1 test passed** (`pnpm --filter @ugc/core test fal-webhook.fixture`). Este test queda como regresión PERMANENTE de conformance. **Es lo único de producto/tests que tocó el verifier** — es evidencia congelada, no implementación de feature. NO se aplicó el fix del schema.

Nota: este fixture NO se rompe con el bug del schema — prueba `verifyFalWebhook` (la firma), no `FalWebhookPayloadSchema` (el payload). El bug del payload es invisible a los tests unitarios/self-consistency; SOLO lo caza la Verificación real, como el propio comentario del test anticipaba.

## Coste real

**~$0.013 de gasto REAL en fal** (dinero perdido: fal generó y facturó la imagen aunque nuestro sistema no la registrara por el bug).
- fal generó 1 imagen `fal-ai/flux-2` 1024x1024 (payload real con URL, seed 427063521, timings inference 1.37s).
- Precio del perfil: 1.2c/megapixel x 1.0486 MP = 1.26c -> nuestro ledger habría redondeado a `Math.round(1.0486x1.2)` = **1c** (si hubiera funcionado el webhook).
- **Coste registrado en NUESTRO sistema / `/spend`: $0** — no se creó `cost_entry` (el webhook nunca llegó al handler). Hallazgo secundario: un fallo de este webhook implica gasto real de fal NO capturado en el ledger (huérfano hasta que T4.3 reconcilie).
- vs estimado $0.15: muy por debajo (una sola imagen barata). Sin recalibración necesaria.

## Qué debe arreglar el implementer (accionable)

1. **`packages/core/src/generation/fal-webhook-payload.ts:28`**: `error: z.string().optional()` -> `error: z.string().nullish()` (acepta el `"error": null` que fal envía en payloads de éxito). Verificado que este cambio hace `safeParse` verde contra el body real.
2. Tras el fix, re-ejecutar la Verificación completa (cláusulas 1 y 3, que quedaron bloqueadas). Sugerencia: añadir el body real capturado (`webhook-1-body.raw`) como fixture de un test de `FalWebhookPayloadSchema` para que ESTE fallo de conformance del payload quede también cubierto por regresión (hoy no lo está).

## Rarezas / notas

- La firma ED25519, el layout del mensaje (`[requestId, userId, timestamp, hex(sha256(body))].join('\n')`), el hex, el timestamp en segundos y el JWKS conforman perfectamente con fal — la parte "difícil" de la tarea está bien. El fallo es un `.optional()` que debía ser `.nullish()`.
- fal reintenta el webhook ~10x/2h: se observaron 6 reintentos en 10 min, todos 400. Un 400 hace que fal siga reintentando; idealmente un payload inválido tras firma válida debería responder 200 para que fal pare — pero eso es secundario al bug principal.
- La evidencia de "sin polling" es sólida: `submitGenerationForWebhook` no pollea y el poller de T4.3 no existe aún; la única vía de completion era el POST entrante de fal (visible en proxy.log). No hubo ninguna línea de poll/reconcile para esta generación en los logs del worker.

## Archivos de evidencia (docs/verifications/T4.2/)
- `report.md` (este)
- `capture-proxy.mjs` — proxy de captura byte-exacto
- `proxy.log` — 6 webhooks entrantes + respuestas 400
- `dev-server.log` — logs web+worker (POST /api/webhooks/fal 400)
- `pre-gate.log` — gate previo verde
- `smoke-submit.txt` — submit del smoke (request_id real)
- `webhook-1-body.raw` — bytes crudos exactos del webhook real de fal (564 B, `"error": null`)
- `webhook-1-headers.json`, `webhook-1-all-headers.json` — headers reales
- `jwks-real.json` — JWKS real de rest.fal.ai en el momento
- `generated-image.png` — el PNG real que fal generó (1024x1024, 1.07 MB, sha256 fc84f05d...)
- `db-state.txt` — estado de la generación colgada + conteos
