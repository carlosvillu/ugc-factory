# T4.12 — Verificación · Generación de Personas, thumbnails y "probar template"

- **Fecha**: 2026-07-19 · **RE-VERIFICACIÓN** tras el fix del FAIL de cláusula 2 (thumbnails sin cablear a /gallery).
- **Verifier**: contexto fresco, escéptico. NO implementa código, NO regenera (disciplina T4.11: se LEE la BD ya producida).
- **VEREDICTO GLOBAL: PASS** (las 3 cláusulas cumplen; la cláusula 2 que había fallado ahora renderiza el thumbnail real en /gallery).

## Historial
1. **1a pasada -> FAIL**: cláusulas 1 y 3 PASS; cláusula 2 parte de ESTADO PASS pero parte OBSERVABLE «en /gallery» FAIL — el thumbnail generado NO se renderizaba en ninguna superficie (la tarjeta pintaba un hatch-placeholder hardcodeado con el texto «thumbnail»; la ficha no pintaba imagen). Evidencia del fallo: `01-gallery-thumbnails.png`, `02-template-ficha.png`, `03-gallery-grid-published-hatch-placeholder.png`.
2. **Fix (wiring de UI)**: `thumbnailAssetId` movido a `TemplateSummarySchema`; `template-card.tsx` y `template-detail.tsx` pintan la primitiva `Image` del DS con `src=/api/assets/:id/download`; e2e ampliado con assert observable (`data-status="loaded"`) + control negativo (draft -> `data-status="empty"`).
3. **Esta RE-VERIFICACIÓN -> PASS** (abajo).

## Verificación LITERAL (planning.md:668, 3 cláusulas)

> «10 Personas activas con referencias consistentes (mismo sujeto a juicio humano); los ~50 templates quedan `published` con thumbnail en `/gallery` (ninguno publicado sin thumbnail); "probar template" genera un clip/imagen barata visible en la ficha con su coste en `/spend`.»

## Gate previo

`pnpm gate` (DOCKER_HOST al socket Docker Desktop) -> **VERDE**: lint + typecheck + format:check + knip + readme:status:check + test. **205 test files / 2105 tests passing** (exit 0). Evidencia: `gate-reverify.txt`.

> NOTA (rareza diagnosticada, NO fallo real): una primera corrida del gate dio 1 test rojo — `sse-contract.test.ts:81` «next dev murió durante el arranque (code 1)». Causa raíz: MI propio `pnpm dev` (para conducir /gallery por UI) ocupaba el puerto 3000 que ese test necesita para su `next dev`. Al liberar el puerto, el gate pasa limpio (205/205). No es regresión del fix (el fichero no lo toca el diff y no tiene nada de gallery/thumbnail/persona).

## Sistema levantado

- Postgres dev `ugc-postgres-dev` healthy, puerto 55432.
- `pnpm --filter @ugc/web dev` (puerto 3000) contra el dev-DB. Startup log: `templates:56`, `personas:10`, `imagesCreated:0` (seed idempotente -> estado PRODUCIDO preservado, sin regenerar).
- Login como humano (`/login`, `AUTH_BOOTSTRAP_PASSWORD` del `.env`), navegación real a `/gallery` con agent-browser (sesión `t412r`).

---

## Cláusula 1 — 10 Personas activas con referencias consistentes (mismo sujeto a JUICIO HUMANO): **PASS**

### Estado observable (BD dev, query directa + `inspect:personas` read-only)

| Comprobación | Esperado | Observado |
|---|---|---|
| No de personas | 10 | **10** OK |
| personas activas (>=2 refs IA) | 10 | **10** OK |
| refs IA por persona (kind=`reference_image`, generation_id no-null) | >=2 | **3 cada una** OK |
| refs sintéticas (generation_id null) | 0 (post-cleanup) | **0** OK |
| lado largo de cada ref IA | >=2048px | **2752px** (1536x2752) OK |

Las 10: Alex, Carmen, Chloe, David, Kenji, Lucía, Marcus, Nerea, Priya, Rosa — sufijo `(placeholder)` INTENCIONAL (§11). Evidencia: `inspect-personas-output.txt`.

### «Mismo sujeto a JUICIO HUMANO»

Registro DURABLE en `docs/dev-loop/journal.md` (no solo en el brief):
- **L1997** (2026-07-19): contact sheet de las 8 nuevas x 3 encuadres -> **AskUserQuestion -> «Sí, las 8 valen — cerrar T4.12»** (incluida la aceptación explícita de la deriva de EDAD de Kenji ~50 vs «late 30s»: cara curtida, no deriva de identidad).
- **L1964**: sample LUCIA/MARCUS -> **«Sí, escala a 10 personas»** (aprobación del mecanismo identity-lock).

---

## Cláusula 2 — ~50 templates `published` con thumbnail EN /gallery (ninguno publicado sin thumbnail): **PASS**

### Parte A — invariante de ESTADO «ninguno publicado sin thumbnail»: **PASS**

| Comprobación (BD dev) | Esperado | Observado |
|---|---|---|
| total templates | ~50 | **56** OK |
| status=`published` | todos | **56** (0 draft) OK |
| published SIN thumbnail | 0 | **0** OK (clave dura) |

### Parte B — VISIBLE «en /gallery» (la que había FALLADO): **PASS** <- foco de la re-verificación

Conducido por la UI real (login humano -> `/gallery`), con evidencia observable de que los BYTES cargaron (no un `<img>` en opacity-0):

- **Rejilla**: los **56** `[data-slot="image"]` de las tarjetas alcanzan `data-status="loaded"` con **`naturalWidth>0`** (bytes decodificados), `src=/api/assets/<id>/download`. `byStatus: {loaded: 56}`, `loadedWithBytes: 56`. Screenshot `04-gallery-thumbnails-loaded-FIXED.png`: las tarjetas muestran las MINIATURAS REALES (persona con móvil enseñando app SaaS, demo de móvil, before/after fitness) — NO el hatch «thumbnail» de antes.
- **Ficha (detalle)**: `[data-slot="template-thumbnail"]` con `Image` en `data-status="loaded"`, `naturalWidth=576`, `src=/api/assets/<id>/download`. Screenshot `05-ficha-thumbnail-FIXED.png`: el thumbnail real se ve arriba de «Cuerpo del prompt».
- Sin errores de consola en /gallery.

**Cobertura permanente**: `gallery-generation.spec.ts` asevera que una tarjeta de template published alcanza `[data-slot="image"][data-status="loaded"]` con `src` al asset (los bytes cargaron, NO falso PASS) + control negativo: un draft sin thumbnail alcanza `data-status="empty"`.

---

## Cláusula 3 — "probar template" genera clip/imagen barata visible en la ficha con coste en /spend: **PASS**

Verificado por `apps/web/e2e/gallery-generation.spec.ts` contra el stack real + **fal FAKE ($0)** (disciplina de coste; mecanismo cerrado en Pase A). Leí el spec (material no confiable): el test «probar template» hace click en el botón real `[data-slot="template-test-button"]`, espera el POST `/templates/:id/test` 200, asevera imagen de prueba `[data-slot="template-test-image"]` + coste `[data-slot="template-test-cost"]` VISIBLES en la ficha, ledger scoped a `template_test=true` +1, y fila `fal.ai` en `/spend` con total NO-cero.

**Ejecutado en esta re-verificación**: `4 passed (18.9s)` — incluido el test #3. Evidencia: `e2e-gallery-generation-reverify.txt`.

> El total inflado de /spend (filas flux de debug previas) NO afecta: la cláusula asevera que APARECE coste de la prueba, no un total concreto; el spec lo verifica con ledger SCOPED.

---

## Resumen por cláusula

| Cláusula | Veredicto | Evidencia |
|---|---|---|
| 1 · 10 personas activas, mismo sujeto (juicio humano) | **PASS** | query BD + inspect-personas-output.txt + journal L1997/L1964 |
| 2A · ninguno published sin thumbnail (estado) | **PASS** | query BD (56/56, 0 sin thumbnail) |
| 2B · thumbnail VISIBLE en /gallery (observable) — antes FAIL | **PASS** | 04/05 screenshots + DOM 56x`data-status="loaded"`+naturalWidth>0 + e2e |
| 3 · probar-template visible en ficha + coste en /spend | **PASS** | e2e-gallery-generation-reverify.txt (4 passed, fal fake $0) |

## Coste real

- **$0** gastado por el verifier (BD ya producida leída; e2e con fal fake; sin regeneración).
- Coste ya incurrido por el bucle en T4.12 (contexto): ~$4.06 acumulado, bajo el techo ~$5.1. vs estimado planning ~$5.

## Rarezas / notas
- 1a corrida del gate roja por conflicto de puerto 3000 (mi propio dev server), NO regresión — al liberar el puerto: 205/205 verde.
- Sufijo `(placeholder)` en personas: INTENCIONAL (§11).
- `inspect:personas` emite un `AVISO NO coincide` diseñado para el estado pre-cleanup; el estado observado (0 sintéticas, 3 IA) es el DESEADO.
- Kenji ~50 vs «late 30s»: aceptado por el usuario (journal L1997) como deriva de edad, no de identidad.

## Evidencia (docs/verifications/T4.12/)
- `04-gallery-thumbnails-loaded-FIXED.png`, `05-ficha-thumbnail-FIXED.png` — thumbnails REALES visibles (post-fix)
- `01/02/03-*.png` — estado PRE-fix (el FAIL cazado; memoria del proyecto)
- `e2e-gallery-generation-reverify.txt` — 4 passed · `gate-reverify.txt` — 205/205
- `inspect-personas-output.txt` — 10 personas x 3 refs IA 2752px
