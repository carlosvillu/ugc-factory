# Verificación T5.8b — Cablear N8/N9 en el plan de generación del flujo normal

- **Tarea**: T5.8b · Cablear N8/N9 en el plan de generación del flujo normal (`planning.md`)
- **Fecha**: 2026-07-23
- **Ejecutor**: verifier (contexto fresco) · agent-browser 0.27.0 · sesión `t5.8b`
- **Sistema**: árbol uncommitted (sha base `9de578b` + diff de T5.8b y T5.8 co-residente) · docker compose dev (`ugc-postgres-dev`, migración 0025 aplicada) + `pnpm dev` (web+worker) + seeds de arranque (10 personas, 80 hooks, recipes test/standard/premium, 56 templates) · **fal REAL** (`secret.fal` resuelto de `app_setting`; sin `FAL_BASE_URL` → sin fake stack)

## Verificación esperada (literal de planning.md)
> un lote aprobado en CP3 (flujo normal, sin regen) llega a componer máster + C2PA y pausa en CP4 (antes: se cortaba en N7). Con fal real de 1 variante en tier ready.

## Gate previo
- `pnpm gate` VERDE desde la raíz: 229 test files, **2394 tests passed**. El gate no incluye e2e; el flujo web/media es lo que este CUA cubre con fal real.
- Migración 0025 (`spawned_regen_run_id`, de T5.8) aplicada en la BD de dev.

## Método (harness del verifier, NO el del implementer)
Script propio `seed.mts` que siembra en la BD VIVA de dev un lote PREMIUM (único tier generation-ready) con **1 variante scripted** + su guion v1 (escenas hook/body/cta) + una Persona con imagen de referencia que casa el hint beauty, y deja un step N5 pausado. El **approve de CP3 se hizo como humano**: login por `POST /api/login` → cookie de sesión → `POST /api/steps/:id/approve` con `{decision:{kind:'scripts',verdicts:[{variantId,approved:true}]}}` (ruta autorizada por la tarea; T5.8b no toca la UI de CP3). El worker con fal real ejecutó el run. Progreso y coste sondeados en la BD (ledger, no logs).

## Pasos ejecutados
1. Seed lote premium + 1 variante scripted + N5 pausado (`seed-output.txt`).
2. `POST /api/steps/:id/approve` (CP3, flujo normal) → **200 `{ok:true, nextRunId:"01KY8221XRSD0309YW69HVA12K"}`** (nextRunId presente ⇒ tier generation-ready ⇒ run arrancado).
3. **Control estructural T5.8b**: el run del flujo normal emite `N6 N7a N7b N7c N7d N7e N7f N8 N9` — **N8 y N9 PRESENTES** (antes de T5.8b se cortaba en N7).
4. Ejecución fal real: N7a/N7d/N7e/N7f → succeeded. **N7b (voz) falló 422** de fal por voiceId placeholder de fixture (ver Rareza 1); retry con voz real `Rachel` (config-patch de `/retry`) → succeeded, sobre el MISMO run (no re-pagó los i2v ya hechos).
5. N7c (avatar omnihuman) → succeeded. **N8 (composición) running → succeeded SIN `ComposeError`** (bed real ace-step normalizado por T5.8a; ducking voz+bed en vivo).
6. **N9 → `waiting_approval` (CP4 pausado)**.
7. Máster persistido (`master_asset_id` no-null), copiado, checksum casa BD, ffprobe OK, **c2patool dump → `trainedAlgorithmicMedia` FOUND**.
8. UI (agent-browser, login humano): `/runs/<run>` renderiza panel **CP4 · REVISIÓN** con player del máster, QA 100/100 Apto, botones Aprobar/Rechazar/Regenerar. Consola limpia.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | CP3-approve (flujo normal) arranca run | approve→200 nextRunId, kind `full` | `approve-response.txt`, `01-cp4-panel.png` | OK |
| 2 | El run emite N8/N9 (antes cortaba en N7) | node_key distintos incluyen N8 y N9 | query BD (paso 3) | OK |
| 3 | Compone MÁSTER | master_asset_id=01KY82X2C2D1FRKY30ZPT4FP8Y, final_video, checksum 1abb34a8…, ffprobe h264 1080x1920 + aac stereo 48k, 4.7s | `master.mp4`, `ffprobe.txt` | OK |
| 4 | + C2PA | manifest C2PA c2pa.created / softwareAgent UGC Factory / digitalSourceType…trainedAlgorithmicMedia | `c2pa-dump.txt` | OK |
| 5 | Pausa en CP4 | N9 step 01KY8221XQEN3F94W9RXZK4DKM = waiting_approval; panel CP4 en UI | `01-cp4-panel.png` | OK |
| 6 | fal real, 1 variante, tier ready | premium; ledger cost_actual>0 en fal real (flux-2, omnihuman, veo3.1x2); request IDs fal reales | `cost-by-node.txt`, `dev.log` | OK |
| - | (bonus) qa_report | score 100, todos los checks pass, loudness -13.3 LUFS | qa_report BD | OK |

## Fixture entregado para T5.8 (regeneración parcial — NO borrar, variante VIVA)
- **variant_id**: `01KY820M6TDYZ5Y2CNSYX0TQT9`
- **batch_id**: `01KY820M6PQZX4AE2YZJYEN0GF`
- **project_id**: `01KY820M5SYAMS0DJWQ5B1DK35`
- **N9 step_run.id (CP4 pausado)**: `01KY8221XQEN3F94W9RXZK4DKM` (`waiting_approval`)
- **run_id (kind full)**: `01KY8221XRSD0309YW69HVA12K`
- **tier**: premium · **master_asset_id**: `01KY82X2C2D1FRKY30ZPT4FP8Y`
- `ad_variant.status = scripted` (NO approved — CP4 sin resolver, correcto). Clips N7 cacheables por content_hash para el dedup de T5.8.
- **DE-RISK del handoff (scenario prep, 2026-07-23)**: el `voice_map` de la persona del fixture (`01KY820M3YNNN3V2B9GDTBWEZD`) se actualizó de `placeholder-es/en` a **`Rachel`** (voz elevenlabs válida). Motivo: la regen de CTA de T5.8 regenera N7f **y N7b (voz de la escena cta)** reconstruyendo el plan DESDE la persona → con el placeholder habría re-disparado el mismo 422 de fal (y no habría cache-hit: distinto content_hash por el CTA nuevo + voz placeholder). Con `Rachel` la voz cta de la regen resuelve a una voz válida. Es dato de escenario (write permitido), no código de producto.

## Coste real
Ledger `generation.cost_actual` (fal REAL), delta sobre baseline 1232c:
| Nodo | Endpoint | cents |
|---|---|---|
| N7a x2 | fal-ai/flux-2 | 2 |
| N7b | elevenlabs/tts/eleven-v3 (Rachel) | ~0 (sub-cent) |
| N7c | bytedance/omnihuman/v1.5 | 24 |
| N7d | veo3.1/image-to-video (b-roll 4s) | 80 |
| N7f | veo3.1/image-to-video (cta 4s) | 80 |
| **Total** | | **186c = $1.86** |

Cross-check: la UI del run muestra "Coste real $1.86". Los 422 de N7b (voz placeholder) NO facturaron.
- **Estimado planning ≤$0,50** (asumía dedup de regen). **Recalibrado por el usuario ~$1,5-2,5** (generación desde cero). Real **$1,86** < cap autorizado ~$2,5. Aritmética pre-gasto del verifier (N7f incluido, cuantización a 4s del enum veo3.1 [4,6,8], N7a=flux-2 barato) proyectó ~$1,96-2,26 — acertada.

## Veredicto
**PASS** — el flujo NORMAL (CP3-approve, sin regen) arranca un run `full` que EMITE N8/N9 (antes cortaba en N7), COMPONE un máster real (h264 1080x1920 + aac, qa 100), lo FIRMA C2PA (trainedAlgorithmicMedia) y PAUSA en CP4 (waiting_approval), con fal real de 1 variante premium por $1,86 (< cap $2,5). T5.8a confirmada EN VIVO: N8 muxó voz+bed (ace-step) con ducking sin ComposeError.

### Rarezas (aunque PASS)
1. **[fixture del verifier, NO defecto de producto]** La 1ª pasada de N7b (voz) dio **fal 422** porque el `MATCHING_PERSONA` que copié del e2e (`normal-generation-composes.spec.ts`) trae voiceIds placeholder (`placeholder-es`) — el e2e usa providers FAKE que los aceptan; fal real los rechaza. Es la trampa «no reutilices a ciegas los fixtures del implementer» disparándose; el camino limpio habría sido sembrar un voiceId real de entrada. Resuelto con voz real `Rachel` (histórica válida) vía config-patch de `/retry` sobre el MISMO run, sin re-pagar los i2v. **Por qué el PASS sobrevive al parcheo**: (a) el control estructural de T5.8b (N8/N9 emitidos por el flujo normal, paso 3) se observó sobre el plan SIN parchear, ANTES de cualquier retry; (b) el parche tocó DATO de voz, no el cableado de composición que T5.8b entrega (`withComposition`→N8/N9). **Recomendación (journal)**: sembrar en dev una persona premium con voiceId real de elevenlabs para que el flujo normal con fal real no requiera parcheo. No afecta a T5.8b (no toca N7b).
2. **N7e (bed) SÍ se ejercitó**: el máster se compuso con voz+bed y ducking real → cobertura EN VIVO de T5.8a (cerrada $0 contra bed guardado), aquí con ace-step real sin ComposeError.
3. `/api/spend` reporta un agregado distinto del SUM(generation.cost_actual) de este run (usa cost_entry); el coste imputable a T5.8b es el per-nodo ($1,86), coincidente con la UI del run.
4. Consola del navegador limpia (solo HMR/React-devtools dev-only).

## Evidencias
- `report.md` · `seed.mts` · `seed-output.txt` · `approve-response.txt`
- `master.mp4` · `ffprobe.txt` · `c2pa-dump.txt` · `cost-by-node.txt` · `cost-before.txt`
- `01-cp4-panel.png` · `browser-console.txt`
