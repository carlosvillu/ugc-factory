# Verificación T1.4 — Cliente Firecrawl + fallback Jina

- **Tarea**: T1.4 · Cliente Firecrawl + fallback Jina (`planning.md`)
- **Fecha**: 2026-07-11
- **Ejecutor**: verifier (Opus 4.8) · agent-browser 0.27.x · sesión `t1.4`
- **Sistema**: commit `43aff9c` (+ diff staged de T1.4, working tree = staged) · docker `ugc-postgres-dev` (healthy) + migraciones aplicadas + `pnpm dev` (web, pid 76341) · secreto `firecrawl` ya sembrado cifrado en `app_setting` (T0.14)
- **Gate previo**: `pnpm gate` VERDE — 73 files / 707 tests, lint + typecheck + format:check + knip OK (`gate.txt`). Sin e2e (T1.4 no añade superficie web propia).

## Verificación esperada (literal de planning.md)
> analizar una landing real JS-heavy → `url_analysis.raw_content` contiene markdown legible, ≥3 imágenes y branding con paleta; el screenshot se descarga por `GET /api/assets/:id/download` (T0.5) y coincide con la landing; con la key de Firecrawl inválida, Jina produce al menos el markdown; los créditos aparecen en `/spend`.

## Superficie
Mixta. Clausulas 1/3 a nivel de datos (script + psql sobre el sistema levantado); clausula 2 = descarga HTTP autenticada (T0.5); clausula 4 = UI `/spend` (agent-browser, no psql).

## Landing elegida
`https://www.oatly.com/en-gb` — SPA JS-heavy (Storyblok headless, clasificada `platform=custom`; el fast-path de T1.3 NO la craquea). Marca fuerte (paleta roja/rosa/azul, tipografía Margo Pro) -> discriminador ideal para validar `mapPalette`/`mapTypography` contra la respuesta REAL.

## Pasos ejecutados
1. Gate verde + puerto 3000 libre + sin dev colgado -> `pnpm dev`, `/api/health` = `{ok:true,db:true}`. Secreto firecrawl ya existente en BD (no re-siembra).
2. **1 (una) scrape REAL pagada** via `pnpm smoke:firecrawl` (URL Oatly) -> `provider=firecrawl`, `credits=1`, analisis `01KX87QQKV8PBHX6D54MFCDXM1` en `status=done`.
3. Dump del `raw_content` por psql (docker exec) -> markdown legible, 25 imagenes con URLs reales (storyblok/vimeocdn), paleta de 6 hex + typography "Margo Pro Regular, Margo Pro Bold".
4. cost_entry: fila NUEVA `01KX87QQHWV9HNQJMR64TB375Q` con `amount_cents=0, quantity=1, unit='credits'` (unica fila firecrawl del dia -> sin doble gasto).
5. Login por navegador (agent-browser) -> `/spend`: fila **Firecrawl · CANTIDAD=1 · UNIDAD=credits** (`04-spend-firecrawl.png`).
6. Descarga autenticada `GET /api/assets/01KX87QQKMPNZ6TJSWZ1XCXHS0/download` con la cookie de sesion -> HTTP 200, `content-type: image/png`, 1484565 bytes, checksum `3952a2fb…` = identico a la fila `asset` en BD. PNG 1920x4453 (fullPage).
7. Eyeball del PNG (`05-crop-top.png`, Read) -> es la landing de Oatly (logos OATLY!, "LOOK BOOK A/W 2025", "AVAVAV × OATLY", paleta de marca) — NO placeholder, coincide con la URL scrapeada.
8. **Fallback**: script propio del verifier (`fallback-verify.ts`) conduce el ingester de core con una key BOGUS -> Firecrawl 401 (gratis) -> Jina -> 20735 chars de markdown. `provider=jina`, `credits=0`, warning `firecrawl_status_401`. (NO se uso `FIRECRAWL_API_KEY=bad pnpm smoke` porque `loadFirecrawlKey` lee la key VALIDA de la BD, no del env -> habria facturado sin fallback.)

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1a | markdown legible | 10614 chars, prosa real de Oatly ("We exist to make it easier…") | smoke-firecrawl.txt, psql dump | OK |
| 1b | >=3 imagenes | 25 imagenes, URLs reales (storyblok.com/vimeocdn) | smoke-firecrawl.txt | OK |
| 1c | branding con paleta | paleta 6 hex NO vacia (#E43E39…) + typography Margo Pro, mapeada de la respuesta REAL | psql dump | OK |
| 2 | screenshot por `GET /api/assets/:id/download` coincide con la landing | HTTP 200 image/png, checksum = BD, PNG = landing Oatly (eyeball) | 05-screenshot-download.png, 05-crop-top.png | OK |
| 3 | key invalida -> Jina al menos el markdown | 401->jina, 20735 chars markdown, credits=0 | fallback-verify.txt | OK |
| 4 | creditos en `/spend` | fila Firecrawl · Cantidad 1 · credits (USD $0.00 correcto/esperado) | 04-spend-firecrawl.png | OK |

## Coste real
- Firecrawl: **1 scrape real = 1 credito ~ $0,00083** -> `amount_cents=0` en el ledger ($0.00, correcto por invariante entero + facturacion por bolsa de creditos). Verdad del gasto en `quantity=1 credits`.
- Jina fallback: tier gratis = $0. 401 de Firecrawl = $0.
- **Total ~ $0,00083 (sub-centimo)** · estimado planning ~$0,30 · cap $0,90. Muy por debajo; sin doble gasto (1 sola fila firecrawl hoy). No requiere recalibracion (el estimado cubria "varios scrapes de prueba"; el verifier acoto a 1).

## Consola del navegador
Sin errores JS en `/spend` (`agent-browser console` limpio).

## Veredicto
**PASS** — las 4 clausulas de la Verificacion se cumplen contra el sistema real con red real acotada a 1 llamada pagada. El mapeo paleta/typography funciona contra la forma REAL de Firecrawl (no solo fixtures); el screenshot descargado por T0.5 es byte-identico y es la landing scrapeada; el fallback a Jina produce markdown con key invalida; los creditos aparecen en `/spend`.

Notas / rarezas (no bloquean):
- La columna **USD** de la fila Firecrawl en `/spend` muestra **$8.42**, NO $0.00. Ese importe viene de una fila `cost_entry` PRE-EXISTENTE (`01KX65D0E2BPK9MYWJ0539ZYEE`, `amount_cents=842`, SIN quantity/unit, del 2026-07-10) ajena a T1.4 — probablemente un seed/prueba manual previo. Mi scrape de T1.4 aporto una fila limpia con `amount_cents=0, quantity=1, unit='credits'`; agregadas dan $8.42 en USD y 1 en Cantidad. La clausula pide que los CREDITOS aparezcan (Cantidad=1 credits) y aparecen; el $8.42 es ruido de datos preexistente, no un defecto de T1.4. Recomendacion menor (no de T1.4): limpiar esa fila huerfana si distorsiona la conciliacion de gasto de F1.
