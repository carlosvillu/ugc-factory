# Verificación T1.10a — N1–N3 como nodos reales del DAG

- **Tarea**: T1.10a · N1–N3 como nodos reales del DAG (`planning.md`, fase F1)
- **Fecha**: 2026-07-12
- **Ejecutor**: verifier (contexto fresco) · agent-browser 0.27.x · sesión `t1.10a`
- **Sistema**: commit base `91b01e7` + working tree con el diff de T1.10a · docker compose dev (Postgres 16, `ugc-postgres-dev`, healthy) + `pnpm db:migrate` + web (`PORT=3001`) + worker, ambos con `pnpm dev`
- **APIs REALES** (no fakes): ver § "Prueba de que se usaron las APIs reales"

## Verificación esperada (literal de planning.md)

> **Verificación**: pegar una URL real en el intake → los nodos N1→N2→N3 progresan en el canvas en vivo y el brief JSON aparece como output del nodo N3 en el panel genérico; con texto libre sin imágenes, N2 aparece `skipped` en el grafo.

## Gate previo

- `pnpm gate` **VERDE** (exit 0): lint + typecheck + format:check + knip + **884 tests / 88 ficheros**.
- `/api/health` en 3001 → `{"ok":true,"db":true}`; worker `worker ready` con sweeper y colas arrancadas.

## Prueba de que se usaron las APIs reales (no el fake)

Es el vector nº1 de falso PASS en esta tarea (los tests corren contra fakes). Triangulado por tres vías independientes:

1. **Sin overrides de base URL**: ni el `.env` raíz ni el entorno del proceso worker (pid 4586) definen `FIRECRAWL_BASE_URL`, `JINA_BASE_URL` ni `ANTHROPIC_BASE_URL` → los clientes apuntan a las APIs reales (`boss.ts` los lee de `process.env`). Evidencia: `worker-env-real-apis.txt`.
2. **Claves reales configuradas en `/settings`** (cifradas en BD, T0.14): Anthropic `••••••••pQAA`, Firecrawl `••••••••355c`, fal `••••••••5566`. Evidencia: `00-settings-keys-reales.png`.
3. **El contenido del brief es del producto real scrapeado**, no de un fixture: "Analog Daily Focus Kit (Walnut)", $69 USD, imágenes reales de `ugmonk.com/cdn/shop/...` y `cdn.stamped.io`. Los fixtures de la suite emiten un sérum de `glow.example`. Evidencia: `07-n3-brief-completo.json`.

## Pasos ejecutados

### Escenario 1 — URL real (`https://ugmonk.com/products/analog-starter-kit`)

1. Login en `/login` → `/`.
2. `/analyses/new`: la pestaña **«Desde URL» viene seleccionada por defecto** (`aria-selected=true`), sin clicarla. → `01-intake-tab-url-por-defecto.png`
3. Pegar la URL real + idioma «Español» → clic en **Analizar** → navega a `/runs/01KX9R00EJTDP70D2HW3NSH38D`.
4. **Progresión EN VIVO, sin un solo reload** (poll del DOM del canvas sobre la MISMA página, SSE abierto):
   - `t+8s`: `N1 en curso 2.2s` · `N2 esperando deps` · `N3 esperando deps`
   - `t+157s`: `N1 completado` · `N2 completado` · `N3 completado`
   Evidencia: `02-canvas-live-poll.txt`, `03-canvas-n1-n2-n3-completados.png` (canvas al 100 %, 3/3 pasos).
5. Clic en el nodo **N3** → el panel genérico (Inspector) muestra el **OUTPUT** con el brief JSON: `{"brief":{"meta":{"language":"es","platform":"shopify",...`. → `06-panel-n3-brief-json.png`

### Escenario 2 — Texto libre SIN imágenes

6. `/analyses/new` → pestaña **«Texto libre»**; el campo de imágenes queda en «Ningún archivo seleccionado» (cero imágenes: la condición que hace N2 inaplicable).
7. Descripción corta de un cuaderno A5 → **Analizar** → `/runs/01KX9R841T9076FGE2YMXQ9T79`.
8. En vivo: `N1 completado` · **`N2 saltado`** (`{"reason":"no_analyzable_visuals"...`) · `N3 en curso` → `N3 completado` a los ~48 s. Evidencia: `09-escenario2-live-poll.txt`, `10-escenario2-n2-skipped.png`.
9. Clic en **N2** → panel: estado **«saltado»**, OUTPUT `{"reason":"no_analyzable_visuals","skipped":true}`. → `11-escenario2-panel-n2-motivo.png`

## Resultado observado vs esperado

| # | Esperado (literal) | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Pegar una URL **real** en el intake | `https://ugmonk.com/products/analog-starter-kit` scrapeada de verdad (Firecrawl real, 4 créditos) | `05-coste-real.txt` | ✅ |
| 2 | Los nodos **N1→N2→N3 progresan en el canvas EN VIVO** | Capturado `N1 en curso` con N2/N3 `esperando deps`, y después los tres `completado`, **sin reload** (SSE) | `02-canvas-live-poll.txt`, `03-…png` | ✅ |
| 3 | **El brief JSON aparece como output del nodo N3 en el panel genérico** | Inspector · N3 → sección OUTPUT con `{"brief":{"meta":…` | `06-panel-n3-brief-json.png` | ✅ |
| 4 | Con **texto libre sin imágenes**, **N2 aparece `skipped` en el grafo** | Nodo N2 en gris, etiqueta **«saltado»**; en BD `status = skipped` (NO `succeeded`+flag) | `10-…png`, `12-escenario2-bd.txt` | ✅ |

### Comprobaciones independientes (pedidas en el brief del verifier)

| # | Comprobación | Observado | OK |
|---|---|---|---|
| a | El brief de N3 es un **ProductBrief real y completo** | 11 secciones (`meta, brand, angles, assets, pricing, product, audience, objections, benefits, pain_points, social_proof`). **5 ángulos** con `hook_examples` (3 c/u), CTA, framework y `awareness_level`; **5 benefits**; **3 pain_points**; **3 segmentos** de audiencia; `pricing` = 69 USD + envío + garantía; `assets.images` = 5 URLs CDN reales clasificadas (`kind`, `background`, `video_suitability`). No es un objeto vacío ni un error disfrazado. | ✅ |
| b | **Fila de `cost_entry` por cada llamada de pago** (record-first) | 4 filas nuevas: firecrawl ×1 (4 créditos), anthropic ×3 (N2 del esc.1 + N3 del esc.1 + N3 del esc.2). Coincide exactamente con las llamadas pagadas realizadas (N2 del esc. 2 NO llamó → correctamente NO registró coste). | ✅ |
| c | En el esc. 2, **N2 realmente `skipped`** y **N3 avanzó igualmente** | `step_run.status = 'skipped'` para N2; N3 `succeeded`. Un nodo saltado satisface la dependencia. | ✅ |
| d | El `output_refs` de N2 saltado lleva el **motivo** | `{"reason": "no_analyzable_visuals", "skipped": true}` — visible en el panel, no solo en BD. | ✅ |

### Consola del navegador

`08-browser-console.txt`: **0 errores, 0 warnings** en el flujo completo.

## Latencia REAL (dato crítico para T1.10b)

Fuente: `step_run.started_at/finished_at` (Postgres), no el ojo. Evidencia: `04-tiempos-y-estados.txt`.

### Escenario 1 (URL real, el camino que mide T1.10b)

| Nodo | Estado | Duración |
|---|---|---|
| N1 (ingesta Firecrawl) | succeeded | **20,0 s** |
| **N2 (visión Haiku)** | succeeded | **32,3 s** |
| N3 (síntesis Sonnet 5) | succeeded | **64,4 s** |
| **PIPELINE COMPLETO N1→N3** | | **116,7 s** |

Escenario 2 (texto libre): N1 16 ms · N2 7 ms (skip) · N3 42,9 s → **pipeline 43,4 s**.

### Consecuencia directa para T1.10b (hallazgo, no bloquea T1.10a)

**La Verificación de fase de T1.10b exige el pipeline completo en <90 s. Medido HOY: 116,7 s — la incumple por 27 s (+30 %).**

Matiz importante sobre la hipótesis de partida: **el sospechoso no era el culpable principal**. La descarga en serie de imágenes de `prepareProductImages` (hasta 8 × 15 s de timeout) es real, pero con ugmonk N2 costó 32,3 s — molesto, no catastrófico. **El nodo dominante es N3 (64,4 s, el 55 % del total)**: la síntesis de Sonnet 5 escribiendo ~7k tokens de salida. Optimizar solo N2 (p. ej. paralelizando las descargas) recortaría como mucho ~20 s y dejaría el pipeline en ~95 s — **seguiría sin bajar de 90 s**. Con las descargas de N2 en paralelo *y* algún recorte en N3 sí entraría. Decisión de alcance para el usuario.

## Coste real

Delta medido en `cost_entry` contra el baseline (174 cts / 26 filas → 201 cts / 30 filas):

| Proveedor | Llamadas | Unidades | Coste |
|---|---|---|---|
| Firecrawl (N1, esc. 1) | 1 | 4 créditos | **$0,00** (0 cts; el crédito no llega a céntimo) |
| Anthropic (N2 Haiku, esc. 1) | 1 | 5.903 tok | **$0,01** |
| Anthropic (N3 Sonnet 5, esc. 1) | 1 | 32.045 tok | **$0,19** |
| Anthropic (N3 Sonnet 5, esc. 2) | 1 | 19.697 tok | **$0,07** |
| **TOTAL VERIFICACIÓN** | **4** | | **$0,27** |

- **vs estimado**: la tarea estimaba **~$0,25** para el escenario de URL; el pipeline de URL costó **$0,20** (por debajo). El total de $0,27 incluye ADEMÁS el segundo escenario (texto libre, $0,07), que la estimación no contaba por separado. Dentro del **CAP DURO de $0,75** con holgura.
- Contrastado en la UI: `/spend` muestra el ledger acumulado ($2,01 del mes) incluyendo estas llamadas. → `13-spend-coste-real.png`

## Rarezas y deudas observadas (ninguna bloquea la Verificación literal)

1. **El KPI «Coste real» del canvas muestra $0,00 con 20 cts realmente gastados.** Causa raíz confirmada: `run-shell.tsx:49` suma `step.costActual`, pero (a) nadie escribe `step_run.cost_actual`, y (b) **las 4 filas de `cost_entry` se insertan con `step_run_id = NULL`** (llevan `project_id`, pero no el step). Los servicios de `@ugc/services` nunca reciben el `stepRunId` — el executor lo tiene (`ctx.stepId`) pero no lo propaga; `recordCost()` sí acepta el campo.
   - **No es una regresión de T1.10a: es un hueco preexistente de F0 que ahora aflora.** El propio `boss.ts:83` ya documenta que el camino de coste de los executors de demo registra "sin refs (step/project): el ExecutorContext no las expone — quedan null en F0".
   - **No bloquea T1.10a**: su Verificación no menciona coste ni el KPI, y el ledger de `/spend` (la superficie que el PRD designa para el gasto, T0.6) **sí muestra correctamente el dinero**. El invariante *record-first* se cumple: hay fila por cada llamada pagada.
   - **Sí es deuda a rutear hacia T1.10b**, cuya Verificación de fase pide "coste real del lote <$0,25": con `step_run_id` NULL no hay forma de atribuir el coste a un run/lote desde la UI. Fix apuntado: pasar `ctx.stepId` de los executors N1/N2/N3 a los servicios y de ahí a `recordCost({ stepRunId })`.
2. Warnings del validador sobre el brief real: `markdown_truncated` y 1 × `hook_too_long` (14 palabras) — **esperado y ya anotado en el planning** (nota de alcance de T1.9: "los hooks reales de Sonnet 5 incumplen el techo de ≤12 palabras"). No son bloqueantes (`ok=true`, el step pasó).

## Veredicto

**PASS** — los dos escenarios de la Verificación se cumplen LITERALMENTE contra el sistema real con APIs de pago reales: la URL real de ugmonk hace progresar N1→N2→N3 en vivo en el canvas (sin reload, por SSE) y el brief JSON completo aparece como output de N3 en el panel genérico; el texto libre sin imágenes deja N2 en `skipped` en el grafo (con su motivo) y N3 avanza igualmente.

**Coste real: $0,27** (cap $0,75). **Pipeline URL: 116,7 s** (N1 20,0 · N2 32,3 · N3 64,4).

**Aviso al bucle**: el pipeline de 116,7 s **incumpliría hoy el <90 s** que exige la Verificación de fase de T1.10b, y el cuello de botella dominante es **N3 (64,4 s)**, no N2. Además, la atribución de coste por step (`cost_entry.step_run_id`) está sin cablear, lo que impedirá medir el "coste real del lote" que T1.10b pide. Ambas cosas deben decidirse antes de dar T1.10b por cerrable.
