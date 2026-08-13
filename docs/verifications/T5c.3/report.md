# Verificación T5c.3 — Poblar `pipeline_run.batchId` (la columna existe pero nunca se escribe)

- **Tarea**: T5c.3 · Poblar `pipeline_run.batchId` (`planning.md`)
- **Fecha**: 2026-08-13
- **Ejecutor**: verifier (contexto fresco) · lote live end-to-end contra fake fal + SELECT crudo · integración DB/web Testcontainers · sin agent-browser (la Verificación pide un SELECT, no una superficie UI)
- **Sistema**: working tree sobre commit `91d2f31` (rama `feat/t5b1b-i-n6-per-scene`) — el cambio de T5c.3 vive UNCOMMITTED en el working tree (14 ficheros: 12 M + 1 A test + journal). Stack e2e standalone (`scripts/e2e-stack.ts`): Postgres 16 (testcontainer) + `next build && next start` en :3100 + worker + APIs externas FALSAS ($0). El diff verificado = `03-gitdiff-before-revert.txt`.

## Verificación esperada (literal de planning.md)
> **Verificación observable**: crear un lote nuevo end-to-end → los `pipeline_run` de su N5 y de su generación tienen el mismo `batchId` no nulo, consultable con un `SELECT`. Control: un run de análisis (pre-lote) mantiene su semántica actual.

## Pasos ejecutados
1. **Gate estático**: `typecheck` (6/6 proyectos), `format:check` (clean), `lint` (0 errores; 31 warnings pre-existentes ajenos), `knip` (solo config hints). Higiene: `check-orphan-workers` → sin workers vivos (5 contenedores postgres:16 huérfanos previos, informativos).
2. **Lectura del diff completo** (código + tests). Cadena de propagación coherente: `RunDefinitionSchema.batchId?` (Zod) → `NewRunRow.batchId?` (puerto, sitio canónico del rationale) → `createRun` (spread condicional) → adapter Drizzle `insertRun` (`...(run.batchId !== undefined ? { batchId } : {})`). Los 3 callers server lo suministran: `batchRunDefinition(projectId, batchId)` fija el run-level batchId (N5, batch-dag.ts:301), `generationRunDefinition(..., {batchId})` (CP3-normal, script-checkpoint.ts) y regen (`{kind:'regen', batchId: variant.batchId}`, regen-checkpoint.ts). El run de análisis usa `analysisRunDefinition` (analysis-dag.ts:103), que NO lleva batchId → NULL (confirmado por grep).
3. **Round-trip DB real (SUT vs Postgres, Testcontainers)** — `packages/db … create-run-batchid`: 4/4 verdes. Casos leídos uno a uno (`01b-db-roundtrip-cases.txt`): LOTE→batch_id poblado; GENERACIÓN→batch_id poblado; CONTROL análisis (def SIN batchId)→NULL; HERMANOS→dos runs SEPARADOS (`n5.runId != gen.runId`) que comparten batch_id y `SELECT count(*)` devuelve exactamente 2. El assert HERMANOS compara batch_id de dos runs distintos y exige igualdad; el CONTROL exige `toBeNull()`.
4. **Propagación en los 3 callers server (integración web real)** — `apps/web … scripts-checkpoint regen-checkpoint`: 24/24 verdes, con asserts nuevos de batch_id: N5 (`runs[0].batch_id === batch.batch.id`, CP2), generación normal (`genRun.batch_id === batchId`, CP3), regen (`regenRun.batch_id === batchId`, CP4).
5. **Lote NUEVO end-to-end (la Verificación literal) al $0** — stack standalone vivo; `f4-generation.spec.ts` (@phase) conduce el journey REAL contra fake fal: URL beauty → N1/N2/N3 → CP1 → N4 → CP2 (tier PREMIUM) → N5 → CP3 → arranca el run de generación N6→N7a-e. 2/2 passed (`07-f4-live-journey.txt`). 0 hits a fal real.
6. **SELECT crudo contra la BD del stack vivo** (`08-live-select.txt`) — un run por node_keys; batch_id por run; cross-check con `ad_variant.batch_id`.

## Resultado observado vs esperado
| # | Esperado | Observado (SELECT live) | Evidencia | OK |
|---|---|---|---|---|
| 1 | Lote nuevo end-to-end crea los runs | 3 runs: análisis (N1-N4), N5, generación (N6-N9) | 07, 08 | OK |
| 2 | El run de N5 tiene batch_id NO nulo | N5 run batch_id = 01KZXRJT06P0W8P9PY4CN7CZMS | 08 | OK |
| 3 | El run de generación tiene batch_id NO nulo | Gen run batch_id = 01KZXRJT06P0W8P9PY4CN7CZMS | 08 | OK |
| 4 | N5 y generación comparten el MISMO batch_id | Idénticos (shared = true) | 08 | OK |
| 5 | CONTROL: run de análisis (pre-lote) → batch_id NULL | Análisis run batch_id = null | 08 | OK |
| 6 | Consultable con un SELECT | `SELECT pr.id, pr.kind, pr.batch_id …` devuelve las filas directamente | 08 | OK |
| 7 | Cross-check verdad de lote | pipeline_run.batch_id del run de generación == ad_variant.batch_id de sus steps | 08 | OK |

Resultado crudo del SELECT (live):
```
{"id":"...G0348","kind":"full","batch_id":null,                       "node_keys":"N1,N2,N3,N4"}      <- análisis: NULL (control)
{"id":"...SBXE","kind":"full","batch_id":"01KZXRJT06P0W8P9PY4CN7CZMS","node_keys":"N5"}               <- lote/N5
{"id":"...CJM5","kind":"full","batch_id":"01KZXRJT06P0W8P9PY4CN7CZMS","node_keys":"N6,N7a…N8,N9"}     <- generación
```

## Control negativo
ROJO reproducido: revertida temporalmente la línea `...(run.batchId !== undefined ? { batchId: run.batchId } : {})` en `packages/db/src/adapters/run-store.ts` (único punto de mapeo core→columna Drizzle). Con el spread fuera, la columna NUNCA se escribe. Los tests que respaldan el fix se ponen FAIL / Expected exactamente donde deben, y el CONTROL sigue verde:

- **DB round-trip** (`04-negctrl-db.txt`): `3 failed | 1 passed`. LOTE → `AssertionError: expected null to be 'bat_lote_01'`; GENERACIÓN → `expected null to be 'bat_lote_01'`; HERMANOS → `expected +0 to be 2`. El CONTROL análisis→NULL sigue verde (sin batchId la columna era NULL igualmente — el test discrimina lo que dice discriminar).
- **Callers web** (`05-negctrl-web.txt`): `3 failed | 21 passed`. Los tres asserts reales muerden: N5 (`scripts-checkpoint.test.ts:177` `expected null to be '01KZ…'`), generación normal (`:424`), regen (`regen-checkpoint.test.ts:294`). No son decorativos.

Restaurado el fichero desde backup; `git diff packages/db/src/adapters/run-store.ts` muestra SOLO la adición legítima del implementer (spread T5c.3) y `git diff --stat` es byte-idéntico a antes de la reversión (`03-…` == `06-…`, verificado con `diff`).

## Coste real
$0 — sin APIs de pago. El journey live corre contra el fake de fal (`127.0.0.1/fal-cdn`): los costCents del worker son contabilidad SIMULADA del fake, 0 hits a un endpoint fal real. Estimado del planning: $0. Sin desviación. Ninguna operación intentó gastar; T5c.3 es DB/orquestador determinista.

## Veredicto
**PASS** — creado un lote nuevo end-to-end (live, $0), los pipeline_run de su N5 y de su generación comparten el MISMO batch_id no nulo (01KZXRJT06P0W8P9PY4CN7CZMS, == ad_variant.batch_id), consultable con un SELECT directo; y el run de análisis (pre-lote) mantiene su semántica con batch_id NULL. El control negativo confirma que los tests (DB round-trip + 3 callers web) muerden el mapeo core→columna. Gate estático verde; DB/web/core integración+unit verdes.

Notas (rarezas, PASS igual):
- Working tree dirty en rama ajena: el cambio de T5c.3 vive uncommitted sobre `feat/t5b1b-i-n6-per-scene` (no una rama de T5c.3), base `91d2f31`. El código bajo prueba ES el del diff (git status == la lista de la tarea, sin ficheros extra). `docs/recap/` sin trackear es ajeno.
- Entrega vs Verificación (scope, se ROUTEA al bucle, no bloquea): la Entrega de T5c.3 menciona además (a) backfill de los runs viejos de prod y (b) evaluar un parentRunId para el linaje análisis→N5→generación. Ninguna forma parte de la Verificación observable (que solo pide el SELECT del lote nuevo) y NINGUNA se implementa en este diff. Además, el run de análisis queda NULL por diseño (correcto para el control), así que la cadena análisis→N5→generación NO queda atada por esta columna: eso lo cubriría parentRunId (deuda declarada, prerequisito parcial de T5c.6). Se documenta para que el CLOSE/usuario decida si backfill+parentRunId van aquí o como tarea aparte; no es FAIL porque la Verificación literal no los exige.
- 5 contenedores postgres:16 huérfanos de Testcontainers vivos bajo Colima (Ryuk off), previos; limpieza opt-in del guard. Recomendable limpiar antes del próximo gate completo.

## Evidencias
- `01-db-roundtrip.txt` / `01b-db-roundtrip-cases.txt` — round-trip DB real, 4/4 verde con nombres de caso.
- `02-web-callers.txt` — integración web, 24/24 verde (asserts batch_id de los 3 callers).
- `03-gitdiff-before-revert.txt` / `06-gitdiff-after-restore.txt` — stat idéntico (control negativo sin residuo).
- `04-negctrl-db.txt` — DB con spread revertido: 3 failed (LOTE/GEN/HERMANOS ROJO), CONTROL verde.
- `05-negctrl-web.txt` — callers web con spread revertido: 3 failed (N5/gen/regen ROJO).
- `07-f4-live-journey.txt` — lote nuevo end-to-end live ($0), 2/2 passed.
- `08-live-select.txt` — el SELECT literal contra el stack vivo + cross-check con ad_variant.batch_id.
- `09-core-unit.txt` — unit de core (batch-dag/generation-dag/create-run/run-definition), 43/43 verde.
