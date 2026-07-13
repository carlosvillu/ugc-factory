# Verificación T1.17 — Listado de runs

- **Tarea**: T1.17 · Listado de runs (`planning.md`, fase F1c)
- **Fecha**: 2026-07-13
- **Ejecutor**: agente `verifier` · agent-browser (npx, 0.27.x) · sesión `t1.17`
- **Sistema**: working tree sobre commit `06b76c9` (diff de T1.17 sin commitear) · docker `ugc-postgres-dev` (Postgres 16, BD/user `ugc`) + `pnpm dev` (web :3000 + worker) + los **4 runs REALES** del uso del 2026-07-13 (sin seeds nuevos, sin lanzar runs: coste $0)
- **Gate previo**: `pnpm gate` VERDE — 1232 tests / 115 ficheros. `pnpm test:e2e` VERDE — 54/54 (incluye el nuevo `runs-list.spec.ts`).

## Verificación esperada (literal de planning.md)

> en el navegador, `/runs` muestra los runs reales existentes en la BD local (incluidos los dos muertos del 2026-07-13) con estado y coste, y desde la nav global se llega sin escribir URLs; click en uno → su canvas.

## Verdad de la BD establecida ANTES de tocar la UI (el oráculo)

Ejecutado por el verifier contra `ugc-postgres-dev` (output crudo en `db-ground-truth.txt`). Es el contraste **columna-mentirosa vs ledger**, y es lo que permite cazar un hardcode afinado a fixtures:

```
-- pipeline_run: la columna de estado MIENTE en el 100 % de las filas
             id             | kind | col_status_MENTIROSA | col_cost_MENTIROSA
 01KXDDNG2BR2YK8BCS90540T9T | full | pending              |          (NULL)
 01KXD5XD4AWWRAM28W7EDJTMDT | full | pending              |          (NULL)
 01KXD1SPQ8EYKDZ4QXWD3WWX1Z | full | pending              |          (NULL)
 01KXD1MM3ENG6QNZ43YY7M1P6V | full | pending              |          (NULL)

-- step_run: los DOS N3 muertos tienen cost_actual NULL... habiendo gastado
 01KXD1SPQ8EYKDZ4QXWD3WWX1Z | N3 | failed | (NULL) | N3: ...missing_hero_image, hook_too_long
 01KXD1MM3ENG6QNZ43YY7M1P6V | N3 | failed | (NULL) | N3: ...missing_hero_image
 (los 6 steps de los 2 runs OK: succeeded, cost_actual 0/0/18 y 0/0/16)

-- cost_entry (EL LEDGER = la verdad del dinero)
           run_id           | ledger_cents | entries
 01KXDDNG2BR2YK8BCS90540T9T |           18 |       3
 01KXD5XD4AWWRAM28W7EDJTMDT |           16 |       3
 01KXD1SPQ8EYKDZ4QXWD3WWX1Z |           13 |       3   <-- muerto, columna NULL, ledger 13c
 01KXD1MM3ENG6QNZ43YY7M1P6V |           16 |       3   <-- muerto, columna NULL, ledger 16c
```

## Pasos ejecutados (CUA, la app usada como un humano)

1. `pnpm gate` desde la raíz (con `next dev` MATADO antes) → verde: 1232 tests, 115 ficheros.
2. Sistema levantado: docker compose ya arriba (healthy) + `pnpm dev` → `GET /api/health` = `{"ok":true,"db":true}`. `GET /api/runs` sin sesión → **401** (ruta tras `withAuth`).
3. SELECTs de la BD (arriba) → oráculo independiente de coste y estado.
4. Navegador: `open http://localhost:3000/runs` → **redirige a `/login`**. Login con la contraseña real vía formulario (`fill` + `click`).
5. Desde el HOME, **click en la entrada «Runs» de la nav global** (`@e8`, `url=/runs`) → aterriza en `/runs`. **Sin teclear ninguna URL**, literal de la Verificación.
6. `snapshot` de `/runs` → tabla semántica (`<table>`, `columnheader` ORIGEN/ESTADO/PASO/COSTE/LANZADO) con **las 4 filas reales**, orden DESC por creación.
7. Medición del resaltado de nav (`data-highlighted` + `aria-current`) en 5 rutas.
8. **Click en la fila del run muerto de stayforlong** (el `<a>` de la celda ORIGEN) → navega a `/runs/01KXD1SPQ8EYKDZ4QXWD3WWX1Z` (su canvas).
9. **Los 4 canvases abiertos** y leído el KPI «Coste real» de la cabecera de forma estructural (label→valor), no por regex.
10. Paginación y entradas malformadas contra la API viva (`?limit&offset`).
11. Contraste WCAG de los badges de estado, compositando el fondo translúcido sobre la superficie real, en tema oscuro Y claro.
12. Consola y errores del navegador.
13. **Control negativo PROPIO** (independiente del del implementer): sabotear el rollup del ledger en `run-list.repo.ts` (`coalesce(sum(amount_cents),0)::int` → `0::int`) y correr la integración.
14. Restaurado el fichero, `pnpm gate` verde otra vez + `pnpm test:e2e` 54/54.

## Resultado observado vs esperado

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | `/runs` muestra los runs REALES de la BD local | Las **4** filas reales, orden DESC (11:41 → 08:11), con su URL de origen y su ULID | `01-runs-listado-light.png`, `02-runs-snapshot.txt` | OK |
| 2 | Con **estado** (los 2 muertos incluidos) | `completado`/`completado`/**`fallido`**/**`fallido`** — DERIVADO de los steps, **contra el `pending` que dicen las 4 filas de `pipeline_run.status`** | `02-runs-snapshot.txt` vs `db-ground-truth.txt` | OK |
| 3 | Con **coste** | $0.18 / $0.16 / **$0.13** / **$0.16** — coinciden EXACTAMENTE con mi SUM del ledger (18/16/13/16). Los muertos **NO** muestran $0.00 | `02-runs-snapshot.txt` vs `db-ground-truth.txt` | OK |
| 4 | Desde la nav global se llega **sin escribir URLs** | Entrada «Runs» en la nav (`/runs`); click → `/runs`. Nunca se tecleó la URL | `01-runs-listado-light.png` | OK |
| 5 | Click en uno → **su canvas** | Click en la fila (`<a>` de ORIGEN) del muerto de stayforlong → `/runs/01KXD1SPQ8EYKDZ4QXWD3WWX1Z` | `04-canvas-muerto-stayforlong-coste-013.png` | OK |
| 6 | **EL BUG DEL DINERO**: la cabecera del canvas de los muertos NO puede decir $0.00 | **«Coste real» = $0.13 y $0.16** en los dos muertos (y $0.18/$0.16 en los OK). Los 4 = ledger exacto | `06-canvas-coste-cabecera.txt`, `04-…-013.png`, `05-…-016.png` | OK |
| 7 | `GET /api/runs/:id` sirve el coste del ledger | `{"…","totalCostActual":null,"costActualCents":13}` — la columna mentirosa sigue expuesta pero **ya no la pinta nadie** | `05-api-run-detail.txt` | OK |
| 8 | Nav: NO se resaltan DOS entradas a la vez | Exactamente **1** resaltado en cada ruta: `/`→Inicio, `/analyses/new`→Canvas, `/runs`→Runs, **`/runs/:id`→Runs (y NO Canvas)**, `/spend`→Gasto | `03-nav-highlight.txt` | OK |
| 9 | Estados con los MISMOS tokens del canvas (no 2ª paleta) | `runStatusTone` vive en el MISMO fichero que la de steps (`run-canvas/status.ts`) y usa los mismos tonos del DS (`success/warning/info/danger/neutral`) | diff de `status.ts` | OK |
| 10 | Paginación simple `?limit&offset` que no revienta | `?limit=2&offset=0/2` → ventanas correctas sin solape; `?limit=1&offset=3` → la 4ª; `?offset=99` → `runs:[]`, `total:4` (no crash). Malformados → **400 tipado** (`limit=abc`, `limit=0`, `limit=1000000`, `offset=-1`), jamás un 500 | `07-paginacion.txt` | OK |
| 11 | Legible en tema claro y oscuro | Ambos legibles; el DS cambia los tokens de texto del badge en light | `02-runs-listado-dark.png`, `03-runs-listado-light.png` | OK |
| 12 | Consola del navegador limpia | **0 errores, 0 warnings** de código propio (solo ruido de HMR/React DevTools de Next dev) | `09-browser-console.txt`, `09-browser-errors.txt` (vacío) | OK |

### Control negativo del verifier (¿los asserts tienen dientes?)

Sustituí el rollup del ledger por `0::int` en `run-list.repo.ts` (**mi propio sabotaje**, no el del implementer) y corrí la integración:

```
× un run muerto en N3 se lista FAILED, señala el step y MUESTRA EL DINERO QUE GASTÓ
  AssertionError: expected +0 to be 13
× un run MUERTO devuelve el dinero del LEDGER, no el 0 de la columna del step
  AssertionError: expected +0 to be 13
× el coste del DETALLE y el del LISTADO coinciden (una sola verdad del dinero)
  AssertionError: expected +0 to be 18
  (6 tests en rojo en total)
```

Los tests atan el dinero al **ledger**, no a fixtures cómodos. Fichero restaurado; gate verde de nuevo.

### El tradeoff declarado por el implementer: VERIFICADO

El total de la cabecera **es una foto REST al cargar, no un contador vivo**. Comprobado por el camino del código (sin gastar dinero fabricando un run en curso):

- `costActualCents` **no viaja por SSE** (no aparece en el contrato del orquestador ni en `use-run-events`/`apply-event`; solo en el schema REST `RunResponse`).
- El store se siembra UNA vez con el `run` del fetch RSC; `applySnapshot` **sustituye `steps`, nunca `run`**.
- ⇒ en un run EN CURSO el total sube al recargar, no con cada step. En runs **terminales** —los que se auditan— es exacto: los 4 medidos coinciden al céntimo con el ledger.
- No rompe nada: `Coste estimado` se sigue sumando de los steps (esa columna no miente) y los E2E del canvas (54/54) siguen verdes.

## Rarezas y hallazgos (NO bloquean el PASS, pero se reportan)

1. **Contraste del badge `fallido` en tema OSCURO: 4.46:1** — justo por debajo del umbral AA de 4.5:1 para texto normal (11px, weight 600). Medido compositando el fondo translúcido (`rgba(239,68,68,.1)`) sobre la superficie real. El resto pasa: `succeeded` dark 6.96:1, `succeeded` light 5.27:1, `fallido` light 5.30:1. **El defecto NO es de T1.17**: el color es el token `danger` del DS (el MISMO que ya usa el nodo del canvas — la tarea reutiliza la paleta, que es justo lo que se le pedía). Se rutea como hallazgo del **Design System** (valores del DS, decisión del usuario), con la tabla de ratios en `08-contraste-badges.txt`. **Alcance de la medición**: con los 4 runs reales solo se ejercen los tonos `success` y `danger`; `warning`/`info`/`neutral` (esperando aprobación / en curso / pendiente-cancelado) NO los renderiza ningún run existente y por tanto NO se han medido — fabricar runs para ejercerlos sería testear la primitiva Badge del DS, fuera de la Verificación literal de T1.17.
2. **El dinero sigue invisible a nivel de NODO** (misma familia de bug, una capa más abajo): en el canvas del run muerto, el nodo N3 muestra `est. —` y **ningún coste real**, y N1/N2 muestran `$0.00`. Los nodos siguen pintando `step_run.cost_actual` (la columna que queda NULL al fallar). La cabecera ya es honesta; el desglose por nodo aún no. Fuera del alcance de T1.17, pero es deuda: quien abra el canvas para auditar VE $0.13 arriba y $0.00 en los nodos que lo gastaron.
3. **La API pagina, pero la página `/runs` no expone controles de paginación**: siempre pide el default (limit 25, offset 0). Con 4 runs es invisible; a partir de 25 runs la UI mostraría en silencio solo la primera página. La Verificación pedía «paginación simple (`?limit&offset`)» a nivel de API y eso está y funciona; los controles de UI caen razonablemente en T5.10, pero el hueco es real.
4. **`pipeline_run.status` y `total_cost_actual` siguen mintiendo en la BD** (deuda de T0.8, preexistente y fuera de alcance). T1.17 las esquiva derivando de steps + ledger; la deuda sigue viva y ahora hay DOS lectores que dependen de esquivarla.
5. **`step_run.cost_actual` NULL al fallar** (causa raíz del bug de dinero) **no se ha arreglado**: se ha rodeado. Correcto para esta tarea (el ledger es la verdad), pero la columna sigue siendo una mina para el próximo que la sume.
6. Rareza del arnés (no del producto): con `pnpm dev` corriendo, `sse-contract.test.ts` falla en teardown (`server.stop()` sobre undefined: puerto ocupado). Con el dev server matado, gate 100 % verde.

## Coste real

**$0** — no se lanzó ningún run ni se llamó a ninguna API de pago. La verificación se hizo íntegramente contra los 4 runs REALES ya existentes en la BD local. (Estimado del planning: $0. Desviación: 0 %.)

## Veredicto

**PASS** — `/runs` lista los 4 runs reales de la BD local (los dos muertos del 2026-07-13 incluidos) con el estado DERIVADO de los steps (contra el `pending` mentiroso de las 4 filas) y el coste REAL del ledger; se llega desde la nav global sin teclear URLs y sin doble resaltado; y el click en una fila lleva a su canvas.

**El punto crítico —el bug de dinero— está genuinamente arreglado**: los dos runs muertos muestran **$0.13 y $0.16** tanto en el listado como en la **cabecera de su canvas** (que antes decía $0.00), y ambos números coinciden al céntimo con mi propio `SUM(cost_entry)` independiente. El control negativo del verifier (zeroing del rollup del ledger) pone 6 tests en rojo con `expected +0 to be 13`: los asserts atan el dinero al ledger, no a fixtures.

Se reportan 6 rarezas —ninguna bloqueante—, de las que dos merecen ruta: el contraste 4.46:1 del badge `fallido` en dark (defecto de VALORES del DS, no de esta tarea) y el coste por NODO, que sigue pintando la columna mentirosa.
