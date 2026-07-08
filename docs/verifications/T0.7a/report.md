# Verificación T0.7a — Máquina de estados transaccional

- **Tarea**: T0.7a · Máquina de estados transaccional (`planning.md`)
- **Fecha**: 2026-07-08
- **Ejecutor**: verifier (contexto fresco) · solo backend (script + `psql LISTEN`, sin navegador)
- **Sistema**: working tree en `5b1e6e1` (cambios T0.7a staged, sin commitear — el commit lo hace el bucle tras PASS; `git status` confirma que NO hay cambios ajenos a la diff de T0.7a). Postgres 16 vía `docker-compose.dev.yml` sobre **volumen fresco** (`down -v` + `up -d`). Puerto **55432** (desviación anotada en `.env`, no 5432). Migraciones `0000`+`0001` aplicadas desde BD vacía con `pnpm db:migrate`.
- **Gate previo**: `pnpm gate` verde (exit 0, 18 test files / 271 tests) antes de empezar.

## Verificación esperada (literal de planning.md)
> script contra la BD real que ejecuta una secuencia de transiciones legales e ilegales: las legales dejan las filas con los estados/timestamps esperados, las ilegales lanzan error sin tocar la BD; en una sesión `psql` con `LISTEN pipeline_events` se ve el NOTIFY de cada transición.

## Cómo se ejecutó
Dos scripts TS que ejercitan el `transition()` REAL de producción vía los adaptadores reales (`makeWithTransaction(createDb, PgBoss)` + `ensureQueue(stepExecuteJob)`), contra la BD y el pg-boss reales del compose — sin mocks, sin consumer registrado (para que los jobs se acumulen en `pgboss.job` y sean contables):
- `verify.ts.txt` — legal/ilegal + deps + rollback, con cliente `pg` dedicado como observador determinista del NOTIFY (payload verificado). Salida: `03-script-output.txt`.
- `fire-transitions.ts.txt` — 3 transiciones legales + 1 ilegal mientras una sesión **`psql` literal con `LISTEN pipeline_events`** observa. Salidas: `04-fire-transitions-output.txt`, `02-psql-listen-session.txt`.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Migración crea tablas + enums §7.1 | pipeline_run, step_run; step_status=13, run_status=7, run_kind=3 | 01-schema-dt-dT.txt | OK |
| 2 | Legal deja estados/timestamps esperados | pending->queued (started/finished null) -> running (started_at fijado) -> succeeded (finished_at >= started_at) | 03-script-output.txt | OK |
| 3 | Encolado en la MISMA transacción | +1 job step.execute por cada entrada a queued (transaccional) | 03-...txt, 05-pgboss-jobs.txt | OK |
| 4 | Resolución de depends_on | A2 succeed -> B awaiting_deps->queued + encolado (+1 job) | 03-script-output.txt | OK |
| 5 | Ilegal lanza SIN tocar la BD | IllegalTransitionError; fila intacta (status/timestamps/updated_at idénticos), 0 jobs, 0 NOTIFY | 03-script-output.txt | OK |
| 6 | Rollback des-encola y silencia NOTIFY | Abort tras encolar -> step pending, 0 jobs, 0 NOTIFY | 03-script-output.txt | OK |
| 7 | psql LISTEN ve el NOTIFY de cada transición legal, ninguno de la ilegal | 3 "Asynchronous notification pipeline_events" payload==runId; 0 por la ilegal | 02/04-...txt | OK |
| 8 | Payload del NOTIFY == run_id | Los 6 NOTIFY de verify.ts y los 3 de psql llevan el runId exacto | 03/02/04-...txt | OK |

Detalle NOTIFY (cliente pg de verify.ts): 6 transiciones legales committeadas -> exactamente 6 NOTIFY, todos payload==runId; 2 casos ilegales/rollback -> 0 NOTIFY. Detalle psql literal: 3 legales -> 3 banners; 1 ilegal -> 0.

## Coste real
$0 — ninguna API de pago. Solo Postgres local en docker.

## Veredicto
**PASS** — el sistema real hace literalmente lo que la Verificación describe: transiciones legales dejan estados/timestamps correctos con encolado transaccional, las ilegales lanzan IllegalTransitionError sin tocar fila/job/NOTIFY, y una sesión `psql LISTEN pipeline_events` observa un NOTIFY (payload==run_id) por cada transición legal y ninguno por las ilegales. La atomicidad (rollback des-encola + silencia NOTIFY) queda probada de forma independiente.

Notas / rarezas:
- El `\watch` de psql NO vuelca los banners de notificación asíncrona entre ciclos; el idioma que sí funciona es `LISTEN;` + un bucle de queries vacías (`;`) que fuerza a psql a procesar y volcar las notificaciones. Particularidad de psql, no del código; documentado por si un verifier futuro tropieza.
- `verify.ts.txt` y `fire-transitions.ts.txt` quedan bajo `docs/verifications/T0.7a/` como evidencia reproducible (se ejecutan con cwd=packages/db vía `pnpm exec tsx - < script` para resolver pg/pg-boss/drizzle-orm/@ugc desde el node_modules del paquete). No son tests del producto ni tocan packages/.

## Notas adicionales (post-review)
- **NOTIFY es uno por LLAMADA a `transition()`, no uno por cambio de estado.** Cuando A2 `succeed` promueve a B (`awaiting_deps→queued`) DENTRO de la misma tx, se emite UN solo NOTIFY (payload=runId), no dos. Es deliberado: el payload es el run_id y el cliente SSE (T0.10) re-snapshotea el run entero, así que un notify por transición basta. Verificado en `verify.ts.txt` ("deps: transition(A2,succeed) emite exactamente 1 NOTIFY"). La evidencia psql literal solo ejercita transiciones de un único step, por lo que muestra limpiamente "el NOTIFY de cada transición".
- **La prueba de rollback-del-encolado usa los adaptadores directamente** (un `withTransaction` manual que encola y luego lanza), no un `transition()` que encole-y-aborte: en el script las transiciones ilegales lanzan en la validación (paso 2, ANTES del encolado del paso 4), así que ningún camino de `transition()` encola-y-revierte. No es un hueco: `transition()` usa el MISMO `makeWithTransaction`/adaptadores, y su encolado en commit ya se observó (jobs persistidos en `pgboss.job`). La atomicidad queda establecida por composición.
- **Los scripts de evidencia se guardan como `verify.ts.txt` / `fire-transitions.ts.txt`** (no `.ts`): un `.ts` bajo `docs/` rompe `pnpm gate` (eslint lo parsea y no está en ningún tsconfig → "not found by the project service"), lo que habría hecho fallar el gate post-PASS del bucle y bloqueado el commit. Renombrados a `.ts.txt` el gate vuelve a verde (exit 0, 271 tests) manteniéndolos como evidencia legible y reproducible. Para re-ejecutar: copiar a un `.ts` temporal y `cd packages/db && DATABASE_URL=... pnpm exec tsx - < <fichero>`.
