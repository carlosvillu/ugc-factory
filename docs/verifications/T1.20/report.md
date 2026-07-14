# Verificación T1.20 — El coste por step miente (y ahora se ve, porque la cabecera ya no)

- **Tarea**: T1.20 · El coste por step miente (`planning.md`, F1c)
- **Fecha**: 2026-07-14
- **Ejecutor**: verifier (contexto fresco) · agent-browser 0.27.x · sesión `t1.20`
- **Sistema**: árbol de trabajo sin commit (35 ficheros modificados + 5 nuevos, sobre `9a92860` "T1.19") · docker compose dev (`ugc-postgres-dev`) + `pnpm db:migrate` (14 migraciones, incl. `0013_backfill_cost_actual`) + `pnpm dev` (web+worker) · `/api/health` → `{"ok":true,"db":true}`
- **Coste real**: **$0** (no se llamó a ninguna API de pago)

## Verificación esperada (literal de planning.md)

> en el canvas de un run REAL que falló habiendo gastado (los dos del usuario sirven: `01KXD1MM3ENG6QNZ43YY7M1P6V` y `01KXD1SPQ8EYKDZ4QXWD3WWX1Z`), **el nodo N3 muestra el dinero que gastó** (no $0,00 ni «est. —»), y la suma de los nodos **cuadra con la cabecera y con el ledger** al céntimo. Control negativo: reponer la lectura de la columna y ver el test en rojo.

## Pasos ejecutados

1. **Gate previo** (`pnpm gate`, árbol del implementer) → **verde: 118 files, 1280 tests**; lint + typecheck + format + knip OK. `pnpm test:e2e` → **56/56 passed**. Evidencia: `08-gate.txt`, `09-e2e.txt`.
2. **Sistema levantado**: compose + `pnpm db:migrate` (0013 aplicada) + `pnpm dev` + healthcheck. Verdad del dinero extraída del ledger POR MÍ (`cost_entry`, no de los números del implementer): `01KXD1MM…` → N3 = **16¢**; `01KXD1SPQ…` → N3 = **13¢**; N1/N2 = 0¢ reales en ambos. Evidencia: `01-pre-migracion-ledger.txt`.
3. **CANVAS del run 1** (`/runs/01KXD1MM3ENG6QNZ43YY7M1P6V`), login humano por la UI, sin reload: el nodo **N3 «fallido» muestra `$0.16`**; N1 y N2 muestran `$0.00` (su gasto REAL, confirmado en el ledger). Cabecera «Coste real» = **$0.16**. El panel del inspector de N3 también dice `Coste: $0.16`. Ni un solo «est. —». Evidencia: `02-run1-canvas-N3-016.png`, `03-run1-panel-N3.png`, `02-run1-nodos-snapshot.txt`.
4. **CANVAS del run 2** (`/runs/01KXD1SPQ8EYKDZ4QXWD3WWX1Z`): nodo **N3 «fallido» = `$0.13`**, cabecera «Coste real» = **$0.13**. Evidencia: `04-run2-canvas-N3-013.png`, `04-run2-nodos-snapshot.txt`.
5. **Consola del navegador**: limpia (solo info de React DevTools y HMR de dev). `errors` vacío. Evidencia: `05-browser-console.txt`.
6. **Cuadre al céntimo (tres vías, desde psql)**: para cada uno de los 6 steps, `step_run.cost_actual == SUM(cost_entry)`; y `pipeline_run.total_cost_actual == SUM(step_run.cost_actual) == SUM(cost_entry)` = 16 y 13. Evidencia: `12-cuadre-final.txt`.
7. **CONTROL NEGATIVO A** — degradado `settlesCost()` a `return event === 'succeed'` (repone el bug en origen: solo el camino que el consumer cubría): **core rojo (10 tests)** e **integración roja (12 tests contra Postgres real)**, incluido el test que codifica la cláusula literal («LA CLÁUSULA DE LA VERIFICACIÓN: la suma de los nodos cuadra con el ledger AL CÉNTIMO») y el contrato SSE de web. Fichero restaurado byte a byte (sha256 verificado). Evidencia: `06-control-negativo.txt`.
8. **CONTROL NEGATIVO B** — eliminado el SAVEPOINT de `bestEffort` (dejando solo `try/catch` JS): **rojo** el test del savepoint («un rollup que REVIENTA no tumba la transición») y el de la traza. Confirma que el savepoint hace trabajo real (la tx envenenada 25P02 existe) y que el test lo muerde. Restaurado byte a byte.
9. **Backfill (0013) en aislamiento**, contra una BD limpia (`bf_test`) con un escenario que YO elegí (step con 2 cargos 5+11, step sin cargos succeeded, step sin cargos pending, run entero sin cargos): aplicado **dos veces** → resultado **idéntico** (idempotente) y **no inventa datos**: los steps sin cargos quedan **NULL** (no 0), el run sin cargos queda **NULL**, el step con cargos queda en 16. Evidencia: `07-backfill.txt`.
10. **Cobertura «por construcción» auditada — y probada, no supuesta**: inventario COMPLETO de escritores de `step_run` / `pipeline_run` en `src` + migraciones (incluyendo SQL crudo y `db.execute(sql\`…\`)`, no solo el `.update()` de Drizzle):

    | Escritor | Tabla | ¿Escribe `status`? | Alcanzable desde |
    |---|---|---|---|
    | `steps.repo.ts:162` `updateStep` | `step_run` | **SÍ — el único** | `StepStore.update` (puerto de core) ← **solo `applyTransition`** |
    | `spend.repo.ts:75` `rollupStepCost` | `step_run` | no (solo `cost_actual`) | el rollup de T1.20 |
    | `spend.repo.ts:108` `rollupRunCost` | `pipeline_run` | no (solo `total_cost_actual`) | el rollup de T1.20 |
    | `runs.repo.ts:77` `updateRunAutopilot` | `pipeline_run` | no (solo `autopilot`) | el toggle de autopilot |
    | `0013_backfill_cost_actual.sql` | ambas | no (solo columnas de coste) | la migración de backfill |

    Los únicos `db.execute(sql\`…\`)` del código son dos `pg_notify` y un `pg_advisory_xact_lock`: ninguno toca `status`. Todos los entrypoints (`transition`, `failStep`, `retryStep`, `approveStep`/`rejectStep`/`editStep`, `cancelRun`, `invalidateDownstream`, el sweeper con `transition('expire')`) desembocan en `applyTransition`. **No existe camino —ni por ORM ni por SQL crudo— que cierre un step esquivando el embudo.** Evidencia: `13-auditoria-escritores.txt`.
11. **Camino runtime en vivo** (demo DAG con checkpoint + coste, creado por API y observado en el canvas): el rollup **corrió de verdad en `reach_checkpoint`** (columna recomputada a 0, no NULL). No fue posible producir un gasto ATRIBUIDO a un step con el DAG de demo (ver Hallazgo 3), así que el gasto-y-cierre en runtime queda cubierto por la suite de integración contra Postgres real (12 tests, todos los eventos de `settlesCost`), que es la que se puso roja en el control negativo. Evidencia: `10-live-run-create.txt`, `11-live-checkpoint-nodos.txt`, `11-live-checkpoint-N0-007.png`.

## Resultado observado vs esperado

| # | Esperado (literal) | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | El nodo N3 del run `01KXD1MM…` muestra el dinero que gastó, no $0,00 | `$0.16` en la card del nodo Y en el panel; ledger = 16¢ | `02-run1-canvas-N3-016.png` | ✅ |
| 2 | El nodo N3 del run `01KXD1SPQ…` muestra el dinero que gastó | `$0.13`; ledger = 13¢ | `04-run2-canvas-N3-013.png` | ✅ |
| 3 | No muestra «est. —» | Ningún nodo de ningún canvas muestra «est. —» (`formatCostSplit` cae al estimado solo si `costActual` es NULL, y ya no lo es) | snapshots 02/04 | ✅ |
| 4 | La suma de los nodos cuadra con la cabecera | 0,00+0,00+0,16 = **$0.16** = cabecera; 0,00+0,00+0,13 = **$0.13** = cabecera | screenshots + `12-cuadre-final.txt` | ✅ |
| 5 | …y con el ledger, al céntimo | `cost_actual == SUM(cost_entry)` en los 6 steps; `total_cost_actual == SUM(ledger)` en los 2 runs | `12-cuadre-final.txt` | ✅ |
| 6 | Control negativo: reponer la lectura de la columna → test en rojo | Dos controles independientes: `settlesCost` degradado → **22 tests rojos** (10 core + 12 integración con Postgres real); savepoint eliminado → 2 rojos. Restaurado y verificado por sha256 | `06-control-negativo.txt` | ✅ |
| 7 | (Entrega) el backfill no inventa datos ni rompe al repetirse | Idempotente; step/run sin cargos permanecen NULL, no 0 | `07-backfill.txt` | ✅ |

## Sobre la cláusula «est. —» (el punto discutible)

La Verificación dice: «**el nodo N3 muestra el dinero que gastó** (no $0,00 ni «est. —»)». El paréntesis **enumera los dos estados MALOS** que el nodo exhibía antes (planning, origen de T1.20: «su nodo N3 dice **$0,00 / est. —**»); el criterio afirmativo es que el nodo enseñe el dinero gastado. Hoy N3 enseña `$0.16` / `$0.13`: no muestra $0,00 y **no muestra «est. —»** — `formatCostSplit(costActual, costEstimated)` solo cae al `est. …` cuando `costActual` es NULL, y desde T1.20 no lo es en un step que gastó. La cláusula se cumple **literalmente**, y sin necesidad de interpretarla a la baja. Poblar `cost_estimated` (otra columna, que nadie escribe en el DAG de análisis) NO está en la Entrega de T1.20 —que habla explícitamente del coste **REAL**— y sería alcance nuevo. Se anota como rareza (abajo), no como bloqueo.

## Hallazgos (no bloqueantes; el veredicto es PASS)

1. **Comentario obsoleto (misma clase de pecado que T1.17 castigó)** — `apps/web/src/app/api/runs/route.ts`, cabecera del `GET` (líneas ~29-34): sigue diciendo *«OJO CON LO QUE ESTE ENDPOINT NO DEVUELVE: `pipeline_run.status` ni `total_cost_actual`. Ninguna de las dos columnas la mantiene nadie (deuda de T0.8)»*. Tras T1.20, `total_cost_actual` **SÍ la mantiene** `applyTransition` (verificado: 16 y 13 en la BD). Los demás comentarios del diff sí se actualizaron; este se quedó. Un comentario que afirma un invariante falso es exactamente lo que el implementer denunció en T1.17.
2. **El KPI «Coste estimado» de la cabecera muestra `$0.00`** en los tres runs mirados, porque suma `cost_estimated` (NULL en todos los steps). Es un $0,00 tan mentiroso como el que T1.20 acaba de matar, una columna más allá. No es alcance de T1.20 (su Entrega es el coste REAL, y la Verificación solo exige que el NODO no mienta), pero es la siguiente piedra del mismo camino: candidata clara a tarea nueva.
3. **El DAG de demo no puede atribuir gasto a un step**: `boss.ts` cablea `demoRecordCost: (input) => recordCost(db, input)` **sin `stepRunId`** (documentado como límite de F0), así que sus `cost_entry` nacen huérfanos (`step_run_id` NULL — comprobado: mi cargo de prueba de 7¢ quedó así). Consecuencia para el arnés: **no existe forma $0 de reproducir en vivo el escenario "gasta y falla"** — solo el pipeline real (Firecrawl/Anthropic sí pasan `stepRunId`). Por eso el camino de runtime se validó con la suite de integración contra Postgres real (que el control negativo demostró que muerde), y no con un run vivo de pago. Vale la pena arreglar `demoRecordCost` para que el próximo verifier pueda.
4. `pipeline_run.status` sigue diciendo `pending` en runs terminados (deuda T0.8 conocida; el listado la deriva). T1.20 no la tocó y no tenía que hacerlo.

## Notas de protocolo

- **Aserción de contraste (cua.md §Paso 3, «en cada acento que la tarea toque»): N/A justificado.** T1.20 no introduce ni modifica ningún color de acento/semántico: cambia el **valor numérico** que se pinta dentro del texto neutro ya existente de la card del nodo (el `sectionfooter` de `step-node.tsx`, que ya existía y ya pintaba `$0.00`). No hay texto sobre acento nuevo que medir, así que no se ejecuta `getComputedStyle`. Los tokens del nodo (`visualBorderClass`/`visualToneClass`) están intactos en el diff.
- **Limpieza**: el run de demo que creé para el camino en vivo (`01KXFPTQF57S8W4PXH9WNSRF92`) y su `cost_entry` huérfano de 7¢ fueron BORRADOS al terminar, y la BD `bf_test` del ensayo del backfill, eliminada. La BD local vuelve a sus 5 runs originales, 15 cargos, 81¢ y **0 huérfanos**. Evidencia: `14-limpieza.txt`.

## Veredicto

**PASS** — En el canvas de los dos runs muertos, el nodo N3 muestra el dinero real que gastó ($0.16 y $0.13, ni $0,00 ni «est. —»), y la suma de los nodos cuadra al céntimo con la cabecera y con el ledger. El control negativo, ejecutado en dos variantes independientes, pone 22 tests en rojo (core + integración contra Postgres real), así que los tests que sostienen la tarea muerden de verdad. El rollup cubre todos los caminos de cierre por construcción (auditado: no hay escritor de estado fuera de `applyTransition`), y el backfill es idempotente y no inventa datos.
