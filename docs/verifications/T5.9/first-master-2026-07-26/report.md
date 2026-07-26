# Re-generación de 1 variante F5 → PRIMER máster + C2PA — 2026-07-26 (NO es T5.9)

> Encargo puntual: re-generar UNA variante completa por la UI para componer el PRIMER máster real + C2PA.
> **NO cierra T5.9** (1 variante es, no cubre cláusula (a) ni (c)). T5.9 sigue SIN marcar.
> Dos tramos: (LEG 1) abort en el gate de coste de CP3 con la autorización de ~$4,20; (LEG 2) tras
> autorización del usuario de ~$4,56, se aprobó ESE MISMO CP3 preservado y **se compuso el PRIMER MÁSTER
> REAL de UGC Factory** — nunca logrado antes (T5.8b usó fixture; 3 runs previos murieron en N7d).

---

# ✅ LEG 2 (2026-07-26 18:2x) — AUTORIZADO ~$4,56 → PRIMER MÁSTER COMPUESTO + C2PA FIRMADO

- **Resultado: COMPUSO.** N6→N7(a–f)→**N8 succeeded**→N9 `waiting_approval` (CP4). Cadena completa sin
  errores. Es el **primer máster real** que el pipeline F5 compone end-to-end.
- **Coste real de LEG 2: $4,34** (delta 434¢ sobre baseline 330¢; total cost_entry 764¢). fal
  íntegro; ningún otro proveedor. Por debajo del hard-stop de 500¢ (nunca disparó). **Vs proyección de
  CP3 $4,56 → desviación −4,8%**, explicada por (a) avatar real 4,28s (69¢) < guion 5,6s (90¢ proyectado)
  y (b) **1 HIT de dedup**: el music bed N7e se reusó de la generación del smoke (0¢, ver abajo).
- **Máster**: `/private/tmp/ugc-assets-dev/masters/01KYFS0TCGEDR6QZ68G35ZCFAR/master.mp4` (localizado vía
  `ad_variant.master_asset_id`=`01KYFTV9J8Q4E0V93X80X6THZV` → `asset.storage_key`, no por globbing).
  15,93 MB, **H.264 1080×1920 (9:16)**, **AAC estéreo 48kHz**, dur real **15,23s** (el `asset.duration_s=30`
  es el TARGET; el máster real es la suma de clips recortados a narración). checksum sha256 del fichero
  = el de la fila `asset` (`3f46587505…`), coincide.
- **Subtítulos karaoke BURNED-IN**: sí (no hay stream de subtítulos — es correcto, van quemados). Frames
  extraídos a 2/7/12s muestran el texto sincronizado con la narración ("hora ya tienes", "de piel está",
  "rápido sin dejarte"). Ver `14/15/16-frame-*.png`.
- **Audio voz+música**: los 9 assets de entrada de N8 (`asset.parent_asset_ids`) incluyen 4 `tts_audio`
  (voz por escena) + 1 `music_bed` (audio/wav, 30s) mezclados en el único stream AAC. Observado
  directamente a nivel de datos (los inputs de N8) + el stream AAC del máster.
- **C2PA (verificado POR SEPARADO con `c2patool` sobre el fichero firmado — `13-c2pa-verify.txt` /
  `13-c2pa-detailed.json`)**:
  - **Firma criptográfica VÁLIDA**: `claimSignature.validated` + `claimSignature.insideValidity` +
    `assertion.bmffHash.match` + 2× `assertion.hashedURI.match` = todos SUCCESS. Algoritmo **ES256**.
  - Manifiesto declara acción `c2pa.created`, `softwareAgent: "UGC Factory"`,
    `digitalSourceType: trainedAlgorithmicMedia` (cumplimiento EU AI Act Art. 50 / auto-etiquetado).
  - **Único "failure": `signingCredential.untrusted`** — el cert autofirmado ES256 de test
    ("C2PA Test Signing Cert") no está en un trust anchor. **ES LO ESPERADO EN DEV** (el pipeline usa las
    fixtures de test `packages/services/test/fixtures/c2pa/es256_*`; certs C2PA reales = deuda conocida
    de `compose-variant.ts`). Es decir: **la firma es válida sobre el contenido; solo la CADENA de
    confianza del cert es de test.** En producción bastará con un cert de una CA C2PA reconocida.

## Coste real de LEG 2 por endpoint (`cost_entry ⨝ generation ⨝ step_run`, gen run `01KYFTKY…`) — `17-final-cost.txt`

| Nodo | Endpoint | Facturado | ¢ | `fal_request_id` |
|---|---|---|---|---|
| N7a keyframes | flux-2 | 2 imágenes | **2** | `019f9fa9-fd5c`, `019f9faa-12a6` |
| N7b voz | elevenlabs v3 | 4 clips (261 chars) | **3** | 4× `019f9fa…` |
| N7c avatar | omnihuman v1.5 | 4,28s → 16¢/s | **69** | `019f9faa-6ea4` |
| N7d b-roll 1/2 | veo3.1 i2v | 8s × 20¢ | **160** | `019f9faa-6daf` |
| N7d b-roll 2/2 | veo3.1 i2v | 6s × 20¢ | **120** | `019f9fac-51cc` — **submit OK (¡el que 403’d en el smoke!)** |
| N7e música | ace-step | **DEDUP HIT** (bed del smoke) | **0** | (sin generación nueva) |
| N7f CTA | veo3.1 i2v | 4s × 20¢ | **80** | `019f9faa-6d63` |
| | | | **434 = $4,34** | |

**El clip que mató al smoke SÍ generó esta vez**: el 2º clip de b-roll (N7d 2/2) se submitió con
`request_id` real (`019f9fac-51cc`), sin el 403 del smoke — el saldo recargado era suficiente. N7d fail-fast
secuencial (`generate-broll.ts:141`) no se ejercitó porque ambos clips completaron.

**Dedup medido (corrección al LEG 1)**: hubo **1 HIT** — el **music bed N7e** (prompt ace-step constante,
NO depende del keyframe) se resolvió reusando el bed de la generación del smoke (`01KYFG1D…`; el
`parent_asset_id` del música del máster es `01KYFG1NQ…`, del smoke). Ahorro ~1¢ (subcéntimo). Los nodos de
VÍDEO (N7d/N7f) NO deduplicaron y generaron a coste pleno — **exactamente como el LEG 1 predijo** (análisis
fresco → keyframes N7a nuevos → hash distinto). La predicción "0 HITs" del LEG 1 se refería a los nodos de
vídeo (correcta); el bed de música es un HIT adicional que no cambia la cifra.

## Estado tras LEG 2
- Gen run `01KYFTKY9RQ79GAHYXYYM5ERNJ`: N8 succeeded, **N9 `waiting_approval` (CP4 QA)** — dejado pendiente
  para juicio humano de calidad (no se aprueba CP4; el máster ya existe y está firmado).
- Run padre `01KYFS0TCVNMZNXK9W4CPD5Y87`: N5 succeeded (CP3 aprobado por la UI — checkbox "Aprobar esta
  variante" + "Confirmar guiones", como humano; sin tocar la narración).

## Rareza de CALIDAD (no bloquea "compuso", pero es un hallazgo real) — el avatar NO es Maya
- El clip de avatar (escena hook) renderizó un **personaje anime/chibi masculino** (pelo verde, uniforme
  militar), NADA que ver con Maya (25-34, female, natural), la persona FIJADA en CP2. Ver `14-frame-02s.png`.
- La composición, los subtítulos, el audio y la firma C2PA son correctos; el **identity-lock del avatar
  falló para el hook** (OmniHuman generó un sujeto ajeno a la persona). El b-roll y el CTA sí muestran el
  producto CeraVe correctamente (`15/16-frame-*.png`). Es un defecto de CALIDAD del avatar (candidato a
  investigación aparte), no un fallo de la composición N8 ni del objetivo "primer máster + C2PA".
- **CORRECCIÓN post-investigación (2026-07-26, `docs/verifications/T5.19/`)**: el diagnóstico «identity-lock del
  avatar falló» de arriba es INCORRECTO. Ground truth de BD: el `image_url` que N7c envió a OmniHuman ES la
  reference_image de Maya (`fal_url` → `asset.kind=reference_image`), y esa reference es un **placeholder
  abstracto** (círculo+banda de color, generado por el path de sharp de T5.15), NO una foto. OmniHuman animó
  fielmente un input abstracto → chibi. El identity-lock NO está roto; la causa raíz es aguas arriba (seed sin
  reference usable). Ver T5.19 (gate anti-placeholder, $0) y T5.20 (regenerar references con fotos, spend-gated).

## Evidencia de LEG 2 (añadida)
- `10-cp3-approved-checkbox.png` — CP3 aprobado por la UI (checkbox + confirmar).
- `11-canvas-generating.png`, `18-canvas-n8-composed-cp4.png` — canvas durante y tras la composición.
- `12-master-ffprobe.txt` — streams del máster (h264 1080×1920, aac estéreo, 15,23s).
- `13-c2pa-verify.txt` / `13-c2pa-detailed.json` — verificación C2PA (firma válida, cert de test untrusted).
- `14-frame-02s.png` / `15-frame-07s.png` / `16-frame-12s.png` — frames con subtítulos karaoke burned-in.
- `17-final-cost.txt` — delta 434¢ y desglose por endpoint (join cost_entry⨝generation⨝step_run).
- `pnpm-dev-approve.log` — log del stack en el tramo autorizado.

---

# LEG 1 (previo) — ABORT en CP3 con la autorización de ~$4,20 (registro histórico)

> **Resultado LEG 1: ABORT en el gate de coste de CP3 — la proyección determinista fue $4,56 > $4,50 (umbral
> de abort) y > $4,20 (autorización de entonces). NO se aprobó CP3, NO se generó ningún N7 de vídeo. Coste
> LEG 1: $0,29 (todo Anthropic de guiones aguas arriba; $0,00 fal). El run quedó PRESERVADO en CP3, que es
> lo que permitió aprobarlo en LEG 2 sin re-pagar el trabajo aguas arriba.**

- **Sistema**: HEAD `95869b0` (rama `docs/f5-cost-reprojection`), árbol limpio salvo esta carpeta de evidencia.
  docker `ugc-postgres-dev` :55432 (persistente, con los datos del smoke) + `pnpm db:migrate` + `pnpm dev`
  (web :3000 + worker via `tsx watch`) + first-boot seed (personas=11 incl. Maya, secrets fal/anthropic/
  firecrawl desde BD). Health `{ok:true,db:true}`.
- **Ejecutor**: verifier · agent-browser 0.27.x · sesión `t5.9regen`. UI conducida como humano
  (login, intake URL, CP1, CP2 config, CP3). Sin atajos por API en el flujo. Abort ANTES de aprobar CP3.
- **Worker corre T5.17**: SÍ. `tsx watch` sobre el árbol de trabajo @ `95869b0`; `normalizeErrorBody` +
  `FalProviderError.detail` presentes en `packages/core/src/generation/fal-client.ts`; `step-execute.ts`
  persiste `status`/`detail` en el jsonb de `step_run.error`. (No se ejercitó: no hubo fallo de fal — no
  se llegó a generar vídeo.) Detalle en `01-preflight-decision.txt`.

## Desenlace de la cadena

| Etapa | Resultado |
|---|---|
| N1 Ingesta + N2 Análisis visual (CeraVe URL) | completed |
| N3·CP1 ProductBrief | aprobado por la UI (brief en es bien formado — `04-cp1-brief-cerave.png`) |
| N4·CP2 Estrategia del lote | configurado: Maya FIJADA, es, angleIndices:[0], hooksPerAngle:1, Conversión, **Premium**, 1 variante (`05-cp2-config-maya-1variant-premium.png`) |
| N5·CP3 Guiones | guion de 4 escenas generado (`06-cp3-scripts-panel.png`) — **GATE DE COSTE ejecutado aquí, $0** |
| Aprobación de CP3 | **NO ejecutada — ABORT.** Proyección $4,56 > $4,50 |
| N6->N7->N8->N9 | nunca lanzados (no se aprobó CP3). **CP3 queda `waiting_approval`, NO cancelado** |

## Gate de coste de CP3 (determinista, $0, escrito ANTES de decidir) — `07-cp3-cost-gate.txt`

Guion real del variant `01KYFS0TCGEDR6QZ68G35ZCFAR` (Maya, es, premium, conversion, 4 escenas, est. 21s;
scenes jsonb en `cp3-scenes.json`):

| Escena | seg | Nodo | Facturado | ¢ |
|---|---|---|---|---|
| hook | 5,6 | N7c avatar (omnihuman 16¢/s) | 5,6s × 16¢ | **90** |
| body | 6,4 | N7d b-roll (veo3.1 i2v 20¢/s) | 6,4 -> **8s** × 20¢ | **160** |
| body | 5,2 | N7d b-roll | 5,2 -> **6s** × 20¢ | **120** |
| cta | 3,2 | N7f CTA (veo3.1 i2v) | 3,2 -> **4s** × 20¢ | **80** |
| — | — | N7a/N7b/N7e (keyframes/voz/música) | subcéntimo | **~6** |
| | | | **TOTAL** | **456 = $4,56** |

Tarifas verificadas en `model_profile` (BD dev): omnihuman `{unit:second, 16}`; veo3.1 i2v `{unit:second,
20, durations:[4,6,8]}`. Cuantización `quantizeDurationToEnum` = redondeo ARRIBA al enum >= seg
(`scene-planner.ts:118`), verificada en código.

**Por qué $4,56 es un SUELO, no un techo:**
- El **grueso es fijo y no encoge**: N7d (280¢) + N7f (80¢) = 360¢ salen de la cuantización de segundos de
  GUION a buckets [4,6,8] — deterministas, no dependen del ASR real.
- Lo único variable (el avatar, 90¢ sobre el hook de 5,6s) se factura sobre el ASR real, que suele ser MÁS
  CORTO que el guion (smoke: 4,36s vs guion) -> el avatar real caería a ~64-77¢. Pero incluso con el avatar
  optimista (~$4,30-4,36) **sigue por encima de los $4,20 autorizados**, y el gate se evalúa sobre la
  proyección disponible en CP3 (segundos de guion), no sobre un encogimiento esperado.
- N7a podría ser 3-4¢ (keyframes para 2 clips body + 1 CTA), no 2¢ como en el smoke -> empuja hacia arriba.
- **Sin split** que dispare el coste: las escenas body (6,4s, 5,2s) son <=8s (maxDuration i2v) -> 1 clip cada
  una. Un split necesitaría una escena >8s; ninguna la tiene. Riesgo de split ~ nulo.

## HITs de dedup MEDIDOS — 0

- El content_hash = sha256(`resolved_prompt`, `model_profile_id`, `inputs`) (`content-hash.ts`). Para
  b-roll/CTA, `inputs` incluye `imageAssetIds` (el keyframe N7a).
- Este run es un **análisis FRESCO** (nuevo scrape de la URL -> nuevo brief -> nuevo guion -> **nuevos
  keyframes N7a con asset ids nuevos**) -> `inputs` distintos -> content_hash distinto de las 12 generaciones
  `completed` del smoke (`00-baseline.txt`) -> **0 HITs**. Confirmado además a nivel de datos: 0 generaciones
  existentes para el variant nuevo `01KYFS0TCGEDR6QZ68G35ZCFAR` en el momento del gate.
- Consecuencia: **ningún descuento de dedup** rebaja la proyección. El $4,56 es firme.

## El `over_budget` del producto != presupuesto en dólares (aclaración importante)

El nodo N5·CP3 trae `status:"over_budget"` en su `output_refs` (`08-cp3-over_budget.json`). **NO es un gate
de gasto en dólares**: son los warnings del `script_writer_retry_budget` — el hook excedía el techo de 12
palabras y el writer lo reescribió más corto (`blocked:false`, el variant es aprobable). La tabla `budget`
(scope/limit_cents) está **VACÍA** -> el producto no tiene ningún guard de dólares configurado. Por tanto el
gate de dólares es EXCLUSIVAMENTE mi proyección de CP3; no hay señal de producto que lo confirme ni contradiga.

## Coste real — SUM(amount_cents) - 301 (baseline del smoke)

`/spend` es CUMULATIVO (arrastra los $3,01 del smoke). El coste de ESTE run es el delta:

| Proveedor | ¢ | Nota |
|---|---|---|
| Anthropic | 29 | análisis visual + brief + guiones (aguas arriba de N7) |
| firecrawl | 0 | scrape de la URL CeraVe |
| **fal** | **0** | **ningún N7 de vídeo — abort antes de aprobar CP3** |
| **TOTAL** | **29 = $0,29** | baseline 301 -> total 330 -> **delta 29** |

Autorización de ~$4,20 fal: **INTACTA** ($0 gastado en fal/vídeo). El monitor de coste-delta (base 301¢,
hard-stop 450¢) estuvo armado en vivo; el delta nunca pasó de 29¢ y el hard-stop nunca se disparó porque
no se llegó a la generación.

## Estado del run — PRESERVADO (crítico para el próximo intento)

- **N5·CP3 queda en `waiting_approval`. El run NO se canceló.** (Verificado: `SELECT node_key,status FROM
  step_run WHERE run_id='01KYFS0TCVNMZNXK9W4CPD5Y87'` -> `N5 | waiting_approval`.)
- Esto es DELIBERADO: cancelar barrería CP3->`cancelled` (terminal, sin aristas — es lo que en el smoke
  convirtió una recuperación de $1,20 en un re-run de $4). Dejándolo pendiente, el análisis/brief/guion ya
  pagados ($0,29 Anthropic) quedan bancados y un futuro intento autorizado **aprueba este mismo CP3** y paga
  SOLO los ~$4,56 proyectados de N7->N8. **El próximo agente NO debe "limpiar" cancelando este run.**
- **Preparación bancada para el próximo intento**: c2patool **0.27.1** presente (homebrew). La firma C2PA
  del pipeline usa fixtures de test autofirmadas ES256 (`packages/services/test/fixtures/c2pa/es256_*`),
  claim generator **"UGC Factory"** (`compose-variant.ts` + `apps/worker/.../compose-variant.ts:100-104`).
  -> cuando componga, c2patool reportará firma válida sobre un cert AUTOFIRMADO de test (deuda conocida:
  certs C2PA reales). Eso se juzgará POR SEPARADO de "existe el fichero" en el próximo intento.

## Decisión que corresponde al usuario / bucle (no al verifier)

El gate abortó porque la única configuración que produce un máster real (Conversión / guion completo por
variante, tal como pide el brief) proyecta $4,56 > $4,20 autorizados. Opciones:
- **(a)** autorizar ~$4,60 y aprobar el CP3 que queda pendiente TAL CUAL -> primer máster + C2PA. (El run
  está listo y preservado para esto.)
- **(b)** aceptar una configuración más barata (objetivo hook_test / guion más corto) como **cambio de
  alcance deliberado**. NO lo hago yo: editar la narración o re-disparar con otro objetivo para colar por
  debajo de $4,50 sería rebajar el gate e invalidar la medición de coste que este ejercicio produce.

## Rarezas / notas

- El coste "de golpe" que subió a 22-29¢ en el monitor en vivo era **Anthropic** (análisis + guiones), no
  fal: este run no generó ninguna imagen de packshot de pago (la landing CeraVe traía imágenes usables) —
  a diferencia del smoke, N2 no facturó a fal.
- El guion salió a 4 escenas (hook+2 body+cta, 21s) tras 2 reintentos del writer por word-budget del hook
  (warnings en `08-cp3-over_budget.json`) — el producto se autocorrige, no bloquea.

## Evidencia
- `00-baseline.txt` — HEAD, baseline cost_entry 301¢, higiene (0 no-terminales, 0 jobs), 12 gens del smoke.
- `01-preflight-decision.txt` — worker=T5.17 confirmado; balance fal UNVERIFIABLE (probe TTS del smoke = falso negativo); contabilidad de delta.
- `02-dashboard.png`, `03-intake-cerave-url.png`, `04-cp1-brief-cerave.png`.
- `05-cp2-config-maya-1variant-premium.png` — CP2 con Maya fijada, 1 variante, premium, conversion.
- `06-cp3-scripts-panel.png` — guion de 4 escenas en CP3.
- `07-cp3-cost-gate.txt` — **el gate: proyección determinista $4,56, ABORT >$4,50**, escrito ANTES de decidir.
- `08-cp3-over_budget.json` — output_refs de N5 (over_budget = script word-budget, no dólares).
- `09-cp3-left-pending-aborted.png` — CP3 dejado `waiting_approval` (no cancelado).
- `cp3-scenes.json` — scenes jsonb del guion con segundos por escena.
- `run-ids.txt` — run de análisis + run de generación + batch/variant.
- `browser-console.txt` — consola del navegador.

## Veredicto

**ABORT en CP3 (gate de coste) — NO compuso, $0 de fal/vídeo.** No es un fallo de producto: es el gate de
gasto funcionando exactamente como el brief lo especifica (proyección $4,56 > umbral $4,50). El primer máster
real + C2PA queda pendiente de una decisión de gasto del usuario (~$4,60), con el run **preservado en CP3**
para aprobarse sin re-pagar el trabajo aguas arriba.
