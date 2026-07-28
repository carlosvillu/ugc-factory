# Verificación T5.23 (CICLO 3 — VEREDICTO VIGENTE, PASS) — `f4-generation` sobre stack REUSADO/warm

> **Este es el veredicto VIGENTE de T5.23 (ciclo 3, PASS).** Los ciclos previos (FAIL) están
> preservados: ciclo 1 en `report-fail-1.md` + `ciclo1-fail/`; ciclo 2 en `ciclo2-fail/report-fail-2.md`
> + `ciclo2-fail/`. Toda la evidencia de este ciclo vive en `ciclo3/`.
> Re-verificación tras cerrar **T5.24** (`c52c525`), el defecto de PRODUCTO que bloqueaba el `:383-390`.

- **Tarea**: T5.23 · `f4-generation` presupone caché de dedup vacía → rojo determinista sobre stack REUSADO (`planning.md`)
- **Fecha**: 2026-07-28
- **Ejecutor**: verifier · sesión backend (script/pg/e2e Playwright; sin agent-browser: superficie = suite Playwright contra el stack real)
- **Sistema**: commit `c52c525` (HEAD contiene AMBOS: `f32aa7b` T5.23 WIP + `c52c525` T5.24) · stack e2e A MANO (`apps/web/scripts/e2e-stack.ts`, testcontainer pg16 + `next dev` :3100 + worker) REUSADO por Playwright (`reuseExistingServer:!CI`, `CI` UNSET verificado, `retries:0`). Fix de T5.24 presente en el árbol: `SelectedStepPanel` wrapper con `key={selectedStepId}` en `run-shell.tsx:98,134-136`.
- **Coste real**: **$0** (fake-fal / fake-anthropic / fake-firecrawl, puertos efímeros locales — NUNCA API de pago). vs estimado $0.

## Verificación esperada (literal de planning.md)
> Arrancar un stack A MANO (`apps/web/scripts/e2e-stack.ts`, para que Playwright lo REUSE) y correr `test:e2e:phases` >=5 veces consecutivas contra ESE MISMO stack vivo -> `f4-generation` VERDE las 5. **Control negativo**: revertir el fix -> la corrida 2 sobre el mismo stack vuelve a ROJO en `:199` (linea-base en el dossier de T5.21). Un stack FRESCO por corrida OCULTA el bug (f4 pasa con o sin fix) — el escenario que muerde es el stack REUSADO/warm.

## Gate previo
- `pnpm lint` (0 err), `pnpm typecheck` (5 paquetes OK), `pnpm format:check` (OK), `pnpm knip` (OK), `pnpm test` (**239 files / 2503 tests passed**). Logs: `ciclo3/gate-*.log`. La porcion e2e del gate (`test:e2e:phases`) ES lo que se mide abajo. No se corrio `pnpm gate` entero para no arrancar un stack FRESCO (que ocultaria el bug — aviso literal de la Verificacion) ni colisionar con el stack manual.
- Entorno: `DOCKER_HOST=unix:///Users/carlosvillu/.colima/default/docker.sock` (runtime = **colima**, no Docker Desktop), `TESTCONTAINERS_RYUK_DISABLED=true`.
- Higiene: `check-orphan-workers --strict` limpio ANTES y DESPUES (sin workers ajenos contaminando la cola).

## Warm REAL confirmado
- Stack manual vivo y estable durante las 6 ejecuciones + control negativo (`{"ok":true,"db":true}` en :3100 verificado antes de CADA corrida; DB del testcontainer PERSISTE). **278 `generation_dedup_hit` acumulados** en `ciclo3/stack.log`; deltas por corrida **30 / 49 / 50 / 50 / 50 / 49** -> cross-run hit desde la corrida 2 = warm real (la corrida 1 arranca sobre DB fresca, deltas >=49 despues = la dedup acierta contra los packshots de corridas previas).

## Resultado observado vs esperado — 6 corridas (1 fresh-DB + 5 warm), MISMO stack
| Corrida | Tipo | dedup d | f4 dur | Esperado | Observado | OK |
|---|---|---|---|---|---|---|
| 1 | fresh DB | 30 | 49.9s | f1/f2/f4 verde | **VERDE** (RUN1_EXIT=0, 4 passed) | OK |
| 2 | **warm** | 49 | 40.7s | f4 verde | **VERDE** (RUN2_EXIT=0) — la corrida que mordio en ciclo 2 (`:390`) | OK |
| 3 | warm | 50 | 19.2s | f4 verde | **VERDE** (RUN3_EXIT=0) | OK |
| 4 | warm | 50 | 18.9s | f4 verde | **VERDE** (RUN4_EXIT=0) | OK |
| 5 | warm | 50 | 19.7s | f4 verde | **VERDE** (RUN5_EXIT=0) | OK |
| 6 | warm | 49 | 42.2s | f4 verde | **VERDE** (RUN6_EXIT=0) | OK |

**f4-generation warm: 5/5 VERDE (corridas 2-6). La clausula «VERDE las 5» SE CUMPLE.** f1/f2 verdes en todas (no contaminan). Logs crudos: `ciclo3/warm-run-{1..6}.log`.

- **El `:383-390` (conmutacion nodo->nodo al panel del sub-step de VIDEO) — el mecanismo M2 que produjo el FAIL #2 del ciclo 2 — quedo RESUELTO.** El locator exacto que fallo ~1/5 warm en ciclo 2 (`getByRole('complementary',{name:/N7c/}).toBeVisible` en `:390`, tras clicar el `article` del video `succeeded`) paso en las 5 corridas warm. La causa era el `StepPanel` sin `key` reusando instancia entre nodos; T5.24 lo remonta con `key={selectedStepId}` (`SelectedStepPanel` wrapper).

## Verificaciones colaterales pedidas por la tarea (EFECTIVAS)
- **Elementos 1/2/4 (URL run-unica `?run=<nonce>` + doom keyed-por-corrida + guarda del prompt N7a en `:206-220`): EFECTIVOS.** El bug ORIGINAL de T5.21 (`waitForFailedStep` vacio -> «un sub-step de generacion debe fallar de forma determinista») NO reaparecio en ninguna corrida warm con 49-50 `dedup_hit`. El doom deliberado (`PermanentStepError: … no trae images[]: {}`) se disparo por corrida — visible en `stack.log` y en `full-e2e-fresh.log`.
- **Drenado de CP4 (paso 7, `:337-340`): LOAD-BEARING y efectivo** — lo prueba el Control negativo abajo. El panel de N6 (`:376`) fue alcanzable en las 5 corridas warm.
- **Cobertura anti-T1.8 (paso 6, `finished_at` de hermanos sanos intacto tras el retry granular, `:294-315`): SIGUE MORDIENDO.** Paso en las 6 corridas.

## Control negativo
**RESULTADO: ROJO reproducido sobre el MISMO stack warm.** Comente SOLO el bucle de `approve` de los N9 (drenado de CP4, `:337-340`), dejando `waitForAllN9Waiting` + su assert de longitud, corri `test:e2e:phases` una vez sobre el stack warm (dedup activo) y f4 viro a **ROJO** (`CONTROL_EXIT=1`) en el panel de N6 — el mecanismo de precedencia de checkpoint del ciclo 1 (`QaPanel` ocupa el slot unico, `StepPanel` no monta):

```
Error: expect(locator).toBeVisible() failed
Locator:  getByRole('complementary', { name: /\bN6\b/ })
Error: element(s) not found
  - waiting for getByRole('complementary', { name: /\bN6\b/ })
    at e2e/phases/f4-generation.spec.ts:376:73
CONTROL_EXIT=1  ·  1 failed / 3 passed
```

Esto PRUEBA que el drenado de CP4 (paso 7) es LOAD-BEARING: sin el, sobre stack warm, el panel de N6 es inalcanzable — el rojo del ciclo 1. Con el drenado presente, el panel de N6 paso en las 5 corridas warm. Log completo: `ciclo3/control-negativo-drain.log`; traza del rojo en `ciclo3/negctrl-test-results/`.

Nota: el brief permitia medir CUALQUIERA de los tres controles —nonce, doom-keyed, drenado— y los tres ya se midieron rojos en ciclos previos. Se re-midio el drenado por ser el mas barato. El control negativo original de la clausula «revertir el fix -> corrida 2 ROJA en `:199`» es exactamente esta familia: sin el fix, el escenario warm vuelve rojo.

### Byte-identidad (no se modifico codigo de producto/test de forma persistente)
`git checkout HEAD -- apps/web/e2e/phases/f4-generation.spec.ts` tras el control negativo (SEGURO este ciclo: HEAD ya contiene T5.24). Shasums finales == baseline:
- `apps/web/e2e/phases/f4-generation.spec.ts`: `3563ea638c4d8d342acfe4112166b7f40377b2c6a0ab81f6018f70a4fd9610a7` **MATCH**
- `apps/web/src/components/run-canvas/run-shell.tsx`: `1da50bd6…` (T5.24, intacto)
- `packages/test-utils/src/fake-apis.ts`: `1e004c189…` **MATCH**

`git status` de codigo producto/test: LIMPIO (solo `docs/verifications` + `docs/dev-loop/journal.md`). Baseline: `ciclo3/baseline-shasums.txt`; final: `ciclo3/final-shasums.txt`.

## Deuda del doom global (premisa cambiada — CERRADA)
La tarea pidio confirmar que, con f4 usando el `Map` keyed-por-nonce, el `doomedRequestId` GLOBAL sin reclamar no deje rojo a OTRO spec bajo la suite `test:e2e` COMPLETA.

- **DATO WARM (el que la premisa nombra) — corroboracion de T5.24**: `pnpm test:e2e` de T5.24 corrio sobre un stack REUSADO/warm (`docs/verifications/T5.24/full-e2e.log`, cabecera literal «full pnpm test:e2e (warm stack reuse)»), sobre un arbol que YA contenia `f32aa7b` (el `Map` keyed-por-nonce que crea la deuda) -> **89 passed**, con los proyectos que compiten por el doom global GREEN: `[normal-generation-composes]`, `[partial-regeneration]`, `[f5-export]` (x2), `[spend]` (x3). Es el punto de dato WARM del doom.
- **DATO PROPIO (fresco)**: `pnpm test:e2e` COMPLETO sobre stack FRESCO de esta sesion -> **89 passed, exit 0** (`ciclo3/full-e2e-fresh.log`), mismos proyectos doom GREEN. Los `PermanentStepError … no trae images[]` del log son el doom deliberado de f4 disparandose bien, NO fallos.
- **GAP NOMBRADO — mis dos intentos de suite COMPLETA WARM de ESTA sesion NO ejercitaron los proyectos doom**: abortaron en el proyecto `chromium` por flakes shared-table/HMR pre-existentes (gallery / library / voice-preview, ver Rarezas), y los proyectos doom tienen `dependencies:['chromium']` -> nunca arrancaron cuando chromium fallo. Por eso mi dato WARM del doom se apoya en la corrida de T5.24 (misma configuracion, mismo `Map` keyed, cabecera «warm reuse»), no en una corrida propia. La clausula LITERAL de T5.23 pide `:phases` warm (cumplida, 5/5); la deuda del doom era un addendum a reportar, no parte de la clausula.
- **NINGUN fallo doom-shaped** (0 hits de `doom`/`waitForFailedStep`/«debe fallar de forma determinista» en los fallos observados) en ~180 ejecuciones de test entre las corridas de suite completa fresca + los intentos warm. **Deuda CERRADA: el doom global sin reclamar no starva ningun spec vecino** (evidencia warm = T5.24; evidencia fresca = esta sesion).

## Coste real
**$0** — el stack sirve fal/anthropic/firecrawl FALSOS. Ninguna API de pago tocada. vs estimado $0.

## Veredicto
**PASS** — sobre el MISMO stack REUSADO/warm, `f4-generation` dio VERDE en las 5 corridas warm consecutivas (corridas 2-6, deltas 49-50 `dedup_hit`), cumpliendo la clausula «VERDE las 5». El `:383-390` (M2, conmutacion nodo->nodo) quedo RESUELTO por T5.24. El control negativo (revertir el drenado de CP4) reprodujo el ROJO sobre warm, probando que el mecanismo es load-bearing. La deuda del doom global quedo CERRADA (suite completa 89/89 en fresco + corroboracion de T5.24).

## Rarezas (aunque el veredicto sea PASS)
- **5/5 verde NO prueba por si solo que el flake M2 desaparecio**: bajo un flake residual hipotetico de ~1/5, un lote de 5 corridas sale todo-verde ~33% de las veces. El PASS es correcto (la clausula literal es «5 verdes» y no se rebaja), PERO la evidencia DETERMINISTA de que M2 esta arreglado es el spec propio de T5.24 (`run-canvas-node-switch.spec.ts`, verde 5/5 + control negativo rojo al revertir el `key`), no estas 5 corridas.
- **Flake pre-existente T5.21/T5.22 (shared-table + HMR bajo `fullyParallel`) VIVO**: en el primer `pnpm test:e2e` warm de este ciclo (sobre la DB muy contaminada tras 6+ corridas) fallo `gallery.spec.ts:44` (`toHaveCount(0)` recibio 1); en un segundo intento el set de fallos SE MOVIO a `library.spec.ts` (x5) + `voice-preview.spec.ts` — la firma exacta del nondeterminismo por scheduling de T5.21 (journal 3134/3139). `gallery.spec.ts:44` re-corrido AISLADO sobre el mismo stack warm: **3/3 verde**. Estos rojos NO son doom-shaped (gallery/library/voice no generan; 0 hits de doom en sus trazas) ni regresion de T5.23 -> NO bloquean. Traza del rojo de gallery: `ciclo3/full-e2e-test-results/`. Son la deuda que T5.22 (correr e2e contra `next build && next start`) existe para cerrar.
- **Deuda de producto anotada (M1/CP4, NO de esta tarea)**: `run-shell.tsx:84-99` da precedencia estricta al `QaPanel` con checkpoint pendiente -> el `StepPanel` no monta. Es DELIBERADO para CP1/CP2/CP3; para CP4 es una pregunta de UI diferida (T5.24 la dejo como deuda). El drenado de CP4 del paso 7 la rodea y sigue load-bearing.
- Runtime Docker = colima, no Docker Desktop; `DOCKER_HOST` al socket de colima para testcontainers.
