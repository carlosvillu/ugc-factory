# Verificación T3.1 · Migraciones y modelo de galería

- **Veredicto**: PASS
- **Fecha**: 2026-07-15
- **Verificador**: verifier (contexto fresco, escéptico)
- **Coste real**: $0 (sin APIs de pago; solo cómputo local — Postgres 16 en contenedor efímero + suite de integración)

## Verificación LITERAL (planning.md T3.1)

> migración aplica (`psql \d`); con ≥1.000 filas sintéticas sembradas para el test
> (o `SET enable_seqscan=off`), una consulta por facetas combinadas muestra **Bitmap
> Index Scan sobre el GIN** en el EXPLAIN y devuelve exactamente las filas esperadas.

## Metodología (evidencia independiente del implementer)

No me fié de los tests del implementer como evidencia primaria. Levanté un Postgres 16
efímero PROPIO (`postgres:16`, contenedor `ugc-t31-verify`), apliqué TODAS las migraciones
`0001->0015` sobre BD vacía con el migrador real de Drizzle (`pnpm --filter @ugc/db db:migrate`,
no `drizzle push`), y sembré datos PROPIOS con un objetivo PROPIO (5000 filas, 37 hits —
distinto de las 8000/40 del implementer, para que cualquier hardcode afinado a sus fixtures
me fallara). Ejecuté yo el EXPLAIN natural y leí el plan de texto, no un regex sobre JSON.

## Resultado por punto

| Punto de la cláusula | Esperado | Observado | OK |
|---|---|---|---|
| Migración aplica (empty->0015) | 0001-0015 sin error | `db:migrate: migraciones aplicadas`; 16 filas en `__drizzle_migrations` | OK |
| 4 tablas nuevas (`psql \d`) | prompt_template, prompt_version, guard_pack, model_profile con columnas/enums | Las 4 con columnas §12, enums nativos (prompt_kind, prompt_status, guard_scope, model_kind, model_status), UNIQUEs, FK CASCADE | OK |
| 5 GIN por faceta + free_tags SIN índice | 5 GIN (formats/hook_angles/verticals/platforms/aesthetics); free_tags sin índice | Exactamente eso (`\d prompt_template`) | OK |
| Opclass es GIN array_ops (no btree) | access_method=gin | `pg_catalog`: los 5 -> `gin` / `array_ops` / opcdefault=t | OK |
| >=1000 filas sintéticas | >=1000 | 5000 sembradas (propias) | OK |
| Consulta facetada combinada -> **Bitmap Index Scan sobre el GIN** en plan NATURAL | Bitmap Index Scan nombrando GIN, sin forzar seqscan | `enable_seqscan=on`: BitmapAnd sobre `prompt_template_formats_gin` + `prompt_template_hook_angles_gin`, Index Cond `@>` | OK |
| Devuelve exactamente las filas esperadas | 37 | `actual ... rows=37` en el plan; count=37 | OK |
| Control negativo (índice load-bearing) | Seq Scan sin GIN | Drop-index flip + free_tags -> Seq Scan | OK |

## Evidencia clave

### Plan NATURAL (el discriminador load-bearing) — `explain-natural.txt`
Con `enable_seqscan=on` (SHOW confirmado), la consulta combinada `formats @> {grwm} AND
hook_angles @> {pain-point}` produce:

```
BitmapAnd
  -> Bitmap Index Scan on prompt_template_formats_gin      Index Cond: formats @> '{grwm}'
  -> Bitmap Index Scan on prompt_template_hook_angles_gin  Index Cond: hook_angles @> '{pain-point}'
  actual ... rows=37
```

El planner ELIGIO el GIN por coste, sin forzarlo. La etiqueta `array_ops` no fue evidencia:
lo probé por el plan de ejecución real.

### Experimento decisivo drop-index — `explain-dropindex-flip.txt`
Misma consulta, mismos datos, con los DOS GIN de faceta borrados (`DROP INDEX`) -> el plan
FLIPO a `Seq Scan` (Rows Removed by Filter: 4963). Prueba, no razonamiento, de que el Bitmap
Index Scan del plan positivo venía del GIN y de nada más. Más fuerte que el control negativo:
mantiene columna Y datos constantes y varía solo el índice.

### Control negativo — `explain-control-negative.txt`
`@>` sobre `free_tags` (text[] hermano SIN GIN) -> `Seq Scan`. Mismo operador GIN-servable,
sin índice que lo sirva. Aísla que lo load-bearing es la PRESENCIA del índice, no el operador.

### `array_ops` sirve `=` — `array_ops-serves-eq.txt`
Confirmada la corrección factual del implementer: el GIN `array_ops` SI sirve `=` (Bitmap
Index Scan sobre `formats = {grwm}`). Por eso el control negativo NO puede ser con `=` (lo
serviría un GIN) sino con la columna sin índice — decisión correcta.

### Tests de integración (corroboración) — `integration-tests.txt`
`prompt-template.gin.test.ts` + `gallery.constraints.test.ts`: 2 files, 13 tests passed.
Los leí antes de correrlos: el test GIN asserta Bitmap Index Scan sobre GIN nombrado + conteo
exacto + control negativo; el de constraints cubre UNIQUEs, enums y ON DELETE CASCADE.

## Ficheros de evidencia

- `migrations-applied.txt` — `__drizzle_migrations` + `\dt` (4 tablas)
- `psql-d-tables.txt` — `\d` de las 4 tablas
- `gin-opclass.txt` — pg_catalog: los 5 GIN son `gin`/`array_ops`
- `target-count.txt` — 5000 filas, 37 target hits (datos propios)
- `explain-natural.txt` — plan natural, Bitmap Index Scan sobre GIN, rows=37
- `explain-dropindex-flip.txt` — flip a Seq Scan al borrar los GIN
- `explain-control-negative.txt` — free_tags -> Seq Scan
- `array_ops-serves-eq.txt` — GIN array_ops sirve `=`
- `integration-tests.txt` — 13 tests passed
- `gate.txt` — salida de `pnpm gate`

## Rarezas / notas

- `psql \d` muestra los GIN como `gin (formats)` sin la etiqueta `array_ops` porque es el
  opclass por defecto (psql lo omite). Verifiqué el opclass real vía `pg_opclass` — es el GIN
  array_ops (opcdefault=t), no el btree homónimo.
- La cláusula ofrece `SET enable_seqscan=off` como alternativa; NO lo usé como prueba. El plan
  natural a 5000 filas con objetivo <1% elige el GIN por sí solo, que es lo load-bearing.
