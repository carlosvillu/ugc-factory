# T1.2 · Migraciones de análisis — VERIFICACIÓN

- **Veredicto**: **PASS**
- **Fecha**: 2026-07-10
- **SHA verificado**: 4265b5b (working tree con el diff de T1.2: 0005_tan_white_queen.sql, schema/project.ts, analysis.constraints.test.ts)
- **Coste real**: $0 (Postgres local en contenedor ugc-postgres-dev, sin APIs de pago)
- **Superficie**: BD pura — sin navegador ni app web. Verificación independiente con psql real contra BD LIMPIA.

## Texto literal de la Verificación

> migración aplica sobre BD limpia y `psql \d` muestra tablas/columnas/enums esperados; insertar 2 filas de `brand_kit` con `domain NULL` entra sin conflicto y 2 con el mismo dominio falla la segunda con error de constraint (UNIQUE parcial verificado).

## Método (escéptico, independiente)

1. **Gate previo**: `pnpm gate` desde la raíz → verde (exit 0), 540 tests, lint/typecheck/format:check/knip OK.
2. **BD LIMPIA nueva**: `CREATE DATABASE ugc_verify_t12` en el contenedor ugc-postgres-dev (base sin tablas de análisis; la dev `ugc` tampoco las tenía). Migraciones 0000→0005 aplicadas con `DATABASE_URL=.../ugc_verify_t12 pnpm --filter @ugc/db db:migrate`. Confirmado que las 3 tablas aterrizaron en ugc_verify_t12 y la dev quedó intacta.
3. **Inspección psql real**: `\d` de las 3 tablas, `\dT+` de los 5 enums, `SELECT indexdef FROM pg_indexes` para la parcialidad.
4. **3 casos de inserción con valores propios del verifier** (no los del implementer): dominio `miproducto.example`, ids vrf_*, palettes propias. SQL directo vía psql.

## Resultado por cláusula

| # | Cláusula | Esperado | Observado | Estado |
|---|---|---|---|---|
| 1 | Migración 0005 aplica sobre BD LIMPIA | sin error | "migraciones aplicadas"; 3 tablas presentes en ugc_verify_t12 | OK |
| 2a | `\d` muestra 3 tablas con columnas §12 | brand_kit/url_analysis/product_brief §12 | Coinciden columna a columna (02-psql-describe-tables.txt) | OK |
| 2b | Enums esperados (§12) | 5 enums con valores literales | brand_kit_source(extracted,manual); product_brief_status(draft,approved); url_analysis_platform(shopify,woocommerce,custom,amazon,manual); url_analysis_source(url,manual); url_analysis_status(pending,scraping,analyzing,done,failed) | OK |
| 3a | 2 filas domain NULL entran sin conflicto | ambos INSERT OK | INSERT 0 1 x2, null_domain_rows=2 | OK |
| 3b | 2 filas mismo dominio no-null → 2ª falla | 1ª OK, 2ª ERROR 23505 | 1ª INSERT 0 1; 2ª ERROR 23505 duplicate key ... "brand_kit_domain_key"; dup_domain_rows=1 | OK |
| 3c | UNIQUE PARCIAL verificado (no plano) | indexdef con WHERE domain IS NOT NULL | CREATE UNIQUE INDEX brand_kit_domain_key ON public.brand_kit USING btree (domain) WHERE (domain IS NOT NULL) | OK |

### Nota sobre 3c (punto crítico)

Un UNIQUE PLANO sobre domain nullable daría el MISMO comportamiento (N NULLs OK + dup no-null rechazado, por NULLS DISTINCT de pg). Por eso se verificó la PARCIALIDAD sobre el catálogo (`\d brand_kit` e indexdef de pg_indexes): AMBOS muestran el predicado WHERE (domain IS NOT NULL). Índice parcial real, no UNIQUE plano.

## Test del implementer (revisado)

analysis.constraints.test.ts cubre la Verificación: pinnea parcialidad vía pg_indexes.indexdef, code 23505, constraint brand_kit_domain_key, y rechazo de enum. La verificación de este report es INDEPENDIENTE con psql.

## Evidencia persistida

- 01-migrate.txt — salida de db:migrate sobre BD limpia
- 02-psql-describe-tables.txt — \d crudo de las 3 tablas
- 03-enums-and-indexdef.txt — \dT+ de 5 enums + indexdef parcial
- 04-insert-cases.txt — 3 casos de inserción
- 05-sqlstate.txt — SQLSTATE 23505 explícito

## Rarezas

- La flag --env-file-if-exists del script db:migrate carga el .env raíz, pero la DATABASE_URL pasada como env var tiene precedencia (dotenv no sobreescribe vars presentes); la migración fue a ugc_verify_t12 como se pretendía. Confirmado empíricamente.
