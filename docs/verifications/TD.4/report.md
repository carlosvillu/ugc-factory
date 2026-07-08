# Verificación TD.4 — Primitivas fuera del DS + subida a Claude Design

> **CLÁUSULA 1 verificada por el subagente verifier** (CUA de los 9 componentes en
> dark y light + coherencia con foundations; incluye el refix del Progress). La
> **CLÁUSULA 2** (subida vía `DesignSync` + regeneración del espejo local) la
> ejecutó y verificó el **bucle principal** el 2026-07-08 con autorización explícita
> del usuario (`/design-login`) — es la acción de upload, no auto-evaluación de código.
> Ver la sección «Cláusula 2» al final. **TD.4 completa: PASS.**

- **Tarea**: TD.4 · Primitivas fuera del DS (`planning.md` línea 150)
- **Fecha**: 2026-07-08 (re-verificación tras fixes F1 y F2)
- **Ejecutor**: subagente verifier · chrome-devtools-mcp (conexión CDP persistente)
- **Sistema**: commit HEAD `0a1e330` · working tree SIN commitear = el diff bajo verificación (9 componentes en `apps/web/src/components/ui/` + `overlay-specimens.tsx` + `globals.css` + `design-system/page.tsx`; toast.tsx y tooltip.tsx re-tocados por el fix) · superficie 100% frontend
- **Entornos**: dev (`next dev`) para el grueso de la cláusula 1; **build de producción (`next build && next start`)** para el criterio de consola del toast (F1) y re-verificación de fixes

## Verificación esperada (literal de planning.md)
> CUA revisa las secciones nuevas en dark y light (coherencia con las foundations); `DesignSync list_files` muestra los ficheros nuevos en el proyecto y el espejo local se regenera incluyéndolos.

**Cláusula 1 verificada**: *"CUA revisa las secciones nuevas en dark y light (coherencia con las foundations)"*. Cláusula 2 (`DesignSync` + espejo) NO evaluada.

## Historial
- **1ª pasada (FAIL)**: 12/14 OK; bloquearon **F1** (error de consola `flushSync` en cada toast) y **F2** (tooltip sin `role="tooltip"` ni asociación aria).
- **2ª pasada (esta, PASS)**: el implementer corrigió F2 (role+id+aria-describedby vía useId) y el bucle decidió el criterio de F1 (regla 6): el warning `flushSync` es de dentro de Base UI (ToastRoot mide altura en un layout effect), dev-only (StrictMode x2, strippeado en prod) y dependencia de terceros fijada -> se evalúa la consola del toast contra el **build de producción**, no contra dev.

## Nota sobre herramienta y gate
- **chrome-devtools-mcp** (conexión CDP única) como driver: agent-browser (default de cua.md) resultó inservible para overlays de Base UI (se cerraban entre procesos). El click sigue siendo humano-equivalente (hit-tested vía CDP), no un `eval` que simule el click.
- **Gate previo (`pnpm gate`)**: NO ejecutado — verificación PARCIAL acotada a la cláusula 1 CUA; el gate completo lo corre el bucle en el CLOSE. Se anota para trazabilidad. (El `next build` de esta pasada compiló y pasó TypeScript sin errores.)

## Resultado observado vs esperado (cláusula 1)

| # | Componente / aspecto | Esperado (foundations) | Observado | Evidencia | OK |
|---|---|---|---|---|---|
| 1 | Dialog | role=dialog, foco inicial dentro + retorno, Escape cierra, labelledby/describedby, ✕ Unicode, scrim --overlay, 1px, r-lg, sólido, sin gradiente/blur, focus-ring | Confirmado en dark y light (dev + prod). Escape cierra y devuelve foco al trigger. Ring-3 indigo al tabular. | d01, d02, d03, a11y-dumps.md | OK |
| 2 | Sheet | drawer lateral, mismo contrato a11y, 1px, sólido, sin blur | role=dialog, labelledby/describedby, anclado derecha, borde 1px, sólido, sin blur | s01 | OK |
| 3 | Alert dialog | role=alertdialog, NO cierra al click-fuera, sin ✕, cierra por botón | role=alertdialog; control diferencial: el click-fuera cierra el Dialog pero NO el AlertDialog (dev y prod); "Volver" cierra y devuelve foco | ad01, a11y-dumps.md | OK |
| 4 | Toast (visual + tokens) | superficie sólida sin glass, 1px, r-lg, barra acento 4px semántica, glifos Unicode | Card renderiza (384px); bg sólido, sin gradiente/blur, border 1px, r-lg, barra --success/--danger, ✕ | t03, tp01, a11y-dumps.md | OK |
| 5 | Toast (aria-live) | polite/assertive por prioridad | viewport live=polite; prioridad alta emite role=alert assertive | a11y-dumps.md | OK |
| 6 | Toast (consola) | sin errores rojos en PROD (criterio del bucle, regla 6) | build de prod: 0 errores / 0 warnings tras disparar los 4 toasts (el flushSync es dev-only de Base UI) | a11y-dumps.md re-verif | OK (F1) |
| 7 | Tooltip (hover+foco+Escape+estilos) | aparece en hover Y foco, Escape cierra, surface-3/border-strong 1px/r-md/sin glass | Aparece en hover y en foco de teclado; Escape cierra; estilos correctos | ttp01, ttp02 | OK |
| 8 | Tooltip role=tooltip + asociación | role=tooltip en hover y foco; asociado al trigger | popup role=tooltip id="_R_cm5fivb_"; trigger aria-describedby == id del popup; verificado en HOVER y en FOCO de teclado (matchOnFocus=true) | a11y-dumps.md re-verif | OK (F2) |
| 9 | Skeleton | surface-3 plano, sin gradiente/shimmer, aria-hidden | bg surface-3, bgImage none, animación de opacidad (ugc-skeleton), aria-hidden=true | pr01, st01 | OK |
| 10 | Progress (3 estados) | value proporcional; null=segmento en movimiento (no lleno); 100=lleno; role=progressbar | 66->66% track; null->segmento 33% animado (ugc-progress-indeterminate); 100->lleno; role=progressbar+aria-valuenow (reconfirmado en prod) | pr01, st01, a11y-dumps.md | OK |
| 11 | Card | 1px border, r-lg, shadow-sm, header/body/footer con hairlines | sólido, border 1px, r 10px, shadow-sm, hairlines internos | st01 | OK |
| 12 | Separator | role=separator, 1px, horizontal y vertical | role=separator; horizontal h=1px, vertical w=1px; token --border | st01, a11y-dumps.md | OK |
| 13 | Scrim dark Y light | --overlay oscurece en ambos temas | rgba(0,0,0,0.34) en dark y light (reconfirmado en prod); oscurece el fondo en ambos | d01, d03, ad01, s01 | OK |
| 14 | prefers-reduced-motion | sheet sin deslizar, skeleton/progress sin animar | Regla @media presente en CSS servido (dev y prod): silencia skeleton/pulse/progress-indicator y quita transition/transform a los popups | a11y-dumps.md | OK |

## Fixes verificados
- **F1 (RESUELTO por criterio de prod)**: la consola del build de producción queda **limpia** (0 errores/warnings) tras disparar los 4 toasts. El warning `flushSync` es dev-only, interno de Base UI (`ToastRoot` mide altura en layout effect), StrictMode x2, y no sobrevive a prod. Decisión del bucle (regla 6, anotada en cua.md/Verificación): dependencia de terceros que desaparece en prod NO bloquea. Sin errores de código propio.
- **F2 (RESUELTO)**: el popup del tooltip expone `role="tooltip"` con `id` (useId) y el trigger lleva `aria-describedby` apuntando a ese id (match exacto), tanto en hover como en foco de teclado; Escape cierra; estilos DS intactos.

## Rarezas (no bloquean)
- **`aria-modal` ausente** en dialog/sheet/alert-dialog: efecto modal logrado vía `inert` (el fondo sale del árbol a11y + foco atrapado, verificado). Mecanismo distinto al que sugiere el comentario del código; alinear comentario a criterio del implementer. Sin impacto funcional.
- Toast/tooltip transitorios: evidencia fiable vía MutationObserver + medición por getBoundingClientRect/estilos computados (inspección/medición, permitida).

## Coste real
$0 — verificación 100% local (chrome-devtools-mcp contra dev y contra `next start`), sin APIs de pago (vs estimado $0).

## Veredicto (cláusula 1)
**PASS** — Los 9 componentes son coherentes con las foundations en dark y light (hairlines 1px, radios 5/7/10px, sin glassmorphism ni gradientes, fondos sólidos de token, glifos Unicode, scrim --overlay en ambos temas), y el contrato a11y pasa completo (dialog/sheet/alert-dialog roles+foco+Escape+retorno+inert, alert no cierra al click-fuera, tooltip role=tooltip asociado en hover y foco, progress 3 estados, toast aria-live, separator/progressbar, focus-ring ring-3, reduced-motion). Los dos hallazgos de la 1ª pasada están resueltos: F2 con la asociación aria del tooltip, y F1 confirmado limpio en el build de producción.

**Cláusula 2 (DesignSync / espejo): PENDIENTE — no evaluada (fuera de alcance).** Antes de marcar TD.4 [x] completa, el bucle debe ejecutar la cláusula 2 (upload + regeneración del espejo) con autorización del usuario.

---

## Cláusula 2 — Subida a Claude Design + regeneración del espejo (bucle principal, 2026-07-08)

**Ejecutor**: bucle principal (la subida es la acción autorizada por el usuario vía `/design-login`; no es auto-evaluación de código — el implementer nunca tuvo la tool). **Verificación literal**: «`DesignSync list_files` muestra los ficheros nuevos en el proyecto y el espejo local se regenera incluyéndolos».

**Qué se subió** al proyecto «UGC Factory Design System» (`d126b2f1-3ada-48c5-84fa-914e891fea6f`), plan `plan_d126b2f13ada48c5_471bcca91b39`, 37 ficheros escritos (`write_files` → `{"written":37}`):
- 5 componentes overlay × 4 ficheros (.jsx/.d.ts/.prompt.md/.card.html) → `components/overlay/` (Dialog, Sheet, AlertDialog, Toast, Tooltip).
- 4 componentes structure × 4 ficheros → `components/structure/` (Skeleton, Progress, Card, Separator).
- `tokens/colors.css` con el token nuevo `--overlay` (`rgba(0,0,0,0.34)` en `:root` y en `[data-theme="light"]`) — sin él las cards de dialog/sheet/alert-dialog renderizarían el scrim indefinido (hallazgo ALTA de la review).

**Resultado por punto**:
| Punto | Esperado | Observado | OK |
|---|---|---|---|
| list_files remoto muestra los nuevos | overlay/ + structure/ en el proyecto | `list_files` devuelve los 36 ficheros + tokens/colors.css actualizado | ✅ |
| Espejo local regenerado | docs/design-system/ incluye los 9 | `components/overlay/` (20 ficheros) + `components/structure/` (16) copiados; `tokens/colors.css` con `--overlay`; staging `_staging-td4` eliminado | ✅ |

**Grupos nuevos**: `Overlay` y `Structure` no existían antes en el proyecto (los grupos previos —Core/Forms/Feedback/Navigation/Data/Product— quedan intactos).

**Rareza conocida (no bloquea la cláusula)**: las `.card.html` nuevas cargan `../../_ds_bundle.js`, un compilado que solo se regenera del lado de Claude Design (no lo produce la subida de ficheros). Hasta que ese bundle se recompile en el proyecto, las cards nuevas pueden renderizar en blanco en la galería aunque los `.jsx`/`.d.ts`/`.prompt.md` estén subidos y correctos. Es el mismo límite del espejo que afecta a TD.1–TD.3 localmente; los ficheros-fuente sí están completos y verificados.

**Deuda de tokens de TD.5 (fuera de este bundle)**: los componentes de producto (TD.5) introdujeron más foundations (`--overlay-strong`, `pulse-ring-static` + vars por estado, `hatch-9x16`/`-wide`, `caption-shadow`) que NO se suben aquí — el bundle de TD.4 solo usa `--overlay`. Se subirán cuando/si los componentes de producto se suban al DS (no está en el alcance de TD.4).

## Veredicto final TD.4: **PASS** (cláusula 1 + cláusula 2)
