# Verificación T0.9 — Timeouts, retries y cron de barrido

- **Tarea**: T0.9 · Timeouts, retries y cron de barrido (`planning.md`)
- **Fecha**: 2026-07-10
- **Ejecutor**: verifier (contexto fresco, escéptico) · backend-only (curl + psql, sin UI — la Verificación no menciona navegador; habla de estados `expired`/`succeeded` en BD)
- **Sistema**: diff T0.9 SIN commitear sobre commit `db76973` (working tree: 12 ficheros modificados + `retry/route.ts`, `sweeper.ts`, `core/{retry,sweep,timeout}.ts` nuevos) · docker compose dev (`ugc-postgres-dev`, Postgres 16, puerto 55432) + `pnpm dev` FRESCO (web en 3000 + worker PID 41026, misma BD) + migraciones aplicadas + project sembrado por psql `01JXVERIFT09PROJECT000000AA`
- **Gate previo**: `pnpm gate` VERDE (exit 0) re-ejecutado desde la raíz al inicio de esta verificación (lint + typecheck + format:check + knip + test).
- **Higiene de arranque**: al levantar `pnpm dev` había un `next dev` STALE de una sesión previa ocupando el 3000 (health respondía pero NO era mi código). Lo maté (`pkill -f "next dev"`, worker main.ts) y relancé `pnpm dev` limpio → web en 3000 propio + worker PID 41026 con `"sweeper de timeouts arrancado" intervalMs:5000`. El sweeper que actúa en la cláusula 1 es ESTE worker.
- **Health**: `{"ok":true,"db":true}`. Smoke previo (run llano `demo.sleep.N0`) → `succeeded` en 1s ⇒ el worker consume y progresa steps de verdad.

## Verificación esperada (literal de planning.md)
> un executor de demo con `hang=true` y timeout de 10 s → el step pasa a `expired` en <40 s sin intervención; `retry` sobre un step con `fail_rate=1` forzado a 0 lo re-ejecuta y completa.

## Método
Dos cláusulas independientes, ambas verificadas contra el sistema REAL levantado. Preparación de escenario (crear runs, seed project) por API/psql — permitido por el protocolo. El estado se observa SIEMPRE por query psql a `step_run` (nunca por logs del código bajo prueba). El tiempo de la cláusula 1 se mide con timestamps de BD (`started_at`->`finished_at`), no con reloj de pared. "Sin intervención" = entre crear el run colgado y ver `expired` solo se ejecutaron SELECTs. La operación `retry` de la cláusula 2 se hace por el endpoint HTTP real AUTENTICADO (`POST /api/steps/:id/retry`), no por la ruta core. Inputs elegidos por el verifier (no reutilizados del implementer): mis propios run/step, mi timeout de 10 s, mi node id.

## Resultado observado vs esperado

| # | Cláusula | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|---|
| 1 | Expiración por timeout SIN intervención | step `demo.hang` con `timeout_ms=10000` pasa a `expired` en <40 s, sin que nadie intervenga | `config` persistida `{hang:true,timeout_ms:10000}`; `timeout_at` = `started_at`+**exactamente 10.000s** (el override `config.timeout_ms` GANA sobre el mapa por node_key); **running->expired = 11.811s** (< 40s); detección desde `timeout_at` = 1.811s (siguiente tick del sweep de 5s). SOLO SELECTs entre medias. El worker PID 41026 (mi proceso) loggeó `"sweep: step colgado expirado"` + `"barrido de timeouts completado" expired:1 skipped:0` -> el sweeper fue el ÚNICO actor. | clause1-output.txt, clause1-final.txt | OK |
| 2 | Retry manual re-ejecuta y completa | step `demo.fail` con `failRate=1`, con retries automáticos AGOTADOS; `retry` cambiando `fail_rate` a 0 -> re-ejecuta y completa | Auto-retries agotados: `failed` TERMINAL con `retry_count=3=max_retries` en 2s (initial + 3 reintentos automáticos = 4 fallos inyectados, todos WARN `"fallo inyectado"`). Estado antes: `failed`/`retry_count=3`/`config={failRate:1}`. `POST /api/steps/:id/retry` con `{config:{failRate:0}}` autenticado -> **HTTP 200** `{ok:true}`. Tras retry: `retry_count` reseteado a 0, `config` REEMPLAZADA a `{failRate:0}`, re-encolado; el step re-ejecuta y alcanza **`succeeded`** en 2s (nuevo `started_at`/`finished_at`). | clause2-output.txt | OK |

## Comprobaciones escépticas adicionales
- **Guard de auth del endpoint**: `POST /api/steps/:id/retry` SIN cookie -> **HTTP 401** `{"code":"unauthorized"}`. El endpoint es genuinamente `withAuth`, no abierto. (auth-check.txt)
- **Precisión del override de timeout**: `timeout_at - started_at = 10.000000s` exacto => el override `config.timeout_ms` de la Verificación es el que fija el timeout, no el mapa por node_key (que daría 60s para `demo.hang`, lo que habría FALLADO el <40s si el override no ganara). Discriminador correcto.
- **Sin errores inesperados**: las ÚNICAS líneas de error en el log durante toda la verificación son 4 WARN (`level:40`) `"demo executor: fallo inyectado"` — los fallos provocados a propósito de la cláusula 2. Cero `level:50/60`, cero 500s. (auth-check.txt)
- **Aislamiento**: cláusula 1 y cláusula 2 son runs/steps DISTINTOS; el smoke previo es otro run más. Ningún atajo por API/psql tocó el paso verificado (crear-run y seed son solo PREPARACIÓN; expirar y retry ocurrieron por el sweeper y por el endpoint HTTP real).

## Coste real
$0 — sin APIs de pago. Orquestador + Postgres local + executors de demo (hang/fail). Estimado $0. Sin recalibración.

## Veredicto
**PASS** — Ambas cláusulas se cumplen literalmente contra el sistema real levantado:
1. Un step colgado con timeout de 10 s pasó a `expired` en 11.8 s (< 40 s) por el sweeper del worker, sin intervención humana (evidencia de timestamps de BD + log del sweeper).
2. Un step con `failRate=1` agotó sus 3 retries automáticos hasta `failed` terminal, y el `retry` manual autenticado con `failRate:0` lo re-ejecutó hasta `succeeded`.

Sin rarezas que reportar. El override `config.timeout_ms` gana sobre el mapa por node_key (correcto y load-bearing para el gate <40s), el endpoint retry resetea `retry_count` y reemplaza `config` como se documenta, y está protegido por auth.
