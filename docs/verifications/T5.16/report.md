# Verificación T5.16 — Un 403/401 permanente de fal se reintenta ~80 veces (cada envío se paga)

- **Tarea**: T5.16 · Un 403/401 permanente de fal se reintenta ~80 veces (cada envío se paga) (`planning.md`)
- **Fecha**: 2026-07-26
- **Ejecutor**: verifier (subagente dev-loop) · sin agent-browser (tarea BACKEND, sin superficie UI) · runtime colima
- **Sistema**: commit `1ddc63e` + diff SIN COMMITEAR bajo verificación (`apps/worker/src/executors/_shared.ts`, `apps/worker/src/executors/_shared.test.ts`, `apps/worker/test/integration/n7-permanent-provider-error.test.ts`). Blob de `_shared.ts` verificado = `9b9fe01` (el del diff de T5.16). Test-driven contra Postgres real (Testcontainers/colima) — NO fal real. `TESTCONTAINERS_RYUK_DISABLED=true` en cada comando.

## Verificación esperada (literal de planning.md)
> Con el fake de fal devolviendo **403**, el step N7 llega a `failed` terminal con **UN solo submit** (medido sobre el contador de llamadas del fake — la métrica que muerde, porque fal cobra por submit; `retry_count <= max_retries` es infalsificable con max=80). Y un fake que devuelva **timeout/red** conserva el reintento (la clasificación no se pasó de ancha).

## Superficie y método
Tarea 100% backend (clasificación de errores en `runGenerationStep`, camino money del worker). La Verificación se ejecuta con el test de integración `n7-permanent-provider-error.test.ts`, que conduce el **consumer REAL** de producción (`registerStepConsumer` vía `startWorkerWith`) contra Postgres real; lo ÚNICO simulado es la respuesta HTTP de fal (`FalProviderError`). NO es un seam: la métrica es `submits()`, incrementada DENTRO del `fn` de `runGenerationStep` — la línea exacta donde un N7 real paga.

### El camino de producción es el mismo que el test ejerce (traza, no dead-code)
El fix vive en `runGenerationStep` (`_shared.ts`). Verifiqué que en PRODUCCIÓN un 403 de N7b llega raw a ese clasificador (no lo intercepta ningún catch intermedio):

1. `apps/worker/src/executors/generate-voice.ts:119` — el N7b real envuelve el submit a fal DENTRO del callback: `runGenerationStep(() => runGenerateAudio(...))`.
2. `packages/services/src/generate-audio.ts:199` — `runGenerateAudio` hace `fal.submit(...)`; sus dos `catch (err)` (líneas 471, 765) solo marcan la fila `failed` y re-lanzan **el error original** (`throw err`, líneas 480, 777) — NO lo tragan ni lo re-envuelven.
3. `packages/core/src/generation/fal-client.ts:367-368` — `submit` captura el error del SDK y lanza `toProviderError(err)`.
4. `packages/core/src/generation/fal-client.ts:488` — `toProviderError` construye `new FalProviderError("fal submit falló con {status}: {message}", { status })` — el mensaje EXACTO del bug real ("fal submit falló con 403: User is locked. Reason: Exhausted balance.") con su status HTTP.

Conclusión: el `FalProviderError({status:403})` producido en producción propaga raw hasta el callback de `runGenerationStep` → cae en la nueva rama `FAL_PERMANENT_STATUSES` → `PermanentStepError` → `consumers/step-execute.ts:207-215` (`transition('fail', { error: { message, permanent: true } })`, terminal, SIN `failStep`). La rama NO es código muerto: se asienta sobre el path del bug del 403.

## Pasos ejecutados
1. `pnpm gate` completo (tras matar orphans de `next dev`/`src/main.ts`) → verde: **235 test files / 2482 tests + 4 e2e phase** (evidencia `gate.txt`).
2. Los 2 ficheros de T5.16 en aislado → **18 tests passed**.
3. Integration file en `--reporter=verbose` → los 5 casos del bug ejecutan y pasan (evidencia `integration-verbose.txt`): 403->1 submit terminal; 401->1 submit; 422->1 submit; 429->reintenta y triunfa (>1 submit); timeout/undefined->reintenta y triunfa.
4. Lectura del `_shared.test.ts` (regla 5): el test que cementaba «FalProviderError 429/timeout -> SUBE TAL CUAL» se REFINÓ, no se relajó.
5. Control negativo #1 (rama deshabilitada) → 403 ROJO. Restaurado.
6. Control negativo #2 (fix demasiado ancho) → 429/timeout ROJO. Restaurado. `_shared.ts` blob = `9b9fe01` (idéntico al diff), re-run verde.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | 403 -> `failed` terminal en 1 submit (no ~81) | Consumer real: `submits()===1`, `status==='failed'`, `retry_count===0`, `error.permanent===true`, mensaje accionable (`/PERMANENTE del proveedor/`, `/Ajustes -> fal/`) + original (`/Exhausted balance/`) | `integration-verbose.txt` | OK |
| 2 | 401/422 también permanentes (decisión 422 justificada) | 401->1 submit terminal; 422->1 submit terminal. 422 documentado en docblock `FAL_PERMANENT_STATUSES` Y pinchado con test (`it.each([403,401,422])` + integración `it.each([401,422])`) | `integration-verbose.txt` | OK |
| 3 | timeout/red conserva el reintento (no se pasó de ancho) | 429 y timeout/undefined: reintentan y triunfan (`status==='succeeded'`, `submits()===3`, `retry_count===2`) — NO permanentes | `integration-verbose.txt` | OK |
| 4 | Métrica = SUBMITS, no retry_count (T5.14) | El fake cuenta `submits` DENTRO del `fn` de `runGenerationStep`; asserts sobre `submits()` (1 permanente, 3 transitorio) | test l.184-185, l.250 | OK |
| 5 | Gate verde con el cambio | 235 files / 2482 tests + 4 e2e phase, 0 errores lint | `gate.txt` | OK |
| 6 | Regla 5: 429/timeout SIGUE aserido retryable | `_shared.test.ts` separa 403/401/422->Permanent vs 429/timeout/undefined/503->retryable. MÁS FINO, no relajado | `git diff _shared.test.ts` | OK |
| 7 | N7b real alcanza el clasificador (no dead-code) | Traza generate-voice->generate-audio->fal-client: FalProviderError raw propaga al callback | file:line arriba | OK |

## Control negativo
Ambas ramas reproducidas por MÍ editando `apps/worker/src/executors/_shared.ts`, corriendo el test, y restaurando. Tras restaurar: blob de `_shared.ts` = `9b9fe01` (idéntico al diff de T5.16) y re-run de los 2 ficheros VERDE (18 passed). `git diff apps/worker/src` no contiene residuo de las ediciones temporales.

**#1 — Rama DESHABILITADA (`if (false && ...)`)**: el 403 deja de ir a `failed` terminal en 1 submit; vuelve a la rama retryable -> el consumer lo re-encola hasta 80 veces (backoff 50ms del test), así que NO alcanza terminal dentro de la ventana y `waitFor 'failed'` agota los 30s. Es el retry-storm exacto del bug (re-submit facturable, no muerte en 1). ROJO:

```
 ❯ test/integration/n7-permanent-provider-error.test.ts (5 tests | 1 failed | 4 skipped) 30232ms
     × un 403 "saldo agotado" con maxRetries=N7_MAX_RETRIES → failed terminal en EXACTAMENTE 1 submit (no ~81) 30101ms
 FAIL  ... > un 403 "saldo agotado" con maxRetries=N7_MAX_RETRIES → failed terminal en EXACTAMENTE 1 submit (no ~81)
Error: timeout (30000ms) esperando: N7b failed terminal por 403 permanente
 ❯ waitFor test/helpers.ts:29:13
 Test Files  1 failed (1)
      Tests  1 failed | 4 skipped (5)
```

**#2 — Fix DEMASIADO ANCHO (`if (err instanceof FalProviderError)` sin filtro por status -> TODO colapsa a permanente)**: los transitorios (429 y timeout/undefined) van a `failed` en 1 submit en vez de reintentar y triunfar -> mata un reintento legítimo -> ambos `waitFor 'succeeded'` agotan los 30s. ROJO:

```
 ❯ test/integration/n7-permanent-provider-error.test.ts (5 tests | 2 failed | 3 skipped) 60345ms
     × CONTROL NEGATIVO — un FalProviderError '429 (rate limit)' SIGUE retryable: reintenta y triunfa (>1 submit, NO permanente) 30141ms
     × CONTROL NEGATIVO — un FalProviderError 'timeout/red (status undefined)' SIGUE retryable: reintenta y triunfa (>1 submit, NO permanente) 30089ms
 FAIL  ... > CONTROL NEGATIVO — un FalProviderError '429 (rate limit)' SIGUE retryable: reintenta y triunfa (>1 submit, NO permanente)
 FAIL  ... > CONTROL NEGATIVO — un FalProviderError 'timeout/red (status undefined)' SIGUE retryable: reintenta y triunfa (>1 submit, NO permanente)
Error: timeout (30000ms) esperando: N7b succeeded tras reintentar un transitorio
 ❯ waitFor test/helpers.ts:29:13
 ❯ test/integration/n7-permanent-provider-error.test.ts:239:7
 Test Files  1 failed (1)
      Tests  2 failed | 3 skipped (5)
```

## Regla 5 — modificación de test existente (refinamiento, NO debilitamiento)
`_shared.test.ts` tenía UN test cementando «FalProviderError (429/timeout/red) -> SUBE TAL CUAL». El diff lo separa en dos `it.each`:
- `it.each([403,401,422])` -> `.rejects.toBeInstanceOf(PermanentStepError)` + mensaje `/Ajustes -> fal/` (NUEVO invariante permanente).
- `it.each([429, {}, 503])` -> `.rejects.toBe(err)` + `.not.toBeInstanceOf(PermanentStepError)` (el invariante retryable ORIGINAL, ahora explícito para 429/timeout/undefined/503).

El 429/timeout SIGUE aserido retryable; solo 403/401/422 cambian a permanente. El invariante se hace MÁS FINO. No es debilitamiento.

## Coste real
**$0** — el fake devuelve `FalProviderError` sintéticos (403/401/422/429/timeout); ninguna llamada a fal real. Estimado $0. Sin desvío.

## Veredicto
**PASS** — la Verificación literal se cumple en ambas direcciones: 403 (y 401/422) -> `failed` terminal en EXACTAMENTE 1 submit medido sobre el contador del fake, con `permanent:true` y mensaje accionable; timeout/red (y 429) conservan el reintento y triunfan. El test conduce el consumer real (no un seam) y mide submits. Ambos controles negativos reproducidos por el verifier salen ROJOS y se restaura el diff exacto (blob `9b9fe01`). Gate completo verde. El fix se asienta sobre el path de producción del bug (traza N7b->generate-audio->fal-client confirmada file:line), no es dead-code. Regla 5 respetada (refinamiento).

### Rarezas / notas
- **CN#1 es rojo por timeout (retry-storm), no por assert de `submits()===81`.** Con la rama deshabilitada el step nunca llega a terminal dentro de los 30s, así que el `waitFor 'failed'` revienta ANTES de poder aserir el nº de submits. Sigue siendo ROJO inequívoco y es la firma exacta del bug. El assert `submits()===1` sí muerde en el mundo verde (el fix hace terminal en 1).
- **La Verificación dice "el step N7" pero el bug fue N7b.** El fix es en `runGenerationStep`, compartido por TODOS los N7 que enrutan su submit por él. Verifiqué N7b (generate-voice) explícitamente; los hermanos N7a/N7c/N7d/N7e/N7f heredan la clasificación por construcción, pero no ejercí cada uno end-to-end (fuera del alcance del bug). Nota, no bloqueo.
- **422 clasificado como permanente** por decisión documentada (docblock `FAL_PERMANENT_STATUSES` + docblock de rama): config inmutable entre vueltas => fal re-valida el mismo payload => mismo rechazo. Pinchado con test en ambos ficheros. Justificado y verificado, no solo prosa.
