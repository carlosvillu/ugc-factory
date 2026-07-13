# Verificación T1.15 — Perfil `url` sin hero image: decisión de CP1, no fallo del run

- **Tarea**: T1.15 · Perfil `url` sin hero image: decisión de CP1, no fallo del run (`planning.md`, fase F1c)
- **Fecha**: 2026-07-13
- **Ejecutor**: verifier (contexto fresco) · agent-browser 0.27.0 · sesiones `t1.15` / `t115b` / `t115c`
- **Sistema**: commit base `212a7c7` + working tree con el diff de T1.15 (20 ficheros, sin commitear) · docker `ugc-postgres-dev` + `pnpm db:migrate` + `pnpm dev` (web en `http://localhost:3000`, worker ok, `/api/health` → `{"ok":true,"db":true}`)
- **Gate previo**: `pnpm gate` VERDE (lint + typecheck + format + knip + **1160 tests / 109 ficheros**). `pnpm test:e2e` **47/47** en la 2.ª pasada; en la 1.ª falló `runs-canvas.spec.ts › cancelar OTRO run en curso` (aislado: pasa; ver Rarezas).

## Verificación esperada (literal de planning.md)

> análisis por URL REAL de `https://es.stayforlong.com` (el caso que falló) → el run YA NO muere en N3: llega a CP1 con el aviso de imagen, se elige una opción, se aprueba y el run completa; la decisión está en `checkpoint_decision` asociada al step de CP1. Evidencia: el mismo input que el run muerto `01KXD1SPQ8EYKDZ4QXWD3WWX1Z`, ahora con brief aprobado.

## El ANTES (run muerto del usuario, 2026-07-13) — `00-before-dead-run.txt`

Run `01KXD1SPQ8EYKDZ4QXWD3WWX1Z` (`https://es.stayforlong.com`):

| node_key | status | error |
|---|---|---|
| N1 | succeeded | — |
| N2 | succeeded | — |
| **N3** | **failed** | `N3: el brief no supera la validación determinista (T1.9): missing_hero_image, hook_too_long` |

N2 clasificó 3 imágenes (award shield `unusable`, about-us `broll`, banner `broll`), `hero_image_url: null`.
`checkpoint_decision` del run: **0 filas**. El usuario no tenía ninguna salida.

## Pasos ejecutados (CUA — la app usada como un humano)

1. `pkill` de los dev servers previos + `rm -rf apps/web/.next` → `pnpm gate` verde → `pnpm test:e2e` 47/47 → `pnpm db:migrate` → `pnpm dev` (health ok).
2. `agent-browser`: login en `/login` con la contraseña real → `/analyses/new` (tab «Desde URL») → pego **`https://es.stayforlong.com`** (el MISMO input del run muerto) → «Analizar» (`01-intake-url.png`).
3. Run nuevo **`01KXDDNG2BR2YK8BCS90540T9T`** (`02-run-arrancado.png`). N1→N2→N3 progresan en el canvas.
4. **N3 NO muere**: llega a `waiting_approval` y el canvas abre el editor de CP1 (`03-cp1-alcanzado.png`) con:
   - el aviso `warning-needs_user_decision`: «Necesitamos una imagen principal del producto. No hay una imagen de producto clara: elige una de las imágenes de la página como principal, sube tus propias fotos, o genera un packshot con IA.»
   - las **TRES** salidas: «Subir imágenes del producto» · «Generar packshot con IA» · galería `hero-candidates` con **2 candidatas**, cada una con **la clasificación de N2 visible** (badge `lifestyle · broll`).
   - «Aprobar y continuar» **deshabilitado** (decisión pendiente).
5. Promuevo a hero la imagen **about-us** (`.../home_v2-about-us/about-us.webp`) con «Usar como principal» → `aria-pressed=true`, `data-selected=true`, y «Aprobar y continuar» **se habilita** (`04-imagen-promovida.png`).
6. Click en **«Aprobar y continuar»** → el editor desaparece y los 3 nodos quedan **`completado` en vivo (SSE, sin reload)** (`05-run-completado.png`).
7. **Reload** de `/runs/01KXDDNG2BR2YK8BCS90540T9T` → los 3 nodos siguen `completado`, sin editor: nada vivía en estado de cliente (`07-tras-reload.png`).
8. Guard del contrato: `curl -X POST /api/steps/<CP1>/approve` con `decision.images = promote_scraped` → **HTTP 400** con el mensaje esperado.
9. `/spend` muestra el gasto acumulado; `cost_entry` del run nuevo → **$0,18**.

## Resultado observado vs esperado

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | El run de la MISMA URL ya no muere en N3 | N3 `waiting_approval` (antes `failed` con `missing_hero_image`) | `06-after-db.txt`, `00-before-dead-run.txt` | ✅ |
| 2 | Llega a CP1 **con el aviso de imagen** | `warning-needs_user_decision` visible con copy accionable | `03-cp1-alcanzado.png` | ✅ |
| 3 | CP1 muestra las imágenes candidatas **con su clasificación de N2** | 2 candidatas (= `brief.assets.images`), badge `lifestyle · broll` en cada una | `03-cp1-alcanzado.png` | ✅ |
| 4 | Se elige una opción (promover una scrapeada) y se aprueba | Promoción del about-us → Aprobar habilitado → aprobado | `04-imagen-promovida.png` | ✅ |
| 5 | **El run completa** | N1/N2/N3 los tres `succeeded`; canvas «completado» ×3 vía SSE, sin reload | `05-run-completado.png`, `06-after-db.txt` | ✅ |
| 6 | **Canal DECISIÓN**: `checkpoint_decision` asociada al step de CP1 | fila en el step `01KXDDNG2AZ0Y4T33DB36BHT16` (`node_key=N3`, `is_checkpoint=t`): `{"kind":"brief","images":"promote_scraped","hero_image_url":"…/about-us.webp"}` | `06-after-db.txt` | ✅ |
| 7 | **Canal ARTEFACTO**: brief aprobado v2 / `edited_by_user` / `approved` / hero = la imagen elegida | `product_brief` v2 · `edited_by_user=t` · `status=approved` · `assets.hero_image_url = …/about-us.webp`. La v1 de la IA se conserva `draft` con hero `null` | `06-after-db.txt` | ✅ |
| 8 | Los DOS canales **coinciden** | `SELECT (decision->>'hero_image_url') = (brief.data->'assets'->>'hero_image_url')` → **`t`** | `06-after-db.txt` | ✅ |
| 9 | Sobrevive a un reload | Tras `reload`, estado final persistido (nodos completados, sin editor) + las 2 filas de BD | `07-tras-reload.png` | ✅ |
| 10 | Guard: `/approve` con `promote_scraped` → 400 | HTTP **400** `validation_error`: «Promover una imagen a hero EDITA el brief: usa POST /api/steps/:id/edit …» | § Pasos, punto 8 | ✅ |
| 11 | Consola sin errores de código propio | 0 `errors`; solo warnings de dependencia (React Flow `error#004`, ya registrado en T1.11) + ruido HMR de dev | `08-browser-console.txt` | ✅ |
| 12 | Contraste WCAG de la superficie NUEVA | ver tabla abajo — todo ≥ 4,5:1 en reposo | eval `getComputedStyle` | ✅ |

### Contraste (WCAG AA, umbral 4,5:1 texto normal)

| Elemento | color / fondo | ratio | AA |
|---|---|---|---|
| «Usar como principal» (seleccionado, `primary` en reposo) | `#fff` / `#5457e5` | **5,42** | ✅ |
| «Usar como principal» (no seleccionado, `secondary`) | `#f4f4f5` / `#212126` | **14,58** | ✅ |
| Badge `lifestyle · broll` (dark / light) | `#a1a1aa`/`#212126` · `#52525b`/`#eeeef1` | **6,25 / 6,68** | ✅ |
| «Subir imágenes» / «Generar packshot IA» | `#f4f4f5` / `#212126` | **14,58** | ✅ |
| «Aprobar y continuar» (habilitado) | `#052e16` / `#22c55e` | **6,54** | ✅ |

`--accent: #5457e5` está definido **una sola vez y es independiente del tema** (`globals.css:73`, con el comentario de TD.7 «Darkened … so white text clears WCAG AA (5.42:1)»), así que la medición en reposo cubre light y dark. El estado **hover** usa `--accent-hover: #6d71ea` → **4,04:1** con texto blanco: por debajo de AA, pero es un **token compartido del DS** (no introducido por T1.15) y un estado transitorio. Se reporta como hallazgo del DS a rutear (mismo criterio de cua.md §Paso 3), no bloquea esta tarea.

## Coste real

| Proveedor | Step | Cantidad | USD |
|---|---|---|---|
| Firecrawl | N1 | 4 credits | $0,00 (plan/caché) |
| Anthropic (Haiku) | N2 | 3 699 tokens | $0,00 |
| Anthropic (Sonnet) | N3 | 29 356 tokens | **$0,18** |
| **TOTAL run `01KXDDNG2BR2YK8BCS90540T9T`** | | | **$0,18** |

**$0,18** vs estimado **$0,30** (−40 %, por debajo) y muy por debajo del cap **$1**. `/spend` muestra el acumulado del proyecto ($0,63) — `09-spend.png`.

## Veredicto

**PASS** — La misma URL que mató el run del usuario (`01KXD1SPQ8EYKDZ4QXWD3WWX1Z`, N3 `failed` por `missing_hero_image`) ahora llega a CP1 con el aviso, ofrece las tres salidas, permite promover una imagen scrapeada a hero, y al aprobar el run completa: la **decisión** queda en `checkpoint_decision` sobre el step de CP1 (`promote_scraped` + la URL elegida) y el **artefacto** en una v2 de `product_brief` (`edited_by_user`, `approved`, `assets.hero_image_url` = esa misma URL). Los dos canales coinciden y sobreviven a un reload. Coste $0,18.

### Rarezas / hallazgos (no bloquean, se rutean)

1. **Miniatura rota en la galería de candidatas — y candidata promovible que NADIE podrá descargar.** Una de las 2 candidatas es `https://es.stayforlong.com/_next/image?url=…&w=1080&q=75`. Ese host **devuelve 403 a cualquier petición que no venga de su propia web** (protección hotlink/bot): verificado con `curl` (403) y **abriendo la URL en el Chrome real de la sesión → «403 Forbidden»**. Consecuencias:
   - En CP1 el `<img>` de esa candidata **no carga**: el usuario ve el icono de imagen rota y su `alt` (visible en `03-cp1-alcanzado.png`), o sea que la galería, cuyo propósito declarado es «elegir con criterio», le pide elegir a ciegas esa carta.
   - Peor: **esa URL es promovible**. Si el usuario la elige, se persiste (decisión + brief v2) un `hero_image_url` que **ningún consumidor podrá descargar** — y el que lo descubriría es **N7a (T4.4, F4) pagando fal.ai**, que es exactamente la clase de fallo diferido y caro que T1.15 existe para eliminar.
   - Origen: seam T1.14/T1.15. T1.14 relajó el filtro para que las URLs `/_next/image?url=…` (sin extensión) llegaran a N2 — y llegan; N2 las descarga desde el worker (donde el CDN sí sirvió esa vez) y las clasifica, pero el **navegador del usuario** y cualquier fetch posterior reciben 403. Recomendación: **nueva deuda de la familia F1c** — que las candidatas de CP1 se sirvan/validen su fetchabilidad (proxy propio de miniaturas o pre-check `HEAD` antes de ofrecerlas como promovibles), y nota en **T4.4** de que un `hero_image_url` promovido debe re-validarse antes de gastar en fal.ai.
2. **Consola**: 0 errores de código propio. Aviso honesto de alcance: `08-browser-console.txt` se capturó tras aprobar/recargar, así que no cubre el instante con la galería abierta — en ese instante hay, por lo dicho arriba, un error de red/recurso **de origen ambiental** (403 del CDN scrapeado), no de código propio. Los únicos warnings son de dependencia (React Flow `error#004`, ya presente en T1.11) y ruido HMR de dev.
3. **E2E flaky**: la 1.ª pasada de `pnpm test:e2e` falló en `runs-canvas.spec.ts › cancelar OTRO run en curso desde el botón del panel` (spec preexistente, ajeno a T1.15); reejecutado aislado pasa, y la 2.ª pasada completa dio **47/47**. Candidato a flaky bajo carga — vigilar.
4. **`pipeline_run.status` sigue en `pending`** para TODOS los runs de análisis (incluido el que T1.14 cerró en PASS): el agregado del run no lo mantiene aún el orquestador. «El run completa» se comprobó por sus 3 steps `succeeded` + el canvas. Hueco preexistente, ajeno a T1.15.
5. **agent-browser**: `wait --text` sobre `/runs/*` (SSE vivo) **colgó el daemon** de la sesión (`os error 35`), obligando a `close --all` y a rehacer login. Además, un `click` sobre un botón fuera del viewport devolvió «Done» sin efecto: hizo falta `scrollintoview` antes. Anotado para futuros CUAs.
