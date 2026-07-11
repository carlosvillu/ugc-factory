# Verificación T1.5 — Mini-crawl de páginas internas (RE-VERIFY, 2º intento, post-fix)

- **Tarea**: T1.5 · Mini-crawl de páginas internas (`planning.md`)
- **Fecha**: 2026-07-11
- **Ejecutor**: verifier (contexto fresco) · backend-only (sin agent-browser: T1.5 no tiene superficie UI; el observable vive en el retorno del ingester `FirecrawlIngestResult`) · **driver propio del verifier** (`reverify-driver.ts`, no el del implementer)
- **Sistema**: commit base `0bd549f` + **diff T1.5 en working tree** (`packages/core/src/ingest/firecrawl.{ts,test.ts}` + `packages/test-utils/src/fixtures/firecrawl.ts` + `apps/web/test/integration/server/firecrawl-ingest.test.ts`). Ingester de core conducido DIRECTAMENTE con la `FIRECRAWL_API_KEY` de `.env` (RED REAL), sin BD/persistencia — el observable de T1.5 no la requiere. Working tree = lo verificado; ningún fichero de producto tocado por el verifier.
- **Gate previo**: `pnpm gate` **VERDE** re-ejecutado por el verifier (no confié en el `gate.txt` stale) — 73 files / **720 tests**, lint + typecheck + format:check + knip OK (`gate-reverify.txt`, exit 0).

## Verificación esperada (literal de planning.md)
> sobre una tienda real con página de reviews, el markdown anexado contiene texto de reviews reconocible; sobre una landing sin esas páginas, el paso termina en `skipped` sin error.

## Qué cambió desde el FAIL #1 (y por qué se re-verifica de verdad)
El FAIL #1 fue un BUG real: `onlyMainContent:true` en el scrape del landing strippeaba nav/footer → el format `links` no veía `/reviews·/faq·/about` → el mini-crawl **skipeaba siempre**. El FIX (aditivo, 2 scrapes): una scrape LIGERA aparte `fetchDiscoveryLinks` con `formats:['links']` + **`onlyMainContent:false`** obtiene los links full-page; el scrape rico del landing y las internas siguen `onlyMainContent:true` (markdown limpio). El FAIL #1 NUNCA llegó a ejercitar el anexado end-to-end de reviews — esta re-verify SÍ lo ejerce.

## Metodología (2 fases por store, driver propio)
Para cada URL el driver ejecuta:
- **Fase A — discovery probe**: UNA scrape directa `formats:['links']` + `onlyMainContent:false` (espeja `fetchDiscoveryLinks` del fix), vuelca los links crudos y ejecuta la función exportada `discoverInternalUrls` sobre ellos. Es la evidencia de que un `skipped` es legítimo (0 matches del patrón, NO un miss por stripping) y de que los targets de obs1 sí se descubren del set full-page.
- **Fase B — `ingest()` completo**: asserta `provider==='firecrawl'` (un fallback Jina anularía el run), inspecciona `warnings`, `internalPages`, y escanea cada bloque anexado `## <path>` con tokens de review reconocibles.

## Elección de stores (evitando falsos FAIL)
- **Observable #1 (tienda con reviews)**: `https://ollie.com` — su nav/footer enlaza páginas SEPARADAS same-domain `/reviews/`, `/faqs/`, `/about/` (keyword al final del segmento). `/reviews/` es una página real con texto de reviews reconocible (citas de clientes, estrellas), NO widget ni ancla `#reviews`.
- **Observable #2 (landing sin esas páginas)**: `https://www.oatly.com/en-gb`. **Re-probada BAJO EL PATH NUEVO** (`onlyMainContent:false`): aunque ahora el discovery VE el footer completo (65 links / 37 paths same-domain únicos), oatly genuinamente NO tiene `/about`, `/faq` ni `/reviews` — usa `/oatly-who`, `/contact`, `/random-answers`, `/sustainability` (ninguno casa el patrón). Skip legítimo bajo el path endurecido, no un artefacto del path viejo.

## Resultado observado vs esperado

| # | Esperado | Observado | Evidencia | OK |
|---|----------|-----------|-----------|-----|
| A1 | discovery full-page descubre las páginas internas de ollie | 42 links → `discoverInternalUrls` → `[/faqs/, /reviews/, /about/]` (3, cap respetado) | `reverify-obs1-ollie.txt` (Fase A) | OK |
| 1 | Tienda real con reviews → markdown anexado con texto de reviews reconocible bajo `## <path>` | `provider=firecrawl`, `internalPages=[/faqs/,/reviews/,/about/]`, **3 bloques anexados**; bloque `## /reviews/` (15987 chars) con **8 tokens de review** (star, 5 out of 5, review, rating, recommend, customer, love, "my dog") + cita real de cliente: *"Grady was having terrible gut issues... I genuinely believe Ollie saved his life." — Grady's Parent* | `reverify-obs1-ollie.txt` (Fase B + BLOCK 2) | OK |
| 2 | Landing sin esas páginas → `skipped` sin error, markdown intacto | oatly: `provider=firecrawl`, `warnings=["internal_crawl_skipped"]` (SIN `internal_links_scrape_failed` → path de skip LEGÍTIMO, discovery ok + 0 candidatas), `internalPages=[]`, markdown landing intacto (11505 chars), 0 error, `credits=2` | `reverify-obs2-oatly.txt` | OK |
| A2 | el skip de obs2 es un 0-match real, no un strip miss | discovery full-page: 65 links, 37 paths same-domain únicos, `discoverInternalUrls → []` — ninguna reviews/faq/about existe en oatly | `reverify-obs2-oatly.txt` (Fase A) | OK |

## Guardas anti-falso-resultado (todas verdes)
- `provider === 'firecrawl'` en AMBOS runs → ningún fallback Jina contaminó el veredicto.
- Obs2 skip: `internal_crawl_skipped` presente **y** `internal_links_scrape_failed` AUSENTE → es el skip por "discovery ok, 0 candidatas" (2ª observable literal), no un fallo de scrape enmascarado.
- Obs2 probado bajo `onlyMainContent:false` (el path endurecido del fix), no bajo el path viejo → el skip no es un artefacto de la medición.

## Coste real
Firecrawl, RED REAL:
- Obs1 ollie: 1 discovery-probe (Fase A) + `ingest` (1 landing + 1 discovery + 3 internas = 5) = **6 créditos**.
- Obs2 oatly: 1 discovery-probe (Fase A) + `ingest` (1 landing + 1 discovery = 2) = **3 créditos**.
- **Total = 9 créditos ≈ 9 × 0,083 cts = 0,75 céntimos ≈ $0,0075**. Muy por debajo del cap $0,30. Sub-céntimo, coherente con lo esperado.

## Veredicto
**PASS** — ambas observables verificadas contra RED REAL con el fix aplicado:
1. Tienda real con reviews (ollie.com): el markdown enriquecido anexa `## /reviews/` con texto de reviews reconocible (citas de clientes + estrellas + valoraciones), vía Firecrawl (no fallback). El bug del FAIL #1 está resuelto: el discovery-scrape `onlyMainContent:false` recupera los links de nav/footer que el path anterior borraba.
2. Landing sin esas páginas (oatly.com): `skipped` sin error, markdown del landing intacto, por el path legítimo (discovery ok + 0 candidatas), confirmado bajo el path endurecido `onlyMainContent:false`.

**Rarezas**: ninguna que bloquee.
- El bloque `## /reviews/` de ollie incluye una referencia a un "Trustpilot Custom Widget" ("4 out of 5 star rating on Trustpilot"), pero eso es contenido ADICIONAL dentro de la página `/reviews/`: la página SÍ trae texto de reviews propio y reconocible (cita de Grady's Parent, percentiles de satisfacción), así que la observable se cumple con la página real, no con el widget.
- `credits` de la scrape de página única es un default (1) porque `/v2/scrape` no reporta `creditsUsed`; el total (5 para ollie) es un cómputo determinista del ingester, no un valor devuelto por Firecrawl. No afecta a la observable de T1.5 (los créditos son observable de T1.4).

## Artefactos
- `report.md` (este fichero)
- `gate-reverify.txt` — gate previo verde (720 tests), re-ejecutado por el verifier
- `reverify-driver.ts` — driver propio del verifier (2 fases)
- `reverify-obs1-ollie.txt` — salida cruda obs1 (Fase A discovery + Fase B ingest + bloques anexados con escaneo de tokens)
- `reverify-obs2-oatly.txt` — salida cruda obs2 (Fase A discovery bajo onlyMainContent:false + Fase B skip legítimo)
- (Artefactos del FAIL #1 conservados: `obs1-*.txt`, `obs2-*.txt`, `minicrawl-verify.ts`, `discovery-proof.ts`, `links-probe.ts` — memoria del bug ya corregido.)
