# Verificación T2.1 — Migraciones de lote + seeds de hooks, CTAs y recetas

- **Tarea**: T2.1 · Migraciones de lote + seeds de hooks, CTAs y recetas (`planning.md` L329–332)
- **Fecha**: 2026-07-12
- **Ejecutor**: subagente `verifier` (contexto fresco) · superficie **solo backend** (Postgres + psql + scripts; sin navegador — la Verificación no menciona UI, ver `cua.md` paso 0)
- **Sistema**: HEAD `48e7aa7e1b40a2d86fa7f294f186609f5daeecd1` + diff de T2.1 sin commitear (working tree tal cual lo dejó el implementer) · `docker compose -f docker-compose.dev.yml` (Postgres 16, `ugc-postgres-dev` healthy, puerto 55432) · `pnpm db:migrate` aplicado · `pnpm seed`
- **Nota de método**: toda la observación de BD se hace con `psql` DENTRO del contenedor (`docker compose exec -T postgres psql`), NO con el `console.table` que imprime el propio script de seed (el script es código bajo prueba: sus conteos no valen como evidencia de sí mismos).

## Verificación esperada (literal de planning.md)

> `pnpm seed` puebla librerías y recetas; el validador (dentro de `pnpm gate`) falla con un fixture inválido (hook sin ángulo o >12 palabras; receta sin coste); `SELECT` de `recipe` muestra los 3 tiers con estimaciones que cuadran con el Apéndice B.

## Pre-gate

`pnpm gate` en verde ANTES de empezar (llegar a verificación con la suite rota es trampa al orden — `cua.md` regla 6):
**101 test files · 996 tests · 0 fallos** → `00-pregate-green.txt`.

## Pasos ejecutados

1. **Estado inicial vacío** (para que "puebla" signifique algo y no "ya estaba lleno"): `pnpm db:migrate` + `TRUNCATE hook_line, cta_line, recipe CASCADE` → conteos 0/0/0 verificados por `SELECT` → `01-estado-inicial-vacio.txt`.
2. **Esquema**: las 6 tablas nuevas existen (`ad_batch`, `ad_variant`, `ad_script`, `hook_line`, `cta_line`, `recipe`) y el enum `ad_variant_status` en la BD es **verbatim** el de PRD §12: `planned, scripting, scripted, generating, composing, qa, approved, rejected, published` (9 labels, orden incluido) — consultado a `pg_enum`, no al fichero fuente.
3. **`pnpm seed` (corrida 1)** → `02-seed-run1-stdout.txt`; conteos leídos por `SELECT` propio → `03-counts-run1.txt`.
4. **`pnpm seed` (corrida 2) — IDEMPOTENCIA** → `04` / `05`.
5. **`SELECT` de `recipe`** con conversión céntimos→dólares hecha en SQL → `06-select-recipe.txt`.
6. **Control negativo (obligatorio, principio 9 de la skill testing)**: inyección de fixtures inválidos en la librería **REAL** (`packages/core/src/library/seed-data.ts`), los TRES casos que la Verificación nombra. Backup por `shasum` antes, restauración verificada después. **Alcance por caso**: el hook de >12 palabras se probó con el **`pnpm gate` ENTERO** (es el único de los tres que lint/typecheck no pueden ver — una cadena larga es TS válido —, así que el rojo prueba sin ambigüedad que el guard vive en el validador *dentro del gate*); los otros dos (hook sin ángulo, receta sin coste) se probaron con **`pnpm seed` (aborta) + el test project `core:unit` del gate (rojo)**, porque borrar `angle` / poner coste 0 rompe además el typecheck y un gate completo se habría puesto rojo en un paso anterior al validador, demostrando menos.
7. **Gate final verde** tras restaurar → `11-gate-restaurado-VERDE.txt`.

## Resultado observado vs esperado

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | `pnpm seed` **puebla** librerías y recetas | Desde 0/0/0 → `hook_line=80` (40 es + 40 en), `cta_line=30` (15 es + 15 en), `recipe=3`. Conteos leídos por `SELECT` propio contra Postgres, no del stdout del script | `01`, `02`, `03` | ✅ |
| 1b | **Idempotencia** (2ª corrida no duplica) | Tras la 2ª corrida los conteos son **idénticos** (80/30/3) y `GROUP BY (language,text) HAVING count(*)>1` devuelve **0 duplicados**. Además: las **PKs (ULID) son las MISMAS** antes y después de re-sembrar → UPSERT real sobre la clave natural, no delete+reinsert (las FKs de `ad_variant.hook_line_id` sobrevivirían) | `05`, `12` | ✅ |
| 2a | Validador falla con **hook SIN ÁNGULO** | Borrado el campo `angle` de `HOOKS_ES[0]`: `pnpm seed` **ABORTA** (`[hook_missing_angle] hook_line hooks[0] — hook sin ángulo válido (recibido: undefined)`, exit≠0) y el **test project del gate** (`core:unit` → `seed-validator.test.ts`) se pone **ROJO** con `hook_missing_angle` (10 tests fallidos). *Alcance de lo ejecutado*: para este caso se corrió el proyecto de tests del validador, no el `pnpm gate` completo — borrar `angle` es además un error de typecheck, así que un gate entero se habría puesto rojo en el paso equivocado; aislar el test del validador demuestra que **el guard es el validador** | `09` | ✅ |
| 2b | Validador falla con **hook >12 palabras**, **dentro de `pnpm gate`** | **Caso ejecutado con el `pnpm gate` COMPLETO** (es el fixture que SOLO el validador puede cazar: una cadena de 15 palabras es TypeScript perfectamente válido, así que lint/typecheck no la ven — el rojo es inequívocamente del validador). Sustituido el texto de `HOOKS_ES[0]` por una frase literal de 15 palabras SIN placeholders: **`pnpm gate` ENTERO en ROJO** (exit 1; `Test Files 2 failed | 99 passed`, `Tests 10 failed | 986 passed`), y **rojo por el guard correcto**: `seed-validator.test.ts > la librería REAL … > pasa el validador entero (control positivo del gate)` con `hook_too_long`, y `… ningún hook supera MAX_HOOK_WORDS en su PEOR CASO RENDERIZADO` reportando `"15w: Este hook tiene exactamente…"`. Además `pnpm seed` aborta y **NO toca la BD** (conteos siguen 80/30/3) | `07`, `08` | ✅ |
| 2c | Validador falla con **receta SIN COSTE** | Puesto `estCost30sMinCents: 0` en el tier `test`: `pnpm seed` **ABORTA** con `[recipe_missing_cost] recipe test — estCost30sMinCents: Too small: expected number to be >0` y el **test project del gate** (`core:unit` → `seed-validator.test.ts`) se pone **ROJO** (6 fallos). *Alcance de lo ejecutado*: igual que en 2a, se corrió el proyecto de tests del validador, no el `pnpm gate` completo | `10` | ✅ |
| 2d | El gate vuelve a **VERDE** tras restaurar | `shasum` de `seed-data.ts` idéntico al original (`e167b094…`), `git status` sin cambios nuevos, `pnpm gate` → **101 files / 996 tests, 0 fallos** | `11` | ✅ |
| 3 | `SELECT` de `recipe`: **3 tiers** con estimaciones que **cuadran con el Apéndice B** (±10 %) | Ver tabla abajo: **desviación 0 %** en los 6 límites | `06` | ✅ |

### Punto 3 en detalle — `SELECT` de `recipe` vs Apéndice B

Apéndice B leído directamente en `PRD.md` (§23, tabla "Recetas por tier"), fila **COGS 30 s**: `Test $0,3–1,7 · Standard $1,8–5 · Premium $9–13`.

`SELECT id, est_cost_30s_min_cents, est_cost_30s_max_cents, round(.../100.0,2) FROM recipe` (contra Postgres):

| tier | min_cents | max_cents | min_usd (BD) | max_usd (BD) | Apéndice B | Desviación |
|---|---|---|---|---|---|---|
| test | 30 | 170 | **$0.30** | **$1.70** | $0,3–1,7 | **0 %** |
| standard | 180 | 500 | **$1.80** | **$5.00** | $1,8–5 | **0 %** |
| premium | 900 | 1300 | **$9.00** | **$13.00** | $9–13 | **0 %** |

Los 6 límites caen EXACTAMENTE sobre el Apéndice B (no solo dentro del ±10 %). Además los `steps` sembrados reproducen la fila del Apéndice B por componente — p. ej. `premium` = avatar `OmniHuman v1.5`, broll `Veo 3.1 / Seedance 2.0 Std`, voz `ElevenLabs Eleven v3`, shots `Nano Banana Pro`.

## Notas del pase escéptico (rarezas, no bloqueantes)

- **El test de recetas es parcialmente autorreferencial**: `packages/core/src/library/seed-validator.test.ts:108` compara `RECIPE_SEEDS` contra un mapa `expected` hardcodeado EN EL PROPIO TEST. Si alguien cambiara ambos a la vez, el gate no lo notaría. Por eso el punto 3 de este report NO se apoya en ese test: los dólares se leyeron de la BD y se compararon a mano contra la tabla del PRD. El dato está bien; se anota que el guard de "cuadra con el Apéndice B" es el verifier, no la suite.
- **El comentario de cabecera de `seed-data.ts` (L16–18) está desactualizado**: dice "contadas por espacios en blanco… Un placeholder cuenta como una palabra", que es justo lo que la corrección del pase de review DEJÓ DE SER (ahora se cuenta el peor caso renderizado con `PLACEHOLDER_WORD_BUDGET`, donde `{pain}`=6). El código y el validador son correctos; el comentario miente. Deuda de documentación, no de comportamiento.
- **TRUNCATE de `hook_line` cascadea a `ad_variant`/`ad_script`** (observado en `01`). Esperable por las FKs; se anota porque un futuro `pnpm seed --reset` debería tenerlo en cuenta.
- **Hint de knip** presente en el gate (verde): `src/golden.ts packages/test-utils — Remove from ignore`. Preexistente, no introducido por T2.1.

## Árbol dejado como se encontró

`seed-data.ts` restaurado y verificado por `shasum` (`e167b094592e7220e416452156c1f17925fa4bb7`, idéntico al de antes del control negativo). `git status` al terminar es el mismo que al empezar (mismos ficheros M/??); el verifier solo añadió `docs/verifications/T2.1/`. No se tocó `planning.md` ni código de producto/tests.

## Coste real

**$0** — esta verificación no llama a ninguna API de pago (Postgres local + validador puro + suite de tests). Estimado: $0. Sin desviación.

## Veredicto

**PASS** — las tres afirmaciones de la Verificación se cumplen contra el sistema real: `pnpm seed` puebla (80 hooks / 30 CTAs / 3 recetas desde tablas vacías) y es idempotente por clave natural (conteos y PKs estables en la 2ª corrida); el validador pone `pnpm gate` en ROJO con los tres fixtures inválidos que la Verificación nombra (hook sin ángulo, hook >12 palabras, receta sin coste) y vuelve a VERDE al restaurar; y el `SELECT` de `recipe` devuelve los 3 tiers con costes que cuadran con el Apéndice B con **0 % de desviación**. Rarezas anotadas arriba: ninguna bloquea.

## Índice de evidencias

| Fichero | Contenido |
|---|---|
| `00-pregate-green.txt` | `pnpm gate` verde antes de empezar (996 tests) |
| `01-estado-inicial-vacio.txt` | migrate + TRUNCATE + conteos 0/0/0 |
| `02-seed-run1-stdout.txt` | stdout de `pnpm seed` (corrida 1) |
| `03-counts-run1.txt` | `SELECT` de conteos tras la corrida 1 (80/30/3, por idioma) |
| `04-seed-run2-stdout.txt` | stdout de `pnpm seed` (corrida 2) |
| `05-counts-run2-idempotencia.txt` | `SELECT` tras la corrida 2 + 0 duplicados |
| `06-select-recipe.txt` | **El `SELECT` de `recipe`** con céntimos y dólares + `steps` de premium |
| `07-control-negativo-ROJO.txt` | `pnpm gate` ENTERO en rojo con el hook de 15 palabras |
| `08-seed-aborta-fixture-invalido.txt` | `pnpm seed` aborta y no toca la BD |
| `09-control-negativo-hook-sin-angulo.txt` | caso (a): `hook_missing_angle` |
| `10-control-negativo-receta-sin-coste.txt` | caso (c): `recipe_missing_cost` |
| `11-gate-restaurado-VERDE.txt` | gate de nuevo verde tras restaurar |
| `12-pks-estables-upsert.txt` | PKs ULID estables entre corridas (upsert real) |
