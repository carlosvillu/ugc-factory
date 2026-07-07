# TD.4 — volcados de árbol de accesibilidad y mediciones (cláusula 1)

Capturados con chrome-devtools-mcp (conexión CDP persistente) contra el sistema
levantado en http://localhost:3000/design-system, commit `0a1e330` (working tree
sin commitear = el diff bajo verificación).

## Dialog (abierto, dark)

Árbol a11y (snapshot con el dialog abierto):

```
dialog "Editar brief" description="Ajusta los beneficios y el hook antes de aprobar. Los cambios crean una versión nueva."
  button "Cerrar" focusable focused          ← foco inicial DENTRO del dialog
  heading "Editar brief" level=2
  StaticText "Ajusta los beneficios..."
  button "Cancelar"
  button "Guardar"
```

Atributos del elemento role=dialog:
```
role="dialog"  tabindex="-1"  aria-labelledby="base-ui-_r_1_"  aria-describedby="base-ui-_r_2_"
class="... rounded-lg border border-border bg-surface p-6 shadow-lg outline-none focus-visible:ring-3 focus-visible:ring-ring ..."
aria-modal = (ausente)   ← ver rareza en report.md; el fondo SÍ sale del árbol a11y (inert), efecto modal presente
```

Estilos computados (dark):
- popup: borderTopWidth 1px · borderRadius 10px (=--r-lg) · backgroundColor rgb(20,20,22) sólido · backgroundImage none · backdropFilter none
- backdrop (scrim): backgroundColor rgba(0,0,0,0.34) (=--overlay) · backdropFilter none
- close glyph: "✕"

Estilos computados (light): popupBg rgb(255,255,255) · bgImage none · border 1px · radius 10px · backdropFilter none · scrim rgba(0,0,0,0.34)

Focus ring (Tab → botón "Cancelar"): boxShadow incluye `rgba(99,102,241,0.4) 0px 0px 0px 3px` = ring-3 ring-ring (acento indigo).

Escape: dialogCount 1→0 y foco DEVUELTO al trigger "Editar brief" (activeIsTrigger=true).

## Sheet (abierto, light)

```
dialog "Logs del nodo N7d" description="Salida del executor de b-roll para la variante en curso."
  button "Cerrar" focusable focused
  heading "Logs del nodo N7d" level=2
  ...
```
role=dialog · aria-labelledby ✓ · aria-describedby ✓ · bg rgb(255,255,255) · bgImage none · backdropFilter none · borderLeft 1px (anclado a la derecha, anchoredRight=true) · clase ring-3 ring-ring presente.

## Alert dialog (abierto, dark y light)

```
alertdialog "Cancelar el lote en curso" description="Se detendrán los 6 steps en ejecución. Esta acción no se puede deshacer."
  heading "Cancelar el lote en curso" level=2
  StaticText "..."
  button "Volver" focusable focused
  button "Sí, cancelar"
```
role=alertdialog ✓ · aria-labelledby/-describedby ✓ · SIN ✕ (fuerza elección) ✓.

Prueba "no cierra al click-fuera" (control diferencial, misma mecánica sintética
de pointerdown/up+click sobre el elemento tope en (100,100), fuera del popup):
- AlertDialog → sigue ABIERTO (count sigue 1, data-open presente).
- Dialog normal (control) → CIERRA (count 1→0).
  ⇒ el evento SÍ alcanza la lógica de dismiss (cierra el Dialog), por lo que la
    resistencia del AlertDialog es real y no un artefacto del evento sintético.
Cierre por botón "Volver" → cierra y devuelve foco al trigger. ✓

## Toast (dark) — capturado con MutationObserver sobre el viewport

El card del toast se monta y renderiza (rectWidth 384px), auto-descarta rápido.
Card danger ("Generación fallida"):
- bg rgb(20,20,22) sólido · bgImage none · backdropFilter none · border 1px · radius 10px
- barra de acento izquierda (toast-bar) backgroundColor rgb(239,68,68) = --danger
- close glyph "✕"
Regiones aria-live: viewport "Notifications" live=polite (prioridad normal);
prioridad alta (Error) emite además role=alert aria-live=assertive.
⇒ contrato polite/assertive por prioridad ✓.

## Tooltip (dark) — hover y foco de teclado

- Hover: aparece el popup con el texto ("Reintentar el step fallado" / "Coste real del lote: $2.14").
- Foco de teclado (Tab real → focus-visible): aparece el popup (tooltipShown=true). ✓
- Escape: cierra el popup (tooltipAfterEscape=false). ✓
- Estilos: rounded-md · border border-border-strong (1px hairline) · bg-surface-3 · shadow-md · sin gradiente · sin blur. ✓
- DESVIACIÓN a11y (ver report): el popup NO lleva role="tooltip"
  (data-slot="tooltip-popup" con role=null; 0 elementos [role=tooltip] en la página).
  Además el trigger NO tiene aria-describedby y el popup no tiene id → el texto del
  tooltip NO está asociado programáticamente al trigger para lectores de pantalla.

## Progress — 3 estados (role=progressbar)

| Estado | role | aria-valuenow | ancho indicador / track | animación | veredicto |
|---|---|---|---|---|---|
| value=66 | progressbar | 66 | 252/384 = 66% (proporcional) | none | ✓ |
| value=null (indeterminado) | progressbar | (null) + data-indeterminate | 127/384 = 33% (segmento corto, NO lleno) | ugc-progress-indeterminate (se mueve) | ✓ |
| value=100 | progressbar | 100 | ~99–100% (lleno) | none | ✓ |

El indeterminado es claramente distinto de "completado" (segmento corto en
movimiento, no barra llena estática). Fix reciente confirmado.

## prefers-reduced-motion — reglas en el CSS servido

chrome-devtools-mcp no expone emulación de prefers-reduced-motion; según cua.md /
brief, se confirma en el CSS servido. Regla @media (prefers-reduced-motion: reduce)
presente en el stylesheet servido:
- silencia `.animate-skeleton` y `.animate-pulse-ring` (animation: none)
- silencia `[data-slot="progress-indicator"]` (animation: none) → indeterminado queda segmento estático parcial
- `[data-slot="dialog-popup"|"alert-dialog-popup"|"sheet-popup"]` → transition:none; transform:none → el sheet aparece sin deslizarse

## Consola del navegador

En carga limpia (sin interacción): 0 errores / 0 warnings.
Abrir+cerrar Dialog y Sheet aislados: 0 errores.
Al disparar UN toast (cualquier tipo): aparece
  [error] flushSync was called from inside a lifecycle method. React cannot flush
  when React is already rendering... [2 veces por toast]
⇒ error de consola REAL, exclusivo del componente Toast (Base UI Toast manager
  llamando flushSync dentro de un ciclo de vida de React, según toast.tsx).

---

# RE-VERIFICACIÓN (2026-07-08) — fixes F1 y F2 contra BUILD DE PRODUCCIÓN

`next build && next start` (Next 16.2.10) en localhost:3000. Mismo working tree
(SHA HEAD 0a1e330; toast.tsx y tooltip.tsx modificados en el árbol de trabajo).

## F1 — consola limpia en PRODUCCIÓN (nuevo criterio del bucle)
- Carga limpia de /design-system en prod: 0 mensajes de consola.
- Disparados los 4 toasts (Éxito/Aviso/Error/Info): consola sigue con **0 errores / 0 warnings**.
- El warning `flushSync` (dev-only, de dentro de Base UI ToastRoot que mide altura en
  un layout effect; el 2× era StrictMode) NO aparece en prod (react-dom lo strippea).
- Criterio del bucle (regla 6, cua.md): warning de dependencia de terceros que
  desaparece en prod NO bloquea el PASS. Confirmado limpio en prod. ⇒ F1 RESUELTO.
- Toast card en prod (via MutationObserver): title "Lote publicado", ✕, bg rgb(20,20,22)
  sólido, bgImage none, backdropFilter none, border 1px, radius 10px,
  barra --success rgb(34,197,94), rectWidth 384. Sin regresión visual.

## F2 — tooltip role=tooltip + asociación aria (hover Y foco de teclado)
Árbol de accesibilidad con el tooltip abierto (HOVER):
```
button "Reintentar" description="Reintentar el step fallado"   ← trigger con descripción accesible
tooltip "Reintentar el step fallado"                            ← popup role=tooltip
```
DOM (hover): popup role="tooltip" id="_R_cm5fivb_"; trigger [data-slot="tooltip-trigger"
aria-label="Reintentar"] aria-describedby="_R_cm5fivb_" → **id del popup == aria-describedby
del trigger** (match exacto, 1 solo [role=tooltip] en la página).
Estilos: bg rgb(33,33,38) (surface-3), bgImage none, backdropFilter none, border 1px
(border-strong), radius 7px (=--r-md). Sin glass/gradiente.

FOCO DE TECLADO (Shift+Tab hasta el trigger, focus-visible):
- activeElement = tooltip-trigger "Reintentar", aria-describedby="_R_cm5fivb_"
- popup role=tooltip id="_R_cm5fivb_", matchOnFocus=true, texto "Reintentar el step fallado"
- Foco visible con ring indigo (ver ttp02).
- Escape cierra el tooltip (tooltipAfterEscape=false).
⇒ F2 RESUELTO en hover Y en foco de teclado.

## Reconfirmación del resto (contra el build de PROD) — sin regresiones
- Dialog: role=dialog, labelledby/describedby, foco inicial en "Cerrar", ✕, bg sólido
  rgb(20,20,22) sin gradiente/blur, border 1px, r-lg 10px, scrim rgba(0,0,0,0.34).
  Tab → botón con ring-3 indigo `rgba(99,102,241,0.4) 0px 0px 0px 3px`. Escape cierra
  y devuelve foco al trigger. ✓
- Alert dialog: role=alertdialog; outside-press sintético (mecánica validada por control
  diferencial en la sesión previa) → sigue ABIERTO (count 1→1); botón "Volver" cierra y
  devuelve foco al trigger. ✓
- Progress: determinado value=66 → 66% del track, role=progressbar, sin gradiente;
  indeterminado value=null → segmento 33% animado (ugc-progress-indeterminate),
  data-indeterminate, sin gradiente (distinto de lleno). ✓
- prefers-reduced-motion: regla @media presente en el CSS servido en prod
  (silencia skeleton, progress-indicator y transition/transform de los popups). ✓
- Scrim en LIGHT (prod): dialog bg rgb(255,255,255), sin gradiente/blur; scrim
  rgba(0,0,0,0.34) oscurece la página clara. ✓ (dark ya confirmado arriba)

Evidencia nueva: tp01-toast-prod-4toasts.png, ttp01-tooltip-prod-hover.png,
ttp02-tooltip-prod-focus.png (+ consola prod limpia, dumps a11y arriba).
