# `@ugc/worker`

**El daemon que ejecuta el pipeline.** Consume la cola de pg-boss, resuelve qué hacer con cada step y delega todo cambio de estado en el orquestador.

Es el otro _composition root_ del sistema (el primero es [`apps/web`](../web)). Ninguno importa del otro: se hablan a través de Postgres.

## Comandos

```bash
pnpm dev                              # desde la raíz: arranca web + worker
pnpm --filter @ugc/worker dev         # solo el worker (tsx watch)
pnpm --filter @ugc/worker build       # tsup
pnpm --filter @ugc/worker start       # node dist/main.js
pnpm --filter @ugc/worker test
```

## Cómo arranca

`main.ts` → `bootstrap()` → `createBoss()`. En el arranque hace ping a Postgres: si la base de datos no está, **el worker no muere — degrada** y se queda vivo sin cola (útil en desarrollo, cuando el contenedor todavía no ha levantado).

`boss.ts` es el _composition root_ de verdad: instancia pg-boss, declara las colas, crea el pool de Drizzle, el `StorageAdapter`, la clave de secretos y el registro de executors, y arranca el _sweeper_. El apagado es limpio (`SIGINT`/`SIGTERM` → `boss.stop({ graceful: true })`), así que un job en vuelo termina antes de que el proceso se vaya.

## El consumer genérico

Solo hay una cola que importa: **`step.execute`**. Su consumer es el mismo para todos los nodos del pipeline, y su ciclo es siempre este:

1. `transition('start')` — y aquí está el truco de la **idempotencia**: pg-boss entrega _at-least-once_, así que un job puede llegar dos veces. Si la transición es ilegal, significa que es una re-entrega, y el consumer sale sin hacer nada. No hay trabajo duplicado.
2. Resuelve el executor por `node_key` en el registro.
3. Lo ejecuta. Si va bien → `transition('succeed')`. Si falla → `failStep()`, que decide si toca reintentar o si es un fallo terminal (`PermanentStepError` no gasta reintentos: no tiene sentido reintentar una URL que no existe).

El consumer **no sabe** qué hace cada nodo. Solo sabe orquestar. Añadir un nodo nuevo es registrar un executor, no tocar esto.

## Los executors

Un registro `node_key → StepExecutor` (`executors/index.ts`):

- **`analysis.ts`** — `N1`, `N2`, `N3`: cáscaras finas sobre [`@ugc/services`](../../packages/services) (`runFirecrawlIngest`, `runVisualAnalyze`, `runSynthesizeBrief`). Toda la lógica está allí; aquí solo el enganche con el pipeline. `N2` sabe auto-descartarse cuando no hay imágenes que analizar: el step cierra como `skipped`, no como fallo.
- **`write-scripts.ts`** — `N5`: escribe los guiones del lote (`runWriteScripts`, Sonnet 5), los pasa por el linter FTC (guardrails de §15) y persiste las filas `ad_script` v1. Es el primer step de un run de lote **nuevo** (arrancado al confirmar la matriz en CP2) y a la vez el checkpoint **CP3**: al terminar pausa en `waiting_approval` con los guiones listos para editar. Idempotente por `step_run.id` — un reintento no vuelve a pagar Sonnet.
- **`demo.ts`** — una única implementación parametrizada (`sleepMs`, `failRate`, `hang`) registrada bajo varios `node_key`. Es el andamiaje que permite ejercitar el orquestador —retries, backoff, timeouts, checkpoints, cancelación— **sin gastar un céntimo en APIs reales**.

Los executors de generación (fal.ai) y composición (FFmpeg) aún no existen: son las fases F4 y F5.

## El sweeper

Un intervalo que llama a `sweepExpiredSteps`: los steps `running` cuyo `timeout_at` ya pasó se marcan como `expired`. Deliberadamente **no** usa el cron de pg-boss, cuya precisión es de un minuto — demasiado grueso para lo que aquí se necesita.

## Convención

**El worker nunca escribe un estado a mano.** Todo cambio pasa por `transition()` de `@ugc/core`, que es el único sitio donde se valida la legalidad, se audita, se consolida el coste y se notifica al SSE — todo en la misma transacción.
