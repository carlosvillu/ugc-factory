# Verificación T1.7 — Cliente Anthropic + VisualAnalyzer

- **Tarea**: T1.7 · Cliente Anthropic + VisualAnalyzer (`planning.md`)
- **Fecha**: 2026-07-11
- **Ejecutor**: verifier (escéptico) · agent-browser 0.27.0 · sesión `t1.7`
- **Sistema**: commit `98bd1ed` con el diff de T1.7 **staged sin commitear** (working tree = código verificado; `pnpm dev` corre el diff) · docker compose dev (Postgres 16) + migraciones + `pnpm dev` (web+worker) · secretos T0.14 (anthropic/firecrawl) ya sembrados en BD (la BD es la fuente; `.env` ignorada)

## Verificación esperada (literal de planning.md)
> sobre las imágenes de una landing real, la clasificación coincide con el juicio humano en ≥7 de 8 (revisión manual); coste del paso <$0,02 en `/spend`; el modo manual sin imágenes deja el paso `skipped` y el flujo continúa.

## Naturaleza de la tarea
Backend, sin endpoint web todavía (T1.10a). El servicio bajo prueba es **`runVisualAnalyze`**
(apps/web/src/server/visual-analyze.ts) — la superficie que llama a Haiku, reescala y registra el
`cost_entry`. Se condujo con un driver propio del verifier (`analyze-verify.ts`) que compone los
servicios REALES exactamente como lo hará T1.10a: `runFirecrawlIngest` (RawContent real con imágenes
CDN + screenshot persistido) → `runVisualAnalyze`. **1 sola llamada pagada a Anthropic.** La cláusula
"en /spend" se comprobó en la UI real con agent-browser (login + lectura de la fila anthropic).

## Pasos ejecutados
1. `pnpm gate` → verde (742 tests, lint/typecheck/format/knip OK; solo warnings preexistentes de Playwright/dep). Evidencia: `gate.txt`.
2. compose up + `db:migrate` + `pnpm dev` → `/api/health` = `{ok:true,db:true}`. Boot confirma secreto `anthropic` presente en BD.
3. Baseline cost_entry: anthropic count=1 (fila stale de demo, 1288 cts, sin quantity/project). Evidencia: `cost_baseline.txt`.
4. **Guardrail anti-gasto**: dry-runs (`ANALYZE_DRY=1`) sobre ollie/oatly → <8 imágenes sendable (filtro raster). Se descartaron SIN gastar Anthropic. deathwishcoffee.com → 39 sendable → apto. Evidencia: `dry-ollie.txt`.
5. **Llamada pagada única** sobre deathwishcoffee.com → status=`analyzed`, 8 imágenes clasificadas, usage=`{input:6695, output:313}`. Evidencia: `real-run.txt`.
6. Medición del bound DURO en la fila cost_entry de ESTA llamada (aislada por id/timestamp/project). Evidencia: `cost_entry-isolated.txt`.
7. Descarga local de las 8 imágenes clasificadas (`product-01..08`) para el side-by-side durable.
8. **`/spend` en la UI** (agent-browser, sesión t1.7): login → `/spend` → fila Anthropic visible. Evidencia: `01-spend-anthropic.png`, `browser-console.txt` (limpia).
9. **Caso skipped**: RawContent manual `images=[]`, sin screenshotRef, sin uploads → `skipped`, usage=null, anthropic count 2→2 (cero gasto), VisualAnalysis vacío. Evidencia: `skipped-run.txt`.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Coste del paso **<$0,02** (bound duro: amount_cents < 2) | Fila cost_entry de la llamada: **amount_cents=1** (0.826 cts = 6695·$1/M + 313·$5/M, redondeado), quantity=7008 tokens, unit='tokens', provider='anthropic' | `cost_entry-isolated.txt`, `real-run.txt` | OK |
| 2 | El coste aparece **en /spend** | Fila **Anthropic · 7 008 tokens · $12.89** visible en la UI; el día 2026-07-11 = **$0.03** (mi run: Firecrawl $0.02 + Anthropic $0.01). El $12.89 del proveedor agrega la fila stale de demo ($12.88) + mi fila ($0.01) — ver Rarezas | `01-spend-anthropic.png` | OK |
| 3 | Modo manual sin imágenes -> `skipped`, flujo continúa | status=`skipped`, usage=`null`, anthropic cost_entry 2->2 (cero llamada), VisualAnalysis `{images:[], hero:null}` devuelto sin crash | `skipped-run.txt` | OK |
| 4 | Clasificación coincide con juicio humano >=7/8 (**revisión manual**) | 8 imágenes clasificadas con etiquetas coherentes a la vista del verifier; **decisión final del usuario** | `side-by-side.html`, `product-01..08`, `classifications.txt` | PENDIENTE JUICIO HUMANO |

## Coste real
- **Anthropic (el paso verificado)**: 1 llamada, 7008 tokens (6695 in / 313 out), **$0.01** (amount_cents=1). Estimado planning ~$0.10 -> muy por debajo; el fix de reescalado a <=768px funciona (llamada holgada bajo 1 céntimo, como predijo el implementer).
- **Firecrawl (preparación de escenario, NO cuenta contra el bound del paso)**: ~29 credits a lo largo de los dry-runs + el scrape real = **$0.02** en el ledger.
- **Total nuevo gasto de esta verificación**: **$0.03** (visible como el total del día 2026-07-11 en /spend). Dentro del cap ($0.30).

## Veredicto
**PASS (parcial) — las 3 cláusulas automatizables PASAN; la 4a (>=7/8) queda PENDIENTE de juicio humano.**
- Coste del paso **<$0,02**: **PASS** (amount_cents=1, medido en la fila real, bound duro cumplido).
- Coste aparece en **/spend**: **PASS** (fila Anthropic con 7008 tokens en la UI).
- Modo manual sin imágenes -> **skipped**: **PASS** (skipped, usage null, cero gasto, flujo continúa).
- **>=7/8 con juicio humano: PENDIENTE.** Side-by-side listo en `side-by-side.html` (abrir en navegador; imágenes locales embebidas junto a kind/background/video_suitability/has_overlay_text). **PENDIENTE juicio humano: ¿coinciden >=7 de 8 con tu criterio?** El verifier NO marca esta cláusula PASS.

### Rarezas / notas
- **/spend agrega por proveedor**: la fila Anthropic muestra **$12.89**, no $0.01. Ese total incluye una fila **stale de demo** preexistente (1288 cts = $12.88, sin quantity/project, del 2026-07-10) MÁS mi fila real ($0.01). El coste del PASO (lo que exige la Verificación) es la fila aislada = **1 céntimo**, probado a nivel de fila en BD. Los 7008 tokens que muestra /spend provienen ÍNTEGRAMENTE de mi llamada (la fila vieja tiene quantity=NULL). No es un defecto de T1.7: es data de siembra previa en la BD de dev.
- El diff de T1.7 estaba **staged sin commitear** al verificar (working tree = lo verificado; el bucle debe commitearlo al cerrar).
- Consola del navegador en /spend: limpia (solo React DevTools info + HMR). Sin errores.
- Nota de juicio (no vinculante): a la vista del verifier las 8 lucen correctas (logos de prensa->other/unusable, packshots->hero, banners/escenas->lifestyle/broll), pero el >=7/8 lo decide el usuario.
