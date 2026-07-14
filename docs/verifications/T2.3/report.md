# Verificación T2.3 — CP2: UI de matriz y confirmación de gasto

- **Tarea**: T2.3 · CP2: UI de matriz y confirmación de gasto (`planning.md`, fase F2)
- **Fecha**: 2026-07-14
- **Ejecutor**: subagente `verifier` · agent-browser 0.27.x · sesión `t2.3`
- **Sistema**: base commit `4b57f31` + working tree de T2.3 sin commitear (22 modificados, 17 nuevos) · docker compose dev (Postgres 16) + `pnpm db:migrate` + `pnpm seed` (hook_line=80, cta_line=30, recipe=3, persona=2) + `PORT=3100 pnpm dev` (web + worker) · healthcheck `{"ok":true,"db":true}`
- **Gate previo**: `pnpm gate` **verde** — 121 ficheros, **1322/1322 tests** (lint + typecheck + format:check + knip + readme:status OK).
  > Nota de proceso: una primera pasada del gate dio 1 fichero en rojo (`apps/web/test/integration/server/sse-contract.test.ts`, «Another next dev server is already running»). Fue **interferencia mía**: yo tenía un `pnpm dev` ocupando el 3100 mientras ese test levanta su propio `next dev`. Repetido con el 3100 libre: verde 1322/1322. No es un fallo del código de T2.3.

## Verificación esperada (literal de planning.md)

> **Verificación**: en navegador, cambiar tier de Test a Standard actualiza el coste al vuelo; el selector muestra las personas compatibles con el segmento; aprobar crea exactamente las variantes de la matriz (filas con `filename_code` únicos y legibles).

Entregable bloqueante declarado en la tarea:

> **Playwright permanente**: `apps/web/e2e/batch-matrix.spec.ts` cubre selección de ángulos/persona/idiomas, recálculo al cambiar tier y confirmación con el número exacto de variantes visible tras crear el lote.

## Runs ejecutados

| Run | Intake | Autopilot | Para qué |
|---|---|---|---|
| `01KXGVEQYKFH5EWEEVKCSN0XTX` | URL (dr-squatch) | **ON** (encendido a mano en la cabecera) | Cláusulas 1, 2 y 3 + hard-check `alwaysPause` |
| `01KXGW996H3V99GSV3P97CJE2C` | URL (misma) | off | 2.º lote (primer intento de prueba de colisión) |
| `01KXGWKYY9TNJC2Y4CR62TZZJ1` (A) | manual, texto «Sonik Pro» | off | Lote A de la prueba de colisión |
| `01KXGWKYZQSETH2PY3VFJW72E9` (B) | manual, **mismo texto** | off | Lote B — el que colisiona con A |

Los runs A y B se **crearon por API** (`POST /api/analyses` + `POST /api/runs`): eso es **preparación de escenario**, permitida por `cua.md` regla 1. **Todo el flujo bajo verificación (CP2: cambiar tier/idiomas/ángulos/persona y confirmar) se ejecutó como un humano en el navegador**, con clicks reales sobre los controles del panel.

## Pasos ejecutados

1. **Run con autopilot ENCENDIDO** (`01KXGVEQ…`): se activa el switch «Autopilot» de la cabecera nada más crear el run (`01-autopilot-on-run-inicial.png`) → N1/N2/N3 corren y **N3 (CP1, checkpoint NORMAL) NO pausa: pasa a `succeeded` solo** → **N4 SÍ pausa en `waiting_approval`** y `ad_batch` sigue en 0 filas. Evidencia en BD (`autopilot-n4-pause.txt`):
   ```
   pipeline_run: autopilot = t
   N3 | succeeded        | (sin checkpoint_config)
   N4 | waiting_approval | {"alwaysPause": true}
   ad_batch: 0
   ```
2. **Cláusula 1 — coste al vuelo**: panel abierto en tier **Test** → `$0.48 – $2.73`, «6 variantes · tier test» (`02-…png`). Se limpia el buffer de red y se cambia el `<select>` de tier a **Standard**. La ÚNICA petición que se dispara es `POST http://localhost:3100/api/batches/estimate → 200` (`network-tier-change.txt`) y el rail pasa a **`$2.88 – $8.01`**, «tier standard», **sin recargar** (`03-…png`).
3. **Cláusula 2 — personas compatibles**: el `avatar_hint` real del brief es «Persona joven de estilo urbano-casual, tono desenfadado, grabando en un dormitorio o calle» (`brief-audience.txt`). El selector ofrece **solo Lucía** (25-34 · female · latina · casual) y el panel lo declara: «1 persona(s) compatible(s) con el segmento «…»». **Marcus está en la BD y el panel NO lo ofrece** (male · 35-44 · sporty): es la mitad negativa de la regla.
4. **Ángulos e idiomas mueven la matriz**: marcar «English» → la matriz pasa de **6 → 12 filas** y el coste de `$2.88–$8.01` → **`$5.76–$16.02`** (exactamente ×2), otra vez por `POST /api/batches/estimate`.
5. **Cláusula 3 — confirmar crea exactamente las variantes**: el botón dice **«Confirmar y crear 12 variantes»** (el número exacto, `04-…png`). Se pulsa → `POST /api/steps/…/approve → 200`, N4 pasa a `succeeded` por SSE y el panel se retira solo (`05-…png`). En BD (`lote-1-variantes.txt`): **1 `ad_batch`** `planned`, tier `standard`, `languages={es,en}`, **`cost_estimated_cents = 1602`** = **exactamente el techo `$16.02` que el usuario vio**; **12 `ad_variant`**, **todas en `planned`**, **12 `filename_code` únicos**.
6. **PRUEBA DE COLISIÓN (hard-check 2)** — ver sección propia.
7. **`/spend`**: muestra **$0.57** total (Anthropic $0.57 / Firecrawl $0.00), que cuadra con `cost_entry` (`09-spend-coste-real.png`, `coste-real.txt`).
8. **Consola del navegador**: **limpia** — ni un `error` ni un `warning` en toda la sesión (`browser-console.txt`).

## La prueba de colisión de `filename_code` — hecha CON DIENTES

El riesgo que la tarea existe para evitar: dos lotes del **mismo brief con la misma config** producirían los **mismos** `filename_code` y el 2.º INSERT reventaría contra el UNIQUE **GLOBAL** → un **500 en la cara del usuario justo al confirmar el gasto**.

Confirmado que el UNIQUE es global (no scopeado por `batch_id`):
```
"ad_variant_filename_code_unique" UNIQUE CONSTRAINT, btree (filename_code)
```

**Primer intento (VACUO, se documenta por honestidad)**: dos runs sobre la MISMA URL. No sirvió — el scrape+síntesis es no determinista y produjo **dos briefs completamente distintos** («Topi Tanpa Bingkai» y «selayar88»), así que los códigos base no se solapaban en nada:
```
base_codes_compartidos = 0 | base_codes_distintos = 24 | total = 24
```
Sin solape de base, «no hubo 500» no prueba nada: esos dos lotes **no habrían colisionado ni sin discriminador**.

**Segundo intento (VÁLIDO)**: dos runs (A y B) por **intake manual con el MISMO texto**. La síntesis produjo el mismo `product.name` («Sonik Pro»), la misma ausencia de persona compatible (`norot`), el mismo idioma (`es`) y la misma duración (`12s`); y el **primer ángulo de cada brief slugifica IGUAL** («El cepillo manual **no es** suficiente» vs «El cepillo manual **no limpia lo** suficiente» → ambos truncan a `el-cepillo-manua`). Los **previews de CP2 de A y B enseñan literalmente el mismo código base**:

```
A: sonik-pro-el-cepillo-manua-hook01-norot-es-12s
B: sonik-pro-el-cepillo-manua-hook01-norot-es-12s   <-- MISMO
```
(`07-cp2-runB-codigos-base-colisionantes.png`)

Se confirman **los dos** lotes desde la UI. El 2.º `/approve` devuelve **200, no 500**, y en BD (`colision-filename-code.txt`):

| base_code | filas | lotes | códigos completos persistidos |
|---|---|---|---|
| `sonik-pro-el-cepillo-manua-hook01-norot-es-12s` | 2 | 2 | `…-12s-01kxgwrjg6j1` / `…-12s-01kxgwv7mgzk` |
| `sonik-pro-el-cepillo-manua-hook02-norot-es-12s` | 2 | 2 | `…-12s-01kxgwrjg6j1` / `…-12s-01kxgwv7mgzk` |

**Los códigos base COLISIONAN de verdad y lo único que los separa es el sufijo del `ad_batch.id`** (`batchDiscriminator`). Sin él, el segundo INSERT habría violado el UNIQUE. Test no vacuo: **el discriminador es load-bearing y funciona**.

Totales finales (`lotes-y-variantes-final.txt`): 4 lotes (12 + 12 + 6 + 6) = **36 variantes, 36 `filename_code` únicos, todas en `planned`** — ni una más ni una menos que las que la UI enseñó en cada confirmación.

## Legibilidad de los `filename_code` (§8.3)

Forma: `<producto>-<ángulo>-hookNN-<persona>-<idioma>-<duración>-<lote>`

```
topi-tanpa-bingk-detalle-de-produ-hook01-01kxgv0hs4bt-es-12s-01kxgw39rabc
sonik-pro-el-cepillo-manua-hook01-norot-es-12s-01kxgwrjg6j1
```

Producto, ángulo, hook, idioma y duración son **legibles y trazables en un Ads Manager**. El segmento de persona es el **prefijo ULID** de la persona (`01kxgv0hs4bt`), o `norot` si no hay ninguna: trazable, pero **no legible por un humano** (ver Rarezas).

## Playwright permanente — el spec existe, corre y cubre lo que dice

`apps/web/e2e/batch-matrix.spec.ts` (245 líneas, 4 tests, **ninguno `skip`**). Ejecutado con `pnpm test:e2e` (`e2e-batch-matrix.txt`):

```
✓ batch-matrix.spec.ts:100 › cambiar el tier de Test a Standard actualiza el coste AL VUELO (sin recargar) @f2 @checkpoint (10.8s)
✓ batch-matrix.spec.ts:127 › el selector muestra las personas COMPATIBLES con el segmento del brief @f2 (11.0s)
✓ batch-matrix.spec.ts:159 › seleccionar ángulos e idiomas mueve el número de variantes de la matriz @f2 (8.3s)
✓ batch-matrix.spec.ts:182 › confirmar crea EXACTAMENTE las variantes de la matriz, con `filename_code` únicos @f2 @checkpoint (5.6s)
```

Suite E2E completa: **60/60**. Leído el spec: sus asserts son sustantivos (compara el coste **contra el valor anterior** con `toPass`, no contra una constante; comprueba que Marcus **no** aparece; cuenta las filas de `ad_variant` **contra la BD del stack**, no contra un endpoint). Lo que el spec **no** cubre —y por eso se hizo a mano— es la **colisión entre dos lotes** (solo crea uno) y el **autopilot**.

## Contraste texto/fondo (aserción obligatoria de `cua.md` paso 3)

Medido con `getComputedStyle` (color + fondo **efectivo**, componiendo las capas semitransparentes) sobre el panel de CP2 del run `01KXGXHE6VCVHEK9W56ZGKQH47`, en **dark Y light**. Umbral: 4,5:1 normal · 3:1 grande/negrita. Tabla completa en `contraste-wcag.txt`; captura light en `10-cp2-tema-light.png`.

| Elemento | Dark | Light | Umbral | |
|---|---|---|---|---|
| **COSTE total** (`role=status` «Coste del lote», 30 px/600 — el número EN GRANDE) | **16,74** | **17,72** | 3 | OK |
| Botón primario «Confirmar y crear N variantes» | **6,54** | **6,10** | 4,5 | OK |
| Banner de personas (`no_match` / compatibles) | **18,0** | **17,13** | 4,5 | OK |
| Celdas de la matriz (`FILENAME_CODE`, `COSTE`) | **16,74** | **17,72** | 4,5 | OK |
| Sub-línea «N variantes · tier X» | **18,0** | **17,13** | 4,5 | OK |
| Heading «COSTE ESTIMADO DEL LOTE» (`text-text-3`) | **3,81** | 4,83 | 4,5 | **FAIL en dark** |
| Heading «PERSONA · SUGERIDA POR AVATAR_HINT» (`text-text-3`) | **4,09** | 4,67 | 4,5 | **FAIL en dark** |
| Cabecera de tabla «FILENAME_CODE» (`text-text-3`) | **3,59** | 4,52 | 4,5 | **FAIL en dark** |
| Radio seleccionado (`text-accent` sobre `bg-accent-soft`) | **3,28** | **4,27** | 4,5 | **FAIL en ambos** |

**Los elementos que la tarea introduce y que MÁS importan pasan holgados**: el número de dinero en grande (16,7 / 17,7) y el botón que autoriza el gasto (6,5 / 6,1).

**Los cuatro fallos son del DESIGN SYSTEM, no de T2.3** — vienen de tokens usados por sus clases de utilidad, no de colores inventados en CP2:

- `--text-3` = `#71717a` (clase `text-text-3`)
- `--accent` = `#5457e5` sobre `--accent-soft` = `#5457e526` (`globals.css:75`)

**Control negativo**: el mismo `--text-3` da **exactamente 3,81:1** en la nav de `/spend` (página de **T0.12**, preexistente y ajena a T2.3) — **el mismo número que el verifier de T1.13 ya reportó** como deuda del DS («el token compartido `--text-3` … que ya se usa igual en **15 sitios previos**»). T2.3 **hereda** el defecto, no lo introduce.

Por eso, y siguiendo la salvedad explícita de `cua.md` paso 3 («si el color viene del DS: el defecto está en los valores del DS, **decisión del usuario**, pero se REPORTA con la tabla de ratios, no se ignora»), esto es un **hallazgo RUTEADO al DS** y **no bloquea el PASS de T2.3**. Sí es una **deuda que ya va por su segunda tarea sin cerrarse** (T1.13 → T2.3): candidata a tarea propia (subir `--text-3` en dark y `--accent` sobre `--accent-soft` en ambos temas).

## Resultado observado vs esperado

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Cambiar tier Test → Standard **actualiza el coste al vuelo** | `$0.48–$2.73` → `$2.88–$8.01` sin recargar; la única petición es `POST /api/batches/estimate → 200` | `02`, `03`, `network-tier-change.txt` | OK |
| 1b | Ningún número de dinero se calcula en el navegador | Todo recálculo (tier, idiomas, ángulos) dispara `POST /api/batches/estimate`; la razón standard/test ($8.01/$2.73 = 2.93) coincide con la de la tabla `recipe` (500/170 = 2.94) | `network-tier-change.txt` | OK |
| 2 | El selector muestra **las personas compatibles con el segmento** | Solo Lucía (compatible con «estilo urbano-casual»); el panel dice «1 persona(s) compatible(s)…»; **Marcus, que está en la BD, NO se ofrece** | `02`, `brief-audience.txt` | OK |
| 3 | Aprobar crea **exactamente** las variantes de la matriz | Botón «Confirmar y crear 12 variantes» → 1 `ad_batch` `planned` + **12** `ad_variant` `planned`. Los 4 lotes: 12/12/6/6, siempre = lo que la UI enseñó | `04`, `05`, `lote-1-variantes.txt`, `lotes-y-variantes-final.txt` | OK |
| 3b | `filename_code` **únicos** | 36/36 únicos; UNIQUE **global** en BD | `lotes-y-variantes-final.txt` | OK |
| 3c | `filename_code` **legibles** | producto-ángulo-hookNN-persona-idioma-duración-lote; todo legible salvo el segmento de persona (ULID) | § legibilidad | OK (con nota) |
| H2 | Dos lotes con el MISMO código base **no colisionan** (no 500) | Códigos base **realmente colisionantes** entre 2 lotes; `/approve` → **200**; el sufijo `ad_batch.id` los separa | `07`, `colision-filename-code.txt` | OK |
| H3 | `alwaysPause` **con autopilot ENCENDIDO** | `autopilot=t`: N3 (checkpoint normal) auto-aprueba; **N4 pausa igual** en `waiting_approval`, `ad_batch=0` hasta confirmar | `01`, `autopilot-n4-pause.txt` | OK |
| — | Coste autorizado = el que se enseñó | `ad_batch.cost_estimated_cents = 1602` = techo `$16.02` mostrado | `lote-1-variantes.txt` | OK |
| — | Consola del navegador limpia | Sin errores ni warnings | `browser-console.txt` | OK |
| — | N4 es determinista y **$0** | Ni una `cost_entry` colgada de un step N4 (todo el gasto está en N3) | `coste-real.txt` | OK |
| — | **Contraste WCAG** del texto sobre acentos/semánticos (dark y light) | Coste en grande 16,7/17,7 y botón de confirmar 6,5/6,1 **pasan**. 4 elementos por debajo de AA, **todos por tokens del DS** (`--text-3`, `--accent`/`--accent-soft`) que **fallan igual en páginas preexistentes** (mismo 3,81 en `/spend`, ya reportado en T1.13) → hallazgo **ruteado al DS**, no bloquea | `contraste-wcag.txt`, `10-cp2-tema-light.png` | OK (con hallazgo ruteado) |

## Coste real

**$0.70** (estimado de la tarea para N4: **$0**).

| Proveedor | Llamadas | $ |
|---|---|---|
| Anthropic (síntesis N3, **5 runs**) | 7 | **$0.70** |
| Firecrawl (scrape N1, 2 runs, 6 credits) | 2 | $0.00 |

Contrastado con `/spend` en la UI (`09-spend-coste-real.png`): coincide con `cost_entry` al céntimo.

**El gasto NO es de T2.3.** Desglose por nodo (`coste-real.txt`):

```
 node_key | entradas | centimos
 N1       |        2 |        0
 N2       |        2 |        0
 N3       |        5 |       70   <-- TODO el gasto esta aqui
 (N4: NI UNA entrada)
```

**N4 no generó ni una sola `cost_entry`**: es determinista y **$0**, exactamente como la tarea promete. Los $0,70 son el peaje de **llegar** a CP2 (N1→N3 con Anthropic real) en los **5 runs** que la verificación necesitó: 2 para las cláusulas + el autopilot, 2 más para montar la **prueba de colisión con solape real de códigos base**, y 1 para las mediciones de contraste. Dentro del cap (mínimo $1).

## Veredicto

**PASS** — las tres cláusulas literales se cumplen en el navegador contra el sistema levantado, y los tres hard-checks (aritmética en servidor, `filename_code` único global bajo colisión REAL, `alwaysPause` con autopilot encendido) se sostienen. El spec de Playwright existe, corre (4/4, ninguno `skip`) y cubre lo que declara.

### Rarezas y hallazgos (no bloquean T2.3, pero el usuario debe verlos)

1. **[PRODUCTO, candidato a tarea nueva] El scraping por URL devuelve páginas que no son la pedida.** Dos runs sobre `https://www.dr-squatch.com/products/pine-tar-bar-soap` (jabón) produjeron briefs de **«Topi Tanpa Bingkai Futura Wash»** (una gorra indonesia) y de **«selayar88»** (una plataforma de juegos), con imágenes de `footlocker.id`. Es un fallo de **N1 (ingesta)**, ajeno a T2.3 — CP2 compuso correctamente la matriz del brief que le llegó —, pero significa que **el análisis por URL puede devolver basura SEO en vez del producto**. Misma familia que lo que abrió F1c (T1.14/T1.15), con otra cara.
2. **[PRODUCTO] `matchPersonas` da 0 candidatas ante `avatar_hint` realistas — confirmado, y MATIZADO.** El implementer lo declaró y es **cierto en parte**: con el brief del cepillo Sonik Pro (`avatar_hint` = «Persona de unos 30 años, energía cercana y natural, grabando en el baño de su casa…») **ninguna** de las 2 personas sembradas casa, y el panel lo dice honestamente («Ninguna persona de la librería casa con el segmento…; el lote se compondrá sin persona fijada») → `filename_code` con `norot` (`06-…png`). **PERO no es universal**: con el `avatar_hint` «estilo urbano-casual» del otro brief, **Lucía SÍ casó** y Marcus fue correctamente excluido. O sea: la regla funciona, pero **la librería sembrada (2 personas placeholder) es demasiado pobre** para cubrir segmentos comunes. El mecanismo de CP2 es correcto en ambos casos; lo que falta es **librería de personas**, no lógica.
3. **[DS, ruteado — SEGUNDA tarea consecutiva que lo reporta] Contraste sub-AA de dos tokens del DS.** `--text-3` (`#71717a`) da **3,59–4,09:1 en dark** (headings de sección del panel y cabeceras de la tabla de la matriz), y `--accent` sobre `--accent-soft` da **3,28 en dark / 4,27 en light** (el radio de persona/preset seleccionado). **Ninguno lo introduce T2.3**: el mismo `--text-3` da **el mismo 3,81:1** en la nav de `/spend` (T0.12), que es literalmente lo que el verifier de **T1.13 ya reportó** («15 sitios previos»). Los elementos que T2.3 sí estrena y que mandan —el coste en grande (16,7/17,7) y el botón que autoriza el gasto (6,5/6,1)— **pasan holgados**. Tabla completa en `contraste-wcag.txt`. Es deuda del DS acumulándose: **candidata a tarea propia**.
4. **[DS/legibilidad, menor] El segmento de persona del `filename_code` es un prefijo ULID** (`01kxgv0hs4bt`), no un slug del nombre. Trazable, pero un humano en Ads Manager no sabe que es «Lucía». §8.3 pide códigos «legibles»; el resto de segmentos sí lo son. Candidato a pulido (slug del nombre en vez del id).
5. **[Arnés, sin impacto en la app] Los checkboxes/botones de Base UI no siempre responden al `click @eN` de agent-browser** (sí a `check`/`uncheck`). Verificado que **NO es un defecto de la app**: son `<button role="checkbox">` reales, de 20×197 px, con `pointer-events: auto`, y el spec de Playwright los clica por nombre accesible sin problema. Es una limitación del mapeo de refs del CLI sobre el `<input>` visualmente oculto. El mismo síntoma impidió enviar el formulario de intake «Texto libre» desde agent-browser (por eso los runs A/B se prepararon por API); en Playwright ese formulario funciona.
