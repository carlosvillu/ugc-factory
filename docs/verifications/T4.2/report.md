# Verificación T4.2 — Webhook de fal con firma ED25519 (RE-VERIFICACIÓN tras fix)

- **Tarea**: T4.2 · Webhook de fal con firma ED25519 (`planning.md`)
- **Fecha**: 2026-07-16
- **Ejecutor**: verifier (contexto fresco, 2º intento) · agent-browser 0.27.x · sesión `t4.2`
- **Sistema**: commit `29ad60c` (diff de T4.2 sin commitear; fix `.nullish()` ya presente) · docker compose dev (Postgres 16) + `pnpm dev` (web :3000 + worker) + seeds `seed:gallery` (model_profile=16, incl. `fal-ai/flux-2`) · túnel cloudflared → capture-proxy :8799 → :3000

## Verificación esperada (literal de planning.md)
> en el VPS (o local con cloudflared), una generación real completa vía webhook sin polling ("webhook verified" en logs); un POST forjado devuelve 401 sin tocar la BD; reenviar el mismo webhook no duplica nada.

## Veredicto

**PASS** — El fix (`error: z.string().nullish()` + handler 200+warn en payload-inválido-tras-firma-válida) es correcto: el webhook REAL de fal (que trae `"error": null` en éxito) ahora parsea y fluye la ruta de completion completa. La generación llega a `completed` conducida por el WEBHOOK (POST entrante, sin polling), la descarga la ejecuta el JOB del worker `output.download`, el coste real aparece en `/spend` ($0.02, derivado de dimensiones), el forjado da 401 sin tocar la BD, y el reenvío del mismo webhook NO duplica nada. La cláusula BLOQUEADA en el intento anterior (reenvío) ahora se ejercitó de verdad.

## Contexto del 2º intento
El FAIL anterior fue un bug real: `error: z.string().optional()` rechazaba el `"error": null` de fal en éxito → 400 → generación colgada en `submitted`. Verificado en el código que el fix está aplicado (`packages/core/src/generation/fal-webhook-payload.ts:32` = `.nullish()`; `gateway_request_id`/`payload_error` idem; el route handler responde 200+`warn` a payload inválido tras firma válida para no disparar reintentos de fal). Re-ejecutada la Verificación VIVA completa.

## Resultado observado vs esperado

| # | Cláusula | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|---|
| 1 | Generación real completa vía webhook SIN polling | submit→webhook "verified"→job `output.download`→`completed`→coste en /spend | fal generó y POSTeó al túnel. Route handler: `enqueued_download` (200). Worker consumer descargó PNG→asset→cost→`completed`. Sin poll para esta generación. | proxy.log, dev-server.log, smoke-submit.txt, db-state.txt | OK |
| 1a | Log "webhook verified" + POST entrante | POST entrante + log de éxito | proxy.log `WEBHOOK #1 entrante POST /api/webhooks/fal 563 bytes` → upstream `200 enqueued_download`; web log `"webhook de fal verificado: descarga de output encolada"` | proxy.log, dev-server.log | OK |
| 1b | Descarga = JOB worker `output.download` (no inline) | log del consumer del worker | worker (pid 32562, `queue:output.download`, `job_id f84aec4d`): `"output.download: output descargado y generación completed (webhook verified)"`, costCents=1. El route handler SOLO encoló. | dev-server.log | OK |
| 1c | La condujo el WEBHOOK, no un poll | cero líneas de poll/reconcile | grep poll/reconcile/response_url para esta generación: vacío. Única vía = POST entrante. | dev-server.log | OK |
| 1d | Coste real en /spend (no 0, no fabricado) | cifra derivada de dimensiones | /spend UI (browser): fal.ai 3 images / $0.02; día 2026-07-16 = $0.02. cost_entry de esta gen = 1c (1024²=1.0486MP × 1.2c/MP ≈ 1c). Corroborado psql: fal hoy = 2c. | 01-spend-ui.png, db-state.txt | OK |
| 1e | PNG en NUESTRO storage | fichero íntegro en storage local | `/tmp/ugc-assets-dev/generations/01KXNHPHVTRFQDGA1J8V6QEP9F/…png`, 1045963 B = asset.bytes; PNG 1024×1024 RGB; la manzana del prompt. | generated-image.png | OK |
| 1f | Firma ED25519 conforma (discriminador) | fixture real verde | `fal-webhook.fixture.test.ts` + `fal-webhook-payload.test.ts` verdes en el gate (1750 tests) y en run aislado (13 tests). | pre-gate.log | OK |
| 2 | POST forjado → 401 SIN tocar la BD | 401 + conteos idénticos | 401 `invalid_signature`. Global 5/15/29 antes y después (idénticos). | forged-response.txt, db-state.txt | OK |
| 3 | Reenviar el mismo webhook NO duplica | 1 asset, 1 cost, 1 descarga | Reenvío del webhook FRESCO de este run (mismo request_id, firma válida, ts age 88s dentro de ±5min) → 200 `already_completed` (no-op). Per-gen assets=1 cost=1 idénticos; global 5/15/29 sin cambio; sin 2ª descarga. | replay-response.txt, db-state.txt, dev-server.log | OK |

## Pasos ejecutados
1. `pnpm gate` → verde (162 files, 1750 tests passed, exit 0). Incluye `fal-webhook.fixture.test.ts` + `fal-webhook-payload.test.ts`.
2. Verificado el fix aplicado en el árbol: `fal-webhook-payload.ts:32` = `.nullish()`; route handler 200+`warn` a schema-fail tras firma válida.
3. docker compose dev + db:migrate + seed:gallery + `pnpm dev` → health `{ok:true,db:true}`; worker ready, consumer `output.download` registrado.
4. capture-proxy (:8799 byte-exacto) + cloudflared `https://bag-winter-adapted-reduced.trycloudflare.com` → túnel→proxy→:3000 health 200.
5. Conteos BEFORE (global): generation=4 asset=14 cost_entry=28.
6. smoke:generate:webhook → generation `01KXNHPHVTRFQDGA1J8V6QEP9F`, fal_request_id `019f6b1b-49c3-7163-9866-2d7bdfec2232`, `submitted`.
7. Poll de status → `completed` en segundos. proxy.log: webhook #1 entrante, upstream 200 `enqueued_download`. Body capturado `status=OK error=null` (lo que rompía antes) ahora parsea.
8. Logs: route handler "webhook verificado…encolada"; worker consumer "output.download … completed (webhook verified)". Cero poll.
9. Cláusula 3 (reenvío): replay del webhook fresco byte-exacto, headers reales, ts en ventana → 200 `already_completed`, conteos idénticos (per-gen y global). NO duplicó.
10. Cláusula 2 (forjado): firma hex bogus + ts fresco → 401 `invalid_signature`; conteos idénticos.
11. /spend en browser (agent-browser, login `AUTH_BOOTSTRAP_PASSWORD`): fal.ai 3 images / $0.02. Screenshot + consola limpia.
12. PNG copiado desde storage local (1024×1024, la manzana del prompt).
13. Teardown: cloudflared + proxy + web + worker matados; :3000 y :8799 libres.

## La prueba del fix (contraste con el FAIL anterior)
    proxy.log (ESTE run):
      WEBHOOK #1 entrante: POST /api/webhooks/fal · 563 bytes · reqId=019f6b1b ts=1784208380 sigLen=128
      WEBHOOK respuesta upstream: 200 · {"ok":true,"outcome":"enqueued_download"}
    body: status=OK  error=null  → parsea (antes: 400 validation_error en error:null)
El intento anterior recibió 400 en este punto exacto; ahora es 200 `enqueued_download` y la ruta fluye entera.

## Coste real
~$0.013 de gasto REAL en fal (1 imagen `fal-ai/flux-2` square_hd 1024²). Esta vez SÍ se registró en nuestro ledger: `cost_entry` provider=fal amount_cents=1 → visible en `/spend` ($0.02 acumulado fal hoy = 2c: esta gen 1c + resto del día). vs estimado $0.15: muy por debajo. Sin recalibración. Gasto F4 holgado bajo ~5€.

## Rarezas / notas (aunque PASS)
- La generación colgada `submitted` del intento FAIL anterior (`01KXNFEBGCCZX83JZDTD85PZVH`) sigue en la BD (por eso BEFORE global era generation=4, no 3). No afecta: todos los conteos se comprobaron before/after de cada acción y scoped al generation_id de este run. Es gasto real de fal huérfano (~1c) que T4.3 (poll/reconcile) recogería.
- Consola de /spend limpia (solo React DevTools/HMR dev-only info).
- No verifiqué contraste WCAG de /spend: T4.2 no toca esa superficie (solo lee la cifra); /spend es de T0.12.
- Evidencia del FAIL previo archivada en `prev-attempt-fail/` (incl. `report-fail-1.md`).

## Archivos de evidencia (docs/verifications/T4.2/)
- report.md (este) · pre-gate.log · smoke-submit.txt · proxy.log · dev-server.log
- webhook-1-body.raw (563 B, status=OK error=null) · webhook-1-headers.json · -all-headers.json
- replay-response.txt (cláusula 3) · forged-response.txt (cláusula 2) · db-state.txt
- 01-spend-ui.png · browser-console.txt · generated-image.png (1024×1024) · jwks-real.json
- capture-proxy.mjs (herramienta) · prev-attempt-fail/ (FAIL anterior archivado)
