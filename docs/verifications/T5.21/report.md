# Verificación T5.21 — Clase de flakes e2e (fila-más-reciente + fixture global one-shot)

- **Tarea**: T5.21 · Clase de flakes e2e: premisas sostenidas por orden de scheduling bajo `fullyParallel` (`planning.md`)
- **Fecha**: 2026-07-27
- **Ejecutor**: verifier (contexto fresco) · sin agent-browser (verificación estática + suite + BD) · stack e2e propio
- **Sistema**: commit `9d48e94` · los **4 ficheros del diff están SIN COMMITEAR** (`M` en git status). mtimes de los 4 (`05:46`–`06:00`) son ANTERIORES a ambos logs de coordinador (gate `06:12`, full-e2e `06:29`) → los logs cubren el código bajo verificación. Stack levantado a mano por Playwright (`e2e-stack.ts`, Postgres 16 vía colima) para los specs A.
- **Alcance**: SOLO los TRES entregables actuales de T5.21 — **A** (re-ancla fila-más-reciente), **B2** (aislar f5-export), **unit** (intake-form). El cuarto entregable original (B1, arming del doom en el gate) fue SEPARADO a **T5.23** el 2026-07-27; NO se verifica aquí.

## Verificación esperada (literal de planning.md)
> **(A) estático, definitivo**: no queda ningún `FROM ad_batch ORDER BY id DESC LIMIT 1` (ni lectura equivalente de fila-más-reciente de tabla compartida) en `apps/web/e2e/`. Ambos specs re-anclados verdes. Control negativo: probar anclas alternativas peores (`project_id` en app mono-usuario → recuento inflado) confirma que el ancla elegida discrimina.
> **(B2)**: `pnpm test:e2e` completo verde con f5-export bajo su proyecto propio (`--list` lo confirma SOLO bajo `[f5-export]`; `test:e2e:phases` inalterado, 4 tests). Control negativo: quitar f5-export del `testIgnore` → `--list` lo co-agenda bajo `chromium` (compite con f4).
> **(unit)**: `intake-form.test.tsx` 5/5 verde. Control negativo: revertir la re-habilitación del botón → rojo en el `waitFor` del botón, con el alert ya verde (el rojo cae donde debe).

## Pasos ejecutados
1. **Gate previo**: `pnpm gate` ya medido por el coordinador → `GATE_REAL_EXIT=0`, 2503 tests + `test:e2e:phases` 4 passed (log `regate-t521-b.log`, resumen en `gate-resumen.txt`). mtime de los 4 ficheros anterior al log → cubierto. Re-leído críticamente, no re-ejecutado.
2. **A estático**: grep de `ad_batch ORDER BY id DESC LIMIT 1` en `apps/web/e2e/` → NINGUNO. Grep ampliado (`a-grep-ampliado.txt`) de todo `ORDER BY … DESC` + `LIMIT 1`: los dos supervivientes (`brief-editor.spec.ts:222`, `script-editor.spec.ts:222`) están SCOPED por dato propio del spec (`url_analysis_id` derivado de `$1`, `batch_id` propio) — NO son lectura de fila-más-reciente de tabla compartida.
3. **A verde**: levanté un stack a mano (Playwright lo reusa) y corrí `batch-matrix.spec.ts` + `persona-library-cp2.spec.ts` bajo `--project=chromium` → **6 passed** (`a-specs-run.log`, `A_SPECS_EXIT=0`), incluyendo los dos tests que alimentan los `toHaveLength` re-anclados (`batch-matrix:182`, `persona-library-cp2:112`).
4. **A control negativo (BD viva)**: psql contra la BD del stack (puerto 33094) → `project_id` agrupa 2 `ad_batch` en un solo proyecto (inflado); el ancla N5 elegida da 1 por run.
5. **A refuerzo**: verifiqué que ningún run tiene >1 step_run N5 (el `toHaveLength(1)` lo presume) → query `HAVING count>1` vacía; 1 N5 por run.
6. **B2 positivo**: `playwright test --list` (config real, stub `.runtime.json`) → f5-export SOLO bajo `[f5-export]` (2 tests), 0 bajo chromium (`b2-list-positivo.txt`).
7. **B2 control negativo**: copié el config a `playwright.t521-negctl.config.ts` (sibling), quité `f5-export` del `testIgnore` de chromium (diff = solo línea 34), `--list` → f5-export co-agendado bajo `[chromium]` (2) además de `[f5-export]` (2). Copia eliminada (`b2-list-negativo.txt`).
8. **B2 suite completa**: `pnpm test:e2e` ya medido → `E2E_REAL_EXIT=0`, **88 passed**, tests #86/#87 bajo `[f5-export]`, f4-generation:94 verde bajo chromium (`full-e2e-resumen.txt`). `test:e2e:phases` = 4 (selecciona f1/f2/f4 por ruta; f5-export no está en esa lista).
9. **unit positivo**: `vitest run intake-form.test.tsx` → 5/5 (`unit-positivo.log`).
10. **unit control negativo**: muté `intake-form.tsx` (botón atascado en «Analizando…» tras error de servidor), corrí el test → rojo en el `waitFor` del botón con el alert verde; restauré con `git checkout --`; re-verde 5/5.

## Resultado observado vs esperado
| # | Cláusula | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|---|
| A1 | estático | 0 lecturas fila-más-reciente de tabla compartida en `e2e/` | 0 `ad_batch ORDER BY id DESC LIMIT 1`; supervivientes SCOPED por dato propio | `a-grep-ampliado.txt` | OK |
| A2 | specs verdes | batch-matrix + persona-library-cp2 verdes | 6 passed, `A_SPECS_EXIT=0` | `a-specs-run.log` | OK |
| A3 | control neg. | `project_id` infla el recuento | 2 `ad_batch` en 1 solo `project_id`; ancla N5 = 1/run | Control negativo A | OK |
| B2a | `--list` | f5-export SOLO bajo `[f5-export]` | 2 tests bajo `[f5-export]`, 0 bajo chromium | `b2-list-positivo.txt` | OK |
| B2b | suite completa | `test:e2e` verde, f5-export aislado | 88 passed, #86/#87 bajo `[f5-export]`, f4:94 verde | `full-e2e-resumen.txt` | OK |
| B2c | phases | `test:e2e:phases` inalterado, 4 tests | 4 passed | `gate-resumen.txt` | OK |
| B2d | control neg. | quitar del testIgnore → co-agenda en chromium | f5-export bajo `[chromium]` (2) + `[f5-export]` (2) | `b2-list-negativo.txt` | OK |
| U1 | unit verde | 5/5 | 5 passed | `unit-positivo.log` | OK |
| U2 | control neg. | rojo en el `waitFor` del botón, alert verde | `Unable to find role=button /analizar/i` en línea 121-122; alert (l.120) verde | `unit-control-negativo.log` | OK |

## Control negativo

Los tres entregables tienen su control negativo REPRODUCIDO, con la salida ROJA/FAIL real en cada subsección:
- **A**: un ancla peor (`project_id`) da **2 filas** donde el ancla N5 da 1/run → el `toHaveLength(1)` descuadraría (FAIL); detalle abajo.
- **B2**: quitar f5-export del `testIgnore` → `--list` lo co-agenda bajo `chromium` compitiendo con f4 por el doom; detalle abajo.
- **unit**: revertir la re-habilitación del botón → el test se pone ROJO en el `waitFor` del botón (`Test Files 1 failed`, `Expected` el botón enabled), con el `alert` ya verde — el rojo cae exactamente donde debe; salida FAIL abajo.

### A — el ancla peor (`project_id`) infla el recuento
BD viva del stack de los specs A (2 runs corridos en paralelo contra el MISMO stack):
```
-- total ad_batch en la tabla
2
-- ad_batch agrupado por project_id (mono-usuario: ensureDefaultProject agrupa TODO)
01KYGY6SCJPZTYGDXKJKJDQCXY|2
```
Un ancla por `project_id` devolvería **2 filas** → el `toHaveLength(1)` descuadraría. El ancla elegida (JOIN `step_run.config->>'batchId' WHERE node_key='N5' AND run_id=$1`) da **1 por run**:
```
-- runs con >1 step_run N5 (el toHaveLength(1) lo presume): VACIO
-- distribucion N5 por run:
01KYGY75TRNA52PFHSQVDYDGTT|1
01KYGY75VFQKH12W40SY3VNK96|1
```
Confirma que `project_id` NO discrimina y el ancla N5 sí. (Robustez: no hay indice unico `(run_id,node_key)` en `step_run`; el `toHaveLength(1)` del propio spec actua de guardian — un N5 duplicado futuro fallaria RUIDOSO, no elegiria el lote equivocado en silencio.)

### B2 — quitar f5-export del `testIgnore` lo co-agenda bajo chromium
Copia sibling `playwright.t521-negctl.config.ts`, diff = solo la linea 34 del `testIgnore`:
```
34c34
<   /spend…|partial-regeneration…|normal-generation-composes…|f5-export\.spec\.ts/,
---
>   /spend…|partial-regeneration…|normal-generation-composes…/,
```
`--list` sobre la copia (`b2-list-negativo.txt`):
```
[chromium]   › phases/f5-export.spec.ts:120  … (co-agendado — compite con f4)
[chromium]   › phases/f5-export.spec.ts:319  …
[f5-export]  › phases/f5-export.spec.ts:120  …
[f5-export]  › phases/f5-export.spec.ts:319  …
```
Sin el testIgnore, los 2 tests seeded de f5-export corren TAMBIEN bajo `chromium` `fullyParallel` → compiten por el `doomedRequestId` one-shot con f4. Copia eliminada; `git status` post = solo el config real modificado (sin residuo).

### unit — revertir la re-habilitación del botón → rojo en el `waitFor`
Mutacion aplicada a `intake-form.tsx` (deja el boton atascado en «Analizando…» tras el 500, revirtiendo el re-enable):
```diff
-          loading={isSubmitting}
-          disabled={uploading}
+          loading={isSubmitting || Boolean(errors.root?.server)}
+          disabled={uploading || Boolean(errors.root?.server)}
         >
-          {isSubmitting ? 'Analizando…' : 'Analizar'}
+          {isSubmitting || errors.root?.server ? 'Analizando…' : 'Analizar'}
```
Salida ROJA (`unit-control-negativo.log`):
```
× un 500 re-habilita el boton y muestra el error (recuperable, no atascado)
TestingLibraryElementError: Unable to find role="button" and name `/analizar/i`
 waitForWrapper …
    120|     expect(await screen.findByRole('alert')).toHaveTextContent(/boom/i…   <- VERDE
    121|     await waitFor(() => {
    122|       expect(screen.getByRole('button', { name: /analizar/i })).toBeEn…   <- ROJO
 Tests  1 failed | 4 passed (5)
```
El rojo cae EXACTAMENTE en el `waitFor` del boton (l.121-122); el `findByRole('alert')` (l.120) pasa → el alert ya esta verde, el rojo cae donde debe. Restaurado con `git checkout -- intake-form.tsx` → re-verde 5/5 (`unit-positivo.log`). El `push` no se ve afectado por la mutacion.

## Coste real
n/a — $0. Ninguna corrida llama a API de pago (fake de fal, mocks). Estimado planning: $0. OK

## Veredicto
**PASS** — los tres entregables (A, B2, unit) cumplen la Verificación literal, incluidos los tres controles negativos con la forma exacta que exige el planning.

Notas / rarezas (aunque PASS):
- **Fichero real vive en `apps/web/e2e/phases/f5-export.spec.ts`**, no en la ruta plana que sugiere el texto de planning. El `testMatch:/f5-export\.spec\.ts/` (regex sin ancla de directorio) lo captura igual. **El caveat de planning linea 807 ("UNTRACKED, WIP de T5.9") esta OBSOLETO**: el fichero esta COMMITEADO (`360f15a T5.11`), NO untracked, NO ignorado → la evidencia de B2 es durable, no local-only.
- **Los 4 ficheros del diff siguen SIN COMMITEAR** (`M` en git status) — el commit de cierre lo hara el bucle.
- No hay indice unico `(run_id, node_key)` en `step_run`; la unicidad del N5-por-run la garantiza la logica del orquestador + el guardian `toHaveLength(1)` del propio spec (robustez, no defecto).
- El comentario actualizado del config ("el discriminador `seed !== undefined` excluye los submits seedless de galeria") es CORRECTO: confirmado en `fake-apis.ts:759-763`.
