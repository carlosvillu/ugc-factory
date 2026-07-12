# Verificación T1.12 — Contraste WCAG AA de los tokens semánticos en tema claro

- **Tarea**: T1.12 · Contraste WCAG AA de los tokens semánticos en tema claro (`planning.md`)
- **Fecha**: 2026-07-12
- **Ejecutor**: subagente `verifier` · agent-browser 0.27.x · sesión `t1.12` · + Playwright (stack E2E con fakes)
- **Sistema**: base `ef4f89a` + los 4 ficheros de T1.12 sin commitear (`globals.css`, `foundation-specimens.tsx`, `colors-semantic.card.html`, `tokens/colors.css`). Docker compose dev (pg16) + `pnpm dev` en **:3001** con `INTERNAL_API_URL=http://localhost:3001` · CP1 sobre el **stack E2E (:3100) con las APIs de pago FALSAS** ⇒ **$0**.
- **Gate previo**: `pnpm gate` en **verde** (lint + typecheck + format + knip + 916 tests / 93 ficheros).

## Verificación esperada (literal de planning.md)

> En `/design-system` y en CP1 (`/runs/:id` con N3 pausado), en tema **light**, los badges `success`/`violet`/`info` miden **≥4,5:1** con un medidor de contraste real (no a ojo), y **siguen ≥4,5:1 en dark**; evidencia con los ratios medidos antes/después en `docs/verifications/T1.12/`. Ninguna otra página del DS regresiona (recorrido CUA del showcase en ambos temas).

---

## VEREDICTO: **FAIL**

Los badges que la Verificación **nombra**, en las páginas que **nombra**, medidos con un medidor real sobre las superficies en las que **realmente se pintan**, no llegan a 4,5:1 en light:

| dónde | badge | superficie REAL (medida, no supuesta) | ratio | ¿AA? |
|---|---|---|---|---|
| **CP1** `/runs/:id` | **`✓ extraído` (success)** | `--surface-2` #f7f7f9 (el `fieldset` del bloque PRODUCTO) | **4,28:1** | ❌ |
| **`/design-system`** | **`✓ extraído` (success)** | `--bg-subtle` #f4f4f6 | **4,20:1** | ❌ |
| **`/design-system`** | **`i` (info)** | `--bg-subtle` #f4f4f6 | **4,15:1** | ❌ |

Son **0,22–0,35 por debajo** del umbral: no hay ambigüedad de método ni de redondeo (fallan también con aritmética de coma flotante). `violet` es el único de los tres nombrados que aguanta (4,60 en CP1).

**El arreglo va en la dirección correcta y el `--success-on` invertido SALVÓ el botón** (5,27:1 en light, §3) — eso está bien resuelto. Lo que falla es la **calibración**: los cinco tonos se ajustaron contra **una sola superficie (blanco puro)** y con **margen cero** (4,52–4,60), pero la app pinta estos badges sobre **tarjetas neutras más oscuras que el blanco**, donde el mismo token cae 0,3–0,4 puntos.

---

## Preempción de la réplica obvia: «pero sobre `--surface` sí pasan»

Es cierto, y por eso hay que decirlo explícito: sobre `--surface` (#ffffff) los tres nombrados **pasan** (success 4,60 · info 4,52 · violet 5,01). El brief de la tarea decía «compuesto sobre `--surface`» — pero eso era **una suposición sobre dónde vive el badge, y la realidad la contradice**:

- En **CP1**, el badge `✓ extraído` se compone sobre **`--surface-2` (#f7f7f9)**, no sobre blanco. No es una deducción de la captura: es la **cadena de ancestros volcada del DOM vivo** (`cp1-badge-ancestor-chain.txt`) — `span.badge(rgba(21,124,59,0.1))` → `fieldset.bg-surface-2 rgb(247,247,249)` = primer opaco. Un `fieldset` neutro y corriente, sin ningún lavado de color.
- En **`/design-system`**, de los 28 badges pintados en light, **15 se apoyan en `--bg-subtle` (#f4f4f6)** y solo 13 en blanco. La superficie **más común** es la que peor puntúa.

Medir el token sobre un `--surface` idealizado en lugar de sobre el badge **tal como se renderiza** sería repetir **exactamente el error de aislamiento que esta tarea existe para cazar** (el linaje de TD.7: medir el token suelto en vez del par real). La cláusula que manda es la de la Verificación: «los badges … **en CP1** … miden ≥4,5:1 **con un medidor de contraste real**». Con un medidor real, en CP1, el badge success da **4,28**.

---

## Cómo he medido

El par que renderiza un `Badge` es `--<fam>` como **TEXTO** sobre `--<fam>-soft` (el mismo tono al alfa `0x1a`) **compuesto sobre el primer ancestro OPACO**. Detalles que importan:

1. **El alfa real es `0x1a` = 26/255 = 0,10196**, no 0,10.
2. **La superficie se descubre caminando el DOM**, no se asume. (Los scripts `check.mjs`/`solve.mjs` del implementer **asumen blanco**: ésa es justamente la suposición que escondía el fallo, así que **no los he usado como base del veredicto**.)
3. **El navegador rasteriza a canales ENTEROS.** He compuesto el mismo apilamiento en un `<canvas>` y leído el píxel, que es lo que el ojo ve. Efecto: la aritmética en coma flotante lee **~0,015–0,03 de más** que la pantalla.

Medidores propios, todos ejecutados **en el navegador con el CSS real aplicado**: `verifier-canonical.js`, `verifier-measure.js`, `cp1-contrast.spec.ts`.

---

## 1) `/design-system` · los 5 tokens, ANTES vs DESPUÉS, en los DOS temas

### LIGHT (el entregable) — par del badge, rasterizado real

| familia | ANTES (dark reusado en light) | sobre `--surface` #fff | sobre `--bg` #fbfbfc | sobre `--surface-2` #f7f7f9 | sobre `--bg-subtle` #f4f4f6 | sobre `--surface-3` #eeeef1 | ¿AA en las reales? |
|---|---|---|---|---|---|---|---|
| `success` `#157c3b` | 2,09 | 4,60 ✅ | 4,44 ❌ | **4,29 ❌** | **4,20 ❌** | 3,99 ❌ | ❌ |
| `warning` `#986206` | 1,99 | **4,4888 ❌** | 4,33 ❌ | 4,22 ❌ | 4,11 ❌ | 3,92 ❌ | ❌ |
| `danger` `#d31212` | 3,30 | 4,58 ✅ | 4,41 ❌ | 4,28 ❌ | 4,18 ❌ | 3,98 ❌ | ❌ |
| `info` `#0b62ef` | 3,27 | 4,52 ✅ | 4,37 ❌ | 4,25 ❌ | **4,13 ❌** | 3,95 ❌ | ❌ |
| `violet` `#6b3bf7` | 2,49 | 5,01 ✅ | 4,84 ✅ | 4,71 ✅ | 4,58 ✅ | 4,37 ❌ | ✅ (salvo surface-3) |

**Todas esas superficies son reales y están en uso.** Las columnas que deciden son `--surface-2` (donde vive el badge de CP1) y `--bg-subtle` (donde se apoyan 15 de los 28 badges del showcase).

Nota sobre **`warning` = 4,4888 sobre blanco puro**: es tan justo que **falla incluso en la mejor superficie posible** en cuanto se cuenta el rasterizado a 8 bits (la coma flotante da 4,5038 y «pasa»). Lo dejo como **dato de apoyo**, no como pilar del veredicto — el veredicto se sostiene solo con los 4,28/4,20/4,15, que fallan con cualquier método.

- Evidencia: `measure-ds-light.txt`, `measure-ds-light-dom.txt`, `measure-light-all-surfaces.txt`, `handcheck-light.txt`, `02-ds-light.png`.

### DARK (cláusula de NO-REGRESIÓN) — ✅ no regresiona

| familia | dark, sobre `--surface` | ¿AA? |
|---|---|---|
| `success` `#22c55e` | 6,93 | ✅ |
| `warning` `#f59e0b` | 7,28 | ✅ |
| `danger` `#ef4444` | 4,45 | ⚠ preexistente (§5) |
| `info` `#3b82f6` | 4,47 | ⚠ preexistente (§5) |
| `violet` `#a78bfa` | 5,85 | ✅ |

**Una regresión en dark es estructuralmente imposible, probado sobre el diff**: la ÚNICA línea eliminada de `globals.css` es el comentario obsoleto — los cinco valores de `:root` (dark) son **byte-idénticos**. En CP1, dark: success 6,51 · violet 5,50 · botón 6,54 → todos ✅.

- Evidencia: `measure-ds-dark.txt`, `01-ds-dark.png`, `measure-cp1.txt`.

---

## 2) CP1 (`/runs/:id`, N3 pausado) — el fallo que bloquea

Análisis real por URL conducido **desde la UI** hasta CP1, con el pipeline real (N1/N2/N3) contra las APIs **falsas** ⇒ **$0**.

| tema | par medido | superficie real | ratio | OK |
|---|---|---|---|---|
| **LIGHT** | **badge `✓ extraído` (success)** | `--surface-2` → `rgb(223,234,229)` | **4,28:1** | ❌ **FAIL** |
| LIGHT | badge `inferido` (violet) | `rgb(232,227,248)` | 4,66:1 | ✅ |
| LIGHT | **BOTÓN «Aprobar y continuar»** | relleno sólido `--success` | 5,27:1 | ✅ |
| DARK | badge `✓ extraído` | — | 6,51:1 | ✅ |
| DARK | badge `inferido` | — | 5,50:1 | ✅ |
| DARK | BOTÓN «Aprobar y continuar» | — | 6,54:1 | ✅ |

**Mecanismo del 4,28** (medido, no deducido): el badge vive dentro del `fieldset` del bloque PRODUCTO, que es **`bg-surface-2` (#f7f7f9)** — un panel **neutro**, sin tinte de color. Su `success-soft` al 10 % compone sobre ese gris claro y da `rgb(223,234,229)`. Es decir, **el token falla sobre una tarjeta neutra corriente**, no por ninguna particularidad de CP1: la misma superficie se repite por toda la app.

- Evidencia: `measure-cp1.txt`, **`cp1-badge-ancestor-chain.txt`**, `03-cp1-light.png`, `04-cp1-dark.png`, `cp1-contrast.spec.ts`.

---

## 3) EL BOTÓN — ✅ el `--success-on` invertido hizo su trabajo

| tema | texto | relleno | ratio | OK |
|---|---|---|---|---|
| LIGHT | `#ffffff` | `#157c3b` | **5,27:1** | ✅ |
| DARK | `#052e16` | `#22c55e` | **6,54:1** | ✅ |

La inversión era **necesaria**: el casi-negro `#052e16` sobre el verde nuevo daría 2,82:1. Sin ella, arreglar el badge habría **roto** el botón. Los 3 sitios del relleno sólido (`checkpoint-banner.tsx:66`, `brief-editor.tsx:588`, `step-panel.tsx:219`) comparten exactamente el mismo par de tokens, así que los tres quedan cubiertos por esta medida.

---

## 4) Ninguna otra página regresiona — ✅

- **Recorrido CUA del showcase** (`/design-system`) en **ambos temas** vía el toggle real de la UI: renderiza completo, sin roturas de layout. Consola limpia (solo HMR/React-DevTools) → `console-ds.txt`.
- **`/spend`** (light y dark): `warning` 5,14/8,57 y `danger` 5,43/4,89 → todos AA. Sin regresión.
- **`/settings`**: sin elementos semánticos que medir. Sin regresión.
- El 500 conocido de `/spend`+`/settings` en :3001 (`api-client.ts:26` con `localhost:3000` hardcodeado) se sorteó con `INTERNAL_API_URL=http://localhost:3001`, como indicaba el brief. **No es fallo de T1.12** y no cuenta en el veredicto.
- Evidencia: `measure-spend-settings.txt`, `05-spend-{light,dark}.png`, `05-settings-{light,dark}.png`.

---

## 5) Hallazgo PREEXISTENTE a rutear (NO es de T1.12, no bloquea)

En **dark**, con los valores intactos de siempre: **`danger` 4,45:1** y **`info` 4,47:1** sobre `--surface`. Están por debajo de AA **desde antes** de esta tarea (byte-idénticos en el diff) ⇒ **no son regresión de T1.12**, pero son un defecto real de los tokens del DS y quedan aquí con su ratio en lugar de ignorados (cua.md §111). Decisión del dueño del DS / usuario.

## 6) Juicio estético (no medible — el OK final es del usuario)

Los tonos oscurecidos **se ven bien y conservan su identidad**: el violeta sigue leyéndose violeta (no azul), el verde es un verde bosque legible (no caqui), el ámbar no se ha vuelto marrón y el rojo sigue siendo rojo. En el botón sólido, el blanco sobre el verde nuevo se lee con holgura. **No veo un problema estético**: el problema es exclusivamente de **margen numérico**. Capturas en ambos temas: `02-ds-light.png`, `01-ds-dark.png`, `03-cp1-light.png`, `04-cp1-dark.png`.

---

## Coste real

**$0** (estimado $0) — sin llamadas a APIs de pago. CP1 se alcanzó con el stack E2E de fakes (Firecrawl/Jina/Anthropic servidos por un HTTP local), tal como el brief autorizaba.

---

## Qué debe arreglar el implementer (accionable)

1. **Re-derivar los 5 tonos light EN CLAUDE DESIGN** (fuente de verdad; `docs/design-system/` es espejo de solo lectura y `globals.css` deriva de él) y bajarlos con `DesignSync`. **No editar `globals.css` a mano.**
2. **Calibrar contra la superficie PEOR, no contra el blanco.** Las superficies reales bajo estos badges son al menos: `--surface` #fff, `--bg` #fbfbfc, **`--surface-2` #f7f7f9 (la de CP1)**, **`--bg-subtle` #f4f4f6 (15 de los 28 badges del showcase)** y `--surface-3` #eeeef1. Si el token debe pasar AA «en el badge», tiene que pasarlo **ahí**, no solo sobre blanco.
3. **Calibrar contra el píxel rasterizado y con MARGEN.** La aritmética en coma flotante lee ~0,03 alto; un objetivo de 4,50 clavado garantiza caer por debajo en pantalla. Apuntar a **≥4,6–4,7 en la superficie peor**.
4. **El botón no corre peligro al re-oscurecer**: si `--success` baja más, `--success-on: #ffffff` solo mejora. Pero cualquier re-toque debe volver a medir los 3 sitios del relleno sólido.
5. `violet` (#6b3bf7) es el único que hoy aguanta en todas las superficies salvo `--surface-3`: sirve de referencia del margen que necesitan los otros cuatro.

## Artefactos de esta verificación

- Medidores propios (del verifier, en el navegador): `verifier-canonical.js`, `verifier-measure.js`, `run-measure.sh`, `cp1-contrast.spec.ts`, `playwright.verifier.ts`
- Salidas: `measure-ds-light.txt`, `measure-ds-dark.txt`, `measure-ds-light-dom.txt`, `measure-light-all-surfaces.txt`, `measure-cp1.txt`, **`cp1-badge-ancestor-chain.txt`**, `measure-spend-settings.txt`, `handcheck-light.txt`, `console-ds.txt`
- Capturas: `01-ds-dark.png`, `02-ds-light.png`, `03-cp1-light.png`, `04-cp1-dark.png`, `05-spend-{light,dark}.png`, `05-settings-{light,dark}.png`
- (`contrast.mjs`, `solve.mjs`, `check.mjs` son del implementer; se conservan pero **no** son la base del veredicto: asumen que el badge vive sobre blanco.)
