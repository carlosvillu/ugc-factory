# Verificación T3.9 — Siembra de datos de referencia en el arranque

- **Tarea**: T3.9 · Siembra de datos de referencia en el arranque (deploy nunca deja prod con N4 roto) (`planning.md`)
- **Fecha**: 2026-07-16
- **Ejecutor**: verifier (contexto fresco) · sin agent-browser (verificación backend/datos + endpoints HTTP reales por curl) · BD dedicada `ugc_t39`
- **Sistema**: commit `43eca00` **+ el diff de T3.9 sin commitear** (working tree sucio). El código bajo prueba es el árbol de trabajo, NO HEAD. Prueba de que el diff corrió de verdad: las líneas de log `"sembrando datos de referencia (T3.9)"` / `"datos de referencia sembrados (T3.9)"` solo existen en el `instrumentation.ts` modificado (ver 02-web-boot.log). Postgres 16 (contenedor `ugc-postgres-dev`, puerto 55432) + `pnpm --filter @ugc/web dev` contra la BD **vacía** `ugc_t39` (schema migrado, tablas de referencia a 0).

## Verificación esperada (literal de planning.md)
> Arrancar web contra una BD **vacía** (schema migrado, tablas de referencia vacías) → tras el boot, `recipe`/`hook_line`/`cta_line`/`prompt_template`/`guard_pack`/`model_profile`/`persona` pobladas, y **N4 estima el coste en vez de abortar** (atar al fallo real: un run cuyo N4 pasa). **Control negativo (guarda el contrato insert-only permanentemente)**: sembrar → editar un template vía API (`createTemplateVersion`) → re-arrancar (re-sembrar) → la edición SOBREVIVE y no se duplican filas.

## Pre-gate
`pnpm gate` verde (lint + typecheck + format:check + knip + readme:status + test) → **Test Files 151 passed (151), Tests 1683 passed (1683)**, exit 0. Evidencia: `gate.txt`. Esto establece además el baseline VERDE de los tests de supervivencia que Phase D pone en rojo al invertir el contrato.

## Pasos ejecutados
1. **BD vacía**: `CREATE DATABASE ugc_t39` -> `pnpm db:migrate` (schema) -> psql confirma las 7 tablas de referencia a **count=0** (01-before-boot-empty.txt). Estado literal "schema migrado, tablas de referencia vacías".
2. **Boot de web** contra `ugc_t39`. El log (02-web-boot.log): migraciones -> `sembrando datos de referencia (T3.9)` -> librería 80/30/3 -> galería 56/10/15 -> personas 2 (imagesCreated 4, imagesFailed 0) -> `datos de referencia sembrados (T3.9)`. `/api/health` = `{"ok":true,"db":true}` (03-health.txt).
3. **7 tablas pobladas** tras el boot (psql, 04-after-boot-populated.txt): recipe 3, hook_line 80, cta_line 30, prompt_template 56, guard_pack 10, model_profile 15, persona 2.
4. **N4** (Phase B, 06-n4-estimates.txt): ejercitado el cuerpo REAL de N4 con las funciones de producción (`listPlanningInputs` de @ugc/db + `planBatch` de @ugc/core/strategy, exactamente como `apps/worker/src/executors/strategy.ts`) contra la BD sembrada por el boot. El tier por defecto del lote es `"test"` -- el tier exacto que abortaba en prod. `listPlanningInputs("test")` devuelve `recipe.tier=test`; `planBatch` estima **96-546 cents** para 12 variantes -> N4 NO aborta. Rama de aborto confirmada: con la receta borrada (DELETE en tx revertida) `getRecipe` daría `undefined` -> N4 lanzaría `PermanentStepError`; la receta sembrada sobrevive al rollback.
   - *Por qué no un run orquestado completo*: alcanzar N4 exige N1-N3 (Firecrawl/Anthropic, de pago), que romperían el cap $0. N4 es $0 por diseño. Ejercitar su cuerpo con las funciones de producción es la única vía $0 y es fiel al fallo de prod.
5. **Control negativo (Phase C)** -- vía los ENDPOINTS HTTP REALES y un RESTART real:
   - Login `POST /api/login` (200, cookie de sesión).
   - `PATCH /api/templates/<id>` (endpoint real -> `createTemplateVersion`) sobre el slug `app-screen-demo-saas-time-saving`: body reemplazado por un marcador de usuario; head_version 0->2 (07/08-*.txt).
   - `PATCH /api/personas/<id>` (endpoint real -> `updatePersona`) sobre `Lucía (placeholder)`: descriptor editado.
   - **Restart de web** (mata `next dev` + re-arranca) -> re-ejecuta `instrumentation.register()` = el re-seed REAL del boot con `onConflict:'nothing'` (09-web-reseed-boot3.log).
   - Tras el re-seed (10-negctrl-after-reseed.txt, por psql/identidad): **la edición del template SOBREVIVE** (body sigue con el marcador, head_version 2); **la edición de la persona SOBREVIVE** (descriptor editado). **No se duplican filas**: `prompt_template` total 56 y el slug sigue con 1 fila; `persona` total 2 y el nombre sigue con 1 fila. (El bump de versión 0->2 NO es duplicado: `createTemplateVersion` crea filas de `prompt_version` por diseño; "no se duplican filas" es sobre IDENTIDADES de template/persona, que no cambian.)
6. **Los controles MUERDEN (Phase D)** -- en un git worktree aislado (main y su web intactos): invertido el contrato del boot a `DO UPDATE` en `gallery-seed.repo.ts` y `persona.repo.ts`; los dos tests de supervivencia pasan a ROJO con exactamente las asserts esperadas (11-bite-red.txt): gallery `expect(after?.body).toBe(editedBody)` falla; persona `expect(after?.descriptor).toBe(editedDescriptor)` falla (`'descriptor SEMBRADO'` en vez del editado). Worktree eliminado; el árbol main no recibió ninguna edición (verificado: sin marcador `BITE-TEST`).
7. **Fix de personas confirmado**: la re-lectura en la rama `DO NOTHING` es INCONDICIONAL -- `if (!row) { if (onConflict === 'nothing') { const [existing] = await db.select()... } }` (persona.repo.ts:219-221), NO condicionada a `before`. Es el fix real de la race de primer arranque.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Boot contra BD vacía puebla las 7 tablas de referencia | Antes: las 7 a 0. Después: recipe 3, hook_line 80, cta_line 30, prompt_template 56, guard_pack 10, model_profile 15, persona 2 | 01, 02, 04 | OK |
| 2 | N4 estima el coste en vez de abortar (tier "test", el fallo real) | recipe("test") definido -> planBatch estima 96-546 cents / 12 variantes; N4 solo aborta si recipe undefined | 05, 06 | OK |
| 3 | Editar template (`createTemplateVersion`) -> re-seed de boot -> sobrevive, sin duplicar filas | Edit vía `PATCH /api/templates` sobrevive al restart; templates 56 / slug 1 sin cambios | 07, 08, 09, 10 | OK |
| 3b | Análogo persona (`updatePersona`) -> re-seed -> sobrevive | Edit vía `PATCH /api/personas` sobrevive; personas 2 / nombre 1 sin cambios | 08, 09, 10 | OK |
| 4 | Reintroducir `DO UPDATE` en el re-seed pone rojos los tests de supervivencia | `toBe(editedBody)` y `toBe(editedDescriptor)` fallan al invertir el contrato | 11 | OK |

## Coste real
$0 -- ninguna API de pago. N4 es $0 por diseño (sin LLM, sin red); la verificación no dispara Firecrawl/Anthropic/fal. Estimado del planning: $0. Sin desvío.

## Veredicto
**PASS** -- el arranque de web siembra idempotentemente las 7 tablas de referencia contra una BD vacía, N4 estima el coste (tier "test", el fallo de prod) en vez de abortar, y el contrato insert-only del BOOT (no solo del repo) protege las ediciones de usuario a través de un restart real sin duplicar identidades; los controles negativos muerden.

Notas / rarezas:
- El primer `pnpm dev` sirvió las rutas HTTP con 404 sistémico (incluido `/`, `/login`, `/api/health`) por caché `.next` obsoleta; tras `rm -rf apps/web/.next` y re-arrancar, el routing quedó correcto (health 200, login 200). No es un defecto de T3.9 (el seed de boot funcionó en ambos arranques; es una peculiaridad de Turbopack dev). Documentado por transparencia.
- El `n4-driver.ts` de este directorio es reproducible: se copia a `apps/worker/` para resolver los workspace packages, se corre con `tsx` y se borra (no queda en el árbol). Su salida está en `06-n4-estimates.txt`.
- Cleanup: `.env` restaurado a `ugc`, BD `ugc_t39` eliminada, procesos `next dev` terminados, worktree de bite-test eliminado, sin ediciones filtradas al árbol main.
