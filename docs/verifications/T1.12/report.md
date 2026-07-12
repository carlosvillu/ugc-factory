# Verificación T1.12 — Contraste WCAG AA de los tokens semánticos en tema claro

- **Tarea**: T1.12 · Contraste WCAG AA de los tokens semánticos en tema claro (`planning.md`)
- **Fecha**: 2026-07-12 · **RONDA 2** (la ronda 1 dio FAIL: ver `report-fail-1.md`)
- **Ejecutor**: subagente `verifier` · agent-browser 0.27.x · sesión `t1.12` · + Playwright (stack E2E con fakes)
- **Sistema**: base `ef4f89a` + los 4 ficheros de T1.12 sin commitear. Docker compose dev (pg16) + `pnpm dev` en **:3001** con `INTERNAL_API_URL=http://localhost:3001` · CP1 sobre el **stack E2E (:3100) con las APIs de pago FALSAS** ⇒ **$0**.
- **Gate previo**: `pnpm gate` en **verde** (0 errores; 916 tests / 93 ficheros).

## Verificación esperada (literal de planning.md)

> En `/design-system` y en CP1 (`/runs/:id` con N3 pausado), en tema **light**, los badges `success`/`violet`/`info` miden **≥4,5:1** con un medidor de contraste real (no a ojo), y **siguen ≥4,5:1 en dark**; evidencia con los ratios medidos antes/después en `docs/verifications/T1.12/`. Ninguna otra página del DS regresiona (recorrido CUA del showcase en ambos temas).

---

## VEREDICTO: **PASS**

La recalibración corrige el fallo **en el sitio exacto que lo cazó**. El badge `✓ extraído` de CP1 —el que en la ronda 1 medía **4,28:1** sobre el `fieldset` `--surface-2`— ahora mide **4,91:1**. Los tres tonos que la Verificación nombra (`success`/`violet`/`info`) **pasan AA en el 100 % de sus emplazamientos reales**, en light, medidos en el navegador sobre el píxel rasterizado. Dark no regresiona. El botón mejora a 6,09:1.

Quedan **dos hallazgos preexistentes** que **no bloquean** (no los causa T1.12, y T1.12 mejora uno de ellos) y **una nota de documentación desactualizada**, todos en §5–§7.

---

## 1) CP1 (`/runs/:id`, N3 pausado) — **la piedra angular**

Mismo spec, mismo badge, misma superficie que en la ronda 1. Análisis real por URL conducido **desde la UI** hasta CP1 con el pipeline real (N1/N2/N3) contra las APIs **falsas** ⇒ **$0**.

| tema | par medido | superficie real | **ronda 1** | **ronda 2** | OK |
|---|---|---|---|---|---|
| **LIGHT** | **badge `✓ extraído` (success)** | `--surface-2` → `rgb(223,233,229)` | **4,28 ❌** | **4,91:1** | ✅ |
| LIGHT | badge `inferido` (violet) | `rgb(231,226,248)` | 4,66 | **4,90:1** | ✅ |
| LIGHT | **BOTÓN «Aprobar y continuar»** | relleno sólido `--success` | 5,27 | **6,09:1** | ✅ |
| DARK | badge `✓ extraído` | — | 6,51 | **6,51:1** | ✅ |
| DARK | badge `inferido` | — | 5,50 | **5,50:1** | ✅ |
| DARK | BOTÓN «Aprobar y continuar» | — | 6,54 | **6,54:1** | ✅ |

- Evidencia: `r2-measure-cp1.txt`, `r2-03-cp1-light.png`, `r2-04-cp1-dark.png`, `cp1-contrast.spec.ts`.

## 2) `/design-system` · los 5 tokens, ANTES vs DESPUÉS, en los DOS temas

### LIGHT — par del badge, rasterizado real, sobre TODAS las superficies reales

| familia | ANTES (dark en light) | r1 (rechazado) | **r2** `--surface` | **r2** `--bg` | **r2** `--surface-2` | **r2** `--bg-subtle` | **r2** `--surface-3` (peor) | ¿AA? |
|---|---|---|---|---|---|---|---|---|
| `success` `#147136` | 2,09 | 4,60 / 4,20 ❌ | 5,25 | 5,09 | 4,92 | 4,82 | **4,57** | ✅ |
| `warning` `#885806` | 1,99 | 4,49 / 4,11 ❌ | 5,27 | 5,10 | 4,96 | 4,82 | **4,60** | ✅ |
| `danger` `#c01010` | 3,30 | 4,58 / 4,18 ❌ | 5,28 | 5,11 | 4,93 | 4,84 | **4,57** | ✅ |
| `info` `#0a58d8` | 3,27 | 4,52 / 4,13 ❌ | 5,28 | 5,12 | 4,97 | 4,83 | **4,61** | ✅ |
| `violet` `#6535f6` | 2,49 | 5,01 / 4,58 | 5,28 | 5,11 | 4,95 | 4,84 | **4,59** | ✅ |

**Las 25 celdas pasan AA.** La peor de toda la matriz es **4,57:1** — margen real, no 4,50 clavado. Confirmado en el navegador (`r2-measure-ds-light.txt`) y con mi cálculo independiente (`handcheck-light-v2.txt`); ambos coinciden.

**Barrido del DOM vivo** (`r2-measure-ds-light-dom.txt`): de los 41 badges semánticos pintados, los de las **tres familias nombradas pasan todos** — peor caso `success` 4,82 · `info` 4,85 · `violet` 4,85. (Los dos únicos elementos por debajo son de `warning`/`danger` y viven en un apilamiento soft-sobre-soft preexistente: §5.)

### DARK (cláusula de NO-REGRESIÓN) — ✅ no regresiona

Los cinco valores de `:root` (dark) siguen **byte-idénticos** en el diff ⇒ regresión estructuralmente imposible. Re-medidos: success 6,93 · warning 7,28 · danger 4,45 ⚠ · info 4,47 ⚠ · violet 5,85. Botón dark 6,54. (Los ⚠ son la deuda preexistente de §6.)

- Evidencia: `r2-measure-ds-dark.txt`, `r2-01-ds-dark.png`, `r2-02-ds-light.png`.

## 3) EL BOTÓN — ✅ mejora

| tema | texto | relleno | r1 | **r2** | OK |
|---|---|---|---|---|---|
| LIGHT | `#ffffff` | `#147136` | 5,27 | **6,09:1** | ✅ |
| DARK | `#052e16` | `#22c55e` | 6,54 | **6,54:1** | ✅ |

La inversión de `--success-on` sigue siendo **imprescindible**: el casi-negro `#052e16` sobre el verde nuevo daría **2,45:1**. Los 3 sitios del relleno sólido (`checkpoint-banner.tsx:66`, `brief-editor.tsx:588`, `step-panel.tsx:219`) comparten el par, así que quedan cubiertos.

## 4) Ninguna otra página regresiona — ✅

- **Recorrido CUA del showcase** en **ambos temas** vía el toggle real: renderiza completo, sin roturas. Consola limpia (solo HMR/React-DevTools) → `r2-console.txt`.
- **`/spend`**: light `warning` 6,10 · `danger` 6,32 · dark 8,57 / 4,89 → AA. Sin regresión.
- **`/settings`**: sin elementos semánticos. Sin regresión.
- El 500 conocido de `/spend`+`/settings` en :3001 (`api-client.ts:26`) se sorteó con `INTERNAL_API_URL`. **No es fallo de T1.12.**
- Evidencia: `r2-measure-spend-settings.txt`, `r2-05-{spend,settings}-{light,dark}.png`.

---

## 5) HALLAZGO PREEXISTENTE (no bloquea): `checkpoint-banner` apila soft-sobre-soft

Los **dos únicos** elementos bajo 4,5 en light son **estructurales, no de token**, y viven en `checkpoint-banner.tsx` — que **T1.12 no toca** (`git diff --stat` vacío):

- El **chip «◆»** (línea 46) es `bg-warning-soft` + `text-warning` **dentro** del banner, que ya es `bg-warning-soft` (línea 38) ⇒ el tinte se aplica **dos veces**: **4,25:1**.
- El botón **«Rechazar»** (`danger-soft`) se pinta **dentro de ese mismo banner warning-soft**: **4,25:1**.

**No es regresión: T1.12 lo MEJORA.** Con los valores viejos ese mismo apilamiento daba **3,65** (warning) y **3,68** (danger); ahora da 4,23/4,21 por token. **Ningún valor de token puede cerrarlo**: para superar 4,5 sobre un tinte del ~19 % habría que oscurecer tanto el tono que rompería todas las demás superficies, y además no arreglaría el caso del botón danger dentro de un banner warning (matices distintos). **La solución es del componente** (que el chip/botón interior no vuelva a aplicar `-soft`, o use `--surface`). Se rutea al dueño del DS/componente. El «◆» es un glifo decorativo; el que porta información es «Rechazar».

- Evidencia: cadenas de ancestros volcadas del DOM en `r2-measure-ds-light-dom.txt` + el análisis de arriba.

## 6) DEUDA PREEXISTENTE CONFIRMADA (no bloquea): `danger`/`info` en DARK

Confirmado en la ronda 2, tal como pediste: en **dark**, `danger` **4,45:1** e `info` **4,47:1** sobre `--surface`, por debajo de AA. Los valores dark son **byte-idénticos** desde antes de la tarea ⇒ **no es regresión de T1.12**, sino defecto preexistente de los tokens del DS. **Queda anotado para el dueño del DS** (cua.md §111).

## 7) NOTA: un texto de documentación se quedó desactualizado

El espejo del DS (`colors-semantic.card.html:56`) **sí** dice lo nuevo («*Calibrated on the WORST surface, not the best*»), pero la tarjeta que **renderiza `/design-system`** (`foundation-specimens.tsx:163`) **todavía dice lo viejo**: «*Cada variante light es el tono más claro del mismo matiz que supera el 4,5:1*». Con la recalibración eso ya **no es cierto** (se calibró contra la superficie PEOR y con margen, no contra el tono más claro que pasa). No afecta al contraste ni al veredicto — es **deuda de documentación**: los dos textos deberían decir lo mismo.

## 8) JUICIO ESTÉTICO — tu sospecha del ámbar era CORRECTA

Mirando los cinco tonos nuevos a resolución completa (`r2-06-tonos-light-detalle.png`):

- **`success #147136`** — verde bosque profundo. Se lee **verde** sin ambigüedad. ✅
- **`warning #885806`** — **AQUÍ ESTÁ EL PROBLEMA. Se lee MARRÓN/bronce, no ámbar.** Junto a los otros parece un ocre oscuro / color café. Como señal de *aviso* ha perdido la semántica «ámbar de precaución»: nada en él dice «atención». Es el único de los cinco que, a mi juicio, **pierde su identidad de matiz**. ⚠️
- **`danger #c01010`** — rojo carmesí profundo. Sigue siendo **rojo**. ✅
- **`info #0a58d8`** — azul sólido, inequívoco. ✅
- **`violet #6535f6`** — **violeta** claro, y sigue **distinguiéndose bien del azul de info**. ✅

**No bloquea el PASS** (el ratio pasa y el OK estético es del usuario, no mío), pero lo reporto explícitamente: **si algo hay que revisar aquí, es el ámbar**. Posible vía: subir la luminosidad del matiz sacrificando algo de margen (4,60 → ~4,55 sigue pasando), o aceptar el bronce. **Decisión del usuario.**

---

## Coste real

**$0** (estimado $0). CP1 se alcanzó con el stack E2E de fakes; no se llamó a ninguna API de pago en ninguna de las dos rondas.

---

## Artefactos

- **Ronda 2**: `r2-measure-ds-light.txt`, `r2-measure-ds-dark.txt`, `r2-measure-ds-light-dom.txt`, `r2-measure-cp1.txt`, `r2-measure-spend-settings.txt`, `handcheck-light-v2.txt`, `r2-console.txt`; capturas `r2-01-ds-dark.png`, `r2-02-ds-light.png`, `r2-03-cp1-light.png`, `r2-04-cp1-dark.png`, `r2-05-{spend,settings}-{light,dark}.png`, `r2-06-tonos-light-detalle.png`
- **Ronda 1 (FAIL, memoria del proyecto)**: `report-fail-1.md` + `measure-*.txt`, `cp1-badge-ancestor-chain.txt`, `01..05-*.png`
- **Medidores propios del verifier**: `verifier-canonical.js`, `verifier-measure.js`, `run-measure.sh`, `cp1-contrast.spec.ts`, `playwright.verifier.ts`
