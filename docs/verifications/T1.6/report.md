# Verificación T1.6 — Entrada por texto libre

- **Tarea**: T1.6 · Entrada por texto libre (`planning.md`)
- **Fecha**: 2026-07-10
- **Ejecutor**: verifier (escéptico) · agent-browser 0.27.x (login/orientación) + chrome-devtools MCP (flujo con upload) · sesión `t1.6`
- **Sistema**: HEAD `3519f00` + working tree de T1.6 SIN commitear (el diff ES el sistema bajo prueba; `git status` solo muestra los cambios de T1.6 + mi evidencia). Docker compose dev (Postgres 16 en :55432) + `pnpm dev` de apps/web en :3000 (SIN worker: el modo manual no ejecuta pipeline). Migraciones aplicadas (incl. 0006 UNIQUE parcial). `ensureDefaultProject` resuelve el proyecto.
- **Coste real**: $0 (Postgres local, cero scraping, cero APIs de pago).

## Verificación esperada (literal de planning.md)
> crear un análisis solo con un párrafo y 2 imágenes → `url_analysis` en `done` sin ninguna llamada de scraping (logs); repetir el mismo texto reutiliza la caché (sin fila nueva).

## Pre-gate
- `pnpm gate` → VERDE: lint + typecheck + format:check + knip OK; **655/655 tests** (66 files).
- E2E `intake-manual.spec.ts` (stack propio en :3100, human-equivalent `setInputFiles`) → **5/5 pasan**, incl. "envío CON imágenes adjunta las referencias" y "reutilización observable: mismo texto → mismo análisis".

## Pasos ejecutados (operado desde la UI, en el navegador)
1. Login (`/login`) → home. Baseline BD: `url_analysis WHERE source='manual'` = **0**.
2. `/analyses/new` → párrafo con nonce único (`T1.6-verif-9f3a2c-1783712383`, 258 chars) + **2 imágenes** (`intake-ref-a/b.png`). Ambas en la lista y en log `POST /api/assets 201` (×2). Screenshot `02`.
3. Click **Analizar** → aterrizo en `/analyses/01KX6SPTJGYG6V00WBY23NVTYD`: **Origen: manual · Estado: done · Imágenes de referencia (2)**. Screenshot `03`. Consola limpia.
4. **Cláusula 1 — cero scraping**: ventana de log del submit (`log-04`) SOLO `intake manual creado` (reused:false) + `POST /api/analyses 201` + `GET /analyses/:id 200`. Barrido total (`log-05`,`log-10`) por ingest|firecrawl|jina|scrap|probe|pg-boss|enqueue|pending|scraping|outbound → **vacío**. psql (`psql-01`): source=manual, platform=manual, url_normalized=NULL, status=done, n_images=2. Conteo 0→1.
5. **Cláusula 2 — reutilización**: `/analyses/new` → MISMO párrafo, **2 imágenes DISTINTAS** (`diff-img-c/d.png`, checksums distintos). Conteo antes (`psql-06`)=1.
6. Aterrizo en el **MISMO id** (screenshot `05`), imágenes mostradas = las 2 ORIGINALES → reutilización por hash de SOLO texto (§7.4). Log (`log-08`): `intake manual reutilizado (caché)`, reused:true, `POST /api/analyses 200`. Conteo después (`psql-07`)=**1** (SIN fila nueva).
7. **Control**: texto DISTINTO → id NUEVO `01KX6SWD7HPW1EET1C6CXWWX01` (screenshot `06`), conteo 1→2, content_hash distinto (`psql-09`).

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1a | Párrafo + 2 imágenes → fila en `done` | status=done, n_images=2, source/platform=manual, url_normalized=NULL | 03-*.png, psql-01 | ✅ |
| 1b | SIN ninguna llamada de scraping (logs) | Solo POST /api/analyses; barrido total sin ingest/firecrawl/jina/probe/pg-boss/pending | log-04, log-05, log-10 | ✅ |
| 2a | Repetir mismo texto reutiliza caché — SIN fila nueva | Conteo 1→1; reused:true, HTTP 200 | psql-06, psql-07, log-08 | ✅ |
| 2b | Reutilización observable (mismo destino) | 2.º submit → MISMO id, imágenes originales | 05-*.png | ✅ |
| 2c | (§7.4) mismo texto + imágenes distintas SIGUE reutilizando | Subí 2 imágenes distintas y reutilizó igual | 04-*.png, 05-*.png | ✅ |
| ctrl | Texto distinto SÍ crea fila nueva | id nuevo, conteo 1→2, hash distinto | 06-*.png, psql-09 | ✅ |

## Coste real
$0 — sin APIs de pago (el short-circuit manual no scrapea ni llama a proveedores). T1.6 no lleva coste estimado. Sin desviación.

## Veredicto
**PASS** — ambas cláusulas se cumplen literalmente contra el sistema real operado desde la UI: creación manual en `done` con 2 imágenes y CERO scraping en logs; repetición del mismo texto reutiliza la caché sin fila nueva (mismo id de destino), con control texto-distinto creando fila nueva.

### Notas / rarezas (no bloquean el PASS)
1. **Setup de entorno (NO defecto de T1.6)**: el `.env` del usuario no tiene `ASSETS_DIR`; el server cayó al default de producción `/data/assets` → upload fallaba con `ENOENT: mkdir '/data'` (500). `.env.example` YA documenta `ASSETS_DIR=/tmp/ugc-assets-dev` para dev (var de T0.5, anterior a este diff). Lo resolví lanzando `next dev` con `ASSETS_DIR=/tmp/ugc-assets-dev` inline (prep de entorno; NO edité `.env` ni código). Recomendación al usuario: añadir `ASSETS_DIR` a `.env`.
2. **Robustez del manejo de error de upload (deuda menor, fuera del alcance literal)**: en `intake-form.tsx` `onFilesSelected`, un error NO-`ApiError` (p. ej. `TypeError: Failed to fetch`) hace `throw e` que, invocado vía `void onFilesSelected(...)`, escapa como `unhandledRejection` SIN feedback al usuario. La validación en alcance (mime/tamaño → ApiError → Alert) sí funciona. Recomiendo capturar el caso genérico y avisar; no bloquea T1.6.
3. **Artefacto de automatización (NO producto)**: agent-browser (CDP setFileInputFiles) no dispara de forma fiable el onChange del input file controlado por React bajo turbopack HMR. El upload SÍ funciona para un humano: probado con curl (201) y con Playwright/chrome-devtools MCP (setInputFiles, 5/5 E2E verdes). El flujo CUA con imágenes se completó con chrome-devtools MCP (navegador real, upload human-equivalent).
