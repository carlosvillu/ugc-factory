# Verificación T5.15 — El seed no contiene ninguna Persona capaz de completar un lote generativo

- **Tarea**: T5.15 · seed con ≥1 Persona batch-ready + error accionable en CP3 para persona sin imagen (`planning.md`)
- **Fecha**: 2026-07-26
- **Ejecutor**: verifier (subagente dev-loop) · sin agent-browser (superficie backend/tests) · psql sobre BD dev real
- **Sistema**: `HEAD 26f5e73` (incluye T5.16, committeado DESPUÉS del código de T5.15 en ffaddb4+dd59a10) + artefactos uncommitted bajo verificación (cua.md l.49: «git status limpio O anota el diff»):
  - `packages/db/test/integration/persona-seed.test.ts` (M) — Test A
  - `apps/web/test/integration/api/cp3-seed-persona.test.ts` (??) — Tests B y C
  - `docs/dev-loop/journal.md` (M)
  - Docker: colima · Postgres 16 (`docker-compose.dev.yml`) · `pnpm db:migrate` + `pnpm seed` (seed REAL de personas)

## Verificación esperada (literal de planning.md / brief)
> «Con la BD sembrada de cero (sin inserciones manuales), un lote premium llega a **arrancar generación** con una Persona del seed. Y una persona sin imagen produce un error **accionable** en CP3, no un 500.»
> Playwright/test permanente: «partiendo del seed limpio, existe al menos una Persona que pasa los dos gates (avatar + voz) y CP3 arranca generación con ella. Control negativo: sembrar solo personas placeholder → el test se pone ROJO.»
> Cláusula fal: «validar contra fal que la voz sembrada se acepta» (satisfecha por evidencia PRIMARIA existente, NO se re-gasta).

## Pasos ejecutados
1. `docker compose up -d` + `db:migrate` + `pnpm seed` (SEED REAL, path completo sharp/FS/guard >=2K, NO el memory-storage double de los tests) -> 11 personas, 23 imágenes de referencia; Maya recibe 3 imágenes 1638x2048 (log `seed-real-run.txt`).
2. **Evidencia primaria de BD por psql** (`seed-real-psql.txt`, `seed-real-psql-maya-assets.txt`): predicado batch-ready sobre las 11 personas sembradas -> **solo Maya = t**. Maya: 3 reference_image_ids, 3 filas `asset kind='reference_image'` materializadas (= declared), voice_map real (`EXAVITQu4vr4xnSDxMaL`/`Rachel`), sin sufijo `(placeholder)`. Las 10 placeholder: 2 imágenes cada una pero voz `placeholder-*` -> batch_ready=f.
3. **Cláusula 2 (arranca generación) — Test B** (`web:integration`, `testBC-green.txt`): desde el seed limpio, persona DERIVADA por predicado batch-ready (no cableada), `POST /approve` -> 200 + `nextRunId` + sub-DAG N6(queued)/N8/N9 encolado. PASA.
4. **Cláusula persona-sin-imagen — Test C** (`web:integration`): persona premium sin imágenes -> 400 `validation_error` a nivel de RUTA, mensaje nombra la persona + N7c/avatar + imagen de referencia. PASA.
5. **Test A** (`db:integration`, `testA-green.txt`): el seed REAL materializa >=1 persona batch-ready con FILAS asset reales (no proxy `referenceImageCount`). 4/4 PASA.
6. **Cláusula fal** — evidencia primaria existente `docs/verifications/T5.9/probes/voice-probe.txt` (2026-07-25): `EXAVITQu4vr4xnSDxMaL` -> 200 OK Y `Rachel` -> 200 OK, ambos en `tts/eleven-v3` (endpoint real). Son los 2 voiceIds de Maya. NO se re-gasta fal.
7. **Controles negativos** (ver sección) — ambos muerden con el assert correcto.
8. **Gate completo** (`gate.txt`): lint 0 errores (28 warnings permitidos), 236 files / 2485 tests passed, e2e phases 4 passed. Exit 0.
9. Diff de producto restaurado a VACÍO tras las mutaciones; tests permanentes intactos.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | BD sembrada de cero deja >=1 persona batch-ready (2 gates) | Maya, y solo Maya, batch_ready=t sobre las 11 sembradas | seed-real-psql.txt | OK |
| 2 | Imágenes de la persona batch-ready MATERIALIZADAS en BD | 3 filas `asset kind=reference_image` = 3 declared_ids | seed-real-psql-maya-assets.txt | OK |
| 3 | Voz sembrada aceptada por fal | Sarah(EXAVITQu4vr4xnSDxMaL)+Rachel -> 200 en eleven-v3 | T5.9/probes/voice-probe.txt | OK |
| 4 | Lote premium ARRANCA generación con persona del seed | 200 + nextRunId + N6(queued)/N8/N9 (persona DERIVADA, no cableada) | testBC-green.txt | OK |
| 5 | Persona sin imagen -> 400 accionable, NO 500, a nivel de RUTA | 400 validation_error, mensaje nombra persona + N7c/avatar + imagen | testBC-green.txt | OK |
| 6 | Test A asserta FILAS reales, no proxy | assert cuenta `asset` rows, muerde sobre BD | testA-green.txt / código | OK |
| 7 | Gate verde con el estado bajo verificación | 236/236 files, 2485 tests, e2e 4 passed, exit 0 | gate.txt | OK |

## Control negativo
Reproducidos por el verifier (no confiando en el implementer). Diff de producto restaurado a VACÍO al terminar.

**Control 1 — quitar MAYA de `PERSONA_SEEDS` (seed-data.ts) -> el seed queda sin persona batch-ready.**
Test A (`db:integration persona-seed -t "batch-ready"`) -> ROJO con el assert CORRECTO (el batch-ready, no el self-referential `personas.toBe`):
```
FAIL test/integration/persona-seed.test.ts > ... (T5.15, Test A)
AssertionError: el seed REAL no dejó NINGUNA persona batch-ready en BD: un usuario recién
instalado no puede completar un lote generativo: expected 0 to be greater than 0
 test/integration/persona-seed.test.ts:172:7
 Test Files  1 failed (1)
      Tests  1 failed | 3 skipped (4)
```
Test B (`web:integration cp3-seed-persona -t "arranca generación"`) -> ROJO ANTES de tocar la ruta (filtro batch-ready vacío):
```
FAIL test/integration/api/cp3-seed-persona.test.ts > ... (T5.15, Test B)
AssertionError: el seed no dejó NINGUNA persona batch-ready: un usuario recién instalado
no puede arrancar un lote: expected undefined to be defined
 test/integration/api/cp3-seed-persona.test.ts:330:7
 Test Files  1 failed (1)
      Tests  1 failed | 1 skipped (2)
```

**Control 2 — revertir el mapeo `PersonaWithoutReferenceImageError`->400 en checkpoint-errors.ts (que caiga al 500).**
Test C (`web:integration cp3-seed-persona -t "400 accionable"`) -> ROJO con `expected 500 to be 400` en la LÍNEA DEL STATUS (411), antes de los asserts de mensaje:
```
FAIL test/integration/api/cp3-seed-persona.test.ts > ... (T5.15, Test C)
AssertionError: expected 500 to be 400 // Object.is equality
- Expected  400
+ Received  500
 test/integration/api/cp3-seed-persona.test.ts:411:24
 Test Files  1 failed (1)
      Tests  1 failed | 1 skipped (2)
```

Tras ambos controles: `git diff packages/core packages/services apps/web/src` -> **VACÍO**; los dos ficheros de test permanentes siguen presentes (M / ??).

## Coste real
**$0**. Toda la verificación corre sobre Testcontainers/mocks y el seed sintético (0 llamadas fal). La cláusula fal se satisface con evidencia PRIMARIA ya pagada (~$0,01 en T5.9, 2026-07-25). vs estimado $0 — sin desviación.

## Veredicto
**PASS** — las dos cláusulas se cumplen contra el sistema real: (1) el seed de cero (path REAL, no el double de test) materializa exactamente 1 persona batch-ready (Maya) con 3 filas asset reales en BD y voz que fal acepta, y CP3 arranca generación con ella por la ruta real (200 + nextRunId + N6/N8/N9); (2) una persona sin imagen produce un 400 accionable a nivel de ruta, no un 500. Ambos controles negativos muerden con el assert correcto. Gate verde.

**Rarezas (aunque PASS)**:
- **Test A y Test B siembran con `makeMemoryStorage()`** (un StorageAdapter en memoria que evita sharp/FS/guard >=2K), no con el adaptador real. Su tesis («asserta FILAS reales, no el proxy») se cumple sobre la BD, pero el ESLABÓN que materializa las imágenes de Maya por el path REAL (sharp + guard de dimensiones >=2K) NO lo cubre ningún test permanente — precisamente el eslabón del bug original (persona con voz real pero 0 imágenes). Este verifier lo cerró EJECUTANDO `pnpm seed` real y comprobando por psql que Maya materializa 3 filas asset (seed-real-psql*.txt); queda como control de gate manual, no como test permanente. Deuda menor: un test de integración que corra `seedPersonas` con el StorageAdapter de disco real y afirme las 3 filas de Maya cerraría del todo el hueco.
- El log del gate muestra `LoserRaceError` (N7b voiceover concurrente) tratado como retry esperado del dedup de generación — comportamiento normal de F4, no un fallo.
