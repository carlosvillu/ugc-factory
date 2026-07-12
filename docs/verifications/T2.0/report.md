# Verificación T2.0 — Personas v1 (modelo, CRUD y seed manual)

- **Tarea**: T2.0 · Personas v1 (modelo, CRUD y seed manual) (`planning.md`)
- **Fecha**: 2026-07-12
- **Ejecutor**: subagente `verifier` (contexto fresco) · agent-browser 0.27.x · sesión `t2.0`
- **Sistema**: HEAD `bb89fb8` + diff sin commitear de T2.0 (el código verificado ES el del diff) · docker compose dev (Postgres 16, `ugc-postgres-dev`) + `pnpm db:migrate` + `pnpm seed` + `pnpm dev` en **PORT=3001** · healthcheck `{"ok":true,"db":true}` · **sin `INTERNAL_API_URL`** (T1.13 la quitó a propósito; NO se fijó)
- **Gate previo**: `pnpm gate` VERDE — 106 ficheros, **1089 tests** (`gate.txt`). **`pnpm test:e2e` re-ejecutado por mí**: **46/46 passed, exit 0**; y verificado que el spec permanente que ESTA tarea entrega (`apps/web/e2e/personas.spec.ts`) está de verdad DENTRO de la suite y pasa (**5/5**: CRUD con voice map es/en, upload ≥2K aceptado, <2K rechazado con mensaje visible, acciones de fases futuras deshabilitadas) — `e2e-personas.txt`. No me fié del «46/46» del brief: T2.0 añade un spec nuevo y un conteo previo no lo incluiría.

## Verificación esperada (literal de planning.md)

> crear una persona con 2 imágenes ≥2K y voice_map es/en desde el navegador; el endpoint de candidatas devuelve la persona correcta para un `avatar_hint` compatible y ninguna para uno incompatible; una imagen <2K es rechazada con mensaje claro.

## Pasos ejecutados

1. **Gate + sistema levantado**: `pnpm gate` verde; compose arriba; migraciones aplicadas; `pnpm seed` → `persona=2`; `pnpm dev` en 3001 con `/api/health` = `{"ok":true,"db":true}`.
2. **Personas del seed (las que hay DE VERDAD, no las que dice el implementer)**: `Lucía (placeholder)` = female/latina/casual/25-34 y `Marcus (placeholder)` = male/black/sporty/35-44 (`personas-seeded.txt`). Los hints de prueba los construí YO a partir de estas filas.
3. **Imágenes del seed son ficheros reales ≥2K**: medí los 4 PNG almacenados en `/tmp/ugc-assets-dev/personas/**` con **`sips`** (herramienta del SO, independiente del código del proyecto) → **1638×2048** los cuatro (`seeded-images-dimensions.txt`). El lado largo es 2048 = el umbral exacto: el seed NO tiene puerta trasera, pasa el mismo guard que el navegador.
4. **CLÁUSULA 1 — DESDE EL NAVEGADOR** (CUA, sesión `t2.0`): login real → `/personas` → botón «Nueva persona» → formulario relleno a mano (nombre `Nadia Verifier T2.0`, 30-39, femenino, mediterránea, streetwear, descriptor, escenario, personalidad, vestuario) con **voice_map ES (ElevenLabs · `verif-voice-es-001`) Y EN (MiniMax · `verif-voice-en-002`)** → «Crear persona». Después, **2 uploads ≥2K por el input de fichero de la ficha**, con **imágenes generadas por MÍ con ImageMagick** (no las fixtures del implementer): `verif-ok-A` **2400×3000** JPG y `verif-ok-B` **3000×2100** PNG.
5. **Comprobación de que quedan en la ficha**: el DOM sirve las dos imágenes desde el endpoint real de assets con `naturalWidth/Height` = **2400×3000** y **3000×2100**, y el pie dice «**2 imágenes de referencia · identity lock**». La voz muestra **English (MiniMax) + Español (ElevenLabs)** (`03-…png`, `05-…png`).
6. **CLÁUSULA 2 — endpoint de candidatas** (`GET /api/personas/candidates?avatar_hint=…`, contra la BD levantada, 6 hints construidos por mí — `candidates.txt`).
7. **CLÁUSULA 3 — imagen <2K desde el navegador**: subí `verif-small-1200x800.png` por el input de la ficha → **rechazada**, la imagen NO se añade (siguen 2), y aparece una alerta `role=alert` visible en rojo (`05-…png`). Además probé el **borde exacto**: `1600×2047` (un píxel por debajo) → también rechazada; 2048 pasa.
8. **El guard lee el FICHERO, no al cliente**: subí la imagen pequeña **mintiendo** el filename (`retrato-4096x4096-enorme.png`) y el mime → el servidor midió el fichero real con sharp y devolvió **HTTP 400** `validation_error` con las dimensiones REALES 1200×800 (`upload-2k-guard-lies.txt`). No hay puerta trasera por metadatos.
9. **Deuda de T2.1 (FK)**: `pg_constraint` → `confdeltype = 'n'` (`fk-pg-constraint.txt`).
10. **Contraste WCAG** (obligatorio en toda verificación de UI, cua.md) en dark Y light, con compositing alpha real (`contrast-wcag.txt`).
11. **CONTROL NEGATIVO del guard ≥2K** (principio 9): rompí `MIN_REFERENCE_LONG_EDGE_PX` 2048 → 512 y comprobé QUÉ se pone rojo; restauré y verifiqué byte a byte.
12. **Consola del navegador**: limpia (solo HMR/Fast Refresh de Next dev; ningún error) (`browser-console.txt`).
13. **E2E permanente de la tarea**: `pnpm test:e2e` → **46 passed (exit 0)**; y `playwright test e2e/personas.spec.ts` → **5 passed**, confirmando que el spec que T2.0 entrega se ejecuta de verdad y cubre lo que el planning le exige (`e2e-personas.txt`).

## Resultado observado vs esperado

| # | Esperado (literal) | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Crear una persona **desde el navegador** | Persona `Nadia Verifier T2.0` creada conduciendo la UI real (form + submit), aparece en la librería («3 personas») | `02-form-nueva-persona-voicemap-es-en.png`, `03-…png` | ✅ |
| 2 | …con **2 imágenes ≥2K** | 2 uploads MÍOS por el input de la ficha: 2400×3000 y 3000×2100 (`naturalWidth/Height` leídos del DOM); pie «2 imágenes de referencia · identity lock» | `03-…png`, `05-…png` | ✅ |
| 3 | …y **voice_map es/en** | Ficha muestra **Español** (ElevenLabs · `verif-voice-es-001`) y **English** (MiniMax · `verif-voice-en-002`) | `05-…png` | ✅ |
| 4 | Candidatas: **la persona correcta** para un hint **compatible** | `mujer 25-35 latina casual` → **solo Lucía**. `man 35-44, black, sporty` → **solo Marcus**. (Score **3** tras el fix del género —antes 4—, ver §Re-verificación) | `candidates.txt`, `candidates-refix.txt` | ✅ |
| 5 | Candidatas: **NINGUNA** para un hint **incompatible** | `persona 55-64, asiática, elegante` → **`[]`**; `adolescente 13-17, escandinavo, gótico` → **`[]`**; y **tras el fix** también `hombre 55-64 asiático elegante` → **`[]`** (el caso que yo cacé) | `candidates.txt`, `candidates-refix.txt` | ✅ |
| 6 | Imagen <2K **rechazada** | 1200×800 rechazada (no se añade: siguen 2 imágenes). Borde `1600×2047` también rechazado; 2048 pasa ⇒ umbral = lado largo ≥2048 exacto | `05-…png` | ✅ |
| 7 | …con **mensaje claro** | «**Imagen demasiado pequeña: 1200×800 px. El identity lock exige al menos 2048 px en el lado largo (2K).**» — visible en `role=alert`, dice qué pasó, cuánto mide y cuánto hace falta. HTTP **400** tipado, no 500 ni stack trace. Contraste **16.68:1** (dark) / **14.39:1** (light) | `05-…png`, `06-…png`, `upload-2k-guard-lies.txt`, `contrast-wcag.txt` | ✅ |
| 8 | (Deuda T2.1) FK `ON DELETE set null` | `confdeltype = 'n'` · `FOREIGN KEY (persona_id) REFERENCES persona(id) ON DELETE SET NULL` | `fk-pg-constraint.txt` | ✅ |
| 9 | (Alcance usuario) Seed = 2 personas placeholder con imágenes sintéticas **reales ≥2K** | 4 PNG en disco, **1638×2048** medidos con `sips` (fuera del código del proyecto) | `seeded-images-dimensions.txt` | ✅ |

## Control negativo (principio 9 — obligatorio)

Rompí el guard central a propósito: `MIN_REFERENCE_LONG_EDGE_PX` **2048 → 512** en `packages/core/src/persona/contracts.ts`.

- **ROJO, y el rojo es EL DEL GUARD** (no otro por casualidad): `src/persona/validate-reference-image.test.ts` → **2 tests fallan**, y son exactamente las dos aserciones de rechazo:
  - `× RECHAZA una imagen un solo píxel por debajo del umbral, con mensaje accionable` → `expected { width: 1637, height: 511 } to be an instance of AppError`
  - `× RECHAZA una imagen claramente pequeña (el caso del usuario: sube una miniatura)` → `promise resolved "{ width: 512, height: 640 }" instead of rejecting`
  - Total: `Test Files 1 failed | 36 passed` · `Tests 2 failed | 600 passed` (`negative-control-RED.txt`)
- **RESTAURADO y VERDE**: el fichero vuelve a `2048`; **sha idéntico al de antes del experimento** (`8ffc3cfee0b9457f11eacb79a36107416e167cc6`), y `src/persona/validate-reference-image.test.ts` → `Tests 6 passed (6)` (`negative-control-GREEN.txt`).
- ⚠ Nota operativa: `git checkout --` NO restaura este fichero (es **untracked**: T2.0 está sin commitear). La restauración se hizo a mano y se verificó por sha + `git status`, que queda idéntico al inicial salvo `docs/verifications/T2.0/`.

## Rarezas y hallazgos (no bloquean el PASS, pero se reportan)

### 1. ~~El hint «incompatible» devolvía candidata por el género~~ → **RESUELTA EN T2.0** (2026-07-12)

**El hallazgo (verificación original)**: `hombre 55-64 asiático elegante` → devolvía **Marcus** (score 1,
`matched: ["hombre"]`) en vez de `[]`. Marcus es 35-44 / black / sporty: edad disjunta, etnia distinta,
estilo distinto. Casaba **solo por el token de género**. El género era **asimétrico**: descalificaba si no
coincidía, pero si coincidía **sumaba un punto**. Con la librería sembrada (una mujer, un hombre),
CUALQUIER hint que nombrara un género devolvía a esa persona con score ≥1.

**La decisión del usuario (2026-07-12): afinarlo ANTES de cerrar.** El fix, en
`packages/core/src/persona/candidates.ts`: **el género es un FILTRO, no una señal de afinidad.** Sigue
descalificando a quien no coincide (regla intacta), pero coincidir ya NO puntúa — sus tokens se excluyen
del recuento de solape (`if (genderTokens.has(token)) continue;`).

**Comportamiento resultante, RE-VERIFICADO por mí contra el endpoint real** (ver §«Re-verificación»):
`hombre 55-64 asiático elegante` → **`[]`**; `mujer 25-35 latina casual` → Lucía **score 3** (antes 4: el
género inflaba) y **sin `mujer` en `matched`**; `man 35-44, black, sporty` → Marcus score 3 (el camino
bueno sigue intacto). Queda **cerrada**: ya no es deuda ni decisión pendiente.

### 2. Contraste AA en tema LIGHT: `ghost` y `danger-ghost` fallan — **defecto heredado del Design System, no de T2.0**

| Elemento (tema light) | ratio | umbral | pasa |
|---|---|---|---|
| Alerta de rechazo <2K (lo que la Verificación exige) | **14.39:1** | 4.5 | ✅ |
| btn «Nueva persona» (primary) | 5.42:1 | 4.5 | ✅ |
| btn «Editar» (`ghost`) | **2.48:1** | 4.5 | ❌ |
| btn «Eliminar» (`danger-ghost`) | **3.20:1** | 4.5 | ❌ |

En **dark** (el tema por defecto de la app) los cuatro pasan (16.68 / 5.42 / 7.72 / 4.87).

Los dos que fallan son **variantes del primitivo del DS** (`apps/web/src/components/ui/button.tsx`, tokens `text-muted` y `text-danger`/`bg-danger-soft`). T2.0 las **consume correctamente** (`persona-detail.tsx:284-289`), no hardcodea colores. **Prueba de que es heredado**: la propia página `/design-system` (fase FD, ya verificada, pre-T2.0) mide `danger-ghost` en light a **3.02:1 y 2.66:1** — el mismo fallo, y las mismas variantes ya viven en `login-form`, `intake-form`, `step-panel` y `checkpoint-banner`, todas cerradas. Según cua.md, un color que viene del DS **se REPORTA con la tabla de ratios y se rutea** (la decisión es del usuario), no se convierte en FAIL de la tarea que lo consume. **Queda reportado como deuda del DS** (candidato a tarea propia: subir la luminancia de `text-muted`/`text-danger` en `[data-theme=light]`).

### 3. Botones deshabilitados con motivo en `aria-label`

«Usar en lote · llega en T2.3 (la UI de matriz de variantes)» y «Generar variación · llega en la fase F4 (generación IA de referencias)» aparecen `[disabled]` con el motivo en el `aria-label`. **Es lo esperado** (decisión del usuario 2026-07-12, coherente con T1.13). No es un fallo.

### 4. Rareza del arnés (no de la tarea)

`pnpm dev` se corrompió dos veces por `.next`/turbopack (SST files) al reiniciar con procesos vivos. Se resolvió matando los procesos, `rm -rf apps/web/.next` y relanzando.

## Re-verificación de la cláusula 2 (2026-07-12, tras el fix del género)

**Alcance**: SOLO la cláusula de candidatas. Las otras dos (creación desde el navegador con 2 imágenes
≥2K + voice_map es/en; rechazo de <2K con mensaje claro) siguen válidas: el fix no toca ni el upload, ni
el guard, ni la UI. El veredicto de esas dos no se re-emite.

**Sistema**: mismo stack levantado (compose + migraciones + seed + `pnpm dev` en **:3001**, health
`{"ok":true,"db":true}`), mismas 2 personas sembradas (Lucía female/latina/casual/25-34 · Marcus
male/black/sporty/35-44). Endpoint real, BD real. Evidencia: `candidates-refix.txt`.

| # | Caso | Hint | Esperado | Observado | OK |
|---|---|---|---|---|---|
| 1 | Compatible (es); el género ya NO debe aparecer en `matched` | `mujer 25-35 latina casual` | Lucía, sin `mujer` en `matched` | **Lucía, score 3**, `matched:["age_range","latina","casual"]` — sin `mujer` | ✅ |
| 2 | **El caso que YO encontré** | `hombre 55-64 asiático elegante` | **`[]`** | **`[]`** (antes: Marcus score 1) | ✅ |
| 3 | **No romper el camino bueno** (género + señales reales) | `man 35-44, black, sporty` | Marcus | **Marcus, score 3**, `matched:["age_range","black","sporty"]` | ✅ |
| 4 | Incompatible sin género (no-regresión de mi caso C) | `persona 55-64, asiática, elegante` | `[]` | **`[]`** | ✅ |
| 5 | Incompatible (nadie encaja) | `adolescente 13-17, escandinavo, gótico` | `[]` | **`[]`** | ✅ |
| 6 | Solo género masculino | `hombre` | `[]` | **`[]`** (antes: Marcus score 1) | ✅ |
| 7 | Solo género femenino | `mujer` | `[]` | **`[]`** (antes: Lucía score 1) | ✅ |
| 8 | Género correcto + UNA señal real → debe seguir saliendo | `mujer latina` | Lucía | **Lucía, score 1**, `matched:["latina"]` | ✅ |
| 9 | El FILTRO por género sigue descalificando | `hombre 25-35 latina casual` | Lucía NO puede salir | Lucía **descartada** ✓ (sale Marcus score 1 por `age_range`, ver nota) | ✅ |

**Nota sobre el caso 9** (lo miré por si el fix había roto algo, y NO): sale Marcus con score 1 porque el
hint pide `25-35` y Marcus es `35-44` — los intervalos **se tocan en el 35** (solape de intervalos
cerrados, regla preexistente y explícitamente testeada: `candidates.test.ts:128`). Esto pasaba **igual
antes del fix** (entonces con score 2: `age_range` + `hombre`), así que **no es regresión**: el fix solo
redujo ruido. Es una arista conocida de la regla de edad, no del género.

**¿Se debilitaron tests para pasar?** NO — lo comprobé leyendo el diff de `candidates.test.ts`:
- El test que afirmaba el comportamiento viejo se **reescribió para afirmar el nuevo con la misma dureza**:
  antes `expect(matched).toContain('mujer')` + `score).toBe(4)`; ahora `expect(matched).not.toContain('mujer')`
  + `score).toBe(3)` (score exacto, ausencia de token explícita).
- Se **añadió** un test que fija mi hallazgo: `scorePersona(MARCUS,'hombre 55-64, asiático, elegante').score === 0`
  **y** `matchPersonas(...) === []`.
- Los tests de descalificación por género y el bilingüe (es/en) **siguen ahí**, ahora afirmando el efecto
  real del género (filtrar). Nada borrado, nada relajado. Total: **1090 tests** (+1 sobre 1089).

### Control negativo del fix (obligatorio)

Revertí el fix (quité `if (genderTokens.has(token)) continue;` → el género vuelve a contar en el solape):

- **ROJO, y en los tests CORRECTOS** (`candidates-refix` → `negative-control-candidates-RED.txt`):
  - `× EL GÉNERO FILTRA, NO PUNTÚA: coincidir es el mínimo…` → **`AssertionError: expected 1 to be +0`** —
    literalmente el bug que reporté (Marcus puntuando 1 con `hombre 55-64 asiático elegante`).
  - `× casa etnia, estilo y el SOLAPE de rangos de edad…` → `expected [Array(4)] to not include 'mujer'`.
  - `Test Files 1 failed` · `Tests 2 failed | 13 passed (15)`. Sin daño colateral.
- **RESTAURADO y VERDE**: sha **idéntico** al de antes del experimento (`038a574c92cc289aff6c76ff26bb2cbb8c4908c3`),
  `candidates.test.ts` → **15/15** (`negative-control-candidates-GREEN.txt`). Restaurado **a mano**: el fichero
  es **untracked** (T2.0 sin commitear), `git checkout --` no lo recupera.
- **Gate completo re-ejecutado**: **106 ficheros / 1090 tests / exit 0** (`gate-refix.txt`).

⚠ **Falso positivo del gate que me encontré** (rareza del arnés, NO defecto del código): con un `pnpm dev`
vivo en :3001, `pnpm gate` **falla** (`Test Files 1 failed`) aunque los 1090 tests pasen — revienta
`apps/web/test/integration/server/sse-contract.test.ts`, que arranca **su propio** `next dev` y choca
(«Another next dev server is already running. PID …»). Matando el dev server y repitiendo: **1090/1090,
exit 0**. Conviene saberlo: el gate no es hermético frente a un dev server en marcha.

## Coste real

**$0** — esta tarea no llama a ninguna API de pago (ni fal.ai, ni Anthropic, ni Firecrawl). Las imágenes de referencia del seed son PNG sintéticos generados localmente con `sharp`; las mías, con ImageMagick local. Nada pidió gastar dinero. Estimado: $0. Desviación: 0 %.

## Veredicto (reemitido tras el fix del género, 2026-07-12)

**PASS** — las tres cláusulas de la Verificación se cumplen contra el sistema real levantado: (1) persona creada **desde el navegador** con **2 imágenes ≥2K** (2400×3000 y 3000×2100, subidas por mí) y **voice_map es+en**, visibles en su ficha; (2) el endpoint de candidatas devuelve **la persona correcta** para hints compatibles (Lucía / Marcus) y **`[]`** para incompatibles; (3) la imagen <2K se rechaza con un mensaje **claro, visible y accionable** («Imagen demasiado pequeña: 1200×800 px. El identity lock exige al menos 2048 px en el lado largo (2K)»), con HTTP 400 tipado y AA holgado en ambos temas. El guard ≥2K lee el **fichero** con sharp (probado mintiendo filename/mime) y el **control negativo** lo confirma: romperlo pone en rojo exactamente sus dos tests de rechazo, y restaurarlo los devuelve a verde con el fichero byte-idéntico. La deuda de T2.1 queda saldada (`confdeltype='n'`). **El hallazgo que reporté (rareza #1) se ha ARREGLADO dentro de T2.0 y lo he re-verificado contra el endpoint real**: el género pasa a ser FILTRO y no señal de afinidad, así que `hombre 55-64 asiático elegante` ahora devuelve **`[]`**, los hints compatibles devuelven la persona correcta con `matched` limpio de género (score 3), y el camino bueno (`man 35-44, black, sporty` → Marcus) sigue intacto; los tests se **reescribieron sin debilitarse** (+1 test que fija el hallazgo, 1090 verdes) y el **control negativo** revienta exactamente el test correcto (`expected 1 to be +0`) y restaura byte-idéntico. Queda **un** hallazgo abierto que **no bloquea**: el fallo de contraste AA en tema light de las variantes `ghost`/`danger-ghost`, que es **deuda heredada del Design System** (reproducida en `/design-system`, fase FD ya cerrada) y no de esta tarea.
