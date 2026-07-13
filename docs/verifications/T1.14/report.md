# Verificación T1.14 — El filtro de imágenes deja fuera AVIF y las URLs sin extensión

- **Tarea**: T1.14 · El filtro de imágenes deja fuera AVIF y las URLs sin extensión (`planning.md`, fase F1c)
- **Fecha**: 2026-07-13
- **Ejecutor**: subagente `verifier` · agent-browser 0.27.0 · sesión `t1.14`
- **Sistema**: commit `e14fc10` + **diff T1.14 sin commitear** (working tree) · docker compose dev (`ugc-postgres-dev`) + `pnpm dev` (web `localhost:3000`, worker ready) · sin seeds extra
- **Gate previo**: `pnpm gate` en verde ejecutado por mí antes de levantar la app (109 ficheros / **1146 tests** pasados; lint, typecheck, format:check y knip limpios) — `gate-output.txt`. Ejecutado con `pnpm dev` APAGADO (rareza conocida del journal: el gate no es hermético con un dev vivo).

## Verificación esperada (literal de planning.md)

> análisis por URL REAL de `https://relatio.chat` → N2 clasifica ≥1 imagen (hoy: 0) y el panel del nodo N2 muestra `images` no vacío; coste del pipeline dentro del bound de T1.10a (<$0,25). Evidencia con el `output_refs` de N2 antes/después.

## Pasos ejecutados

1. **Gate previo** con el dev apagado → verde (1146 tests). *(`gate-output.txt`)*
2. **Sistema levantado**: `rm -rf apps/web/.next` (residuo de dev matado) → `pnpm dev` → `GET /api/health` = `{"ok":true,"db":true}`; worker log `worker ready`. Docker `ugc-postgres-dev` healthy.
3. **Evidencia del "antes"** (run REAL del 2026-07-13 que murió, `01KXD1MM3ENG6QNZ43YY7M1P6V`, capturado en BD): N1 scrapeó **2 imágenes, ambas `.avif`**; N2 `visualAnalysis.images = []`, `hero_image_url: null`; N3 **`failed`** con `missing_hero_image` (permanente). *(`n2-output-refs-before.json`, `steps-before-after.txt`)*
4. **Login por UI** (`/login`, password real) y **`/analyses/new` → pestaña «Desde URL»** (ya seleccionada) → campo «URL del producto» = `https://relatio.chat` → click **«Analizar»**. *(`01-intake-url-relatio.png`)*
5. **El run avanza y para en CP1** en `/runs/01KXD5XD4AWWRAM28W7EDJTMDT`, **sin reload en ningún momento**: la página muestra «Progreso · 2/3» y «Coste real $0.16», y N3 queda en `waiting_approval` con el editor de brief abierto. *(`02-canvas-cp1-abierto.png`)*
   > **Honestidad sobre la evidencia**: el run llegó a CP1 antes de mi primera captura, así que **no tengo frames del cambio de color de los nodos en vivo** (mis 3 primeras capturas salieron idénticas byte a byte y las deduplicué). Lo que sí observé sin recargar: las transiciones de estado en BD (`pending`→`succeeded` de N1/N2, N3 en `waiting_approval`) y el contador «Progreso · 2/3» / «Coste real» ya poblados en la página. **El SSE en vivo no es una cláusula de T1.14** (eso era la Verificación de T0.11); no lo cuento como verificado aquí.
6. **N3 alcanza CP1** (`waiting_approval`, brief editable) — NO falla con `missing_hero_image`, a diferencia del "antes". Apruebo CP1 desde la UI («Aprobar y continuar») → **run 100 %, 3/3, los tres steps `succeeded`**. La aprobación libera el panel derecho: por diseño (T1.10b) el editor CP1 **sustituye** al `StepPanel` mientras está abierto, así que el inspector genérico no existe en el DOM hasta que CP1 se cierra.
7. **EL PASO CLAVE — click humano sobre el nodo N2 del canvas** (ya visible y clicable, sin trucos) → se abre **INSPECTOR · N2** (`[data-slot="step-panel"]`) con la sección **OUTPUT**:
   `{"status":"analyzed","warnings":[],"visualAnalysis":{"images":[{"url":"https://relatio.chat/mobile-app.avif","kind":"lifestyle","background":"clean","has_overlay_text":false,"video_suitability":"hero"`
   → **`images` NO vacío en el panel del nodo N2**, con la URL `.avif` que el filtro viejo descartaba. **Esta es la evidencia que sostiene la cláusula.** *(`07-panel-inspector-n2-images.png`, `n2-panel-text.txt`)*
8. *(Secundario)* Antes de aprobar CP1, con el lienzo comprimido, también leí el mismo `output_refs` en el **cuerpo del propio nodo N2** del grafo — pero para que N2 entrase en el viewport tuve que **panear el lienzo a mano** (ver rareza 3). No es la evidencia principal: la cláusula la cierra el paso 7 (click normal sobre un nodo visible). *(`06-nodo-n2-images-no-vacio.png`)*
9. **`output_refs` del después** por psql (contraste con el antes): N2 clasifica **2 imágenes**, ambas `.avif`, y elige `hero_image_url: https://relatio.chat/mobile-app.avif`. *(`n2-output-refs-after.json`)*
10. **Coste real** por `cost_entry` (join por `step_run_id`, que es como se atribuye — la tabla no tiene `run_id`) + contraste con `/spend`. *(`cost-after.txt`, `08-spend.png`)*
11. **Consola y errores del navegador**: cero mensajes fuera de HMR/Fast-Refresh/React-DevTools; `errors` vacío. *(`browser-console.txt`)*
12. **Chequeo independiente del filtro** (mis entradas, NO las del implementer): script propio que importa `fetchableProductImageUrls` del código de producto y comprueba los dos casos reales + los que deben seguir fuera. **10/10 OK.** *(`filter-check.ts`, `filter-check-output.txt`)*

## El antes y el después (el corazón de la tarea)

N1 scrapeó **exactamente las mismas 2 URLs `.avif`** en ambos runs, así que el camino AVIF se ejerció de verdad (no es que la web haya cambiado):

| | ANTES (`01KXD1MM3ENG6QNZ43YY7M1P6V`) | DESPUÉS (`01KXD5XD4AWWRAM28W7EDJTMDT`) |
|---|---|---|
| N1 `raw.images` | 2 URLs `.avif` | las **mismas** 2 URLs `.avif` |
| N2 `visualAnalysis.images` | `[]` (0 clasificadas) | **2 clasificadas** (`lifestyle`/`hero`, `chart_or_text`/`broll`) |
| N2 `hero_image_url` | `null` | `https://relatio.chat/mobile-app.avif` |
| N2 tokens (Anthropic) | 1 911 | **3 182** (las imágenes llegan de verdad al VLM) |
| N3 | **`failed`** · `missing_hero_image` (permanente) | `succeeded` (tras aprobar CP1) |

## Resultado observado vs esperado

| # | Esperado (literal) | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Análisis por URL **REAL** de `https://relatio.chat` | Lanzado desde la UI (`/analyses/new`, «Desde URL»), Firecrawl y Anthropic reales, run `01KXD5XD4AWWRAM28W7EDJTMDT` | `01-intake-url-relatio.png`, `02-canvas-cp1-abierto.png` | ✅ |
| 2 | **N2 clasifica ≥1 imagen** (hoy: 0) | **2 imágenes clasificadas** (ambas `.avif`), con `kind`/`background`/`video_suitability` poblados | `n2-output-refs-after.json` | ✅ |
| 3 | **El panel del nodo N2 muestra `images` no vacío** | Click normal sobre el nodo N2 → INSPECTOR · N2 → OUTPUT con `"images":[{"url":"…mobile-app.avif","kind":"lifestyle",…}]` | **`07-panel-inspector-n2-images.png`** (+ `n2-panel-text.txt`) | ✅ |
| 4 | **Coste del pipeline < $0,25** (bound T1.10a) | **$0,16** (16 ¢) del run completo N1+N2+N3 | `cost-after.txt`, canvas «Coste real $0.16» | ✅ |
| 5 | **Evidencia con el `output_refs` de N2 antes/después** | Ambos persistidos y contrastados: `[]` → 2 imágenes | `n2-output-refs-before.json` / `n2-output-refs-after.json` | ✅ |

## Coste real

| Nodo | Proveedor | Cantidad | USD |
|---|---|---|---|
| N1 | Firecrawl | 2 credits | $0,00 |
| N2 | Anthropic (Haiku) | 3 182 tokens | $0,00 (redondeo a céntimos) |
| N3 | Anthropic (Sonnet) | 23 661 tokens | **$0,16** |
| **Total del run** | | | **$0,16** |

- **Estimado**: $0,30 · **Real**: $0,16 → **−47 %** (por debajo; no requiere recalibración al alza).
- **Bound de la Verificación**: < $0,25 → **cumplido** ($0,16).
- **Cap de gasto**: $1 → no rozado.
- **`/spend`** muestra $0,45 acumulados del día (los 2 runs previos del uso real del usuario + este) — coherente; la atribución por run se hace con el join `cost_entry → step_run`, ya que `cost_entry` no tiene `run_id`.

## Veredicto

**PASS** — con las mismas 2 URLs `.avif` que antes producían `images: []`, N2 clasifica ahora **2 imágenes** y el panel del nodo N2 lo muestra en la UI; el run entero cuesta **$0,16 < $0,25**.

### Notas y rarezas (no bloquean el PASS)

1. **N3 NO falló** (se contemplaba que pudiera hacerlo por `missing_hero_image`). Haiku clasificó `mobile-app.avif` como `video_suitability: hero`, hubo hero, y N3 llegó a CP1 y completó. Esto **no adelanta ni invalida T1.15**: T1.15 sigue siendo necesaria para las webs donde ninguna imagen sea usable como hero — el run de stayforlong.com (`01KXD1SPQ8EYKDZ4QXWD3WWX1Z`) es exactamente ese caso y sigue sin arreglo. Simplemente relatio.chat dejó de ser un caso de T1.15 al arreglarse T1.14.
2. **El corte por `MAX_PRODUCT_IMAGES` (8) no se ejerció en vivo**: relatio.chat solo emite 2 imágenes. Ese camino queda cubierto por los tests (unit + integración), no por esta verificación.
3. **Hallazgo de UI (fuera del alcance de T1.14, candidato a la deuda de F1c)**: mientras el editor CP1 está abierto, el lienzo de React Flow se comprime a **255 px de ancho** y los nodos N2 y N3 quedan **fuera de la vista** (posiciones x=341 y x=641). Como `fitView` solo actúa en el montaje y no hay controles de zoom/fit, el usuario tiene que **panear el lienzo a mano** para ver siquiera que N2 existe. No afecta a lo que T1.14 promete (el dato está en el DOM y el panel lo muestra correctamente en cuanto CP1 se cierra), pero es fricción real del mismo tipo que las que originaron T1.16/T1.17.
4. **Consola del navegador limpia**: cero `console.error`/warnings de código propio; solo ruido de HMR/Fast-Refresh de dev.
5. **Chequeo independiente del filtro** (`filter-check.ts`, entradas elegidas por mí): los dos casos reales del planning pasan (`.avif` de relatio.chat **y** `/_next/image?url=…` de stayforlong.com), y `data:`, `blob:`, `.svg` (incl. `LOGO.SVG?v=9`) y relativas siguen fuera. 10/10.
