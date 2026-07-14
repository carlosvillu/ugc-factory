# Verificación T2.7 — Una redirección silenciosa no puede cambiar lo que el usuario pidió analizar

- **Tarea**: T2.7 · Una redirección silenciosa no puede cambiar lo que el usuario pidió analizar (`planning.md`, fase F2b)
- **Fecha**: 2026-07-14
- **Ejecutor**: subagente `verifier` · agent-browser (CLI vía `npx`, Chrome for Testing 150.0.7871.49) · sesión `t2.7`
- **Sistema**: commit `606e1998d0da2327cac1e36f15eb91b2aa07a97c` + el diff de T2.7 **sin commitear** (21 ficheros modificados: el bucle commitea tras el PASS). docker compose dev (Postgres 16) + `pnpm db:migrate` + `pnpm seed` (hook_line=80, cta_line=30, recipe=3, persona=2) + `pnpm dev` (web :3000 + worker). Healthcheck: `{"ok":true,"db":true}`.
- **Gate previo**: `pnpm gate` **verde** — 121 ficheros, **1372 tests** pasados.

## Verificación esperada (literal de planning.md)

> **Verificación**: análisis por URL de una página que redirige a la raíz (`https://www.dr-squatch.com/products/pine-tar-bar-soap` sirve hoy como caso vivo; si el dominio se limpia, vale cualquier producto descatalogado que redirija) → **CP1 muestra visiblemente que se analizó otra URL**, con la pedida y la final; en BD, `url_analysis` guarda las dos. Y el control negativo: un análisis de una URL que solo redirige `http→https` **NO** dispara ningún aviso (la señal no puede ser ruido).

## Elección de los casos (los inputs los elige el verifier; no se reutilizan los del implementer)

**El caso vivo SIGUE VIVO** — comprobado con `curl` ANTES de gastar ningún run, como la propia Verificación exige:

```
== CASO POSITIVO (dr-squatch)
HTTP/2 301
location: https://www.dr-squatch.com/
  final=https://www.dr-squatch.com/ code=200 hops=1
```

No hizo falta sustituir el dominio. Evidencia cruda: `redirect-chains-curl.txt`.

**El control negativo lo elegí yo** (`http://www.allbirds.com/products/mens-cruiser-shadow-blue-natural-white-sole`), y esa elección es la parte más delicada de esta verificación: un control negativo que **no redirigiera de verdad** no demostraría nada (silencio por ausencia de redirección, no por criterio). Descartes hechos con `curl` antes de gastar el run:

| URL candidata | Por qué la descarté |
|---|---|
| `http://www.ollie.com/products/fresh` | 301 limpio a https, **pero acaba en 404** (2 hops) — no hay página que analizar |
| `http://www.oatly.com/products/oat-drink-barista-edition` | **404** |
| `http://www.tushy.co/products/tushy-classic-3-0` | salta a **otro host** (`join.tushy.com`), 403 — sería un positivo, no un control negativo |

La elegida cumple lo que la cláusula pide, verificado hop a hop:

```
== CONTROL NEGATIVO (allbirds, SOLO http->https, mismo host, mismo path)
HTTP/1.1 301 Moved Permanently
Location: https://www.allbirds.com/products/mens-cruiser-shadow-blue-natural-white-sole
  final=https://www.allbirds.com/products/mens-cruiser-shadow-blue-natural-white-sole code=200 hops=1
```

**Redirección REAL (301) que solo cambia el esquema**, mismo host, mismo path, y termina en 200 con la página de producto viva. Así, la ausencia de aviso es una decisión del comparador, no un accidente.

## Pasos ejecutados

1. `pnpm gate` → verde (1372 tests). Sistema levantado; `/api/health` → `{"ok":true,"db":true}`.
2. Baseline de gasto leído en la **UI de `/spend`**: **$0.70**.
3. Login en el navegador (como humano) → `/analyses/new`.
4. **CASO POSITIVO**: pego `https://www.dr-squatch.com/products/pine-tar-bar-soap`, click en «Analizar» → run `01KXH87VMC7PN0RG3YB7WWPKC8`. Esperado a N3 = `waiting_approval` (CP1).
5. Leído CP1 en el navegador → **el aviso aparece, con las DOS URLs**. Screenshot + consola.
6. Medido el **contraste WCAG** del aviso (aserción obligatoria de UI).
7. `psql` sobre `url_analysis` → las dos URLs persistidas.
8. **CONTROL NEGATIVO**: pego la URL http de allbirds → run `01KXH941MQWWQ42S1FF9CFVD4T`. Esperado a CP1.
9. Leído CP1 → **NO hay aviso de redirección**; y en BD la redirección **sí se observó y se guardó** (pedida ≠ final) ⇒ discriminación, no ceguera.
10. Gasto final leído en `/spend`.

## Resultado observado vs esperado

| # | Cláusula | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|---|
| 1a | Positivo · UI | CP1 muestra visiblemente que se analizó otra URL, **con la pedida y la final** | Alert ámbar: «**Se analizó otra página.** Pediste analizar `https://www.dr-squatch.com/products/pine-tar-bar-soap`, pero la web redirigió a `https://www.dr-squatch.com` y el brief describe ESA página (la página del producto ya no existe y la web devolvió su portada).» Las **dos URLs literales y legibles**. El brief titula **«SELAYAR88»** (la home secuestrada): confirma que se analizó la home | `02-pos-cp1-aviso-redireccion.png` | ✅ |
| 1b | Positivo · avisa NO bloquea | El run sigue; «Aprobar y continuar» habilitado | Botón «Aprobar y continuar» **habilitado** (`requiresDecision:false`); el run sigue vivo en N3 | `02-pos-cp1-aviso-redireccion.png` | ✅ |
| 1c | Positivo · BD | `url_analysis` guarda **las dos** URLs | `url_normalized` = `…/products/pine-tar-bar-soap` · `raw_content->>'urlFinal'` = `https://www.dr-squatch.com/` | `db-url-analysis.txt` | ✅ |
| 2a | **Control negativo · UI** | Una URL que solo redirige http→https **NO** dispara ningún aviso | **No aparece ningún aviso de redirección**. CP1 muestra el producto CORRECTO («Men's Cruiser - Shadow Blue») | `04-neg-cp1-sin-aviso.png` | ✅ |
| 2b | **Control negativo · discriminación** | La ausencia de aviso debe ser CRITERIO, no ceguera | La redirección **sí se observó**: `pedida = http://…` ≠ `final = https://…` (¡difieren!) y aun así **no se emitió `url_redirected`** | `db-url-analysis.txt` | ✅ |
| 2c | Control negativo · warning tipado | `url_redirected` presente en el positivo, ausente en el negativo | Códigos tipados en el output de N3: POSITIVO → `["url_redirected"]` · NEGATIVO → `["hook_too_long"]` (ambiental, no de redirección) | `db-typed-warnings.txt` | ✅ |
| 3 | Consola del navegador | Sin errores JS | Consola **limpia** en ambos runs (solo ruido dev de HMR/Fast Refresh) | `browser-console-*.txt` | ✅ |
| 4 | Contraste WCAG del aviso | ≥4.5:1 texto normal | Texto `rgb(244,244,245)` sobre fondo efectivo compuesto `rgb(34,25,11)` = **15.81:1** | § Contraste | ✅ |

### Por qué el control negativo (2b) es la prueba fuerte

Un implementador que **nunca capturase la URL final** produciría exactamente el mismo «no sale aviso» que se ve en 2a. Lo que separa una cosa de la otra es el dato en BD: aquí la URL final **se capturó y difiere de la pedida** (`http://…` → `https://…`), y aun así el comparador **calló**. Es decir: vio el salto y lo juzgó benigno. Eso es lo que la cláusula pide de verdad («la señal no puede ser ruido») y lo que descarta un falso PASS por ceguera.

Matiz que casi convierte esto en un FAIL falso: el run negativo **sí lleva un warning** (`hook_too_long`). Un check ingenuo del tipo «¿hay algún aviso en CP1?» lo habría suspendido. La cláusula habla del aviso **de redirección**, y ese es el que no está.

Como contraste histórico, en `db-url-analysis.txt` conviven dos filas de dr-squatch **anteriores a T2.7** con `final_servida` **vacía**: es el bug que esta tarea cierra, visible al lado de su arreglo en la misma tabla.

### Qué camino de ingesta sirvió cada run (cierra la cobertura de HALLAZGO 1)

`cost_entry` lo dice sin ambigüedad (`db-cost-por-run.txt`): **los DOS runs pagaron créditos de Firecrawl en N1** (positivo: 3 credits · negativo: 2 credits). Es decir, la URL final de ambos la resolvió **Firecrawl**, no el fast path.

Esto es más fuerte de lo que la cláusula exigía, porque verifica **EN VIVO el HALLAZGO 1** (el campo bueno es `metadata.url`, no `metadata.sourceURL`, que ECHOEA la pedida): si el código siguiera leyendo `sourceURL`, el `urlFinal` del positivo habría salido **igual a la pedida** y el comparador **no habría avisado**. Que el aviso aparezca es prueba directa, contra la API real, de que se está leyendo el campo correcto. No queda apoyado solo en el test unitario que se pone rojo con `sourceURL`.

El camino **Jina** (declarado NO-DETECTOR en la implementación) no entró en ninguno de los dos runs, como era de esperar: solo actúa si Firecrawl falla, y no falló.

### Contraste (aserción obligatoria de UI)

Medido con `getComputedStyle` **componiendo el alpha** sobre el fondo opaco real (el `background` del alert es `rgba(245,158,11,0.1)`: medirlo sin componer da un 1.95 falso — artefacto de medición, no contraste real).

| Elemento | Color texto | Fondo efectivo | Tamaño | Ratio | Umbral | OK |
|---|---|---|---|---|---|---|
| Alert de redirección (`<strong>` + cuerpo) | `rgb(244,244,245)` | `rgb(34,25,11)` | 13px / 600 y 400 | **15.81:1** | 4.5:1 | ✅ |

## Coste real

Leído en la **UI de `/spend`** (no por psql), antes y después:

- Baseline: **$0.70** (Anthropic 122 755 tokens · Firecrawl 6 credits)
- Final: **$1.06** (Anthropic 193 194 tokens · Firecrawl 11 credits)
- **Coste de esta verificación: $0.36** — Anthropic 70 439 tokens ($0.36) + Firecrawl 5 credits ($0.00), en 2 análisis reales completos (N1 ingesta + N2 visión + N3 síntesis, ×2).

**vs estimado $0,20 → desviación +80 %** (>25 %, regla de trabajo 5 ⇒ se anota para recalibrar). Sigue **dentro del cap** (regla 6: cap = máx(estimado×3, $1) = **$1**). La causa es estructural, no un derroche: la Verificación exige **dos** análisis reales de URL (positivo + control negativo) y cada uno paga visión + síntesis de brief completo; el estimado de $0,20 asumía un coste por análisis más barato del que realmente tiene un brief con imágenes. Recalibración sugerida para futuras tareas que exijan 2 análisis reales: **~$0,35–0,40**.

## Rarezas observadas (no bloquean el PASS)

1. **`pipeline_run.status` se queda en `pending`** mientras los `step_run` ya van por `succeeded`/`waiting_approval`. El canvas y los steps son correctos (la UI lee los steps), pero el estado a nivel de run no refleja el avance. No es de T2.7 (afecta también al run previo `01KXGXHE…`) y no toca lo que esta tarea verifica, pero conviene que alguien lo mire: un `/runs` que liste por `pipeline_run.status` mostraría «pending» a runs que están en checkpoint.
2. **El daemon de `agent-browser` se quedó colgado** a mitad de sesión (`Resource temporarily unavailable`). Tras matarlo y relanzarlo, `doctor` daba 9/9 pass y el run seguía intacto en BD. Ruido de tooling, no de la app.
3. El markdown scrapeado de allbirds trae bloques `"this page has been blocked by an extension"` (ruido del scraper). El sintetizador lo detectó y lo ignoró explícitamente (lo dice en `meta.warnings`). Comportamiento correcto; se anota como observación.

## Veredicto

**PASS** — las dos cláusulas se cumplen literalmente contra el sistema real. El positivo (dr-squatch, caso vivo confirmado con `curl` el mismo día) muestra en CP1 el aviso con **la URL pedida y la final**, y `url_analysis` persiste **las dos**; el control negativo (allbirds, `301` real solo de esquema) **no dispara ningún aviso de redirección** — y lo hace **habiendo observado y guardado el salto**, que es lo que prueba que el comparador discrimina en vez de estar ciego. Consola limpia, contraste 15.81:1, coste $0.36 dentro del cap. Extra: `cost_entry` demuestra que **ambos runs se sirvieron por Firecrawl**, con lo que el HALLAZGO 1 (`metadata.url` y no `metadata.sourceURL`) queda verificado **en vivo** y no solo por test unitario.
