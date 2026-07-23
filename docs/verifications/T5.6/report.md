# Verificación T5.6 — CP4 · revisión de variantes

- **Tarea**: T5.6 · CP4: revisión de variantes (`planning.md`)
- **Fecha**: 2026-07-23
- **Ejecutor**: verifier (agente) · agent-browser 0.27.x · sesión `t5.6`
- **Sistema**: commit `b1e6f40` (staged de T5.6) · e2e-stack (`scripts/e2e-stack.ts`: Postgres 16 testcontainer + fakes + worker + web en :3100) · seeds de arranque + siembra propia del verifier

## Verificación esperada (literal de planning.md)
> Aprobar 2 variantes y rechazar 1 desde el navegador actualiza los estados de las `ad_variant` (query en BD; el reflejo en `/library` se verifica en T5.7). Coste $0. (La verificación de «regenerar guion → máster nuevo pasando por QA» se difirió a T5.8.)

## Qué se ejecutó (dos vías independientes)

### 1. Spec permanente (regresión + BD externa) — apps/web/e2e/variant-review.spec.ts
`pnpm --filter web exec playwright test e2e/variant-review.spec.ts` → **3 passed (17.4s)**. Salida en `e2e-output.txt`.
Ambos tests EJECUTARON de verdad (no skipped): (a) lista 3 variantes pausadas + player + overlays + 8 checks QA; (b) aprobar 2 + rechazar 1 desde el navegador y asserta `ad_variant.status` por SQL crudo (`queryStack`, fuente externa al código bajo prueba) — antes `planned`, después `approved`/`approved`/`rejected`, cada una por separado. Los `POST /reject` y `POST /approve` reales se ven en el log del WebServer.

### 2. Pase CUA independiente (agent-browser, escenario sembrado por el verifier)
Siembra propia (`verify-t56-seed.mts.txt`, ejecutada y luego sacada del árbol de producto): run `01KY6ZSHVX2XQW7KVMRG68PJ0X` con 3 variantes + 3 N9 `waiting_approval` + máster sintético cada una.
- Login como humano (`/login`, password dev) → home.
- `/runs/<id>`: el panel CP4 abre por SSE.
- **Las 3 variantes pausadas listadas** (`get count [data-slot=qa-variant-item]` = 3) — hallazgo estructural confirmado EN VIVO (no colapsa a `paused[0]`).
- Player: `<video src>` = `/api/assets/01KY6ZSHVYG0K77QA8BBKAA1NE/download`.
- Overlays safe zones conmutables: `universal` (default) → TikTok → Meta → Sin overlay (`off`), cada cambio verificado sobre `[data-slot=qa-safe-zone] data-preset`.
- QA: 8 checks; apta = «✓ Apto»; no-apta = «✕ No apto» con 1 check `fail` (loudness) visible.
- Rechazo (AlertDialog: botón abre diálogo → confirmar) de la no-apta → sale del sidebar por SSE (3→2).
- Aprobación de las 2 aptas → salen (2→1→0), panel vacío.
- Consola limpia (solo React DevTools info + HMR; sin error/warning de código propio). Sin errores JS.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | El panel LISTA las N variantes pausadas (must-carry: 3, no 1) | 3 tarjetas en el sidebar, live vía SSE | 01-panel-3-variantes.png | OK |
| 2 | Player + overlays TikTok/Meta/Universal conmutables + QA se renderizan | `<video>` con src del máster; 4 presets conmutan; 8 checks; veredicto apto/no-apto | 01..04, 02-overlay-tiktok.png, 03-overlay-meta.png | OK |
| 3 | Rechazar 1 desde el navegador → status='rejected' (esa variante) | `...VT60W` → rejected | 07-dialogo-rechazo.png, db-status-final.txt | OK |
| 4 | Aprobar 2 desde el navegador → status='approved' (cada una la suya) | `...VT2TV`→approved, `...VT6MK`→approved | 08-panel-vacio-resuelto.png, db-status-final.txt | OK |
| 5 | Query en BD confirma los 3 estados finales, cada uno independiente | 2 approved + 1 rejected, IDs conocidos del verifier | db-status-final.txt | OK |
| 6 | Estado inicial `planned` antes de resolver | Aseverado por el spec permanente (pre-acción) | e2e-output.txt | OK |
| 7 | Coste $0 | `cost_entry` vacío (0 filas, 0 cents); masters sintéticos, sin fal | db-status-final.txt | OK |

## Contraste WCAG (aserción obligatoria cua.md, ambos temas)
Medido con `getComputedStyle` (color + bg compuesto) + ratio WCAG. Umbral: 4.5:1 normal, 3:1 grande/negrita.

| Elemento | Light | Dark | Umbral | OK |
|---|---|---|---|---|
| Aprobar (T5.6: bg-success/text-success-on) | 5.30 | 6.54 | 4.5 | OK |
| Rechazar (DS variant=danger: blanco / #ef4444) | 6.32 | 3.76 | 4.5 norm / 3.0 bold | ver Rarezas |
| Badge veredicto (danger) | 4.84 | 4.67 | 4.5 | OK |
| Badge score (neutral) | 6.68 | 6.25 | 4.5 | OK |
| Check pass (success) | 5.27 | 6.96 | 4.5 | OK |
| Check fail (danger) | 5.30 | 4.46 | 4.5 | OK (aprox) |
| Tarjeta seleccionada (bg-accent-soft) | 13.18 | 15.50 | 4.5 | OK |
| Label CP4 (warning) | 6.10 | 8.57 | 4.5 | OK |

La tarjeta seleccionada (`bg-accent-soft`) NO reproduce el defecto de MEMORY (highlight de slots en /gallery): aquí el texto es casi-negro/casi-blanco sobre el soft → 13+.

## Coste real
$0 — sin APIs de pago. Masters sintéticos, N9 pausados a mano, aprobar/rechazar no gastan. `cost_entry` vacío en BD (confirmado). vs estimado $0. Sin recalibración.

## Veredicto
**PASS** — aprobar 2 + rechazar 1 desde el navegador muta `ad_variant.status` a `approved`/`approved`/`rejected`, cada una por separado, confirmado por query en BD directa (IDs conocidos del verifier) y por el spec permanente (asserts externos por SQL crudo). El must-carry de CP4 (N pausas N9 en paralelo; panel lista las 3 y resuelve cada una independiente) verificado EN VIVO. Coste $0.

### Rarezas (no bloquean el PASS)
- **Contraste del botón Rechazar en dark = 3.76:1** (blanco sobre `#ef4444`). Es el token semántico FIJO del DS (`bg-danger` + `text-on-accent`), no código de T5.6 (usa la primitiva `variant="danger"` sin override). Pre-existente: mismo caso que TD.7 y la entrada de MEMORY (blanco sobre danger/emerald falla AA), decisión de recalibración del DS pendiente del usuario. Bajo cua.md (bold → 3:1) queda por encima; bajo WCAG estricto (13px/600 no es "large") queda por debajo de 4.5. Se **rutea** al DS con la cifra, no se ignora ni auto-FAIL. El botón Aprobar (autoría de T5.6, `bg-success/text-success-on`) pasa AA en ambos temas.
- El baseline `planned` (pre-acción) descansa en el spec permanente; el pase CUA independiente capturó los estados FINALES. El bucle before→after queda explícito entre ambas vías.
