# Verificación T1.18 — Una candidata a hero que no se puede descargar no debe ofrecerse

- **Tarea**: T1.18 · Una candidata a hero que no se puede descargar no debe ofrecerse (`planning.md`, fase F1c)
- **Fecha**: 2026-07-13
- **Ejecutor**: verifier (contexto fresco) · agent-browser 0.27.x · sesión `t1.18`
- **Sistema**: commit `67698e9` + diff de T1.18 en staging (13 ficheros) · docker compose dev (`ugc-postgres-dev`) + `pnpm db:migrate` + `pnpm seed` + `pnpm dev` (web :3000 + worker) · `/api/health` → `{"ok":true,"db":true}`
- **Gate previo**: `pnpm gate` **VERDE** re-ejecutado por mí (lint 0 errores, typecheck OK, format OK, knip OK, **1243 tests / 116 files**).

## Verificación esperada (literal de planning.md)

> análisis por URL REAL de `https://es.stayforlong.com` (el mismo caso) → en CP1 **ninguna candidata ofrecida tiene la miniatura rota**, y la imagen que da 403 no es promovible; promover la que sí sirve sigue completando el run. Evidencia con el `curl` del 403 y la captura de la galería.

## El invariante que se verifica (el corazón de la tarea)

> botón promovible ⟺ el **SERVIDOR (el proxy)** puede bajar la imagen de verdad
> — más: ninguna miniatura rota, y el hero PERSISTIDO es la URL del CDN, nunca el proxy.

El oráculo de promovibilidad **es el proxy**, no el `curl` a stayforlong: la UI decide con la respuesta de `/api/thumbnails`. El `curl` a stayforlong es la evidencia que la Verificación NOMBRA (por qué el navegador falla), no el oráculo.

## LA DERIVA DEL SITIO — lo que encontré y cómo lo resolví (leer esto antes que la tabla)

El caso original de T1.15 **ya no se reproduce solo**: hoy (2026-07-13) el sitio devuelve otras imágenes y otros códigos. Los hechos, medidos por mí (`curl-candidatas.txt`, `curl-preview-403.txt`):

| URL | cabeceras del WORKER/PROXY (`accept: image/*`, SIN user-agent) | cabeceras de NAVEGADOR (Chrome UA) |
|---|---|---|
| `es.stayforlong.com/_next/image?url=…&w=1080&q=75` (la candidata del caso T1.15) | **202** `text/html`, 0 bytes, cabecera **`x-amzn-waf-action: challenge`** → NO es una imagen | **403** |
| `static.stayforlong.com/web/images/home_v2-about-us/about-us.webp` (candidata REAL de mi run) | **200** `image/webp` | **200** |
| `static.stayforlong.com/web/images/modal/sfl-revolut-pay.jpg` (candidata REAL de mi run) | **200** `image/jpeg` | **200** |

Es decir: **ninguna de las dos candidatas que N3 emitió en MI run es la del 403** — Sonnet emitió esta vez las URLs directas de `static.` (las dos sirven a todo el mundo). Ni la rama (A) ni la rama (B) que anticipaba el implementer: el sujeto de la cláusula «la imagen que da 403» simplemente **no apareció en el run**.

**No rebajo la Verificación ni la doy por buena con el spec de Playwright** (la Verificación pide observarlo en CP1, con captura). Como los inputs de prueba los elige el verifier, **inyecté como PREP DE ESCENARIO** (edición de filas persistidas — dato, no código de producto/tests/planning) la **URL exacta del caso T1.15** como 3ª candidata, en los dos sitios que la gobiernan:
- `product_brief.data.assets.images[]` → es la **allowlist** del proxy;
- `step_run.output_refs.brief.assets.images[]` → es **lo que la galería de CP1 renderiza**.

Antes de fiarme de la UI, confirmé el veredicto del ORÁCULO sobre esa URL: `/api/thumbnails` → **502 `provider_error` "la imagen no se pudo descargar"** (`proxy-oracle-candidata-inservible.txt`). O sea: el servidor TAMPOCO puede bajarla (el WAF le da un 202-challenge sin imagen). Es exactamente la rama estricta que la tarea debe cubrir. Tras observarla, **restauré el brief a su estado prístino** para que el v2 aprobado no llevara mi dato de prueba.

## Pasos ejecutados

1. `pnpm gate` → verde (1243 tests). Maté `next dev` antes; `rm -rf apps/web/.next`.
2. Levanté el sistema (compose + migrate + seed + `pnpm dev`) y verifiqué `/api/health`.
3. Login por la UI y **análisis por URL REAL** de `https://es.stayforlong.com` desde `/analyses/new` → run `01KXE8A8956H55KBVQSVFK2RQR`; N1, N2 `succeeded`, N3 **`waiting_approval`** (CP1) con `needs_user_decision / missing_hero_image`. Brief v1 `01KXE8D7YF49P6T71A6CH2KNQA`, 2 candidatas, `hero_image_url: null`.
4. **Curls autoritativos** con las URLs de MI run, con las cabeceras del worker y con UA de navegador (tabla de arriba).
5. **El proxy como oráculo** contra el sistema levantado, para cada candidata + los casos de seguridad (`proxy-oracle-y-seguridad.txt`).
6. **CP1 prístino en el navegador**: las 2 candidatas cargan por el proxy (`blob:` + `naturalWidth=512` ⇒ píxeles reales), `data-usable=true`, botones habilitados. Captura `01`. Consola sin errores.
7. **Inyección de la candidata inservible** (prep de escenario) → recarga de CP1 → observación en vivo (tabla de abajo). Capturas `02` (dark) y `03` (light). Contraste WCAG medido en los dos temas.
8. **Restauración del brief a prístino** → promoción **con el ratón** de la candidata usable → **aprobar** → comprobación en BD de los dos canales.
9. `persona-detail` (el otro consumidor migrado a la primitiva) → **aquí aparece el fallo** (§ Hallazgo bloqueante).

## Resultado observado vs esperado

| # | Esperado (cláusula de la Verificación) | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Análisis por URL **REAL** de `es.stayforlong.com` llega a CP1 | run `01KXE8A8956H55KBVQSVFK2RQR`, N3 `waiting_approval`, 2 candidatas, hero `null` | `brief-candidates.json` | ✅ |
| 2 | **Ninguna candidata ofrecida tiene la miniatura rota** | Las 3 candidatas (2 reales + la inyectada) o pintan la imagen del proxy (`status=loaded`, `naturalWidth=512`) o pintan el estado de error del DS («⚠ no disponible» sobre trama). En la inservible **el `<img>` ni existe** (`imgTagRendered:false`) ⇒ el icono roto del navegador es estructuralmente imposible | `01`,`02`,`03` `.png`, `cp1-pristine-dom.json` | ✅ |
| 3 | **La imagen que da 403 NO es promovible** | Inyectada la URL del caso T1.15 (403 al navegador / 202-WAF al servidor): proxy → **502**; en CP1 → `data-usable=false`, `status=error`, placeholder **«⚠ no disponible»**, botón **`disabled`**, `aria-label` = «No se puede usar (el servidor no puede descargarla): …» | `proxy-oracle-candidata-inservible.txt`, `02`,`03` `.png` | ✅ |
| 4 | **Promover la que sí sirve sigue completando el run** | Click humano en «Usar como principal» de `about-us.webp` → `aria-pressed=true`, se habilita «Aprobar y continuar» → aprobar → **N3 `succeeded`** (el checkpoint se cierra: brief v2 `approved` + decisión persistida; el `pipeline_run` queda en `pending` porque los nodos de F2+ aún no existen — el mismo techo de fase que T1.15) | `04`,`05` `.png` | ✅ |
| 5 | El invariante: promovible ⟺ el proxy la baja | 2 candidatas con proxy **200** → botón habilitado; 1 con proxy **502** → botón deshabilitado. **Cero** casos de «no descargable pero promovible» | `proxy-oracle-*.txt` | ✅ |
| 6 | **El hero PERSISTIDO es la URL del CDN, NO el proxy** | `product_brief` **v2** `approved`, `edited_by_user=t`, `hero_image_url = https://static.stayforlong.com/web/images/home_v2-about-us/about-us.webp` · `apunta_al_PROXY = f` · `es_url_del_CDN = t` | `db-hero-persistido.txt` | ✅ |
| 7 | Decisión en `checkpoint_decision` (canal de T1.11), como en T1.15 | fila sobre el step de CP1: `{"kind":"brief","images":"promote_scraped","hero_image_url":"…/about-us.webp"}`; **los dos canales coinciden** (`t`) | `db-hero-persistido.txt` | ✅ |
| 8 | Seguridad del proxy contra el sistema levantado | URL que **no** está en el brief → **404**; `http://169.254.169.254/latest/meta-data/` (SSRF) → **404**; **sin sesión → 401**; brief inexistente → 404 | `proxy-oracle-y-seguridad.txt` | ✅ |
| 9 | Contraste WCAG (obligatorio, cua.md §3), light **y** dark | «⚠ no disponible»: **6,32:1** (light) / **4,89:1** (dark) — ambos ≥ 4,5. Botón habilitado: 15,30 / 14,58. (El botón deshabilitado, 2,21/2,07, está **exento** de la SC 1.4.3 y su motivo va en el nombre accesible) | `contrast-wcag.md` | ✅ |
| 10 | Consola del navegador limpia | Sin errores ni warnings propios (solo Fast Refresh/HMR de dev) | `browser-console-*.txt` | ✅ |
| 11 | **`persona-detail` sigue funcionando** (migrado a la primitiva) | ❌ **NO**: las imágenes de referencia quedan **permanentemente invisibles** tras el placeholder «referencia» | `06-persona-detail-primitiva-migrada.png` | ❌ |

## 🔴 Hallazgo BLOQUEANTE — la primitiva `Image` deja la imagen invisible si carga antes de que React enganche el `onLoad`

**Qué se ve** (`/personas`, persona «Lucía», 2 imágenes de referencia): las miniaturas **nunca aparecen**. Se queda para siempre la trama diagonal con la etiqueta «referencia».

**Qué mide el DOM** — el diagnóstico es inequívoco:

```json
[{ "status": "loading", "imgComplete": true, "naturalW": 1638, "opacity": "0", "placeholderVisible": true },
 { "status": "loading", "imgComplete": true, "naturalW": 1638, "opacity": "0", "placeholderVisible": true }]
```

- `img.complete = true` y `naturalWidth = 1638` ⇒ **la imagen SÍ se descargó y decodificó bien**.
- pero `data-status` sigue en **`loading`** ⇒ la máquina de estados de la primitiva nunca avanzó,
- y como `status !== 'loaded'`, la primitiva mantiene `opacity-0` sobre el `<img>` y **pinta el placeholder por encima**: el usuario no ve nunca la imagen que sí está cargada.

**Causa raíz** (`apps/web/src/components/ui/image.tsx`): el estado solo sale de `loading` por el handler `onLoad` del `<img>`. Si la imagen **ya está completa antes de que React adjunte el handler** (asset cacheado, hidratación, vuelta a la página), **`onLoad` no vuelve a dispararse nunca** y el componente se queda en `loading` de forma permanente. La primitiva no reconcilia con `img.complete` (no hay `ref` que compruebe el estado real del elemento tras montar).

**Reproducible en PRODUCCIÓN, no es un artefacto de dev** (el discriminador de `cua.md` §110). Comprobado a propósito, porque el StrictMode de dev hace un doble montaje que PODRÍA haber fabricado el fallo él solo:

- `next dev`: hard reload y navegación con caché caliente → falla las dos veces (descarta HMR/Fast-Refresh).
- **`pnpm --filter @ugc/web build && next start` (build de PRODUCCIÓN, sin StrictMode ni HMR)** → **falla IGUAL**: `{"status":"loading","imgComplete":true,"naturalW":1638,"opacity":"0","placeholder":"referencia"}` (`prod-build-persona-detail.txt`, captura `07-persona-detail-PROD-BUILD.png`).

Es decir: **esto es lo que ve el usuario real**, no un ruido del entorno de desarrollo.

**Por qué CP1 se libra**: allí el `src` es un `blob:` que `useThumbnailProbe` crea **después** del montaje, así que el `onLoad` siempre llega a tiempo. `persona-detail` usa una URL normal (`/api/assets/…`) que el navegador sirve de caché ⇒ cae de lleno en el agujero.

**Es una regresión de ESTA tarea**: `git show HEAD:apps/web/src/components/personas/persona-detail.tsx` enseña un `<img>` crudo — que se veía siempre, con caché o sin ella. T1.18 lo sustituyó por esta primitiva, que lo esconde. La tarea pedía explícitamente que «los dos consumidores actuales se migran a ella»: **uno de los dos ha quedado roto**, y es justo el que la propia tarea listaba como punto a observar («`persona-detail` sigue funcionando»).

**Qué debe arreglar el implementer**:
1. Que la primitiva **reconcilie el estado real del elemento tras montar**: un `ref` callback que compruebe `img.complete` en el commit → `if (img.complete && img.naturalWidth > 0) setStatus('loaded')`, y `complete && naturalWidth === 0` → `setStatus('error')`. Solo con `onLoad`/`onError` no basta: esos eventos **ya han pasado** para una imagen cacheada.
2. **Tests de la primitiva**: hoy `apps/web/src/components/ui/` contiene **solo `image.tsx`, sin ningún `image.test.tsx`** — la primitiva del DS que esta tarea introduce no tiene NI UN test propio. Ese hueco es la razón de que las 1243 pruebas verdes no vieran nada: los tests y los E2E cargan siempre imágenes frescas (post-montaje), nunca desde caché. Debe cubrirse al menos: imagen ya `complete` al montar → acaba en `loaded` (no en `loading`); `complete` con `naturalWidth === 0` → `error`; cambio de `src` → reinicia la máquina.

## Coste real

**$0,18** — anthropic 18¢ (N2 Haiku + N3 Sonnet), firecrawl $0 (dentro de su tier). Un solo run real (`01KXE8A8956H55KBVQSVFK2RQR`).
- vs estimado ~$0,20 → dentro (−10 %). Cap de la tarea: $1. Sin desvío que recalibrar.
- Contrastado con el header de coste de la propia UI del run: «$0.18 · Coste real» (visible en `01`/`02`/`03`).

## Veredicto

**FAIL** — Las cláusulas de la Verificación se cumplen todas (ninguna miniatura rota; la imagen que el servidor no puede bajar **no es promovible**, con «⚠ no disponible» y el motivo en el nombre accesible; promover la que sí sirve completa el run; el hero persistido es la URL del CDN y no el proxy; el proxy es sólido en seguridad) — **pero la primitiva `Image` que esta misma tarea introduce ROMPE al otro consumidor que la tarea obliga a migrar**: en `persona-detail` las imágenes de referencia quedan permanentemente ocultas tras el placeholder, porque el `onLoad` no llega cuando la imagen ya estaba cacheada. No es una rareza cosmética: es una imagen que existe, se descarga y el usuario **no ve nunca** — en la pantalla del identity lock, donde la imagen ES el contenido.

**Notas / rarezas (aunque no bloqueen)**:
- **La deriva del sitio** hace que la Verificación, tal cual está escrita, **ya no tenga sujeto**: hoy `es.stayforlong.com` no ofrece la candidata del 403 en el brief (N3 emite las URLs directas de `static.`, que sirven 200 a todo el mundo). La cláusula se verificó inyectando esa URL exacta como prep de escenario (ver § arriba). Si la familia F1c quiere un caso permanente, el sitio real no es un oráculo estable: **eso ya lo cubre el spec de Playwright de la tarea**, y conviene anotar en el planning que la Verificación de T1.18 se ejecutó con inyección deliberada, no por gracia del sitio.
- **La URL del caso T1.15 hoy da 202 (`x-amzn-waf-action: challenge`), no 403**, al fetch del servidor. El proxy la trata bien igualmente (`res.ok` es true para 202, pero el cuerpo vacío/HTML no lo decodifica sharp → `provider_error` 502 → no promovible). El resultado es el correcto, pero llega por la vía del *decode*, no por la del *status*: si algún día el WAF devolviera un 200 con una página HTML de challenge, el camino sería el mismo (sharp la rechaza), así que la defensa aguanta. Vale la pena saberlo.
- El botón «Aprobar y continuar» está correctamente deshabilitado hasta resolver la petición de imagen.

---

# RONDA 2 (re-verificación tras el fix) — 2026-07-13

- **Ejecutor**: verifier (contexto fresco) · agent-browser · sesión `t1.18r2`
- **Sistema**: **BUILD DE PRODUCCIÓN** (`pnpm --filter @ugc/web build` + `next start`, sin StrictMode ni HMR) — *deliberadamente el mismo entorno donde la ronda 1 demostró el fallo; un PASS en `next dev` no habría valido nada aquí* · `/api/health` → `{"ok":true,"db":true}`
- **Gate**: `pnpm gate` **VERDE** re-ejecutado por mí: **1249 tests** (los 1243 de la ronda 1 + los **6 nuevos** de la primitiva).
- **Alcance** (lo acordado con el coordinador): SOLO lo que el fix podía tocar — `persona-detail` (el punto que falló) y la **otra mitad de CP1** (el centinela pasa por la misma línea del fix). El resto (proxy, seguridad, hero persistido) no se ha tocado y se conserva de la ronda 1.
- **Coste ronda 2: $0** — NO se relanzó ningún análisis. Se reusó el run de la ronda 1 (`01KXE8A8956H55KBVQSVFK2RQR`) devolviendo su N3 a `waiting_approval` (dato, no código) para que CP1 volviera a pintar; restaurado a `succeeded` al terminar. Totales de `cost_entry` idénticos a los de la ronda 1 (anthropic 81¢ / firecrawl 5 llamadas).

## El fix, y por qué es el correcto

`sync(img)` reconcilia contra el DOM real en el `ref` callback, en vez de fiarse del evento:
`if (!img.complete) return; setStatus(img.naturalWidth > 0 ? 'loaded' : 'error');` + `key={src}` (nodo nuevo por imagen ⇒ el ref vuelve a correr) + `onLoad` delegando en la misma función. Es exactamente la reconciliación que la ronda 1 prescribió, y **una sola línea sostiene las dos mitades de la tarea**: `naturalWidth > 0` ⇒ la cacheada se ve; `naturalWidth === 0` ⇒ el centinela de CP1 (`data:image/gif;base64,no-es-una-imagen`, un `src` ya resuelto y sin píxeles) sigue dando `error`.

## Resultado observado vs esperado (ronda 2)

| # | Esperado | Observado (PROD BUILD) | Evidencia | OK |
|---|---|---|---|---|
| 1 | **`persona-detail`: las imágenes de referencia SE VEN** (el fallo de la ronda 1) | `{"status":"loaded","imgComplete":true,"naturalW":1638,"opacityComputada":"1","placeholderVisible":false}` en las 2 referencias. La ronda 1 daba `status:"loading"`, `opacity:"0"`, placeholder «referencia» encima **para siempre** | `r2-prod-persona-detail.txt`, `08-r2-persona-detail-PROD-ARREGLADO.png` | ✅ |
| 2 | **CP1: la candidata inservible sigue NO siendo promovible** (regresión cruzada, el riesgo evidente) | Reinyectada la URL del caso T1.15 → `data-usable=false`, `status=error`, placeholder **«⚠ no disponible»**, **sin `<img>` en el DOM**, botón **`disabled`**, `aria-label` = «No se puede usar (el servidor no puede descargarla): …» | `r2-prod-cp1-galeria.txt`, `09-r2-cp1-inservible-sigue-no-promovible-PROD.png` | ✅ |
| 3 | CP1: las candidatas usables siguen viéndose y siendo promovibles | Las 2 → `status=loaded`, `naturalWidth=512`, **opacidad computada `1`**, botón habilitado. Promover una → `data-selected=true` y «Aprobar y continuar» **se habilita** | `r2-prod-cp1-galeria.txt`, `09-…png` | ✅ |
| 4 | Sin errores de consola | `agent-browser errors` → vacío | — | ✅ |

## La comprobación que el coordinador pidió validar: ¿es cierto lo del `no-store`?

**Sí, es cierto, y por tanto el razonamiento del implementer es correcto.** `apps/web/src/app/api/assets/[id]/download/route.ts:52` manda literalmente `'Cache-Control': 'private, no-store'` ⇒ el navegador **nunca** cachea la imagen de referencia de una persona ⇒ el evento `onLoad` **siempre** llega ⇒ ese bloque del e2e **no puede** reproducir el bug de la imagen cacheada. Documentarlo en el spec (con la prueba) en vez de dejar un test que finge cubrirlo es la decisión honesta: **el guardián real del bug es el unit** (`image.test.tsx`), y lo que el e2e sí aporta —que en un navegador real la imagen acabe **visible de verdad**, `data-status="loaded"` y opacidad computada `1`— es justo lo que el bug rompía (dejaba un `0` clavado). Correcto.

**Pero eso deja una pregunta abierta que NO me quise creer de palabra**: si `persona-detail` nunca cachea, entonces mi punto 1 (arriba) tampoco prueba, por sí solo, el camino de la imagen **realmente cacheada** en un navegador. Así que lo probé aparte, en el navegador real y contra el build de producción, usando el endpoint que **sí** es cacheable (`/api/thumbnails`, `private, max-age=300`): se precarga una URL, se monta un `<img>` NUEVO con esa misma URL y se leen sus bits **en el instante del montaje**:

```json
{"completeAlMontar": true, "naturalWAlMontar": 512,
 "elEventoNoLlegaria": true, "loQueElFixDecide": "loaded"}
```

`complete === true` ya en el montaje ⇒ **`onLoad` no se dispararía nunca** (el agujero exacto de la ronda 1), y la regla del fix lee esos bits y resuelve **`loaded`**. El mecanismo queda demostrado en un navegador real, no solo en jsdom. (`r2-prueba-cache-navegador-real.txt`)

## Coste real (ronda 2)

**$0** — sin llamadas a APIs de pago. El run reutilizado ya había costado sus **$0,18** en la ronda 1 (anthropic 18¢; firecrawl $0). Total de la tarea T1.18: **$0,18** vs estimado ~$0,20, cap $1.

## Veredicto (ronda 2)

**PASS** — El fallo bloqueante de la ronda 1 está **corregido y comprobado en el mismo entorno donde se demostró** (build de producción): las imágenes de referencia de `persona-detail` se ven de verdad (`loaded`, opacidad `1`, sin placeholder encima). **No hay regresión cruzada**: la candidata que el servidor no puede bajar sigue mostrando «⚠ no disponible» y sigue **sin ser promovible** (botón deshabilitado, motivo en el nombre accesible), y las usables siguen viéndose y promoviéndose. La causa raíz se ataca donde vivía —leyendo los bits del DOM en vez de esperar un evento que no llega—, la primitiva ya tiene **6 tests propios** que cubren el estado en el que el bug vivía, y la afirmación del implementer sobre el `no-store` del e2e es **verificablemente cierta** (`download/route.ts:52`), por lo que el spec no miente sobre su alcance.

Con esto, **todas las cláusulas de la Verificación de T1.18 quedan cumplidas** (ronda 1: ninguna miniatura rota, la que da 403 no es promovible, promover la que sirve completa el run, hero persistido = URL del CDN, proxy seguro, contraste AA; ronda 2: el consumidor migrado que la tarea obligaba a arreglar funciona).

**Rarezas que sobreviven (no bloquean, ya anotadas en la ronda 1)**: la deriva del sitio hace que hoy `es.stayforlong.com` no ofrezca por sí solo la candidata del 403 (se inyecta como prep de escenario, y se restaura); y esa URL responde hoy `202` con `x-amzn-waf-action: challenge` en vez de `403` al servidor — el proxy la rechaza igual (sin píxeles no hay hero), y ahora además el log del decode fallido lleva `upstream_status`/`upstream_content_type`, así que el caso ya es diagnosticable en vez de confundirse con bytes corruptos.
