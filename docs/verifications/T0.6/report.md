# Verificación T0.6 — pg-boss + job de demo `noop` con retries/backoff + `enqueue()`

- **Tarea**: T0.6 · pg-boss inicializado; job de demo `noop` con retries/backoff; helper `enqueue()` en `packages/core` (`planning.md`)
- **Fecha**: 2026-07-08
- **Ejecutor**: verifier (contexto fresco) · superficie **solo backend** (logs + psql, sin navegador)
- **Sistema**:
  - Working tree con cambios staged de T0.6 sin commitear (esperado — commit post-PASS). HEAD = `a7e4e79`.
  - 23 ficheros de T0.6 staged (worker: boss.ts, consumers/demo-noop.ts, job-queue.ts, bootstrap.ts, main.ts; core: jobs/*, orchestrator/*). El código verificado ES el del working tree.
  - Postgres **16.14** (Debian, aarch64), contenedor `ugc-postgres-dev` de `docker-compose.dev.yml`.
  - **Puerto** 55432 (ya en `.env`: `POSTGRES_PORT=55432`, `DATABASE_URL=postgres://ugc:ugc@localhost:55432/ugc`). Sin desviación de puerto.
  - **Volumen fresco**: `down -v` + `up -d` (había datos previos). Postgres healthy antes de continuar.
  - `pnpm db:migrate` NO ejecutado (pg-boss auto-migra `pgboss` en `boss.start()`).
  - **Nota entorno**: `psql` no está en el host → queries vía `docker exec ugc-postgres-dev psql -U ugc -d ugc` (mismo Postgres/BD; equivalente a `psql "$DATABASE_URL"`).

## Gate previo
`pnpm gate` verde: typecheck OK (5 proyectos), format:check OK, knip OK (solo hints), **63 tests passed (14 files)**.

## Verificación esperada (literal de planning.md)
> encolar 10 jobs `noop` con 30 % de fallo configurado → el log muestra ejecuciones y reintentos; la tabla de pg-boss muestra todos en `completed` al final.

(Entrega: pg-boss inicializado; job de demo `noop` con retries/backoff; helper `enqueue()` en `packages/core`.)

## Comando exacto ejecutado
```
DEMO_NOOP_FAIL_RATE=0.3 DEMO_NOOP_SEED=10 pnpm --filter @ugc/worker dev
```
Arrancó pg-boss (auto-migración `pgboss`), creó cola `demo.noop` + DLQ `demo.noop.dlq`, registró el consumer, y encoló 10 jobs `demo.noop` vía el puerto JobQueue real (`makeJobQueue → boss.send`, el helper `enqueue()`).

## Log capturado (ejecuciones + reintentos + backoff)
```
{"level":30,...,"msg":"pg-boss arrancado: colas y consumers listos"}
{"level":40,...,"job_id":"c79f6ecf-...","msg":"demo.noop: fallo inyectado — reintentará"}   ← reintento
{"level":30,...,"job_id":"c6f8d192-...","msg":"demo.noop: ejecutado"}                        ← ejecución
{"level":30,...,"seeded":10,"msg":"demo.noop: jobs de demo encolados"}
...
{"level":40,...,"job_id":"c79f6ecf-...","msg":"demo.noop: fallo inyectado — reintentará"}   t=750766 (2º fallo)
{"level":30,...,"job_id":"c79f6ecf-...","msg":"demo.noop: ejecutado"}                        t=754281
{"level":30,...,"signal":"SIGTERM","msg":"worker shutting down"}
```
**Backoff real**: job `c79f6ecf` falla t=748749, refalla ~2 s (t=750766), triunfa ~4 s (t=754281). Curva 1→2→4 s = `retryDelay:1 + retryBackoff + retryDelayMax:4`. Log completo en `worker.log`.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Encolar 10 jobs `noop` con 30 % de fallo | `seeded:10` + `randomFailRate(0.3)` | worker.log | ✅ |
| 2 | Log muestra **ejecuciones** | Múltiples `demo.noop: ejecutado` (lvl 30) | worker.log | ✅ |
| 3 | Log muestra **reintentos** | `fallo inyectado — reintentará` (lvl 40) + backoff 1→2→4 s | worker.log | ✅ |
| 4 | Tabla pg-boss **todos en `completed`** | `completed = 10`, 0 en failed/retry | state-counts.txt | ✅ |
| 5 | (refuerzo) retries dispararon | `retry_count`: c79f6ecf=2, fb54eca4=1 | retry-counts.txt | ✅ |
| 6 | (refuerzo) DLQ vacía | 0 filas en `demo.noop.dlq` | dlq.txt | ✅ |
| 7 | Shutdown graceful (SIGTERM), exitCode 0 | `worker shutting down` logueado + **exit code 0 observado** (`kill -TERM` + `wait; echo $?`), sin huérfanos | shutdown.log | ✅ |

## Coste real
$0 — sin APIs de pago (todo local). vs estimado $0. ✓

## Veredicto
**PASS** — los 10 jobs `demo.noop` convergen a `completed` con reintentos y backoff exponencial reales y observables (log + `retry_count > 0`), DLQ vacía, shutdown graceful limpio. La Verificación literal del planning se cumple en sus dos partes.

### Notas / rarezas (aunque PASS)
- **exitCode 0 observado directamente**: el flujo de la Verificación se corre bajo `pnpm dev` (= `tsx watch`), que NO propaga el exit code del hijo. Para observar el `exitCode 0` de la Entrega, se ejecutó `main.ts` una segunda vez SIN el wrapper de watch (`npx tsx apps/worker/src/main.ts`, con `.env` cargado), se le envió SIGTERM tras `worker ready`, y `wait; echo $?` → **0**. Evidencia: `shutdown.log` (`worker shutting down` con signal SIGTERM) + exit code 0. El camino graceful (`boss.stop({graceful:true})` → `finally` clearInterval + exitCode 0) se ejecutó sin línea de error de drain.
- **Desviación declarada (no fallo)**: `retryLimit` 6 (no 3 de `jobs.md`) — decisión probabilística. Sin efecto: todos `completed`, DLQ vacía, retry_count máx = 2 << 6.
- Queries vía `docker exec ... psql` porque `psql` no está en el host; mismo Postgres/BD del worker.
- **Helper `enqueue()`**: el puerto `JobQueue.enqueue()` (contrato de la Entrega) vive en `packages/core/src/orchestrator/ports.ts`; su impl concreta `makeJobQueue` (que hace `boss.send`) está en el composition root del worker (`apps/worker/src/job-queue.ts`). El seed de 10 jobs se encoló por este camino (`seeded:10`), demostrando el helper en vivo.
