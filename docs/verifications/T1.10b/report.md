# Verificación T1.10b — CP1: editor de brief (E2E de cierre de F1)

- **Tarea**: T1.10b · CP1: editor de brief (`planning.md`)
- **Fecha**: 2026-07-12
- **Ejecutor**: verifier (contexto fresco) · agent-browser 0.27.0 · sesión `t1.10b`
- **Sistema**: base `c0db4f8` + working tree con el diff de T1.10b (pre-commit) · docker compose dev (Postgres 16) + `pnpm db:migrate` + `pnpm dev` en **puerto 3001** con `INTERNAL_API_URL=http://localhost:3001` (workaround del bug conocido de `api-client.ts:26`, deuda ajena a esta tarea)
- **Gate previo**: `pnpm gate` **VERDE** (lint + typecheck + format + knip + **916 tests**)
- **APIs REALES**: Firecrawl + Anthropic (Sonnet 5 / Haiku 4.5). Ninguna suite ni fake intervino.

## Verificación esperada (literal de planning.md)

> **Verificación (E2E de la fase, criterio O1)**: en el navegador — URL real → N1/N2/N3 → editar un beneficio y un hook en CP1 → aprobar → brief versionado (v1 IA, v2 editado) y el run avanza; pipeline **<180 s** (sin contar la edición) *(bound revisado en T1.10a: el real es 116,7 s, dominado por N3 — ver nota de O1 en el PRD)* y **<$0,25** *(bound revisado en T1.8 — ver su nota 5; ojo: este es el coste del pipeline COMPLETO N1+N2+N3; medido en T1.10a: **$0,20** con URL real, así que entra)*. Después, editar el brief aprobado vía `/api/briefs/:id` sin run activo crea v3. Los badges extraído/inferido muestran su `evidence` (cita) en el editor; un análisis en modo manual sin imágenes muestra en CP1 la petición bloqueante de imágenes con la derivación a packshot-IA.

## Pasos ejecutados

**Run A — URL real (`https://ugmonk.com`)**, run `01KXAQPG1EEM8ARBXQ6PE33N0T`:

1. Login → `/analyses/new` (tab «Desde URL», viewport 1440×1000) → pego `https://ugmonk.com` → «Analizar» → navega a `/runs/<id>`.
2. N1 → N2 → N3 progresan y N3 queda en `waiting_approval`; **CP1 abre con el brief cargado** (`03-cp1-brief-cargado.png`). El brief es el producto **AUTÉNTICO** de ugmonk (sistema «Analog», Card Bar, Discbound Journal, 150.000 clientes, Wirecutter/WSJ/Wired, imágenes de `ugmonk.com/cdn`) — ningún fixture produce esto.
3. Badges «✓ extraído» / «inferido · <confidence>» con **4 citas `evidence` VISIBLES** (`<q data-slot="evidence">`, no tooltip): testimonios literales de clientes de ugmonk sacados del mini-crawl de reviews (`07-cp1-badges-evidence.png`).
4. **Edito con MI texto** (no fixtures del implementer): beneficio 3 → `VERIFIER-T110B: mantiene las tareas visibles sin desbloquear el movil`; hook 2 del ángulo «Solo 10 tareas al día» → `VERIFIER-T110B: una tarjeta, diez huecos, cero notificaciones` (`09-cp1-editado.png`).
5. «Guardar cambios y continuar» → **el run avanza**: N3 pasa a `completado`, progreso **3/3 (100 %)**, KPI «Coste real **$0.21**» (`10-tras-aprobar.png`).
6. `GET` + **`PATCH /api/briefs/:id`** sin run activo (el run ya cerró) → **v3**; un segundo PATCH sobre un campo del contrato (`product.one_liner`) → **v4** con el valor persistido (`12-briefs-api-v3.txt`).

**Run B — modo manual (texto libre) SIN imágenes**, run `01KXAR7Z14ZJYA11XSPTMK3YFG`:

7. Tab «Texto libre», descripción propia (cinturón de cuero artesanal), **sin subir imágenes** → N1 `succeeded`, **N2 `skipped`**, N3 `waiting_approval`.
8. CP1 muestra la **petición bloqueante**: *«⚠ Necesitamos imágenes del producto. No hay imagen de producto: sube al menos una foto o elige generar un packshot con IA»* + bloque *«Decisión sobre las imágenes del producto — Elige cómo seguir para poder aprobar»* con **«Subir imágenes del producto»** y **«Generar packshot con IA»** (la derivación). Ambos botones de aprobar **`disabled: true`** hasta decidir (`14-cp1-manual-peticion-imagenes.png`).
9. Click en «Generar packshot con IA» (`aria-pressed=true`) → los botones de aprobación se **habilitan** (`15-cp1-manual-packshot-elegido.png`).
10. **Aprobar SIN editar** (check escéptico) → v1 pasa a `approved` **sin crear v2**, `edited_by_user` sigue `false`; el run avanza (N3 `succeeded`).

## Resultado observado vs esperado

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | URL real → N1/N2/N3 → CP1 abre con el brief | N1 `succeeded` → N2 `succeeded` → N3 `waiting_approval`; CP1 con brief auténtico de ugmonk | `03-…png`, `04-step-timings.txt` | ✅ |
| 2 | Editar un beneficio Y un hook → aprobar → **v1 IA + v2 editado** y el run avanza | `product_brief`: **v1** `edited_by_user=f`, `status=draft`, `origin_step_run_id`=step de N3 · **v2** `edited_by_user=t`, `status=approved`. v1 tiene **0** marcas `VERIFIER-T110B`, v2 tiene **2** (mi beneficio + mi hook, cada uno en su sitio exacto, resto del brief intacto). Run a **3/3 100 %** | `11-product-brief-rows.txt`, `09/10-…png` | ✅ |
| 3 | Pipeline **< 180 s** (sin la edición) | **119,9 s** — N1 29,5 s · N2 11,2 s · **N3 79,2 s**. Medido por timestamps de `step_run` en Postgres (min `started_at` → `updated_at` de N3 al entrar en `waiting_approval`), **no** wall-clock: excluye la edición humana. Coherente con los 116,7 s de T1.10a | `04-step-timings.txt` | ✅ |
| 4 | Coste **< $0,25** | **$0,21** el pipeline completo (N1 $0,00 Firecrawl + N2 $0,01 Haiku + N3 $0,20 Sonnet 5) | `05-cost-entries.txt`, `19-coste-concordancia.txt` | ✅ |
| 5 | `PATCH /api/briefs/:id` sin run activo → **v3** | HTTP 200, `version: 3`, `editedByUser: true`, id nuevo, conserva la edición de v2. Un 2º PATCH sobre `product.one_liner` → **v4** con el valor persistido en BD | `12-briefs-api-v3.txt`, `11-product-brief-rows.txt` | ✅ |
| 6a | Badges extraído/inferido muestran su **`evidence` (cita)** | 4 `<q data-slot="evidence">` **visibles** (no tooltip) con testimonios literales de clientes de ugmonk; badge «✓ extraído» junto a la cita, «inferido» sin ella (Apéndice A) | `07-…png` | ✅ |
| 6b | Modo manual sin imágenes → **petición bloqueante** + derivación a **packshot-IA** | Warning bloqueante visible + 2 opciones; **aprobar deshabilitado** hasta elegir; elegir packshot-IA lo desbloquea | `14-…png`, `15-…png` | ✅ |

### Checks escépticos exigidos por el brief (todos superados)

| Check | Resultado |
|---|---|
| **Bloqueo 2 — `cost_entry.step_run_id`** | **RESUELTO**. Baseline: 30 filas, **0** con `step_run_id`. Tras T1.10b: **4/4 filas nuevas con `step_run_id` NOT NULL** |
| **Bloqueo 2 — KPI del canvas ya no miente** | El canvas muestra **«Coste real $0.21»** (antes $0,00 con 20 cts gastados). `step_run.cost_actual` poblado (0/1/20) |
| **Triple concordancia de coste** | `step_run.cost_actual` == `SUM(cost_entry)` step a step; coste **por run** calculable (A $0,21 · B $0,12); `/spend` muestra **$0,33 hoy** = 0,21 + 0,12 sobre el baseline de $2,01 → total $2,34 ✓ |
| **Aprobar SIN editar NO crea v2** | ✅ Run B: v1 pasa a `approved` con `edited_by_user=false`; **no** aparece v2 |
| **Idempotencia de N3 (`origin_step_run_id`)** | Índice único parcial `product_brief_origin_step_key`. Query: **ningún `step_run` tiene 2 briefs** (0 filas duplicadas). 5 briefs / 2 análisis, cadena exacta sin huecos |
| **Brief auténtico (no fixture)** | ✅ Producto real de ugmonk con datos que solo salen del scrape real |
| **Warnings `hook_too_long`** | Presentes, **no bloquean** la aprobación (esperado según el planning) |
| **Consola del navegador** | **0 errores JS**. 2 warnings de **React Flow** (dependencia de terceros, transitorios en el mount antes de que el contenedor tenga tamaño; el canvas renderiza correctamente) → excepción estrecha de `cua.md` §paso 3 |

### Contraste WCAG (aserción obligatoria de `cua.md`)

**Dark (tema por defecto): TODO PASA.**

| Elemento | Ratio | Umbral | OK |
|---|---|---|---|
| Badge «inferido» (11px, 600) | **6,38–6,76:1** | 4,5:1 | ✅ |
| Badge «✓ extraído» / «on_page» | **7,62–8,07:1** | 4,5:1 | ✅ |
| Botón «Aprobar y continuar» (13px, 600) | **6,54:1** | 4,5:1 | ✅ |
| Botón «Guardar cambios y continuar» | **14,58:1** | 4,5:1 | ✅ |
| Alert de warning / info | **16,74–18:1** | 4,5:1 | ✅ |
| «Cancelar lote» | 5,09:1 | 4,5:1 | ✅ |

**Light: los badges FALLAN AA — pero el defecto es del DESIGN SYSTEM, no de T1.10b** (hallazgo a rutear, `cua.md` §paso 3: *«hallazgo a rutear si el color viene del DS… se REPORTA con la tabla de ratios»*).

| Elemento (light) | Ratio | Umbral | OK |
|---|---|---|---|
| Badge «✓ extraído» (`text-success` / `bg-success-soft`) | **2,28:1** | 4,5:1 | ❌ |
| Badge «inferido» (`text-violet` / `bg-violet-soft`) | **2,54–2,72:1** | 4,5:1 | ❌ |
| Badge «on_page» | **2,13:1** | 4,5:1 | ❌ |
| Botón «Aprobar y continuar» | 6,54:1 | 4,5:1 | ✅ |

**Por qué NO bloquea T1.10b**: (a) `brief-editor.tsx` consume la primitiva `Badge` del DS con sus tokens semánticos (`tone="success"/"violet"`), **sin hardcodear ningún color**; (b) los tokens `--violet`/`--success`/`--info` **no cambian de valor en light** — el badge conserva el color pensado para fondo oscuro sobre un fondo casi blanco; (c) **verificado que es preexistente y transversal**: la página `/design-system` (cerrada en TD.1–TD.7, que T1.10b no toca) exhibe **los mismos ratios malos** (1,96–2,48:1) en sus propios badges. Es el mismo agujero que TD.7 documentó, en otra familia de tokens. → **Deuda del DS**, decisión del usuario; no es regresión ni defecto de esta tarea.

## Coste real

| Concepto | Importe |
|---|---|
| Run A (ugmonk, pipeline completo N1+N2+N3) | **$0,21** — Firecrawl $0,00 · Anthropic Haiku (N2) $0,01 · Anthropic Sonnet 5 (N3) $0,20 |
| Run B (texto libre, N2 skipped) | **$0,12** — Anthropic Sonnet 5 (N3) |
| **Total de la verificación** | **$0,33** |

- **Bound de la Verificación (coste del pipeline por lote): $0,21 < $0,25** ✅
- Estimado del planning: $0,50 · cap $1,50 → **muy por debajo** (el total gastado, $0,33, incluye el segundo run del modo manual, que la Verificación exige aparte).
- Cross-check `/spend`: $2,34 total = $2,01 baseline + **$0,33 de hoy** ✓ (`18-spend.png`).

## Veredicto

**PASS** — los 6 observables de la Verificación se cumplen literalmente contra el sistema real con APIs de pago, y los dos bloqueos que T1.10a dejó abiertos quedan cerrados: el pipeline entra en el bound (119,9 s < 180 s) y **el coste ya es atribuible por run** (`cost_entry.step_run_id` NOT NULL, `step_run.cost_actual` poblado, KPI del canvas mostrando $0,21 en lugar del $0,00 mentiroso).

**Rarezas y notas (no bloquean):**

1. **Contraste de los badges en light: FALLA AA (2,13–2,72:1)** — defecto del **DS**, preexistente y transversal (reproducido en `/design-system`, que T1.10b no toca). T1.10b usa la primitiva correctamente. **Se rutea como deuda del DS** con la tabla de ratios de arriba.
2. **`pricing.price` sale `null`** en el brief de ugmonk. **No es un bug**: el propio brief lo explica en `meta.warnings` (la home es una homepage de marca sin producto único con precio estructurado; Sonnet 5 detectó un `$27.25` en un `alt` y lo descartó por poco fiable). Es la decisión correcta del sintetizador, y el badge de CP1 lo refleja.
3. **Los 2 warnings de React Flow** («parent container needs a width and a height») son de la dependencia, transitorios en el mount. 0 errores JS.
4. **Falta la captura `02-run-inicial.png`**: el `wait --url "**/runs/*"` de agent-browser **colgó hasta el timeout** pese a que la navegación SÍ ocurrió — el canvas de `/runs/*` mantiene el SSE abierto y ese wait no resuelve (es justo lo que `cua.md` advierte para `--load networkidle`; aquí muerde también a `wait --url`). El run avanzó correctamente; solo se perdió esa captura. **Anotable para el arnés**: en páginas con SSE vivo, esperar con `wait --text` o polleando la BD, nunca con `wait --url`.
5. **El `PATCH /api/briefs/:id` acepta claves desconocidas descartándolas en silencio** (mi primer payload añadía `product.tagline`, inexistente en el contrato: devolvió 200 y creó v3 sin ese campo). Zod hace strip por defecto. No incumple nada de la Verificación (el versionado y la persistencia de campos reales funcionan, probado con `product.one_liner` → v4), pero **una edición con un typo en el nombre del campo se pierde sin aviso**. Candidato a `.strict()` en el schema de entrada del PATCH.
