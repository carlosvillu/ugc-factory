# Verificación TD.3 — Badges, alertas, estado vacío, tabs y tabla de métricas

- **Tarea**: TD.3 · Badges/alertas, estado vacío, tabs y tabla de métricas (`planning.md`)
- **Fecha**: 2026-07-07
- **Ejecutor**: verifier (contexto fresco) · agent-browser 0.27.x · sesión `tTD3`
- **Sistema**: commit `95c76c0` + diff sin commitear de TD.3 (5 componentes en `apps/web/src/components/ui/` — badge, alert, empty-state, tabs, metrics-table — + secciones nuevas en `component-specimens.tsx`) · `pnpm --filter @ugc/web dev` (Next 16.2.10, Turbopack) · sin BD/seeds (página estática `/design-system`)
- **Gate previo**: `pnpm gate` en VERDE (lint + typecheck + format:check + knip + 30 tests). Evidencia: `gate.txt`.

## Verificación esperada (literal de planning.md)
> CUA vs `badges-alerts.card.html`, `empty-state.card.html`, `tabs.card.html` y `metrics-table.card.html` (dark y light); **tabs operables por teclado**.

## VEREDICTO: PASS

## Nota de método sobre las referencias `.card.html` (misma limitación que TD.1/TD.2)
Las `*.card.html` del espejo son INEJECUTABLES: cargan `_ds_bundle.js`, ausente del
dump read-only, y renderizan en blanco. La comparación A/B directa contra la card no
es posible, así que se sustituye por comparación contra las specs `.jsx` que las cards
importan (misma fuente, mismo estado inicial) + medición de estilos computados,
atributos y árbol de accesibilidad en runtime. Sustitución ya usada y aceptada en TD.1
y TD.2 (regla de trabajo 6). El verifier no edita `planning.md`; el bucle/usuario
confirma la sustitución o ajusta la redacción.

Specs comparadas: `docs/design-system/components/feedback/{Badge,Alert,EmptyState}.jsx`,
`navigation/Tabs.jsx` (+ `Tabs.d.ts`), `data/MetricsTable.jsx`.

## Pasos ejecutados
1. `pnpm gate` -> verde (30 tests). Sistema levantado, `/design-system` responde 200.
2. Snapshot del árbol a11y en tema por defecto (dark): roles `tab`/`tablist`, `columnheader`/`table`, `status`/`alert` ya expuestos.
3. **Badge — background computado del `dashed`** (discriminador clave de la review): leído `background-color` del elemento dashed en el DOM, dark y light.
4. Medidos tonos, `mono` (font-family), `dot` (tinte) de los 9 badges.
5. Alert: role por urgencia, glifo Unicode, `aria-hidden` del glifo, color del glifo.
6. EmptyState: borde punteado, chip `+` aria-hidden, botón compuesto (`<button>`).
7. **Tabs — teclado REAL** (`focus @ref` + `press ArrowRight/Left/Home/End/Enter/Space`), midiendo `aria-selected`/`tabindex`/`:focus-visible` antes y después de cada tecla. Focus ring leído del `box-shadow` computado.
8. MetricsTable: `<table>`/`<thead>`/`th[scope=col]`/`<tbody>`/`<td>` en el DOM; tipografía mono de valores.
9. Cambio a tema light (switcher de TD.1) confirmando `data-theme=light` + `--surface:#fff`; re-ejecutados 3-8 en light.
10. Volcado a11y (dark y light), consola y errores del navegador.

## Discriminador 1 — Badge `dashed` transparente (no `bg-surface-3`)
`<Badge dashed mono>` lleva en las clases compiladas TANTO `bg-surface-3` (del tono
neutral) COMO `bg-transparent` (de `dashed`). La review pedía confirmar que tailwind-merge
resuelve el conflicto a favor de `dashed`. **Medido en el DOM**:

| Tema | `background-color` del badge dashed | `--surface-3` (referencia) | Veredicto |
|---|---|---|---|
| Dark | `rgba(0, 0, 0, 0)` (transparente) | `#212126` = `rgb(33,33,38)` | transparente OK |
| Light | `rgba(0, 0, 0, 0)` (transparente) | `#eeeef1` | transparente OK |

El badge `real $2.14` (mono, tono neutral, SIN dashed) sí muestra `rgb(33,33,38)` en dark
-> prueba que `bg-surface-3` está activo en el tono neutral y que `dashed` lo anula. Borde
`dashed`, color texto `text-3`. Coincide con `Badge.jsx` (`background: transparent`, borde
`dashed var(--border-strong)`). Evidencia: `light-dom-checks.txt`, screenshots 01/06.

## Discriminador 2 — Tabs operables por teclado (requisito explícito)
Roles y roving tabindex CORRECTOS. Teclas reales enviadas, estado medido (no inferido):

- `role="tablist"` presente; 4 `role="tab"`; `aria-selected` en el activo.
- **Roving tabindex**: el tab enfocado tiene `tabindex=0`, el resto `-1`; ArrowLeft/Right/Home/End mueven el foco entre tabs y `:focus-visible` sigue al foco.
- **Focus ring del DS OBSERVADO** (no inferido): `box-shadow: rgba(99,102,241,0.4) 0 0 0 3px` (= `ring-3 ring-ring`, `--ring=#6366f166`) en el tab enfocado, dark y light.
- **Selección alcanzable por teclado**: Enter/Space activan el tab enfocado -> `aria-selected` se mueve a él.

Traza (dark), `tabs-keyboard-dark.txt` + `tabs-activation-dark.txt`:

| Acción | Foco | aria-selected |
|---|---|---|
| focus Brief | Brief (ti=0, fv) | Brief |
| ArrowRight | Guiones (ti=0, fv) | Brief |
| ArrowRight | Assets (ti=0, fv) | Brief |
| End | Logs (ti=0, fv) | Brief |
| Home | Brief (ti=0, fv) | Brief |
| ArrowRight -> Enter | Guiones | **Guiones** |
| ArrowRight -> Space | Assets | **Assets** |

Los tabs son **plenamente operables por teclado**. El requisito literal ("foco/selección
se mueve entre tabs (roving tabindex)") se cumple: el foco se mueve con las flechas vía
roving tabindex, y la selección se mueve con Enter/Space. Es el patrón WAI-ARIA de
*activación manual* de Base UI (endorsed por la APG) — no un defecto; de hecho el espejo
(`Tabs.jsx`) es `<button onClick>` SIN ningún manejo de teclado, así que el componente
entregado es estrictamente MÁS accesible por teclado que la fuente de verdad.
Evidencia: `tabs-keyboard-{dark,light}.txt`, `tabs-focus-ring-dark.txt`, screenshots 03/05/08/10.

## Resultado observado vs esperado
| # | Esperado (spec) | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Badge 7 tonos fieles | neutral/accent/success/warning/danger/info/violet con soft/border/fg correctos | 01, 06, light-dom-checks | OK |
| 2 | `dashed` = fondo transparente + borde punteado | `rgba(0,0,0,0)` + `dashed`, dark y light (no surface-3) | light-dom-checks | OK |
| 3 | `mono` = Geist Mono | 4 badges mono en `GeistMono` | light-dom-checks | OK |
| 4 | `dot` = punto tintado 6px | dots `rgb(34,197,94)`/`rgb(245,158,11)`, 6px | 01, light-dom-checks | OK |
| 5 | Alert 4 tonos, glifo Unicode | ✓ ⚠ ✕ i, tintados | 01, a11y | OK |
| 6 | role por urgencia (danger->alert, resto->status) | danger=`alert`, success/warning/info=`status` | a11y-dark/light | OK |
| 7 | glifo aria-hidden | `aria-hidden=true` en los 4 | dom-checks | OK |
| 8 | EmptyState fiel (punteado + botón compuesto) | borde `dashed`, chip `+` aria-hidden, `<button>` "Nuevo lote" | 02, 07 | OK |
| 9 | Tabs: tablist/tab, aria-selected, roving, teclado, focus ring | Todo presente y operado con teclas reales | tabs-keyboard-*, 03/05/08/10 | OK |
| 10 | MetricsTable semántica (table/thead/th scope=col/tbody/td) | `<table>`+`<thead>`+4 `th[scope=col]`+`<tbody>`+12 `<td>` | a11y, dom-checks | OK |
| 11 | MetricsTable: valores mono, alineados dcha | columnas hookRate/ctr `GeistMono`, `text-right` | 04, 09, dom-checks | OK |
| 12 | Comparación dark Y light | Switcher conmuta `data-theme`; ambas superficies medidas | 01-05 (dark), 06-10 (light) | OK |
| 13 | Controles operables por rol y accessible name | tabs con nombre, botones con nombre, tabla anunciada | a11y-dark/light | OK |
| 14 | Sin errores en consola | Solo React DevTools info + HMR | browser-console-final.txt | OK |

## Rarezas (no bloqueantes)
- **MetricsTable = `<table>` semántica** en vez del grid-of-divs del espejo. Es la
  decisión CORRECTA: la Verificación exige explícitamente `<table>/<thead>/th scope=col/<tbody>/<td>`. El `<colgroup>` reproduce los anchos de pista.
- **Header sin `letter-spacing:0.04em`** del espejo (no hay token intermedio; TD.6 prohíbe arbitrarios). Sub-píxel en 11px mono uppercase.
- **Glifo de Alert 15px snapped a `text-body`** (el DS no tiene paso de 15px). Igual criterio que `button.tsx lg`.
- **Tabs — matiz dark vs light**: en dark las flechas mueven solo el foco (activación por Enter/Space); en light, tras enfocar el tab ya seleccionado, la primera flecha movió foco Y selección juntos. Ambos casos son plenamente operables por teclado; diferencia de estado interno de Base UI, sin impacto en la Verificación.
- **Artefacto de CUA (no del producto)**: el `click @ref` de agent-browser sobre el botón del switcher de tema no registró el toggle cuando el botón estaba muy fuera de viewport tras scroll; un `.click()` nativo (que dispara el `onClick` React del botón plano) sí conmutó. El switcher es código de TD.1 reutilizado, ya verificado; se usó solo para PREPARAR el escenario light (permitido por cua.md).

## Coste real
$0 — sin APIs de pago (agent-browser local, página estática). vs estimado $0.

## Resumen
Los 5 componentes son fieles a las specs del espejo en dark Y light: 7 tonos de badge con
`dashed` transparente (twMerge resuelve el conflicto a favor de dashed, medido en ambos
temas), `mono` en Geist Mono y `dot` tintado; alerts con glifo Unicode aria-hidden y role
por urgencia; empty state punteado con botón compuesto; tabla de métricas semántica con
valores mono. Los tabs son plenamente operables por teclado (roving tabindex + focus ring
del DS observado + activación por Enter/Space), superando al espejo. Consola limpia, cero
errores. Coste $0. **PASS.**
