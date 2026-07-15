# Verificación — Hotfix «Reintentar» corrompía la config de nodos reales

- **Fecha:** 2026-07-15
- **Commit:** `5467bb3` (rama `bug-fix`)
- **Handoff origen:** `docs/handoffs/2026-07-15-n3-retry-config-corruption.md`
- **Veredicto:** **PASS**

## Qué se verificó

El bug: el botón «Reintentar» del canvas enviaba SIEMPRE `{ failRate: 0 }` (parámetro
exclusivo de los executors de demo) y `retryStep` REEMPLAZABA el config entero → un N3
real con `{ targetLanguage: "es" }` pasaba a `{ failRate: 0 }` y moría inmediato en su
`safeParse` («N3: config inválida … targetLanguage … expected string, received undefined»).

## 1) Gate local completo — verde

`pnpm gate`: typecheck ✓ · format ✓ · knip ✓ · readme ✓ · **1499 tests** (unit+integration) ✓.
`pnpm test:e2e` `runs-canvas.spec.ts` «reintentar con éxito» ✓ (el nodo de DEMO N4 SÍ sigue
recibiendo `failRate:0` y completa — la condicional de la capa 1 preserva la ruta de demo).

Tests nuevos en `apps/web/test/integration/api/retry.test.ts` que reproducen el escenario de
prod al nivel de la API: config `{targetLanguage:'es'}` + patch `{failRate:0}` →
`{targetLanguage:'es',failRate:0}` (merge, la clave obligatoria SOBREVIVE).

## 2) Flujo end-to-end REAL con la URL de AliExpress — verde

URL: `https://es.aliexpress.com/item/1005012268239172.html?...` (la del goal).
Stack local real: Postgres (docker) + web + worker con keys reales de Firecrawl/Anthropic/fal
sembradas cifradas en `app_setting`. Run `01KXK6KQAPWKFTYKH9D2T05W92`.

| Nodo | Resultado |
|---|---|
| N1 (Firecrawl ingesta) | **succeeded** — Firecrawl SÍ scrapeó AliExpress (donde un WebFetch simple solo obtenía footer) |
| N2 (visión, Haiku) | **succeeded** |
| N3 (síntesis, Sonnet 5) | **waiting_approval** — produjo el ProductBrief en `es` y pausó en CP1. El «1er error» del handoff (refusal por contenido pobre) NO ocurrió |

Ledger real: `anthropic` 14¢ (2 llamadas: N2+N3) · `firecrawl` 1 llamada. Prueba de que el
pipeline real corrió (concuerda con la nota de prod del handoff: debe existir un `cost_entry`
de anthropic para ese N3). El config de N3 en BD: `{"targetLanguage": "es"}` — intacto.

Evidencia: `canvas-aliexpress.png` (N1/N2 completados, N3·CP1 con el brief).

## 3) El bug NO se reproduce — retry real de un nodo N3 fallido — verde

Reproducción del escenario exacto de prod, verificada por DOS caminos:

**(3a) Vía el BOTÓN «Reintentar» del canvas (la acción exacta que el usuario reportó).**
1. Se forzó N3 a `failed` conservando su config `{targetLanguage:"es"}` (simulando el fallo original).
2. Se abrió el panel de N3 y se pulsó **«Reintentar»** en la UI real (agent-browser: `focus`+`click`).
   Log web: `POST /api/steps/<N3>/retry 200` + `"step reintentado manualmente"`. Consola del
   navegador limpia (sin errores JS, sin «Error inesperado»).
3. Resultado: N3 se reencoló, **re-sintetizó el brief** y quedó
   `status=waiting_approval | retry=0 | config={"targetLanguage":"es"} | err=NULL`.

   Nota de método: un primer intento de clic con agent-browser no registró el POST (ref `@eN`
   quedó stale tras abrir el panel); tras re-snapshot fresco + `focus`+`click`, el botón disparó
   correctamente. NO es un bug del producto (Playwright clica ese mismo botón sin problema en el
   E2E de demo) — era un artefacto del driver. Confirmado que el onClick del botón funciona.

**(3b) Vía el endpoint directo (contrato backend de la capa 1 para nodos reales).**
`POST /api/steps/<N3>/retry` **sin body** — exactamente lo que el fix envía para nodos reales
(`step.nodeKey.startsWith('demo.')` falso ⇒ patch `undefined`) → `200 {"ok":true}`, mismo
resultado: config `{targetLanguage:"es"}` intacto, N3 recupera.

Con el código viejo ese mismo retry desde el botón habría dejado `config={"failRate":0}` y N3
habría muerto en el `safeParse`. **Cero** ocurrencias de «config inválida» / «invalid_type» /
«targetLanguage undefined» / «failRate» en los logs tras el retry.

Evidencia: `canvas-n3-recovered.png` (N3 recuperado tras el retry).

## Fuera de alcance (confirmado con el usuario, 2026-07-15)

El «1er error» del handoff (N3 rehúsa sintetizar ante contenido pobre) es un issue de producto
SEPARADO, por diseño, no el bug. Decisión del usuario: «aparte, no ahora». En esta URL no se dio
porque Firecrawl scrapeó contenido suficiente.
