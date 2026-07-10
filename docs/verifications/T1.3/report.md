# Verificación T1.3 — Fast path determinista de ingesta

- **Tarea**: T1.3 · Fast path determinista de ingesta (`planning.md`)
- **Fecha**: 2026-07-10
- **Ejecutor**: verifier (contexto fresco) · script backend `smoke:ingest` + curl externo + `psql` (docker exec) · RED REAL
- **Sistema**: working tree de T1.3 sobre commit base `fa70fa5` (diff sin commitear: `packages/core/src/ingest/`, `packages/db/src/repos/url-analysis.repo.ts`, `apps/web/scripts/smoke-ingest.ts`) · docker compose dev (Postgres 16 `ugc-postgres-dev`, puerto 55432) + migraciones aplicadas
- **Gate**: `pnpm gate` → 610/610 tests verdes. Un `57P01` en el teardown de `apps/worker/.../step-execute.test.ts` hace salir el runner con exit 1 en la 1ª corrida; es el flake benigno documentado (journal 2026-07-10: teardown-only, siempre post-tests-pass, jamás falso verde). Re-corrida de `pnpm test` → 610/610 exit 0 limpio. Gate considerado VERDE.

## Verificación esperada (literal de planning.md)
> contra 3 URLs reales (1 Shopify, 1 con JSON-LD, 1 solo-OG), el `RawContent` persistido contiene título/precio/imágenes correctos comprobados a mano contra la página; una URL cuyo `{url}.json` responde 404/401 degrada al parser JSON-LD/OG de forma transparente (sin error visible ni fila rota).

## URLs reales elegidas (por el verifier, no fixtures del implementer)
| Tipo | URL | `.json` status | Fuente que ganó el merge |
|---|---|---|---|
| Shopify | `https://www.allbirds.com/products/mens-cruiser-shadow-blue-natural-white-sole` | **200** | Shopify `.json` |
| JSON-LD | `https://woocommerce.com/products/woocommerce-bookings/` | **404** (non-200) | JSON-LD `Product` (fallback) |
| solo-OG | `https://bellroy.com/products/hide-and-seek-wallet` | **404** | OpenGraph (fallback; sin JSON-LD en la página) |

Nota clasificador: las 3 URLs tienen path `/products/<handle>` -> `classifyUrl` devuelve `shopify` para las tres -> el probe `{url}.json` se DISPARA en las tres. En allbirds responde 200 (fast path lo usa); en woocommerce.com y bellroy responde 404 -> la rama 404 -> degradacion transparente de la clausula 2 se ejecuta de verdad (no vacuamente). Se eligieron URLs no-Shopify con path `/products/` precisamente para forzar el disparo del probe.

## Comprobacion A MANO (RawContent extraido/persistido vs la pagina real)

### URL 1 — Shopify (allbirds)
Ground truth leido del `.json` real de la pagina:
| Campo | Real en la pagina (.json) | Extraido/persistido | OK |
|---|---|---|---|
| titulo | `Men's Cruiser - Shadow Blue (Natural White Sole)` | identico | OK |
| precio | `105.00` (variant price) | `105.00` | OK |
| moneda | USD | `USD` | OK |
| imagenes | 5, 1a = `.../All-birds_0010.png?v=1783535519` | 5, 1a identica | OK |
| platform | shopify | `shopify` | OK |

Precedencia Shopify > JSON-LD confirmada: los valores persistidos coinciden con el payload del `.json`.

### URL 2 — JSON-LD (woocommerce.com)
Ground truth leido del `<script type="application/ld+json">` `Product` real:
| Campo | Real en la pagina (JSON-LD) | Extraido/persistido | OK |
|---|---|---|---|
| titulo | `WooCommerce Bookings` (name) | identico | OK |
| precio | `221.00` en `offers[0].priceSpecification[0].price` (UnitPriceSpecification) | `221.00` | OK |
| moneda | `EUR` (priceCurrency) | `EUR` | OK |
| imagen | `.../Bookings_icon-marketplace-160x160-1.png` | identica | OK |

El precio vive en `priceSpecification`, no en `offers.price` directo — el parser lo resuelve (fix "JSON-LD priceSpecification" del code-review). Un extractor ingenuo se lo perderia.

### URL 3 — solo-OG (bellroy)
Pagina SIN JSON-LD (`has ld+json script: false` comprobado); solo OpenGraph:
| Campo | Real en la pagina (OG) | Extraido/persistido | OK |
|---|---|---|---|
| titulo | `og:title` = `Hide &amp; Seek: Wallet With Hidden Pocket | Bellroy` | `Hide & Seek: Wallet With Hidden Pocket | Bellroy` (`&amp;`->`&`) | OK |
| imagen | `og:image` = `.../USD/WHSD-CAR-301/0` | identica | OK |
| precio | AUSENTE en OG | `null` | OK |
| moneda | AUSENTE | `null` | OK |

Precio null HONESTO (fix "currency=null honesto"): la pagina no expone precio en OG y el fast path no lo inventa. `&amp;` decodificado correctamente.

## Clausula 2 — degradacion transparente (404/401 -> JSON-LD/OG, sin error ni fila rota)
- `woocommerce.com/products/woocommerce-bookings.json` -> **404** (curl externo). Probo, obtuvo 404, degrado a JSON-LD.
- `bellroy.com/products/hide-and-seek-wallet.json` -> **404**. Degrado a OG.
- En ambos: `warnings = []` (el 404 del `.json` no genera warning — rama esperada), smoke salio `OK` (exit 0), fila `url_analysis` escrita con `status=done` y RawContent valido. Sin error visible, sin fila rota.
- Cross-check BD: las 3 filas presentes, `source=url`, `status=done`, `warnings=[]`, RawContent completo, `content_hash` calculado.
- El codigo ramifica en `!res.ok` (fast-path.ts:137), asi que 401 recorre EXACTAMENTE la misma rama que 404; verificados dos 404 reales, el 401 queda cubierto por identidad de rama.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Shopify: titulo/precio/imagenes correctos a mano | Coincidencia exacta vs `.json` real | smoke-1-shopify.txt, db-rows.txt | OK |
| 2 | JSON-LD: titulo/precio/imagenes correctos a mano | Coincidencia exacta vs JSON-LD Product (precio en priceSpecification) | smoke-2-jsonld.txt, db-rows.txt | OK |
| 3 | solo-OG: titulo/imagen correctos, precio ausente honesto | Coincidencia exacta vs OG; `&amp;` decodificado; precio null | smoke-3-og.txt, db-rows.txt | OK |
| 4 | `{url}.json` 404 -> degrada transparente, sin error ni fila rota | 2 URLs con `.json` 404 -> fallback silencioso, warnings=[], exit OK, fila valida | clause2-json-probe.txt, db-rows.txt | OK |

## Coste real
**$0** — solo webs publicas de e-commerce por HTTP; ninguna API de pago. Estimado $0.

## Veredicto
**PASS** — las dos clausulas se cumplen contra red real: los 3 RawContent persistidos coinciden a mano con la pagina real (Shopify via `.json`, JSON-LD via priceSpecification, OG con decode de entidades y precio null honesto), y las dos URLs con `.json` 404 degradan a JSON-LD/OG de forma transparente (sin warning, sin error, sin fila rota).

**Rarezas (aunque PASS)**:
- El caso JSON-LD ideal (PDP no-Shopify con JSON-LD Product + precio, `.json` 404) fue dificil en red real: la mayoria de grandes retailers renderizan JSON-LD por JS o bloquean bots (403). ~30 candidatos probados. `woocommerce.com/products/woocommerce-bookings` es un JSON-LD Product server-rendered legitimo con precio real (221.00 EUR) — valido, aunque es un plugin, no un bien fisico. Documentado como rareza por guia de la propia Verificacion, no como debilidad del veredicto.
- Las 3 URLs clasifican `platform=shopify` por el path `/products/` (incluso las no-Shopify). Para bellroy es correcto (plausiblemente una tienda Shopify que capo su `.json`). Para woocommerce.com es una MISCLASIFICACION real del heuristico `/products/` (el sitio de WooCommerce no es Shopify). PERO la Verificacion de T1.3 acota a contenido del RawContent + fallback transparente, NO a la exactitud de la columna `platform` -> fuera de alcance de esta tarea; se anota para consumidores downstream, no es defecto de T1.3. La eleccion de URLs con `/products/` fue deliberada para que el probe `.json` se disparara y la clausula 2 tuviera cobertura real.
- `bellroy` `.json` en 404 al verificar; `woocommerce.com` paso de 301->404 entre corridas; ambos non-200 -> fallback. Sin impacto en el veredicto.
