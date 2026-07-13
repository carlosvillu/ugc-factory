# Verificación T1.16 — Nodos con título humano + visor modal del output JSON

> **Estado: PASS (ronda 2, 2026-07-13).** Este documento conserva ABAJO el FAIL de la ronda 1 (evidencia del fallo encontrado) y añade AL FINAL la re-verificación del fix. Los fallos documentados son memoria del proyecto: no se borran al arreglarlos.

---

## RONDA 1 — FAIL (histórico)

- **Tarea**: T1.16 · Nodos con título humano + visor modal del output JSON (`planning.md`, fase F1c)
- **Fecha**: 2026-07-13
- **Ejecutor**: subagente `verifier` · agent-browser 0.27.x · sesiones `t1.16` (stack dev) y `t1.16b` (stack de proveedores falsos)
- **Sistema**: HEAD `128d099` + **diff sin commitear de T1.16** (22 ficheros; `git status` sucio por diseño — la tarea aún no está cerrada). Dos stacks REALES:
  - **A · dev** (`docker compose` + `pnpm dev`, :3000) sobre la BD local, que conserva los runs REALES ya pagados en T1.14/T1.15 → sirve el ProductBrief auténtico de 14.770 caracteres.
  - **B · proveedores falsos** (`apps/web/scripts/e2e-stack.ts`, :3100): web + worker + Postgres + orquestador + SSE REALES; solo Firecrawl/Jina/Anthropic falseados ⇒ **$0**.
  - Los dos no coexisten: Next 16 solo admite un `next dev` por directorio. Se ejecutaron en secuencia.

## Verificación esperada (literal de planning.md)

> en el navegador, en un run real: los nodos muestran títulos legibles en canvas e inspector; la modal muestra el output ÍNTEGRO y formateado de un step cuyo excerpt está truncado; el `ds-reviewer` pasa sobre la superficie nueva.

Cláusula de cierre absorbida (deuda del verifier de T1.14):

> con el editor de CP1 abierto, el lienzo de React Flow se comprime y **N2/N3 quedan fuera de la vista**; no hay controles de zoom/fit. Entra en esta tarea: controles de zoom/fit visibles y re-encuadre cuando cambia el tamaño del lienzo.

## Gates previos (re-ejecutados por el verifier, no heredados)

| Gate | Resultado |
|---|---|
| `pnpm gate` (lint + typecheck + format:check + knip + test) | **VERDE** — 1176 tests, 112 ficheros |
| `pnpm test:e2e` | **VERDE** — 51/51 (incluido el `cancelar OTRO run` históricamente flaky) |
| `ds-reviewer` (pase INDEPENDIENTE, no el auto-informe del implementer) | **LIMPIO** — 0 hallazgos reemplazables, 0 tokens hardcodeados |

## Pasos ejecutados

1. Matar `next dev`/`next-server` residuales → `pnpm gate` verde → `pnpm test:e2e` 51/51.
2. **Stack A**: login por la UI → `/runs/01KXDDNG2BR2YK8BCS90540T9T` (run REAL de T1.15, es.stayforlong.com) → canvas con títulos humanos → inspector de N3 → modal del output → medición de contraste en dark y light → cambio de tema por la UI (Ajustes).
3. **Stack B**: login por la UI → preparación de escenario por API (`prepare-runs.ts`, permitido por cua.md regla 1): (a) run de ANÁLISIS que se detiene en CP1; (b) run de DEMO cuyo N4 falla con un error de **642 caracteres** con marcador único al final (`MARCADOR_FINAL_DEL_ERROR_T116`) — input elegido por el verifier, no reutilizado del implementer.
4. En el navegador: badge `N3 · CP1` en espera → aprobación desde la UI → lienzo comprimido con CP1 abierto → controles de zoom/fit → N4 fallido → caja del panel vs modal del error.

## Resultado observado vs esperado

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Títulos humanos en **canvas** | N1 «Ingesta», N2 «Análisis visual», N3 «ProductBrief», N4 «Estrategia del lote» como texto principal; la clave sigue en badge mono; el **accessible name sigue siendo el `node_key` crudo** (`article "N1 completado"`) → API de tests intacta | `01-canvas-titulos-humanos-run-real.png` | OK |
| 2 | Títulos humanos en **inspector** | Encabezado `<h2>` = «ProductBrief» / «Estrategia del lote»; clave como `Badge` mono | `02`, `07` | OK |
| 3 | Patrón **`N3 · CP1`** mientras espera, y vuelta a `N3` al aprobar | Run en `waiting_approval`: badge **`N3 · CP1`**. Run REAL ya aprobado (`succeeded`, `is_checkpoint=t` en BD): badge **`N3`** a secas. Comparación entre runs = prueba del revert | `06` (CP1) vs `01` (aprobado) | OK |
| 4 | La modal muestra el output **ÍNTEGRO** de un step cuyo excerpt está truncado | Brief REAL de 14.770 chars en BD. **Caja del panel = exactamente 200 chars**, cortada a media frase, **sin `angles`**. **Modal = 17.534 chars**, `"angles"` presente, y **el texto renderizado vuelve a parsear como JSON válido** con los 5 ángulos y sus nombres idénticos a los de la BD ⇒ artefacto completo, nada perdido | `02`, `03`, `05` | OK |
| 5 | JSON **formateado**, resaltado, con scroll y botón copiar | Indentado (`\n  "`), 1080 spans de resaltado, scroll real (5824 px de contenido en caja de 307 px), «Copiar» → confirma «Copiado» | `03`, `05` | OK |
| 6 | La modal del **ERROR** sirve el error COMPLETO (regresión arreglada en review) | Error inyectado de **642 chars**. **Caja del panel: 200 chars, 3 issues, SIN marcador final.** **Modal: 642 chars, los 8 issues, CON `MARCADOR_FINAL_DEL_ERROR_T116`.** La promesa «Ver el error completo» ahora es cierta | `07-modal-error-completo-642-chars.png` | OK |
| 7 | **Controles de zoom/fit + re-encuadre** con CP1 abierto (deuda T1.14) | Lienzo comprimido a **255 px** (el ancho exacto de la deuda) y **N1, N2 y N3 los tres DENTRO del viewport** (medido con `getBoundingClientRect` contra el rect del lienzo, no por `visible`). Zoom del viewport = **0,2617**, POR DEBAJO del `minZoom` 0.5 de fábrica ⇒ el `minZoom={0.15}` es load-bearing. Controles «Acercar»/«Alejar»/«Ajustar a la vista» visibles y **funcionales** (0,3141 → 0,2617 → 0,2181 → fit 0,2735, y tras el fit los 3 nodos vuelven al viewport) | `06-cp1-abierto-lienzo-255px-3-nodos-visibles.png` | OK |
| 8 | El `ds-reviewer` pasa sobre la superficie nueva | Pase **independiente**: **LIMPIO**, 0 hallazgos, 0 tokens hardcodeados | — | OK |
| 9 | El resaltado se **re-tematiza** (claro y oscuro) | Sí: los tokens cambian de valor con el tema (`success` `#22c55e`→`rgb(20,113,54)`, `warning` `#f59e0b`→`rgb(136,88,6)`, etc.) | `03` (light), `05` (dark) | OK |
| 10 | **El contraste del texto del visor es legible en los dos temas** (cua.md: aserción obligatoria, AA 4.5:1 texto normal) | **NO.** En el tema por defecto (dark), las **claves del JSON** —el token más leído del visor, 217 apariciones— quedan en **3,20:1**, y la puntuación en **3,59:1** | tabla de abajo, `05-modal-dark-contraste-claves-3.2.png` | **FALLA** |

## El fallo: contraste del visor de JSON (bloqueante)

Medido con `getComputedStyle` sobre los **spans REALMENTE renderizados** contra el **fondo REALMENTE renderizado** del visor (`bg-surface-2`, opaco: `rgb(26,26,29)` en dark / `rgb(247,247,249)` en light). Texto de **11 px, peso 400** ⇒ umbral **AA = 4,5:1** (no es texto grande). Reproducido de forma independiente en los DOS stacks, y con compositing alpha correcto.

| Token del visor | Uso | Ratio DARK (por defecto) | Ratio LIGHT | AA 4,5:1 |
|---|---|---|---|---|
| **`text-accent`** — **claves** `"brief"`, `"meta"`… | **217 spans** | **3,20** | 5,07 | **FALLA en dark** |
| **`text-text-3`** — puntuación/estructura | **649 spans** | **3,59** | 4,52 | **FALLA en dark** |
| `text-success` — strings | 202 spans | 7,62 | 5,70 | OK |
| `text-info` — números | 2 | 4,72 | 5,77 | OK |
| `text-warning` — booleanos | 2 | 8,08 | 5,70 | OK |
| `text-violet` — `null` | 8 | 6,38 | 5,78 | OK |
| (texto base del `<pre>`) | — | 15,80 | 16,56 | OK |

**Y es peor que «un problema de dark»**: `--accent` es un token **dependiente del acento** que el usuario elige en Ajustes (Indigo/Emerald/Amber/Cyan). Barrido de las 8 combinaciones tema × acento, midiendo `--accent` contra `--surface-2` (sus puntos de anclaje coinciden con las medidas sobre spans renderizados):

| Acento | Ratio de las CLAVES en DARK | Ratio de las CLAVES en LIGHT |
|---|---|---|
| Indigo (por defecto) | **3,20** FALLA | 5,07 OK |
| Emerald | 6,85 OK | **2,37** FALLA |
| Amber | 8,08 OK | **2,01** FALLA |
| Cyan | 7,15 OK | **2,27** FALLA |

Es decir: **en 4 de las 8 combinaciones las claves del JSON incumplen AA**, y el default de la app (dark + indigo) es una de ellas.

### Causa raíz y a quién le toca

1. **Claves (`text-accent`) → lo arregla el implementer, NO es un defecto del DS.** `--accent` es un color de **marca/relleno** (botones, chips), no un color de **texto sobre superficie**. Usarlo para el token más frecuente de un visor de texto pequeño es una elección equivocada de token, no un valor malo del DS: el mismo `#5457e5` es válido como fondo de botón. El fix es elegir (o añadir) un color de texto-sobre-superficie que cumpla ≥4,5:1 **en los dos temas y en los cuatro acentos** — el ds-reviewer confirma que el DS hoy no tiene primitiva de code/JSON viewer, así que el token de «clave de sintaxis» hay que decidirlo explícitamente.
2. **Puntuación (`text-text-3`, 3,59 en dark) → posible defecto de VALOR del DS.** Este sí es un token de texto (pasa en light con 4,52). Se reporta con su ratio; la decisión de tocar el valor del DS es del usuario. No mueve el veredicto (las claves ya lo bloquean por sí solas).

Es exactamente la familia de fallo que cua.md documenta desde TD.7 («el blanco sobre emerald/amber/cyan seguía fallando AA y NINGÚN verifier lo cazó porque medían fondos y tokens, nunca el contraste del texto»).

## Rarezas (no bloquean)

- **El overlay de Next dev-tools (`NEXTJS-PORTAL`) tapa los controles de zoom** (esquina inferior izquierda): con él delante, los clicks sobre «Alejar»/«Ajustar a la vista» no llegan al botón (`document.elementFromPoint` devuelve el portal). Es un artefacto **solo de dev** (no existe en `next build`); ocultando el portal, los tres controles funcionan perfectamente. Se documenta porque le costará tiempo a quien lo cruce de nuevo, no porque sea un defecto de producto.
- **CTA «Ver el error completo»**: 4,45:1 (11 px, peso 600) — a 0,05 del umbral. Nit, no bloqueante.
- El *read* del portapapeles está denegado por permiso del navegador, así que no se pudo leer lo copiado desde el CUA; el *write* sí se confirmó por la UI («Copiado») y el E2E permanente lo asegura con permisos concedidos.
- Consola del navegador **limpia** en los dos stacks: 0 errores, 0 warnings (`browser-console-dev.txt`, `browser-console-e2e-stack.txt`).

## Coste real

**$0.00** — vs estimado $0. No se llamó a ninguna API de pago:
- El brief real (14.770 chars) sale de un run **ya existente** en la BD local, pagado en su día por T1.15 ($0,18). Verificar sobre él no cuesta nada.
- Los runs nuevos (análisis en CP1 + demo con error largo) corrieron en el stack de **proveedores falsos** (`e2e-stack.ts`), que es web/worker/Postgres/SSE reales con Firecrawl/Jina/Anthropic falseados.

## Veredicto

**FAIL** — la funcionalidad de T1.16 está bien construida y sus piezas observables funcionan de verdad (títulos humanos, `N3 · CP1`, modal con el artefacto ÍNTEGRO, modal con el error ENTERO, controles de zoom/fit con los 3 nodos alcanzables a 255 px), pero **el visor incumple la aserción obligatoria de contraste de cua.md en el tema por defecto**: las claves del JSON, el token que más se lee del visor, quedan en **3,20:1** frente al mínimo AA de 4,5:1 — y en 4 de las 8 combinaciones tema × acento.

**Qué debe arreglar el implementer** (accionable):
1. Sustituir `text-accent` como color de las **claves** del JSON por un token de **texto sobre superficie** que cumpla ≥4,5:1 en dark Y light Y en los cuatro acentos (`indigo`/`emerald`/`amber`/`cyan`). Ojo: cualquier token ligado a `--accent` volverá a fallar, porque el acento es configurable por el usuario.
2. Re-medir con `getComputedStyle` sobre los spans renderizados (no sobre los valores del token) las 8 combinaciones, y dejar la tabla de ratios en el report.
3. Decidir explícitamente qué hacer con `text-text-3` en la puntuación (3,59 en dark): o se cambia el token del visor, o se ruta al usuario como ajuste de VALOR del DS.

Todo lo demás queda verificado y no hace falta repetirlo salvo que el fix toque el visor (que lo tocará): al re-verificar, basta re-ejecutar los puntos 4, 5, 9 y 10.


---

# RONDA 2 — RE-VERIFICACIÓN DEL FIX (2026-07-13) — **PASS**

- **Ejecutor**: subagente `verifier` (contexto fresco) · agent-browser · sesión `t116r2`
- **Sistema**: stack de proveedores falsos (`e2e-stack.ts`, :3100) — web + worker + Postgres + orquestador + SSE REALES, solo Firecrawl/Jina/Anthropic falseados ⇒ **$0**
- **Alcance**: SOLO los puntos que fallaron o que el fix podía tocar (3 output íntegro, 4 error completo, 6 ds-reviewer, 7 contraste). Los puntos 1, 2 y 5 (títulos, `N3 · CP1`, zoom/fit) quedaron verificados en la ronda 1 y el fix no los toca.

## Qué cambió (según el implementer, verificado por mí)

- Las **claves** del JSON dejan de usar `text-accent` (token de MARCA) y pasan a **`--text`** (texto fuerte).
- La **puntuación** pasa de `--text-3` (3,59 en dark) a **`--text-2`**.
- Los **CTAs** de las cajas de output y error (que también llevaban `text-accent`) pasan a `text-text`.
- **Guard nuevo**: `json-token-palette.ts` + `json-token-palette.test.ts`, que **parsea los hexes de `globals.css`** (no los copia) y mide el contraste de cada clase × tema × superficie, más un guard de nombre (ninguna clase puede contener `accent`) y un CONTROL que verifica que los tokens rechazados siguen cayendo por debajo de AA.

## Verificación del guard (control de mutación PROPIO, no el del implementer)

Muté un token DISTINTO al que mutó el implementer: `punctuation: 'text-text-2'` → `'text-text-3'`.

```
× cada color de la paleta cumple AA en los DOS temas y sobre la superficie REAL del visor
+   "punctuation (text-text-3) dark/surface: 3.81:1 < 4.5",
+   "punctuation (text-text-3) dark/surface-2: 3.59:1 < 4.5",
```

**El guard muerde**, y con **exactamente el 3,59 que yo medí en el navegador en la ronda 1** — la métrica del test coincide con la realidad renderizada. Fichero restaurado (sin diff propio); 3/3 verde.

## LA TABLA: contraste re-medido POR MÍ en el navegador (spans renderizados, compositing alpha correcto)

Visor a **11 px / peso 400** ⇒ umbral **AA = 4,5:1**. Clases realmente presentes en el visor: `text-text`, `text-text-2`, `text-success`, `text-info`, `text-warning`, `text-violet` (**`text-accent` ha desaparecido**).

| Token | Rol | DARK (`rgb(26,26,29)`) | LIGHT (`rgb(247,247,249)`) | AA |
|---|---|---|---|---|
| `text-text` | **claves** | **15,80** | **16,56** | ✅ |
| `text-text-2` | puntuación | **6,77** | **7,22** | ✅ |
| `text-success` | strings | 7,62 | 5,70 | ✅ |
| `text-info` | números | 4,72 | 5,77 | ✅ |
| `text-warning` | booleanos | 8,08 | 5,70 | ✅ |
| `text-violet` | `null` | 6,38 | 5,78 | ✅ |
| CTA «Ver el output/error completo» | — | **16,06** | **14,86** | ✅ |
| Excerpt de las cajas del panel | — | 16,06 | 14,86 | ✅ |

**Independencia del acento (lo que el coordinador pidió comprobar)**: medí las **8 combinaciones tema × acento** (indigo/emerald/amber/cyan). Los ratios de las 6 clases son **IDÉNTICOS byte a byte al cambiar de acento** dentro de cada tema ⇒ **ninguna clase del visor depende de `--accent`**. No queda ningún token de marca escondido.

Comparado con la ronda 1: claves **3,20 → 15,80** (dark), y las 4 combinaciones que fallaban (dark+indigo 3,20; light+emerald 2,37; light+amber 2,01; light+cyan 2,27) ya no existen como categoría, porque el color de la clave ya no lo elige el usuario.

## ¿Sigue siendo ÚTIL el visor? (no un arreglo pírrico)

El fix **no** ha dejado un JSON monocromo. Los tipos de valor conservan hues distintos y escaneables (dark):

| Rol | Color renderizado |
|---|---|
| clave | `rgb(244,244,245)` (casi blanco, dominante) |
| string | `rgb(34,197,94)` verde |
| número | `rgb(59,130,246)` azul |
| booleano | `rgb(245,158,11)` ámbar |
| `null` | `rgb(167,139,250)` violeta |
| puntuación | `rgb(161,161,170)` gris (retrocede sin desaparecer) |

El par más próximo es puntuación/`null` (distancia RGB 83: gris vs violeta, familias de tono distintas, y `null` es escaso). Confirmado a ojo en las capturas de los dos temas: las claves ahora son lo más legible de la caja (antes eran lo MENOS legible), y el tipo del valor se sigue distinguiendo de un vistazo. El criterio del implementer —«en un JSON lo informativo es el TIPO DEL VALOR; la clave no necesita color propio»— se sostiene en pantalla.

**Comprobación adicional**: el 100 % de los 6.837 caracteres del visor están dentro de un `<span>` tokenizado (cero nodos de texto sueltos), así que el color base del `<pre>` no pinta ni un glifo.

## Resultado por punto (ronda 2)

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 3 | Modal con el output ÍNTEGRO (excerpt truncado) | Caja del panel = **200 chars exactos, sin `angles`**; modal = **6.837 chars**, con `"angles"`, **re-parsea como JSON válido** (5 ángulos, keys `brief/status/briefId/warnings`), formateado y con scroll | `09`, `10` | ✅ |
| 4 | Modal con el ERROR COMPLETO | Error de **642 chars**: caja = 200 chars / 3 issues / **sin** marcador; modal = **642 chars / los 8 issues / CON `MARCADOR_FINAL_DEL_ERROR_T116`** | `11-fix-modal-error-light.png` | ✅ |
| 6 | `ds-reviewer` pasa sobre la superficie nueva | Pase **independiente** (no el auto-informe): **LIMPIO**, 0 hallazgos. Verificó que los 6 tokens de la paleta están en el catálogo del DS, 0 hexes, y ejecutó el guard (3/3) | — | ✅ |
| 7 | **Contraste legible en los DOS temas** (y sin depender del acento) | **Todas las clases ≥ 4,72 en ambos temas**, ratios idénticos con los 4 acentos. El nit del CTA (4,45 en ronda 1) queda cerrado en 14,86–16,06 | tabla de arriba, `09`, `10` | ✅ |

## Gates (re-ejecutados por mí, no heredados)

| Gate | Resultado |
|---|---|
| `pnpm gate` | **VERDE** — **1179 tests, 113 ficheros** (coincide con lo que declaró el implementer) |
| `pnpm test:e2e` | **51/51** en 2 de 3 ejecuciones; los **4 specs de T1.16 pasaron en las 3**. Ver «Rareza» abajo |
| `ds-reviewer` independiente | **LIMPIO** |
| Consola del navegador | **0 errores, 0 warnings** (`browser-console-fix.txt`) |

## Rareza observada (no bloquea, pero se documenta)

**Una de las tres ejecuciones de `pnpm test:e2e` falló.** Las otras dos dieron 51/51, y **los cuatro specs de T1.16 pasaron en las tres**, así que el fallo NO está en la superficie de esta tarea. Es coherente con el flaky preexistente y conocido (`runs-canvas.spec.ts › cancelar OTRO run en curso`), ajeno a T1.16 y ya presente en la línea base de la ronda 1. Se anota explícitamente en vez de esconderse bajo un «pasó al reintentar»: la regla del proyecto es que un flaky se arregla con causa raíz, no se reintenta. **Recomendación**: abrir/retomar la deuda de ese spec como tarea propia — no debe seguir contaminando los gates de otras tareas.

## Coste real

**$0.00** (vs estimado $0). Todo el escenario (run de análisis que para en CP1 + run de demo con error largo) corrió en el stack de proveedores falsos. Ninguna llamada a API de pago.

## Veredicto ronda 2

**PASS** — la causa raíz que motivó el FAIL está corregida y **verificada en el navegador, no de palabra**: las claves del JSON pasan de **3,20:1** a **15,80:1**, todas las clases del visor cumplen AA en los dos temas, y —lo que cierra el agujero de verdad— **ninguna depende ya del acento elegible por el usuario** (ratios idénticos con los 4 acentos). El visor sigue siendo escaneable (los tipos de valor conservan hues distintos), el output y el error siguen llegando ÍNTEGROS, el `ds-reviewer` pasa, y el guard nuevo mide contra los hexes reales de `globals.css` y **muerde** (verificado con mi propia mutación).
