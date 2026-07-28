# Verificación T5.23 (CICLO 2 — VEREDICTO VIGENTE) — `f4-generation` sobre stack REUSADO/warm

> **Este es el veredicto VIGENTE de T5.23 (ciclo 2, FAIL).** El ciclo 1 (también FAIL, por otra
> línea) está preservado en `report-fail-1.md`. La evidencia del ciclo 1 vive en `ciclo1-fail/`.

- **Tarea**: T5.23 · defecto de infra de test e2e — f4-generation verde sobre stack reusado (`planning.md`)
- **Fecha**: 2026-07-28
- **Ejecutor**: verifier · sesión backend (script/pg/e2e; sin agent-browser: superficie = suite Playwright)
- **Sistema**: diff uncommitted sobre commit `92e0eaf` · stack e2e A MANO (`apps/web/scripts/e2e-stack.ts`, testcontainer pg16 en :33156 + `next dev` :3100 + worker) REUSADO por Playwright (`reuseExistingServer:!CI`, `CI` UNSET verificado, `retries:0`)
- **Coste real**: $0 (fake-fal / fake-anthropic / fake-firecrawl — NUNCA API de pago)

## Verificación esperada (literal de planning.md)
> Arrancar un stack A MANO (`apps/web/scripts/e2e-stack.ts`, para que Playwright lo REUSE) y correr `test:e2e:phases` >=5 veces consecutivas contra ESE MISMO stack vivo -> `f4-generation` VERDE las 5. Control negativo: revertir el fix -> la corrida 2 sobre el mismo stack vuelve a ROJO. Un stack FRESCO por corrida OCULTA el bug — el escenario que muerde es el stack REUSADO/warm.

## Gate previo
- `pnpm lint` (0 errores; 28 warnings pre-existentes de terceros), `pnpm typecheck` (5 paquetes OK), `pnpm knip` (OK), `pnpm format:check` (OK), `pnpm test` (**239 files / 2503 tests passed**). La porcion e2e del gate (`test:e2e:phases`) ES lo que se mide abajo — no se corrio `pnpm gate` por separado para no colisionar con el stack manual ni arrancar uno fresco (que ocultaria el bug, aviso literal de la Verificacion).
- Entorno: `DOCKER_HOST=unix:///Users/carlosvillu/.colima/default/docker.sock` (el runtime activo es **colima**, NO Docker Desktop). `TESTCONTAINERS_RYUK_DISABLED=true`. Chromium ya instalado.

## Warm REAL confirmado
- Stack manual vivo y estable durante las 6 ejecuciones (`{"ok":true,"db":true}` en :3100; DB del testcontainer PERSISTE entre corridas). **326 `generation_dedup_hit` acumulados** en `stack.log`; deltas por corrida 32/50/49/48/49 — cross-run desde la corrida 2 = warm real.

## Resultado observado vs esperado (5 corridas VERDICTED + 1 parcial abortada, mismo stack)
| Corrida | genrun | f4 dur | dedup d | Esperado | Observado | OK |
|---|---|---|---|---|---|---|
| 1 (fresh DB) | `01KYMX1TFE` | 72s | 32 | f4 verde | **VERDE** (RUN1_EXIT=0) | OK |
| 2 (warm) | `01KYMX4W73` | 33.0s | 50 | f4 verde | **ROJO** `:390` `getByRole('complementary',{name:/N7c/})` `toBeVisible` timeout 15s (RUN2_EXIT=1) | FAIL |
| 3 (warm) | `01KYMX61TP` | 39.1s | 49 | f4 verde | **VERDE** (RUN3_EXIT=0) | OK |
| — (parcial, ABORTADA) | `01KYMX7DFP` | — | — | — | SIN VEREDICTO — SIGTERM del timeout de 2 min del harness ANTES del paso 7 | — |
| 4 (warm, retry) | `01KYMXAT49` | 16.8s | 48 | f4 verde | **VERDE** (RUN4_EXIT=0) | OK |
| 5 (warm) | `01KYMXBVDW` | 16.1s | 49 | f4 verde | **VERDE** (RUN5_EXIT=0) | OK |

**f4-generation warm: 4/5 VERDE, 1/5 ROJO (corrida 2).** La clausula «VERDE las 5» NO se cumple. f1/f2 verdes en todas (no contaminan).

Notas de conteo (para el lector futuro): (a) hubo **6** ejecuciones f4 en el mismo stack; la parcial `01KYMX7DFP` la mato el timeout de 2 min del harness a mitad y **no cuenta** — sus 6 N9 quedaron varados en `waiting_approval` como ARTEFACTO del SIGTERM, no como evidencia sobre el fix. (b) La linea `run4 … 844-843 … exit=1 wall=0s` en `dedup-markers.txt` es un no-op de zsh noclobber, no una corrida. Detalle en `dedup-markers.txt`.

## Causa raiz OBSERVADA — el rojo NO es el mecanismo del ciclo 1; el drenado (elemento 3) SI funciona
El rojo de la corrida 2 cae en `:390` — el `complementary` del panel del **sub-step de VIDEO** (N7c) — DESPUES de que pasaran (a) la guarda del drenado `:348` (`[data-slot="qa-panel"] toHaveCount(0)`) y (b) el panel de N6 `:376`. Verificado en BD (testcontainer vivo, `pg` directo): la genrun de la corrida 2 (`01KYMX4W73`) tiene sus **6 N9 `succeeded`** (`waiting=0`), y `stack.log` (ventana 271-464) muestra los **6 POST `/api/steps/:id/approve` -> 200** del bucle de drenado (lineas 448-458). Por tanto **el drenado de CP4 (elemento 3) SE EJECUTO y funciono**: CP4 quedo vacio, el `StepPanel` monto, el panel de N6 fue alcanzable. El fallo del ciclo 1 (N6/N7d inalcanzables porque `QaPanel` ocupaba el slot por precedencia de checkpoint, `run-shell.tsx:95-98`) **NO reaparecio en ninguna de las 5 corridas verdicted**.

El rojo residual es un mecanismo NUEVO Y DISTINTO, aguas abajo del drenado: tras montar el panel de N6, al clicar el `article` del sub-step de video YA `succeeded` (`:383-387`) su `complementary` no monto en 15s (~1/5 warm). Candidatos (a delimitar por el implementer): la seleccion de nodo del canvas/store no conmuta entre dos clicks consecutivos (N6 -> video), o un reflow al montar el `StepPanel`. **No es el drenado.**

Limitacion de evidencia: los artefactos de Playwright de la corrida 2 (trace/video/screenshot) los sobrescribio la corrida 3 antes de copiarlos (el `test-results` es global). El extracto de log con el locator `getByRole('complementary', { name: /\bN7c\b/ })` en `:390` (`warm-run-2.log`) es la evidencia primaria del rojo. Por esa perdida no se distingue "panel de otro nodo abierto" de "ningun complementary" — no se re-corre persiguiendo un flake ~1/5.

## Verificaciones colaterales pedidas por la tarea
- **Elementos 1/2/4 (URL run-unica + doom keyed-por-corrida + guarda del prompt N7a): EFECTIVOS.** El bug ORIGINAL de T5.21 (`waitForFailedStep` vacio -> «un sub-step de generacion debe fallar de forma determinista») NO reaparecio en ninguna corrida warm con 48-50 `dedup_hit`. El `PermanentStepError: el output de la generacion no trae images[]: {}` (el doom deliberado) si se disparo por corrida.
- **Cobertura anti-T1.8 (paso 6, `finished_at` de hermanos sanos intacto tras el retry): SIGUE MORDIENDO.** El bloque `:294-315` lee el `finished_at::text` de los hermanos `succeeded` ANTES del retry, exige que no sean NULL, y re-compara `toBe` la MISMA fila tras el retry. Intacto en el diff (solo se reescribio su comentario). Paso en las 5 corridas verdicted.

## Control negativo
**RESULTADO: ROJO reproducido sobre el MISMO stack warm.** Comente SOLO el bucle de `approve` del paso 7 (dejando `waitForAllN9Waiting` + su assert de longitud), corri `test:e2e:phases` una vez sobre el stack warm (49 `dedup_hit`) y f4 viro a **ROJO** (`CONTROL_EXIT=1`) en el panel de N6 — el mecanismo de precedencia de checkpoint del ciclo 1:

```
Error: expect(locator).toBeVisible() failed
Locator: getByRole('complementary', { name: /\bN6\b/ })
Expected: visible
Timeout: 15000ms
Error: element(s) not found
    at e2e/phases/f4-generation.spec.ts:376:73
CONTROL_EXIT=1  ·  1 failed / 3 passed
```

Esto PRUEBA que el elemento 3 (el drenado de CP4) es LOAD-BEARING: sin el, sobre stack warm, el panel de N6 es inalcanzable (`QaPanel` ocupa el slot unico) — exactamente el rojo del ciclo 1. Con el drenado presente, el panel de N6 paso en las 5 corridas verdicted. Log completo en `control-negativo-drain.log`.

Nota: el control negativo cayo en `:376` (panel N6), no en la guarda `:348` (`qa-panel toHaveCount(0)`) — esta ultima no viro en esta corrida (transitorio tras el `goto`), pero el rojo aterrizo igualmente en el mecanismo de precedencia que el drenado existe para evitar. El positivo del propio ciclo (corrida 2 roja) ya es evidencia directa adicional del FAIL.

### Byte-identidad (no se modifico codigo de producto/test de forma persistente)
Post-run `shasum -a 256` == baseline (`baseline-shasums.txt` == `post-run-shasums.txt`):
- `apps/web/e2e/phases/f4-generation.spec.ts`: `3563ea638c4d8d342acfe4112166b7f40377b2c6a0ab81f6018f70a4fd9610a7` OK
- `packages/test-utils/src/fake-apis.ts`: `1e004c189c2d417852c0974401ff96b6e7b18bad6920b5a536140c9be75b3d07` OK

La edicion del control negativo (comentar el bucle de approve) se revirtio BYTE-IDENTICA tras la corrida. El `M f4-generation.spec.ts` de `git status` es el diff del implementer (el fix), presente al inicio de la sesion — su shasum casa con el baseline.

## Coste real
$0 — el stack sirve fal/anthropic/firecrawl FALSOS (puertos efimeros locales). Ninguna API de pago tocada. vs estimado $0.

## Veredicto
**FAIL** — sobre el mismo stack REUSADO/warm, `f4-generation` dio ROJO en 1 de 5 corridas verdicted (corrida 2, `:390`), incumpliendo la clausula «VERDE las 5». El rojo NO es el mecanismo que el fix ataca (el drenado de CP4 FUNCIONO: N9 `succeeded`, panel de N6 alcanzable), sino un mecanismo NUEVO Y DISTINTO en la inspeccion del panel del sub-step de VIDEO (`:390`, `complementary` de N7c no monta ~1/5 warm), aguas abajo del drenado.

### Que debe arreglar el implementer (accionable)
- **NO re-tocar el elemento 3 (drenado de CP4): es efectivo y load-bearing** — el control negativo lo demuestra (quitarlo -> rojo del ciclo 1). Tampoco los elementos 1/2/4 (verificados efectivos: el `waitForFailedStep` vacio no reaparecio con 48-50 dedup hits/corrida).
- **El rojo residual esta en la inspeccion del panel del sub-step de VIDEO (`:383-390`)**, NO en el drenado. Tras clicar el `article` del video `succeeded` (despues de haber inspeccionado N6), su `complementary` (`getByRole('complementary',{name:/N7c/})`) no monta en 15s ~1/5 sobre warm. Delimitar en el canvas/store: la seleccion de nodo no conmuta entre dos clicks consecutivos, o hay un reflow al montar el `StepPanel`. Es la MISMA familia de la deuda de producto ya anotada (`run-shell.tsx:95-98`, slot unico con precedencia de checkpoint), pero ahora en la conmutacion N6->video, no en CP4.

## Rarezas (aunque el mecanismo del fix funciona)
- **AVISO — este es el FAIL #2 de T5.23 -> circuit breaker (2 FAIL consecutivos del verifier en la misma tarea): el bucle PARA.**
- La deuda de producto (`run-shell.tsx:95-98`) sigue siendo la causa estructural que el fix de test rodea — el rodeo funciona para N6, pero la conmutacion de paneles nodo->nodo sobre warm sigue teniendo un flake ~1/5.
- Retrocompat del doom (fuera de alcance de `test:e2e:phases`): cuando f4 usa el `Map` keyed-por-nonce, el `doomedRequestId` global queda sin reclamar; bajo la suite `test:e2e` COMPLETA un spec que antes perdia la carrera del doom frente a f4 podria ahora quedar doomed. No afecta a esta Verificacion.
- El runtime Docker de esta maquina es **colima**, no Docker Desktop; `DOCKER_HOST` hubo que fijarlo al socket de colima para que testcontainers arrancara.
