# Verificación T1.9 — BriefValidator + BrandKit

- **Tarea**: T1.9 · BriefValidator + BrandKit (`planning.md`, fase F1)
- **Fecha**: 2026-07-11
- **Ejecutor**: subagente `verifier` (contexto fresco) · sin navegador (la Verificación es "a nivel de datos, sin UI"; `cua.md` paso 0 cita T1.9 como ejemplo canónico de gate **solo backend**)
- **Sistema**: HEAD `c518adc` + working tree con el diff de T1.9 · **Postgres 16 REAL** (Testcontainers, `postgres:16`) con las **migraciones reales del producto** aplicadas (`packages/db/drizzle`). Sin mocks en ninguna cláusula.
- **Gate previo**: `pnpm gate` **VERDE** (exit 0), ejecutado por el verifier — lint + typecheck + format:check + knip + test: **848 tests / 84 ficheros**. Output: `gate.txt`.

## Verificación esperada (literal de planning.md)

> **Verificación** (a nivel de datos, sin UI): un brief con precio discrepante produce el warning tipado y gana el precio del fast path; en modo manual sin hero image, el validador emite el warning tipado `needs_user_decision: missing_hero_image` en la salida, el brief queda válido y el paso NO falla; analizar 2 URLs del mismo dominio extrae el BrandKit una sola vez (timestamps).

## Metodología (por qué esta evidencia vale)

Los tres scripts son **del verifier**, no del implementer: importan el **código fuente real** del diff por ruta relativa (`packages/core/src/analyze/brief-validator.ts`, `packages/db/src/repos/brand-kit.repo.ts`), eligen sus **propios inputs** y no reutilizan las factories del implementer.

**La entrada de las cláusulas 1 y 2 son los briefs REALES de Sonnet 5** que dejó el verifier de T1.8 (`docs/verifications/T1.8/briefs-c3-stage1.json`), no fixtures de laboratorio. El anclaje decisivo viene del scrape real de Firecrawl (`docs/verifications/T1.8/dry-ingest.txt`):

```
[URL_2 ugmonk]   N1 fast path -> product = {"price":"69","currency":"USD"}
[URL_2 ugmonk]   N3 Sonnet 5  -> pricing.price = "69", currency = "USD"
[URL_1 allbirds] N1 fast path -> product = null
[URL_1 allbirds] N3 Sonnet 5  -> pricing.price = null
```

El formato que emite N1 **de verdad** se confirmó leyendo el código, no asumiéndolo:
- `ingest/firecrawl.ts:263` → `price: price == null ? null : String(price)` ⇒ `"69"`, `"34.9"` — **nunca** símbolo de moneda.
- `ingest/parsers/coerce.ts:17` `priceToString` → devuelve el string de la tienda **tal cual** (`value.trim()`) ⇒ una tienda europea **sí** puede emitir `"29,99"`.

Ambos formatos se probaron contra el precio formateado del LLM.

## Resultado observado vs esperado

| # | Cláusula (literal) | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|---|
| 1a | *"un brief con precio discrepante produce el warning tipado"* — **sin falsos positivos** | Mismo valor en distinto formato ⇒ **NO** hay warning | 6/6 pares reales sin `price_mismatch`: `"69"`↔`"69"` (caso REAL ugmonk), `"34.9"`↔`"34,90 €"`, `"34.90"`↔`"€34.90"`, `"29,99"`(coerce ES)↔`"29,99 €"`, `"1234.56"`↔`"1.234,56 €"`, `"69"`↔`"$69.00"` | `verify-validator.txt` | OK |
| 1b | *"…produce el warning tipado **y gana el precio del fast path**"* | Valores distintos ⇒ warning tipado **y** gana el precio del fast path | `{"code":"price_mismatch","synthesized":"49 $","fastPath":"69 USD"}` → `brief.pricing.price = "69 USD"` (valor **69** = el de N1). Idem `79.90` vs `34,90 €` → gana 79.9; `29,99` vs `39,99 €` → gana 29.99. `ok=true` (corrige, no invalida) | `verify-validator.txt` | OK |
| 1c | Caso real sin fast path | allbirds: N1 `product=null` ⇒ nada que cruzar, sin warning espurio | 0 `price_mismatch`; `price` sigue `null` | `verify-validator.txt` | OK |
| 2 | *"modo manual sin hero image → warning tipado `needs_user_decision: missing_hero_image` **en la salida**, el brief queda **válido** y el paso **NO falla**"* | Las 3 cosas a la vez | Salida literal: `{"code":"needs_user_decision","reason":"missing_hero_image","message":"No hay imagen de producto: sube al menos una foto o elige generar un packshot con IA."}` · `ok = true` · **no lanza** (`threw=null`) · no emite el bloqueante `missing_hero_image` | `verify-validator.txt` | OK |
| 2-contraste | (control: que el warning no sea vacuamente cierto) | El MISMO brief sin hero en perfil `url` ⇒ bloqueante | `ok=false` + `missing_hero_image` | `verify-validator.txt` | OK |
| 3 | *"analizar 2 URLs del mismo dominio extrae el BrandKit **una sola vez** (**timestamps**)"* | 1 extracción, 1 fila; el timestamp lo prueba | 2 URLs distintas de ugmonk (`ugmonk.com/...` y `www.ugmonk.com/...`) → colapsan a `ugmonk.com`. Análisis 1 @ **t1=10:00** ⇒ `reused=false`. Análisis 2 @ **t2=18:00** ⇒ `reused=true`, mismo `id`. **SQL crudo: 1 sola fila, `extracted_at = 2026-07-11T10:00:00Z` (t1), NO t2** | `verify-brandkit.txt` | OK |

### La evidencia de la cláusula 3 (los timestamps, leídos con SQL crudo de la fila real)

```
ÍNDICE REAL EN LA BD:
  CREATE UNIQUE INDEX brand_kit_domain_key ON public.brand_kit USING btree (domain) WHERE (domain IS NOT NULL)

  [análisis 1 @ 2026-07-11T10:00:00.000Z] reused=false id=01KX9EHR54VRTVP2BTMCYJY342 extracted_at=2026-07-11T10:00:00.000Z
  [análisis 2 @ 2026-07-11T18:00:00.000Z] reused=true  id=01KX9EHR54VRTVP2BTMCYJY342 extracted_at=2026-07-11T10:00:00.000Z

  FILAS REALES en brand_kit WHERE domain = 'ugmonk.com' (SQL crudo): rowCount = 1
  { "extracted_at": "2026-07-11T10:00:00.000Z",   <- el del PRIMER análisis
    "palette": ["#1A1A1A","#F5F5F0"],             <- la del PRIMERO (el 2º mandaba otra)
    "tone_of_voice": "Minimalista, sereno y directo, ..." }   <- el del PRIMERO
```

El 2º análisis mandó **a propósito** paleta y tono distintos: **no pisaron nada**. Un `DO UPDATE` habría movido `extracted_at` a t2 y sobrescrito la paleta — eso es exactamente la re-extracción que §9.1 prohíbe. El timestamp inalterado es la prueba de **comportamiento**, no una lectura del código.

## Invariantes afirmados por el implementer — comprobados de forma independiente

| Invariante | Comprobación | Resultado |
|---|---|---|
| `contracts/product-brief.ts` (schema T1.1) no se ha tocado | Ausente de `git diff HEAD --stat` **y** blob hash idéntico a HEAD: `24cebd44…` en worktree y en `HEAD:` | OK byte-idéntico |
| El upsert es `DO NOTHING`, nunca `DO UPDATE` | Grep: 0 `onConflictDoUpdate` (la única coincidencia de "DO UPDATE" es un **comentario** que explica por qué no se usa) **+ prueba de comportamiento**: la fila queda intacta tras un insert en conflicto con datos distintos (`extracted_at` y `updated_at` sin tocar) | OK |
| `validateBrief` es puro (no muta la entrada) | Caso que dispara **las 3 ramas** de corrección a la vez (price_mismatch + hero alucinado + suggested_asset fantasma + hook largo); `structuredClone` antes vs objeto después ⇒ deep-equal. La copia poda el hero a `null`; **la entrada lo conserva** | OK |
| Kits manuales (`domain NULL`) exentos del dedup | 2 upserts con `domain: null` ⇒ `reused=false` ambos, 2 filas distintas (el UNIQUE es parcial `WHERE domain IS NOT NULL`) | OK |
| Dominios distintos no colapsan | `allbirds.com` extrae su propio kit junto al de `ugmonk.com` | OK |

### Extra del verifier — atomicidad bajo concurrencia (`verify-concurrency.txt`)

El repo **afirma** que el `ON CONFLICT DO NOTHING` hace que "dos análisis concurrentes del mismo dominio no creen dos kits". Esa afirmación se comprobó, no se creyó: **8 análisis en paralelo del mismo dominio** contra Postgres real →

```
  extrajeron (reused=false): 1
  reutilizaron (reused=true): 7
  FILAS REALES en brand_kit: 1
  ids distintos devueltos: 1
```

La cláusula "una sola vez" sobrevive a la **concurrencia real**, no solo al camino secuencial.

## Coste real

**$0,00** — cero llamadas a APIs de pago (Anthropic, Firecrawl, fal). T1.9 es lógica **determinista**: el validador es una función pura y el dedup se prueba contra Postgres local (Testcontainers). Los briefs de entrada son los que **ya se pagaron** en la verificación de T1.8; no se re-sintetizó ninguno.

- **Estimado en planning**: ~$0,40 (*"2 análisis del mismo dominio"*).
- **Real**: **$0,00** (desviación −100 %).
- **Recalibración (regla de trabajo 5)**: el estimado era **erróneo por exceso**. La cláusula 3 no necesita dos análisis de pago: lo que verifica es el **índice UNIQUE parcial** de Postgres, y los `extracted_at` son inyectables. Cualquier tarea futura cuya verificación sea "dedup / caché / idempotencia a nivel de datos" debe presupuestarse a **$0**: se prueba contra la BD real con timestamps inyectados, no comprando dos análisis idénticos.

## Veredicto

**PASS** — las tres cláusulas de la Verificación se cumplen literalmente contra el sistema real, con los briefs auténticos de Sonnet 5 como entrada y Postgres 16 real (más las migraciones del producto) como sustrato del dedup.

### Rarezas y hallazgos (no bloquean el PASS, pero quedan anotados)

1. **Los hooks reales de Sonnet 5 incumplen el techo de ≤12 palabras — y el validador lo caza.** Al pasar los briefs REALES de T1.8 por el validador saltaron **8 `hook_too_long`** (7 en allbirds, 1 en ugmonk); p. ej. *"Llevo estas puestas desde las 7 de la mañana y aún no me duelen los pies."* (**16 palabras**). No es un defecto de T1.9 — **es la feature funcionando**: el prompt de N3 (T1.8) no sujeta de forma fiable la regla de §7.2 N3, y el validador determinista lo destapa. Consecuencia para T1.10b: **CP1 mostrará warnings de hooks largos en la mayoría de análisis reales**. Si resulta ruidoso, la palanca es el prompt de N3, no el techo del validador.

2. **Deuda ya documentada por el implementer (`firecrawl.ts` + journal): `registrableDomain` es una heurística last-two-labels, no una public-suffix-list.** Como clave **absoluta** del dedup de `brand_kit`, `marca-a.co.uk` y `marca-b.co.uk` colapsan **ambas** a `co.uk` ⇒ dos comerciantes distintos compartirían paleta, tipografía y tono de voz sin error ni warning (`reused: true` es el camino feliz). Está **fuera del alcance de las tres cláusulas** (que hablan de "2 URLs del mismo dominio") y el implementer lo dejó anotado con mitigación propuesta, así que **no bloquea**. Pero es contaminación cruzada de identidad de marca, no un defecto cosmético: **debe cerrarse antes de que entre en el sistema el primer dominio con sufijo compuesto** (`.co.uk`, `.com.au`, `.co.jp`, `.com.br`).

3. **Hint de knip en el gate** (`src/golden.ts · Remove from ignore`): **preexistente**, no lo introduce T1.9 (ni `knip.json` ni `golden.ts` están en el diff). Es un *hint*, no un error; el gate sale en verde (exit 0).

4. **Divergencia deliberada con la skill de testing**, declarada por el implementer en el código: `unit-core.md` §5 dice *"url sin hero image → error (NO warning)"*, y la implementación emite un **warning tipado bloqueante** (`missing_hero_image` ⇒ `ok=false`). Verificado: da el "error" que la skill pide **y además** el motivo. Ni el PRD (§9.2) ni la Verificación de T1.9 lo prohíben, y la jerarquía del proyecto es PRD/planning > skills. Se anota para que la skill se actualice de forma deliberada (regla 6) y no diverja en silencio.

## Artefactos de esta verificación

- `gate.txt` — output completo de `pnpm gate` (848 tests, exit 0)
- `verify-validator.ts` / `.txt` — cláusulas 1 y 2 + pureza, con los briefs reales de Sonnet 5
- `verify-brandkit.ts` / `.txt` — cláusula 3 contra Postgres 16 real (timestamps + SQL crudo de la fila)
- `verify-concurrency.ts` / `.txt` — atomicidad del dedup con 8 análisis concurrentes
- `invariants.txt` — hashes de `product-brief.ts` y grep de `DO UPDATE`/`DO NOTHING`
