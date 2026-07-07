# Verificación TD.2 — Primitivas core y formularios

- **Tarea**: TD.2 · Primitivas core y formularios (`planning.md`)
- **Fecha**: 2026-07-07
- **Ejecutor**: verifier (contexto fresco) · agent-browser 0.27.x · sesiones `tTD2`/`tTD2b` (1ª pasada, FAIL) y `tTD2c` (re-verificación tras fix, PASS)
- **Sistema**: commit `8803097` + diff sin commitear de TD.2 (7 componentes en `apps/web/src/components/ui/`, `component-specimens.tsx`, `components.json`, `lib/utils.ts`) · `pnpm --filter @ugc/web dev` (Next 16.2.10, Turbopack) · sin BD/seeds (página estática `/design-system`)
- **Gate previo**: `pnpm gate` en verde re-ejecutado tras el fix (lint + typecheck + format:check + knip + 30 tests).

## Verificación esperada (literal de planning.md)
> CUA compara las secciones con `buttons.card.html` y `form-fields.card.html` en dark Y light: variantes y estados hover/focus/disabled/loading fieles; todos los controles operables por rol y accessible name.

## VEREDICTO: PASS (con una decisión para el bucle, ver abajo)

**Decisión para el bucle/usuario (no la absorbe el verifier)**: la Verificación
literal pide comparar contra `buttons.card.html`/`form-fields.card.html`, pero esas
cards son INEJECUTABLES tal cual: cargan `../../_ds_bundle.js`, ausente del espejo
read-only, así que renderizan en blanco (verificado). El A/B visual directo contra
la card no es posible; se sustituyó por comparación contra las specs `.jsx` que las
cards importan (misma fuente) + medición en runtime de colores/dimensiones/atributos.
La sustitución es rigurosa y el PASS es defendible en sustancia, pero **el bucle debe
confirmar esta sustitución o ajustar la redacción del planning (regla de trabajo 6)**
— el verifier no edita `planning.md`. TD.1 topó con la misma limitación del espejo.

La 1ª pasada dio FAIL por un `Checkbox` etiquetado que no toggleaba al click de
ratón (doble activación por el wrapper `<label>`). El implementer lo corrigió:
el checkbox etiquetado se renderiza ahora como un ÚNICO `<button role="checkbox">`
(`nativeButton render={<button type="button">}`) con la caja + el texto dentro
del mismo control → un único camino de activación. Re-verificado el flujo COMPLETO
(no solo el checkbox) en dark y light: PASS.

### Verificación del fix (click de puntero REAL, no `.click()` sintético)
El toggle del nuevo `<button role=checkbox>` NO se dispara con el click sintético
de agent-browser (confirmado: `click @e32` no cambió `aria-checked`). Se usó por
tanto la secuencia de puntero real vía CDP (`mouse move → down → up`) midiendo
`aria-checked` antes/después. Cada click bien apuntado togglea EXACTAMENTE una vez:

| Tema | Objetivo del click | Antes → Después | OK |
|---|---|---|---|
| Dark | Reels — caja | false → true; true → false (2 clicks) | 1 toggle/click |
| Dark | TikTok — texto | false → true; true → false | 1 toggle/click |
| Dark | Reels — texto | false → true | 1 toggle/click |
| Light | TikTok — caja | true → false | 1 toggle/click |
| Light | TikTok — texto | false → true | 1 toggle/click |
| Light | Reels — texto | true → false | 1 toggle/click |

(Los intentos intermedios que "no toggleaban" fueron deriva de coordenadas: la
fila se re-maqueta cuando un checkbox pasa a checked/unchecked, moviendo el centro
del texto; recalculando `getBoundingClientRect` justo antes de cada click, todos
togglean una vez. No hay doble toggle.)
Evidencia: `10-dark-checkbox-toggle.png`, `12-light-checkbox-toggle.png`.

### El fix no rompió lo demás (checkbox)
- `role="checkbox"` con accessible name intacto en el árbol: `checkbox "TikTok"`,
  `checkbox "Reels"` (el ✓ es `aria-hidden`, no contamina el nombre). tag = BUTTON.
- Caja del indicador 18×18px (medido), glifo ✓ `aria-hidden=true`.
- Focus ring OBSERVADO (no inferido) con foco por teclado real (`Tab`): con la
  navegación por teclado sobre el checkbox, `el.matches(':focus-visible')`=true y
  el indicador renderiza `box-shadow: rgba(99,102,241,0.4) 0 0 0 3px` (anillo DS
  ring-3 ring-ring) + borde accent `rgb(99,102,241)`. El selector de descendiente
  arbitrario reescrito (`focus-visible:[&_[data-slot=checkbox-indicator]]:ring-3`)
  emite CSS de verdad. Visible en `15-dark-checkbox-focus-ring.png`.
Evidencia: `15-dark-checkbox-focus-ring.png`, `a11y-dark-v2.txt`, `a11y-light-v2.txt`.

### Los otros 6 controles siguen fieles y operables (re-verificado)
- **Button**: 5 variantes × sm/md/lg + loading + icon, dark y light. Hover MEDIDO:
  rest `#6366f1` (`--accent`) → hover `#7c80f6` (`--accent-hover`). Focus ring DS
  en botón e input. Disabled/loading correctos. Dimensiones icon 28/34/34.
- **Input/Textarea**: mono, focus ring, error (borde danger), disabled.
- **Select**: role=combobox, ▼ glifo, operable por teclado.
- **Switch**: click togglea (C2PA false→true en light); track 38×22.
- **Slider**: teclado ArrowRight 4→6 (dark y light); nombre en el nodo role=slider.
Evidencia: `14-dark-full-v2.png`, `13-light-full-v2.png`, `08-light-buttons.png`,
`03/05` (hover/focus), a11y v2.

## Nota de método sobre las referencias `.card.html`
`buttons.card.html`/`form-fields.card.html` NO son renderizables: su `<head>` carga
`../../_ds_bundle.js` (define `window.UGCFactoryDesignSystem_d126b2`) y ese bundle
NO existe en el espejo (dump read-only sin el compilado). La comparación se hace
contra las specs `.jsx` que esas cards importan (misma fuente) + medición runtime;
contenido y estado inicial del specimen coinciden 1:1 con el `<Demo>` de cada card.
Limitación conocida del espejo, ya reportada; TD.1 topó con lo mismo.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Button 5 variantes × sm/md/lg + loading + icon | Correctos dark y light | 14, 08 | OK |
| 2 | Estado hover fiel | rest `#6366f1` → hover `#7c80f6`, medido | eval | OK |
| 3 | Estado focus fiel | Anillo DS único en botón e input | 04, 05 | OK |
| 4 | Estado disabled fiel | surface-3/text-4, opacidad 0.6 | 14, 08 | OK |
| 5 | Estado loading fiel | Spinner, disabled, aria-busy | 14, 08 | OK |
| 6 | 6 controles de formulario fieles | Input/Textarea/Select/Switch/Checkbox/Slider fieles | 14, 13 | OK |
| 7 | Comparación dark Y light | Switcher conmuta data-theme; ambas superficies correctas | 14 (dark), 13 (light) | OK |
| 8 | Dimensiones: icon 28/34/34, switch 38×22, thumb 18 on, checkbox 18 | Medido idéntico | eval | OK |
| 9 | Controles operables por ROL | button/textbox/combobox/switch/checkbox/slider expuestos | a11y v2 | OK |
| 10 | Controles con ACCESSIBLE NAME | Todos con nombre (incl. checkbox "TikTok"/"Reels", icon buttons, inputs error/disabled) | a11y v2 | OK |
| 11 | Slider: nombre en nodo role=slider | `slider "Concurrencia de render"`; teclado 4→6 | a11y v2 | OK |
| 12 | **Checkbox operable por click (interacción primaria)** | **Click de puntero real togglea 1 vez (caja Y texto, dark y light)** | 10, 12 | OK |
| 13 | Sin errores en consola | Solo info React DevTools + HMR | browser-console-v2.txt | OK |

## Otras desviaciones (no bloqueantes)
- **Select nativo** en vez de Base UI (documentado en `select.tsx`): 1:1 con la card y accesible (role=combobox, teclado). No afecta la Verificación literal.
- El click SINTÉTICO de agent-browser no dispara el `nativeButton` del checkbox; se requiere secuencia de puntero real. Es artefacto del harness de test, no del producto — un usuario con ratón real togglea (eventos de puntero confiables). Documentado para futuras verificaciones de componentes `nativeButton`.

## Coste real
$0 — sin APIs de pago (agent-browser local, página estática). vs estimado $0.

## Resumen
Tras el fix del checkbox, la Verificación literal se cumple ENTERA en dark y light:
variantes y estados hover/focus/disabled/loading fieles; los 7 controles operables
por rol y accessible name; y el checkbox etiquetado ahora togglea exactamente una
vez con un click de puntero real sobre la caja o el texto, sin romper su nombre
accesible, tamaño ni focus. Consola limpia. Coste $0. **PASS.**
