# Verificación DEUDA-falkey-worker — Unificar el worker a `app_setting` para la fal-key (como web)

- **Tarea**: DEUDA money-path · el worker resuelve la fal-key de `app_setting` (cifrada) vía `loadFalKey` compartido, no de `process.env.FAL_KEY`
- **Fecha**: 2026-07-20
- **Ejecutor**: verifier (contexto fresco) · sin agent-browser (verificación backend: grep + lectura + gate + tests) · sesión `tfalkey-worker`
- **Sistema**: working tree con el diff sin commitear (29 commits por delante de origin/main; HEAD `5042436`). El código verificado ES el del working tree (fal-key.ts nuevo + 3 web servers + worker migrados). Gate corre Postgres 16 vía Testcontainers (`DOCKER_HOST` al socket de Docker Desktop).

## Verificación esperada (literal del brief)
> **Cláusula 1** — Grep: el worker ya NO lee `process.env.FAL_KEY` en runtime. Debe quedar SOLO como comentario en el worker y SOLO instrumentation.ts (bootstrap env→BD) en web.
> **Cláusula 2** — Fuente única: `loadFalKey` en packages/services/src/fal-key.ts, exportado de @ugc/services, importado por los 3 servidores web + worker boss.ts; apps/web/src/server/fal-key.ts BORRADO.
> **Cláusula 3** — `pnpm gate` verde (esperado 2149 tests).
> **Cláusula 4** — Tests nuevos del sweeper (per-tick + degrade) pasan; CONTROL NEGATIVO: romper el orden per-tick pone ROJO el test "EN CADA tick" (calls=0). Revertir.
> **Cláusula 5** — resolveFalKeyOrPermanent: provider_error→PermanentStepError; otro error→retryable; resolución ANTES del primer submit en los 5 executors. Submit antes de resolución = FAIL.

## Pasos ejecutados y resultado

### Cláusula 1 — Grep (evidencia: clausula1-grep.txt)
`grep -rn "process.env.FAL_KEY" apps/worker/src apps/web/src --include="*.ts"` → 4 matches, TODOS legítimos:
- `apps/worker/src/boss.ts:115` — comentario
- `apps/worker/src/boss.ts:163` — comentario
- `apps/worker/src/executors/generation.ts:70` — comentario (JSDoc)
- `apps/web/src/instrumentation.ts:122` — bootstrap env→BD (seeding cifrado first-boot, idempotente; NO es lectura runtime)

Verificado línea a línea: ningún path de ejecución del worker (boss/sweeper/executors) lee env. **OK.**

### Cláusula 2 — Fuente única (evidencia: git status, grep de imports)
- `packages/services/src/fal-key.ts` existe; `export async function loadFalKey(db, secretsKey)` (línea 17).
- `packages/services/src/index.ts:124`: `export { loadFalKey, falOptionsFrom } from './fal-key';`
- Importan de `@ugc/services`: template-generation.ts (import multilínea, líneas 22/25), voice-preview.ts:17, persona-generation.ts:11, worker boss.ts:12. Los 3 web + worker. OK
- `apps/web/src/server/fal-key.ts` — `git status` = `D` (borrado); no existe en disco; sin referencias colgadas al módulo viejo. **OK.**

### Cláusula 3 — Gate verde (evidencia: clausula3-gate-CLEAN.txt)
NOTA metodológica: la 1a ejecución del gate corrió en background CONCURRENTE con el control negativo de la cláusula 4, así que observó el sweeper.ts roto (2 failed / 2147 passed) — resultado CONTAMINADO por mi propia edición temporal, descartado. Tras revertir y confirmar el árbol limpio, se RE-EJECUTÓ el gate:

    Test Files  209 passed (209)
          Tests  2149 passed (2149)
       Duration  69.39s

Background exit code 0. **OK (2149 tests exactos, verde).**

### Cláusula 4 — Tests del sweeper + control negativo (evidencia: clausula4-sweep-baseline.txt, clausula4-negative-control.txt)
Baseline `generation-sweep` (6/6 pass), los dos relevantes:
- (a) `el thunk de fal-key se invoca EN CADA tick (no se cachea): ... calls === 2` — PASS (33ms). Prueba resolución per-tick, no cacheada.
- (b) `sin fal-key ese tick (thunk lanza provider_error) el sweep ABORTA antes de tocar la BD` — PASS (36ms). Fila queda `submitted`, 0 downloads encolados.

CONTROL NEGATIVO: en `sweeper.ts resolveCheckStatus` moví `const key = await deps.falKey()` DESPUÉS del `if (deps.checkStatus !== undefined) return deps.checkStatus`. Resultado:
- Test "EN CADA tick" → ROJO: `AssertionError: expected +0 to be 2` (calls=0, el checkStatus inyectado bypasea el thunk) — EXACTAMENTE lo predicho.
- Test degrade → ROJO también (`resolved undefined instead of rejecting`, consistente con el mismo reorden).
Cambio REVERTIDO; orden restaurado (key-then-if); re-run 6/6 verde; `git diff sweeper.ts` = solo los cambios del fix, sin residuo del control. **OK — el test muerde.**

### Cláusula 5 — Clasificación money-safe (lectura de _shared.ts + 5 executors)
`resolveFalKeyOrPermanent` (_shared.ts:89-101):
- (a) `AppError('provider_error')` → `PermanentStepError` (líneas 96-98). No retry storm.
- (b) cualquier otro error (p.ej. BD caída) → `throw err` tal cual → retryable (línea 99).
- (c) resolución ANTES del primer submit en los 5 executors:
  - generation.ts runShotLoop: resolve L222 → runGenerationStep/submit L225. runReferenceRoute: resolve L319 → hero re-validación + uploadInputCached L356 → runShotLoop reusa la key ya resuelta L406.
  - generate-avatar Std: resolve L170 → submit L171. VEED: resolve L253 → submit L254.
  - generate-broll: resolve L179 → submit L186.
  - generate-voice: resolve L113 → submit L119.
  - generate-music: resolve L64 → submit L65.
  Ningún submit precede a la resolución → sin gasto huérfano. **OK.**

Extra confirmado: `startSweeper` degrada `provider_error` a `warn` y `return` en su propio try/catch (sweeper.ts:206-226), tras haber corrido ya `sweepExpiredSteps` en su try/catch previo (194-205) → un tick sin key sigue barriendo steps. Coincide con el fix descrito.

## Resultado observado vs esperado
| # | Cláusula | Esperado | Observado | OK |
|---|---|---|---|---|
| 1 | Grep runtime | worker solo comentarios; web solo instrumentation.ts | 3 comentarios worker + instrumentation.ts bootstrap | OK |
| 2 | Fuente única | loadFalKey en @ugc/services; 3 web + worker importan; web fal-key.ts borrado | Confirmado; módulo viejo `D`, sin refs colgadas | OK |
| 3 | Gate verde | 2149 tests | 209 files / 2149 passed, exit 0 (tras descartar run contaminado) | OK |
| 4 | Tests sweeper + control neg. | per-tick calls=2, degrade aborta; romper → rojo calls=0 | Baseline 6/6; control neg. rojo `expected +0 to be 2`; revertido verde | OK |
| 5 | Money-safe + orden submit | provider_error→Permanent; otro→retryable; resolve antes de submit x5 | Confirmado por lectura en los 5 executors; sin submit huérfano | OK |

## Coste real
$0 — sin llamadas a fal ni a ninguna API de pago. Todo verificado con grep, lectura, gate y tests (fake de fal en la suite).

## Veredicto
**PASS** — las 5 cláusulas se cumplen contra el sistema real: el worker resuelve la fal-key de `app_setting` vía `loadFalKey` compartido (per-tick en el sweeper, per-step en los executors, ANTES de cualquier submit), `process.env.FAL_KEY` ya no se lee en runtime, la fuente es única, el control negativo demuestra que el test per-tick muerde, y el gate está verde (2149 tests).

**Rarezas / notas**:
- El primer gate (background) quedó contaminado por mi propia edición del control negativo, que corría concurrente. Se descartó y se re-ejecutó limpio (2149/verde). Documentado arriba para que la evidencia sea auditable.
- El echo `GATE_EXIT=` sale vacío en el fichero (el 2o `tee` clobbea `PIPESTATUS`); el exit 0 se confirma por la notificación del background task y la ausencia de `ELIFECYCLE ... failed` en el resumen.
- El working tree tiene el diff sin commitear (esperado: es una deuda aún no cerrada por el bucle). El código verificado es exactamente ese working tree.
