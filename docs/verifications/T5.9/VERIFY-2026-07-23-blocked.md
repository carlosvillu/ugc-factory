# Verificación T5.9 — E2E de la fase F5 (criterios 22.1/22.2/22.8)

- **Tarea**: T5.9 · E2E de la fase (F5) — export (`planning.md:778-785`)
- **Fecha**: 2026-07-23
- **Ejecutor**: verifier (agente) · agent-browser no invocado · sesión no abierta
- **Sistema**: HEAD `aeed0f27` · docker-compose.dev Postgres (persistente, port 55432, healthy) · `pnpm dev` NO arrancado
- **Coste real**: **$0** (CERO — no se llamó a fal/Anthropic/Firecrawl; el bloqueo se detectó ANTES de gastar)

## VEREDICTO: **BLOCKED** (bloqueo de estado del árbol) — NO es FAIL de T5.9, NO se gastó

> El working tree contiene trabajo UNCOMMITTED de una tarea ADYACENTE (la «auditoría del
> journal / determinismo-primero» del 2026-07-23), editado DURANTE esta sesión de verificación,
> incluyendo **código de producto** (`apps/web/src/app/globals.css`) y un **hook del arnés**
> (`.claude/hooks/guard-planning.sh`). No puedo establecer un `pnpm gate` verde atribuible ni una
> base estable para un run de fal REAL de ~$15 y ~45 min que es ESTATEFUL. Se detiene ANTES de gastar.

## Verificación esperada (literal de planning.md:783)
> (a) URL real → ≥6 variantes aprobadas (2 ángulos × 3 hooks) de 15–30 s en es+en, captions karaoke
> correctas, C2PA firmado, coste del lote <$15 en tier **Premium**, <45 min de reloj con checkpoints
> atendidos; (b) **texto libre con 0 imágenes**: párrafo → decisión packshot-IA en CP1 → al menos 1
> variante aprobada con `synthetic_product=true`; (c) **criterio 22.8**: las voces de las variantes es
> y en son nativas y corresponden al `voice_map` de su Persona (revisión humana de 1 variante por idioma).

## Por qué BLOCKED (no PASS, no FAIL)

### 1. El gate previo está ROJO — pero 100% por contaminación AJENA a T5.9
`pnpm gate` (raíz, `DOCKER_HOST` al socket de Docker Desktop) aborta en dos escalones, ambos por
ficheros que NO son de T5.9:

| Escalón del gate | Falla por | ¿De T5.9? |
|---|---|---|
| `format:check` (prettier) | `scripts/check-contrast.mjs` con style issues | ❌ ajeno |
| `knip` | `scripts/check-contrast.mjs` + `scripts/check-e2e-wired.mjs` como *unused files* | ❌ ajeno |
| `lint` (eslint) | 0 errores (28 warnings pre-existentes de `sharp`/`prettier`) | — |
| `typecheck` (tsc -r) | ✅ verde (todos los paquetes) | — |

`test` y `test:e2e` NO se ejecutaron: no aportan señal contra un árbol en movimiento, y el diff de T5.9
ya está certificado verde por el coordinador (2394 tests + e2e 76 passed sobre `f5-export.spec.ts`).

### 2. El árbol lleva trabajo UNCOMMITTED de una tarea adyacente, editado DURANTE mi sesión
`git status` al arrancar mi sesión (snapshot de CLAUDE.md) reportaba `main` limpio salvo el diff de T5.9.
Durante la verificación aparecieron/cambiaron ficheros que **yo no toqué** (solo creé `docs/verifications/T5.9/`):

| Fichero | git | mtime observado | Naturaleza |
|---|---|---|---|
| `scripts/check-contrast.mjs` | untracked | 22:53:12 | tooling nuevo (gate de contraste WCAG) |
| `scripts/check-e2e-wired.mjs` | untracked | 22:54:24 (apareció DESPUÉS de mi 1er check) | tooling nuevo |
| `apps/web/src/app/globals.css` | modificado | 22:53:30 | **CÓDIGO DE PRODUCTO** (tokens del DS) |
| `apps/web/playwright.config.ts` | editado→revertido | 22:55:38 (mtime, pero == HEAD) | config |
| `.claude/hooks/guard-planning.sh` | modificado | 22:46:50 | **HOOK DEL ARNÉS** (añade control-negativo obligatorio) |

Todos citan literalmente «auditoría del journal, 2026-07-23» / «determinismo-primero» en sus docstrings/diffs
→ pertenecen a la tarea de auditoría, NO al diff de T5.9. El diff REAL de T5.9 es solo:
`planning.md` (reconciliación de tier), `PRD.md` (§22.1) y `apps/web/e2e/phases/f5-export.spec.ts` (untracked).

### 3. Por qué esto impide el run de $15 (razonamiento, sin sobre-afirmar)
No afirmo «el árbol se está mutando en este instante» (mtimes ~2 min idle, `ps` sin procesos del repo).
El hecho decisivo, suficiente por sí solo, es más simple: **un working tree COMPARTIDO carga trabajo
uncommitted de otra tarea —incluida fuente de producto y un hook— editado a mitad de mi sesión.** Un run
de fal REAL, estateful (~45 min, ~$15), contra ese árbol es un riesgo genuino:
- la otra sesión puede **commitear**, **reiniciar `next dev` en :3000**, o **editar código del money-path**
  (p. ej. `content-hash.ts`/`generate-broll.ts`, de los que depende TODA mi medición de dedup cross-idioma) a mitad de run;
- no habría **estado atribuible** respaldando un gasto de $15: mediría un objetivo móvil.
La inertidad *runtime* de los ficheros ajenos de HOY (ciertos: no tocan el pipeline F5) NO cubre esa colisión.

Esto es category-distinct de las dos muertes previas de verifier (API stall «Response stalled mid-stream»):
aquí NO hay stall; hay un árbol no estable. Y NO es fallo del código de T5.9 (su diff no rompe nada).

## Resultado por cláusula
| Cláusula | Estado | Motivo |
|---|---|---|
| (a) lote real ≥6 var 15–30s, captions, C2PA, <$15, <45 min | **NO EJECUTADA** | bloqueo de árbol antes de gastar ($0) |
| (b) texto libre 0-img → CP1 packshot → variante sintética | **NO EJECUTADA** | idem |
| (c) voces es/en nativas ↔ voice_map (juicio humano) | **NO EJECUTADA** | idem (además requiere sembrar persona con voiceId real elevenlabs, no placeholder) |

## Control negativo
N/A — verificación de fase con fal REAL bloqueada por estado del árbol antes de ejecutar; no añade tests.
El control negativo del comportamiento de F5 vive en el spec permanente `f5-export.spec.ts` (`@f5 @phase`,
journey mockeado a $0) y en los controles negativos ROJOS verificados de T5.8a/T5.8b/T5.8 (compose máster +
ducking + regen), ya en verde en el gate. Esta verificación añade solo evidencia de cierre real, no código.

## Coste real
**$0.** No se abrió sesión de navegador, no se arrancó el stack, no se llamó a ninguna API de pago.
El bloqueo se detectó en el gate previo, ANTES de cualquier gasto. Cap autorizado ($15) intacto.

## Para REANUDAR (plan listo, ver run-context.txt)
1. **La tarea adyacente (journal-audit / determinismo) debe commitear o stashear su trabajo** (su dueño:
   la otra sesión o el usuario) para que el árbol vuelva a `git status` = solo el diff de T5.9 y `pnpm gate` verde.
2. Re-despachar el verifier. Plan (a)/(b)/(c) ya destilado en `run-context.txt`:
   - Stack: `pnpm dev` contra docker-compose.dev (port 55432, DB `ugc`), NO testcontainer efímero
     (un stall reanuda el MISMO DB → dedup reclama fal ya gastado). Comprobar `lsof -iTCP:3000` (gotcha de next-dev huérfano, journal 2026-07-23).
   - Keys: `.env` ya tiene `FAL_KEY`/`ANTHROPIC_API_KEY`/`FIRECRAWL_API_KEY`/`APP_MASTER_KEY`; web las siembra
     cifradas en `app_setting` al bootear; el worker las lee de ahí. Sin Jina key (fallback free-tier).
   - **Sembrar persona premium con voiceId REAL de elevenlabs** (`EXAVITQu4vr4xnSDxMaL` es+en) + imagen ref —
     los seeds de dev usan `placeholder-es/en` que fal REAL rechaza (422, journal). Load-bearing para (a) N7b y para (c).
   - **Intake URL real** (scrape real N1-N5) — el literal dice «URL real».
   - **Proyectar coste a CP3 ($0) ANTES de aprobar**: leer las duraciones de escena de los 12 guiones + el
     `cost` por-segundo del `model_profile` (b-roll veo3.1 i2v = 20¢/s, avatar omnihuman = 16¢/s, según
     `packages/core/gallery-seed/model-profiles.json`) + `planGeneration`/`quantizeDurationToEnum`. Computar el
     mapa de dedup b-roll cross-idioma (¿es y en del mismo combo cuantizan al MISMO bucket Y mismo nº de clips?).
     Recomendado: calibrar 1 combo (es+en, 2 variantes) real → medir coste exacto por endpoint + HIT/MISS real →
     proyectar los 5 combos restantes. Si proyección >$15 → FAIL de la cláusula de coste, ~$0 gastado.
   - Verificar además, sobre output REAL: máster 15–30s (medir el máster compuesto, no el estimado del guion),
     captions karaoke (inspeccionar el ASS/subtítulo), C2PA = **manifiesto/claim PRESENTE y firmado** (NO la
     palabra «Validated» — gotcha c2patool 0.27.1 del host), <45 min de reloj.
   - (c): extraer 2 clips de voz (es+en) + tabla voiceId↔voice_map por query de BD → **PENDIENTE DE JUICIO
     HUMANO** (naturalidad nativa), NO emitir PASS de (c) por cuenta propia.

## Hallazgos colaterales (para quien reanude / auditoría)
- **planning.md:785 tiene aritmética OBSOLETA**: afirma que N7d b-roll «incluye `dialogue.text` LOCALIZADO en
  su prompt (`compile-prompt.ts:86`)» → nunca deduplica cross-idioma → $12,72. FALSO en el código actual: el
  executor N7d (`apps/worker/src/executors/generate-broll.ts:134-159`) **NO pasa `prompt`** a `runGenerateBroll`
  → usa `DEFAULT_BROLL_PROMPT` (idioma-neutral, `packages/services/src/generate-broll.ts:61`). El `content_hash`
  del b-roll (`generate-broll.ts:242-249`) = prompt(neutral) + modelProfileId + {duración, image_url(keyframe),
  aspect, resolution} + `dedupSalt(sceneIndex:clipIndex)`. Los ÚNICOS discriminadores cross-idioma son la
  **duración cuantizada** y el nº de clips (troceo). ⇒ el b-roll **SÍ deduplica cross-idioma si ambos idiomas
  cuantizan al mismo bucket del enum [4,6,8] Y producen el mismo nº de clips de body**. El brief del coordinador
  ya corrigió esto; se anota aquí como rareza (soy verifier, no edito planning.md). El coste real es
  data-dependent ($13–22) y MARGINAL → medir a CP3 antes de gastar es obligatorio, no opcional.
- **(b) `synthetic_product=true` NO discrimina con-img/sin-img**: `build-variant-generation-plan.ts:106`
  hardcodea `route:'ai_packshot'` (deuda PRE-T4.x) → CUALQUIER lote premium marca `synthetic_product=true`. La
  prueba real de (b) es la DECISIÓN packshot en CP1 (0 imágenes → se ofrece la decisión), no el flag. Anclar el
  PASS de (b) en: intake 0-img completa + CP1 ofrece la decisión packshot + variante aprobada por esa ruta.
