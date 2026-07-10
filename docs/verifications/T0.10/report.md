# Verificación T0.10 — SSE sobre LISTEN/NOTIFY

- **Tarea**: T0.10 · SSE sobre LISTEN/NOTIFY (`planning.md`)
- **Fecha**: 2026-07-10
- **Ejecutor**: verifier (escéptico) · superficie backend (`curl -N` + `psql`, sin navegador — la Verificación pide literalmente `curl`)
- **Sistema**: working tree con el diff de T0.10 SIN commitear sobre commit `16147d9` (ese diff ES lo verificado). `docker compose -f docker-compose.dev.yml up -d` (Postgres 16) + `pnpm db:migrate` + `pnpm dev` (web + worker) con `SSE_HEARTBEAT_MS=1500` en `.env`. Seed: proyecto `proj_t010_verify` insertado por psql (prep de escenario permitida).

## Verificación esperada (literal de planning.md)
> `curl -N /api/runs/:id/events` durante un run de demo → snapshot, deltas por transición y heartbeats visibles; matar y reabrir el curl con `Last-Event-ID` re-sincroniza sin perder el estado final.

## Método de driveo de transiciones
Worker real (`pnpm dev` levanta web + worker). Run de demo por `POST /api/runs` con DAG en cadena N0→N1→N2 (`demo.sleep.N0/N1/N2`), `sleepMs=7000-8000` por step para ensanchar cada ventana y (a) conectar el curl con el run EN CURSO y (b) forzar una transición dentro del gap de desconexión. `autopilot:true` (sin checkpoints en este DAG). El worker consume los jobs `demo.sleep.*` y dispara las transiciones; cada una emite `pg_notify('pipeline_events', <run_id>)` en la tx, que el LISTEN del stream re-lee.

## Pasos ejecutados
1. **401 sin cookie**: `curl -i /api/runs/anyid/events` sin sesión → `401 Unauthorized`, JSON `{"code":"unauthorized",...}`, NO stream → `00-401-no-cookie.txt`.
2. **Login**: `POST /api/login` con `ugc-factory-dev` → 200 + cookie `ugc_session`. Con cookie `/events` → 200 (stream). Sin ella → 401.
3. **Cláusula 1 (live)**: run `01KX5Q8YWRQFDZKXHNKCSAATZ0` (sleepMs 7000), `curl -N` con el run EN CURSO 20 s → `01-stream-live.txt`.
4. **Cláusula 2 (Last-Event-ID)**: run `01KX5QB57BXBMHX9BTY8R8VR0J` (sleepMs 8000). curl-1 6 s (última vista N2=`running`), matado, último `id: 10`. Durante el gap N2 `running`→`succeeded` (psql). curl-2 con `Last-Event-ID: 10` → `02-clause2-curl1.txt`, `03-clause2-curl2-reconnect.txt`, `04-db-final-crosscheck.txt`.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1a | `snapshot` al conectar | `id: 1 / event: snapshot` con los 3 steps | 01-stream-live.txt | ✅ |
| 1b | deltas `step_changed` por transición | ids 4-9,15-17: N0→succeeded, N1 running→succeeded, N2 awaiting_deps→queued→running→succeeded, en vivo | 01-stream-live.txt | ✅ |
| 1c | `heartbeat`s periódicos | cadencia 1501 ms ≈ SSE_HEARTBEAT_MS=1500 | 01-stream-live.txt | ✅ |
| — | ids monotónicos | 1..20 crecientes | 01-stream-live.txt | ✅ |
| 2a | reconexión re-sincroniza (re-snapshot) | curl-2 1.er frame = `event: snapshot` (no replay) | 03-...reconnect.txt | ✅ |
| 2b | sin perder el estado final | re-snapshot N2=`succeeded` (cambió en el gap; curl-1 solo vio `running`) | 03 + 04 | ✅ |
| 2c | id monotónico entre reconexiones | curl-2 arranca en `id: 11` (sembrado de Last-Event-ID:10) | 03-...reconnect.txt | ✅ |
| — | cruce con fuente de verdad | psql tras el gap: N0/N1/N2 `succeeded` = lo del re-snapshot | 04-db-final-crosscheck.txt | ✅ |
| — | 401 sin cookie (withAuth) | 401 JSON, no stream | 00-401-no-cookie.txt | ✅ |

## Coste real
$0 — sin APIs de pago (Postgres local + worker de demo). vs estimado $0. ✓

## Veredicto
**PASS** — Ambas cláusulas se cumplen literalmente contra el sistema real: snapshot + deltas por transición + heartbeats en vivo (cláusula 1), y re-sincronización por `Last-Event-ID` con el estado final que cambió durante la desconexión, ids monotónicos entre reconexiones, cruzado con psql (cláusula 2). 401 sin cookie confirmado. Gate: ver nota.

### Nota sobre el gate
1.ª ejecución de `pnpm gate` (con mi `pnpm dev` de verificación vivo) → 1 fichero fallido `sse-contract.test.ts` (`next dev murió durante el arranque`), por contención de recursos: la suite arranca su PROPIO `next dev` (puerto aleatorio 3200-3599) y competía con mi dev server en frío. Re-ejecutado el gate AISLADO tras parar mi dev: **VERDE** — lint OK, typecheck OK (5 paquetes), prettier OK, knip OK, 37/37 test files, **418/418 tests pasan** (0 fallos, 0 skips).

**Mecanismo confirmado (no asumido)**: `apps/web/test/helpers/server.ts` arranca su `next dev` con `cwd: apps/web` — el MISMO directorio (y el mismo `.next`) que usaba mi `pnpm dev`. Dos `next dev` desde el mismo dir se pisan el cache `.next` en el arranque y uno muere con `code` de salida (coincide con "murió durante el arranque (code …)", que es un exit del proceso, NO el timeout de 90 s que predeciría una simple starvation de CPU). Además, SOLO falló ese fichero (el único que arranca su propio `next dev`); ningún otro test timing-sensitive flakeó.

**Verificación de la no-flakiness (descarta rule-5)**: sin dev server activo, ejecutado el proyecto `web:integration` (incluye `sse-contract.test.ts`) **3 veces seguidas → 3/3 verde (6 files, 42 tests c/u)**, más el `pnpm gate` completo verde = 4 pases limpios. No es un test flaky introducido por T0.10; es contención de mi propio setup de verificación, no un defecto del código bajo prueba.

### Rarezas (aunque PASS)
- Cada NOTIFY re-emite el estado de TODOS los steps del run → una transición produce varios `step_changed` (idempotente POR DISEÑO, `readChangedSteps`; no bug).
- El worker arranca el step al encolarse; el sleep solo retrasa el `succeeded` (N0 ya `succeeded` en el 1.er snapshot). No afecta la verificación.
