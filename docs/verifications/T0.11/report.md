# Verificación T0.11 — Canvas React Flow v1

- **Tarea**: T0.11 · Canvas React Flow v1 (`planning.md`)
- **Fecha**: 2026-07-10
- **Ejecutor**: verifier (agente escéptico) · agent-browser 0.27.x · sesión `t0.11`
- **Sistema**: commit `b6f16f2` + **diff T0.11 sin commitear en el working tree** (sha verificado; ficheros T0.11 `??`: `apps/web/src/app/runs/`, `run-canvas/`, `api/runs/[id]/route.ts`, etc. y `M` en core/db/worker). Stack: `docker compose -f docker-compose.dev.yml` (Postgres 16, host :55432) + `pnpm dev` (web :3000 + worker) contra **BD fresca aislada `ugc_t011verify`** (cruce psql ve solo mis runs). Env: `SSE_HEARTBEAT_MS=2000`, `AUTH_BOOTSTRAP_PASSWORD=ugc-factory-dev`. Un solo `next dev` (lección T0.9/T0.10).
- **Gate previo**: `pnpm gate` VERDE (lint + typecheck + format:check + knip + 449 tests). e2e no re-ejecutado (18/18 es la regresión; esta verificación es CUA de UI real).

## Verificación esperada (literal de planning.md)
> en el navegador, lanzar el run de demo y **ver los nodos cambiar de color en vivo**; aprobar el checkpoint desde el panel; provocar un fallo (`fail_rate=1`) y ver el error en el visor de logs del nodo; retry con éxito; cancelar OTRO run en curso desde el botón; activar el toggle autopilot desde la cabecera y ver un run completar sin pausas (con el candado "parar siempre aquí" respetado); skip de un nodo skippable desde el panel — todo operado desde la UI, no vía API.

## Runs usados (creados vía `POST /api/runs` como arranque; project `01JQZ0T011VERZZZZZZZZZZZ01`)
| Run | id | Rol | autopilot |
|---|---|---|---|
| A | `01KX5YQ8BF9V4GZZN7VDVC7JX8` | comportamientos 1,2,3,4,7 (sleepMs 3000) | off |
| B | `01KX5Z2DPBYRPJGQE14NE3RW3E` | 1er intento autopilot — **race** (toggle tarde, descartado) | off→on |
| C | `01KX5Z59A32SZDA7MKN26Y57V8` | comportamiento 6 (N0 sleep 15s → toggle antes de N1) | off→on |
| D | `01KX5Z7TH9NJCB4VK038XKWYTQ` | comportamiento 5 (OTRO run en curso, N0 sleep 30s) | off |
| — | `01KX5Z9DHS52XN70AQ3BE03Y4H`, `01KX5ZE2QF47V7WT4Z9VZ5MSXV` | medición contraste WCAG (checkpoint + failed, dark/light) | off |

**Todas las 7 acciones se operaron DESDE LA UI** (click en nodos, botones panel/cabecera). Solo la CREACIÓN del run fue por API (arranque permitido; no hay botón "nuevo run" en la UI de F0). Cruce `data-status` del DOM (sin reload) + `psql` de `step_run` por comportamiento.

## Resultado observado vs esperado
| # | Comportamiento | Esperado | Observado (UI + psql) | Evidencia | OK |
|---|---|---|---|---|---|
| 1 | Nodos cambian de color EN VIVO | Transición por SSE sin reload | Polling del DOM vivo (sin reload) tras aprobar N1: N2 queued→running→succeeded, N3 queued→running→waiting_approval. DOM `data-status` == psql en cada frame. | 03-run-a-progressed-N3-parked.png | ✅ |
| 2 | Aprobar checkpoint DESDE EL PANEL | Panel → Aprobar → avanza | Click N1 → panel Aprobar/Editar/Rechazar → Aprobar → N1 `waiting_approval`→`succeeded`, avanza. psql confirma. | 02-n1-panel-checkpoint-actions.png | ✅ |
| 3 | Fallo (fail_rate=1) + error en visor | Mensaje limpio en el panel | N4 agotó 3 retries (retry_count=3=max_retries) → `failed`; panel `[data-slot=error-viewer]` = **"demo executor: fallo inyectado"**. psql `error={"message":"demo executor: fallo inyectado"}`. | 04-n4-panel-error-viewer.png | ✅ |
| 4 | Retry con éxito | Reintentar → succeeded | Click Reintentar (patch failRate=0) → N4 `failed`→`succeeded`. DOM "completado" + psql. | 07-n4-retried-succeeded.png | ✅ |
| 5 | Cancelar OTRO run desde el BOTÓN | 2º run en curso; botón; steps cancelled | Run D en curso (N0 running, N1/N2 awaiting_deps) → botón "Cancelar lote" → 3 steps `cancelled` (DOM "cancelado" + psql). Strengthener: Run C intacto (cancel run-scoped). | 11-run-d-running-before-cancel.png, 12-run-d-cancelled.png | ✅ |
| 6 | Autopilot desde CABECERA, sin pausas, candado respetado | N1 no pausa; N3 (alwaysPause) sí; run completa | Toggle autopilot ON en cabecera de Run C **durante N0 running** (PATCH landed antes de N1, por timestamps). N1 **bypass**→succeeded (`N1_ever_paused=no`); N3 **pausó** pese a autopilot. Tras aprobar N3 + retry N4, KPI cabecera **"100% · 6/6"**. | 09-run-c-autopilot-N1-bypassed-N3-paused.png, 10-run-c-autopilot-completed.png, 15-run-c-header-progress-100.png | ✅ |
| 7 | Skip skippable DESDE EL PANEL | Panel → Saltar → skipped, avanza | N5 awaiting_deps → panel "Saltar" → N5 `skipped` (DOM "saltado" + psql). Hecho ANTES del retry de N4 (solo skippable en awaiting_deps). | 05-n5-panel-skippable.png, 06-n5-skipped.png | ✅ |

### Estado final psql
- **Run A**: N0..N4 succeeded, N5 skipped. **Run C**: N0..N5 todos succeeded. **Run D**: N0,N1,N2 cancelled.

## Consola del navegador
Limpia: solo ruido dev de Next.js/React (DevTools info, HMR, Fast Refresh). Ningún `console.error`/warning de código propio. Ver `browser-console.txt` / `console-errors-warnings.txt` (vacío tras filtro).

## Aserción de contraste WCAG (obligatoria, cua.md línea 111) — HALLAZGO A RUTEAR
`getComputedStyle` (color + background compuesto con alpha) + ratio WCAG, en **dark (default)** y **light**, sobre cada acento/semántico que T0.11 renderiza. Umbral 4.5:1 texto normal.

| Elemento | Token | Dark | Light | AA |
|---|---|---|---|---|
| Aprobar (bg-success / text-success-on) | success | 6.54 | 6.54 | ✅ |
| Editar (secondary) | — | 14.58 | 15.3 | ✅ |
| Panel status label / texto nodo | text | 16.74 | 17.72 | ✅ |
| Visor error — MENSAJE | text/danger-soft | 15.27 | 15.56 | ✅ |
| **Rechazar (danger-ghost)** | **danger `#ef4444`** | **4.46 ✗** | **3.3 ✗** | ❌ |
| **Cancelar lote (danger-ghost)** | **danger `#ef4444`** | 4.67 (borde) | **3.02 ✗** | ❌ light |
| **Visor error — "ERROR" heading** | **danger `#ef4444`** | 4.89 ✓ | **3.76 ✗** | ❌ light |

**Causa raíz**: `--danger: #ef4444` (Tailwind red-500) de `globals.css` como COLOR DE TEXTO falla AA — grave en light (3.0–3.8), borderline/fallo en dark (4.46 Rechazar). NO es bug de T0.11: los componentes consumen el token del DS correctamente; el defecto está en los VALORES del DS (mismo agujero de TD.7 que cua.md línea 111 documenta). **Se rutea a decisión del usuario sobre `--danger`**, no se bloquea al implementer (sin acción posible dentro de una tarea de canvas).

## Coste real
**$0** — Postgres local + executors de demo. Sin APIs de pago (KPI "Coste real $0.00" lo confirma). Estimado $0 → sin desviación.

## Veredicto
**PASS** — los 7 comportamientos se operaron DESDE LA UI y se observaron correctos (color en vivo por SSE sin reload, aprobar/error/retry/skip desde el panel, cancelar OTRO run desde el botón, autopilot desde la cabecera con bypass de checkpoint normal + respeto del candado alwaysPause, run al 100%), con cruce psql y consola limpia.

**Stop de decisión humana (no bloquea el PASS funcional, el bucle debe parar):** el token DS `--danger #ef4444` como texto falla WCAG AA (tabla). Decisión del usuario sobre el valor del token (afecta a todo danger de la plataforma). Rutear, no rebotar al implementer.

**Rarezas (aunque PASS):**
- `pipeline_run.status` queda `'pending'` con todos los steps terminales (Run A, C). Roll-up de estado a nivel run no cableado — probablemente pre-existente a T0.11 (el canvas trabaja a nivel step; finalización observable por KPI "100% · 6/6"). No afecta a los 7 comportamientos.
- N4 (failRate=1) alcanza `failed` terminal tras agotar 3 retries automáticos; el visor de error solo aparece en el estado terminal.
