# Verificación T3.8 — UI de galería (E2E de fase F3)

- **Tarea**: T3.8 · UI de galería (`planning.md` línea 534-539)
- **Fecha**: 2026-07-15
- **Ejecutor**: verifier (Opus 4.8) · agent-browser 0.27.x · sesión `t3.8`
- **Sistema**: commit de trabajo `32dde8a` + diff sin commitear de T3.8 (working tree = el código verificado) · docker compose dev (`ugc-postgres-dev`, Postgres 16) + `pnpm dev` (web en :3200) + `pnpm seed:gallery` (56 templates / 10 guard packs / 15 model profiles)
- **BD usada**: `ugc` dev en `ugc-postgres-dev`. Sembrada con `pnpm seed:gallery` al inicio → 56 templates, todos `draft`, `head_version=0`, `prompt_version` vacía (pre-estado limpio confirmado por psql ANTES de editar).

## Verificación esperada (literal de planning.md)
> en navegador, filtrar por 2 facetas; editar un template introduciendo un slot inválido muestra el error en vivo; guardar crea `prompt_version` v2 con diff visible contra v1.

## Gate previo
- `pnpm gate`: **verde** — 150 test files / 1672 tests passed; lint, typecheck, format:check, knip, readme:status:check todos OK. (`gate-summary.txt`)
- `pnpm test:e2e`: **64 passed (2.2m)** en ejecución aislada (`e2e-gallery.txt`, `gate-summary.txt`). Los 2 specs de galería (`gallery.spec.ts:44` filtros combinados 2 facetas; `gallery.spec.ts:99` slots resaltados + validación en vivo + v2 con diff) pasan.
  - **Nota (flake de entorno, no defecto)**: la 1ª pasada de e2e falló en `auth.setup.ts` con `ERR_CONNECTION_REFUSED` en :3100 + `terminating connection due to administrator command` en el WebServer. Causa raíz: mi `pnpm dev` (:3200) y mis consultas psql concurrentes sobre la MISMA BD dev mataron las conexiones del webserver que Playwright gestiona. Tras parar mi dev server y reejecutar en aislamiento → 64/64 verde. Es contención de entorno provocada por la verificación CUA, no un fallo de T3.8.

## Pasos ejecutados (navegador real, agent-browser)
1. Login en `/login` con la password de bootstrap → sesión iniciada, `/`.
2. `/gallery` → 56 tarjetas, rail con Formato / Ángulo de hook / Vertical + Estado (draft 56), header "56 resultados". Nav «Galería» es enlace real (no deshabilitado). (`01-gallery-inicial.png`)
3. **Cláusula 1** — filtro por 2 facetas de grupos distintos: Vertical=**beauty** (`scrollintoview` + click) → 25 resultados; + Formato=**grwm** (click) → **2 resultados**, ambos botones con `aria-pressed=true`. Grid = exactamente `GRWM beauty — pain-point hook` y `GRWM belleza — sorpresa`, que coinciden con el psql `verticals @> {beauty} AND formats @> {grwm}`. (`03-filtro-2-facetas-beauty-grwm.png`)
4. **Cláusula 2** — abrir ficha `grwm-beauty-pain-point` → cuerpo con slots resaltados (`{persona.descriptor}`, `{product.name}`…). Entrar al editor y teclear `{foo.bar}` → aparece `role="alert"` EN VIVO ("Slots inválidos (no §10.4): {foo.bar}") SIN guardar, y "Guardar versión" queda `disabled`. Reemplazar por body con slots canónicos (`{product.name}`, `{benefit.primary}`, `{duration}`) → la alerta desaparece y el botón se habilita. (`05-slot-invalido-error-en-vivo.png`, `06-slot-canonico-sin-error.png`)
5. **Cláusula 3** — con el body válido editado + changelog, click "Guardar versión" → header pasa a `@2`; se renderiza el bloque `Diff · v2 vs v1` con 1 línea `-` (body original v1) y 1 línea `+` (body v2). (`07-diff-v1-v2.png`). Verificado en BD (`db-prompt-version.txt`).
6. Consola del navegador limpia de errores/warnings de código propio (solo devtools/HMR). (`browser-console.txt`, `browser-console-errors.txt` vacío)

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Filtrar por 2 facetas estrecha la rejilla a los que casan AMBAS (AND) | beauty+grwm (grupos distintos) → exactamente 2 templates, ambos botones pressed; coincide con psql | 03-*, snapshot | OK |
| 2 | Slot inválido muestra error EN VIVO (sin guardar) y bloquea guardar | `{foo.bar}` → `role="alert"` en vivo + Save disabled; `{product.name}` → sin error, Save enabled | 05-*, 06-* | OK |
| 3a | Guardar crea diff visible v2 vs v1 en el navegador | bloque "Diff · v2 vs v1" con líneas +/- (v1 original vs v2 editado) | 07-* | OK |
| 3b | En BD: `prompt_version` v1 (body anterior inmutable) y v2 (editado); `head_version=2`; `body`=editado | v1 = body sembrado original (len 1267, inmutable, no pisado); v2 = edición; template.head_version=2, body=v2 | db-prompt-version.txt | OK |

Query ejecutada (`db-prompt-version.txt`):
```
SELECT template_id, version, left(body,45) FROM prompt_version WHERE template_id='01KXK54ZCSWS4RPY8DJ8B77JV9' ORDER BY version;
 v1 | UGC smartphone video style, vertical 9:16, no...   (body ORIGINAL, inmutable)
 v2 | GRWM beauty edited body for T3.8 verification...   (body EDITADO)
head_version=2 ; template.body = v2
```

## Puntos de JUICIO
1. **Semántica AND de facetas** — DEFENDIBLE para la cláusula literal. "Filtrar por 2 facetas" = 2 facetas de grupos distintos (Vertical + Formato) con AND (`@>` por faceta, AND entre facetas): beauty+grwm → 2 resultados sensatos, no vacío. AND del MISMO grupo (`verticals @> {beauty,food}`) NO da vacío en este seed porque 18 templates son vertical-agnósticos (llevan las 9 verticals); devuelve esos 18. No rompe la intención de la Verificación. Sin hallazgo.
2. **Nav «Galería» + tests modificados** — SIN debilitamiento. `routes.test.ts` añade asserts POSITIVOS (`isHighlighted('/gallery', GALERIA)===true`) y conserva el invariante "un destino sin página nunca se resalta" con «Biblioteca» (href=null, pending F2) como fixture; el assert `expect(biblioteca?.pending).toMatch(/fase F2/)` valida contra el `routes.ts` REAL ("llega en la fase F2 (guiones y variantes)"), correcto. El test "NINGUNA ruta resalta dos destinos a la vez" ahora incluye `/gallery`. Nav real confirmada en navegador: Galería enlace activo, Biblioteca y Métricas deshabilitadas. Sin hallazgo.
3. **Adherencia al mockup 5a** — OK. Rail con Formato / Ángulo de hook / Vertical (+ Estado single-select), rejilla de tarjetas, botón "+ Nuevo template", ficha en diálogo con cuerpo+slots / beats / guards / versiones+diff. El implementer quitó Estética y Plataforma del rail visual (el mockup 5a no las dibuja) — decisión documentada y coherente; siguen filtrables por querystring. Estructura fiel al mockup.

## HALLAZGO ruteado (contraste WCAG · decisión de DS del usuario, NO bloqueante)
La medición de contraste texto/fondo (obligatoria, cua.md paso 3) detecta que **el resaltado de slot canónico (`text-accent` sobre `bg-accent-soft`) NO alcanza AA 4.5:1 en ningún tema**. Reproducido con las clases desnudas del DS (sin nada de T3.8), luego el defecto está en los VALORES del token del DS, no en el uso que hace T3.8 (que mapea correctamente valid=accent / invalid=danger). El DS es un espejo de solo-lectura (`docs/design-system/`, DesignSync) que el implementer no puede editar → se RUTEA a la decisión del usuario, no se marca FAIL (cua.md paso 3, rama "hallazgo a rutear si el color viene del DS").

Tabla de ratios (texto normal 14px/600 → umbral 4.5:1; compositando el alpha de los `-soft` sobre el fondo real):

| Elemento (color / fondo) | Dark | Light | Umbral | Estado |
|---|---|---|---|---|
| **Slot válido resaltado** (accent / accent-soft) | **2.81** | **4.13** | 4.5 | FALLA AA en ambos temas |
| Slot inválido resaltado (danger / danger-soft) | **4.19** | 4.97 | 4.5 | FALLA dark / OK light |
| Alerta de slot inválido en editor (text-danger) | 4.89 | OK | 4.5 | OK |
| Status badge draft (neutral) | 6.25 | 6.68 | 4.5 | OK |
| Botón de faceta del rail | 14.58 | 15.3 | 4.5 | OK |

Alcance real del hallazgo:
- **Slot válido (accent)** es el reachable: se muestra en CADA ficha (todo body sembrado tiene slots canónicos). Es el hallazgo principal (2.81 dark / 4.13 light, falla ambos).
- **Slot inválido (danger)** en la vista de lectura solo aparece si un template PERSISTE un slot no canónico. El PATCH (editar) lo rechaza (400, verificado) y el validador del seed (T3.2/gate) también; PERO el POST de creación valida solo SHAPE (`PromptTemplateSeedSchema` NO cruza slots del body contra §10.4 — nota de alcance en `contracts.ts:48`), así que un template creado por la UI podría llevar un slot inválido y renderizar la rama danger. Reachable pero secundario.

Recomendación (para el usuario, no bloquea T3.8): subir el contraste de `accent`/`accent-soft` (y `danger`/`danger-soft` en dark) en los tokens del DS, o usar un tono de acento más oscuro para texto sobre `-soft`. Mismo patrón de agujero que TD.7.

## Rarezas observadas (aunque PASS)
- El botón de faceta **beauty** (grupo Vertical, y=1382, fuera del viewport) no respondía al `click` de agent-browser hasta hacer `scrollintoview` primero; `grwm` (cerca del top) sí a la primera. Confirmado que NO es bug de la app: con `scrollintoview` el click de agent-browser lo togglea limpiamente (aria-pressed=true, 25 resultados). Era limitación de la automatización con refs fuera de pantalla, no de la UI.
- `02-filtro-1-beauty.png` se capturó ANTES de que el toggle aplicara (bytes idénticos a `01`); la evidencia válida de la cláusula 1 es `03-filtro-2-facetas-beauty-grwm.png` (estado final con ambas facetas por clicks reales scrolleados).

## Coste real
$0 — sin APIs de pago. T3.8 no llama a fal ni a ningún proveedor (el botón "probar template" es T4.12). Ninguna llamada externa.

## Veredicto
**PASS** — las 3 cláusulas literales se cumplen en el navegador real (2 facetas AND → 2 templates; slot inválido → error en vivo + guardar bloqueado; guardar → diff visible v1↔v2 en UI y `prompt_version` v1 inmutable + v2 en BD con head_version=2), gate y e2e verdes, consola limpia de errores propios. El único hallazgo (contraste sub-AA del resaltado accent/accent-soft) proviene de los tokens del DS (espejo de solo-lectura) y se RUTEA a la decisión del usuario con su tabla de ratios; no bloquea el cierre de T3.8.
