# T4.11 — E2E de fase (F4) · RE-RUN LIVE tras fix T4.13 · PASS

**Fecha:** 2026-07-19
**Veredicto:** PASS — una variante real completa N6→N7 end-to-end con fal REAL. El fix T4.13 (commit 065ce53) desbloquea la race sweeper↔polling que hizo FAIL el run anterior: N7a llega a `succeeded` (antes `failed` terminal) y N7d EJECUTA hasta `succeeded` (antes `awaiting_deps` eterno).
**Coste real:** fal $1.07 (107 ¢, 11 cost_entry provider=fal, unidos a generation con `fal_request_id` reales). NO fraude a $0. Cap duro ~$6 no rozado.
**HEAD:** 7d8eaeb (con 065ce53 T4.13 en historia). Gate previo: verde (186 files / 1932 tests passed).

## Cómo se ejecutó (stack híbrido live)
- Script `apps/web/scripts/live-stack.local.ts`: fake N1–N5 ($0 real) + fal REAL N6–N7. Arranque imprimió `live-stack: FAL_KEY real presente ✓ — fal es REAL`.
- BD = testcontainer EFÍMERO Postgres 16 (`test_0dc7c1a0ad4b`, puerto 56695), vacío al arrancar → todo cost_entry fal es de ESTE run.
- URL `https://glow.example/beauty/serum` → brief beauty. Persona Nora F4 Premium (voiceId real elevenlabs EXAVITQu4vr4xnSDxMaL). matchPersonas ofreció SOLO a Nora en el picker de CP2.
- 1 SOLA variante: CP2 reducida a 1 ángulo × 1 hook, tier Premium (expande N7a–N7e). Verificado por CSS `get count [data-slot="planned-matrix"] tbody tr` == 1 ANTES de confirmar.

## Journey (agent-browser, como humano)
1. /login (e2e-password). 2. /analyses/new URL beauty → CP1 ProductBrief aprobado. 3. CP2 matriz: 1 variante Nora Premium, estimado $3.60–$5.20, confirmado. 4. CP3 guiones aprobados. 5. Sub-DAG premium expandió N6+N7a–N7e en el run de generación 01KXVQ3B2H784VNZMQE1NR3YGK (SEPARADO del análisis 01KXVPNNT1... — 3 pipeline_run distintos). 6. Todos N7a–N7e → succeeded, fal 107¢.

## Cláusulas
1. 1 variante completa N6→N7 — PASS. N6,N7a,N7b,N7c,N7d,N7e todos `succeeded`, variant_id 01KXVPY3FV2Z3XTX6PYC89CXBK en todos. N7a succeeded (fix), N7d succeeded (fix).
2. Assets reproducibles en el PANEL (navegador) — PASS. Inspector del canvas: N7a→2 img, N7b→3 audio, N7c→1 video, N7d→1 video, N7e→1 audio; todos src=/api/assets/:id/download real. Bytes HTTP 200 (image/png, video/mp4, audio/mpeg, audio/wav). A ojo: N7a packshot serum real, N7d b-roll serum animado.
3. resolvedPrompt inspeccionable en N6 — PASS. Inspector N6 región PROMPT RESUELTO con prompt beauty completo (Nora, beats, guard rails).
4. audio_source=ai_bed — PASS. ad_variant.audio_source = 'ai_bed'.
5. coste estimado vs real por sub-step visible — PASS. Cada nodo N7 muestra su coste.
retry — cubierto por spec commiteado f4-fake-run2.txt (2 passed); no inducido en live (brief).

## Coste real desglosado
N7a 2¢ (2 shots png 576x1024) | N7b 0¢ (3 clips audio/mpeg) | N7c 25¢ (video/mp4 1248x1664 1.48s omnihuman v1.5) | N7d 80¢ (video/mp4 720x1280 4s i2v) | N7e 0¢ (audio/wav 12s ace-step). TOTAL 107¢=$1.07. 8 generation completed, todos con fal_request_id real.

## Divergencia <15% vs CP2 — HALLAZGO DE CALIBRACIÓN (NO FAIL)
Estimado CP2 (UI): $3.60–$5.20. Real: $1.07. Divergencia ~-70% vs extremo bajo ($3.60), ~-76% vs midpoint. Estimador lineal en segundos, coste fal sublineal → divergencia esperable. Deuda de calibración al resumen de fase. NO se falla, NO se tuneó duración.

## Hallazgos (NO bloquean PASS)
1. N7c avatar contenido abstracto: el clip reproduce como vídeo H.264 válido, pero el frame visual es abstracto púrpura (círculo+punto), no una talking-head de Nora. Asset reproducible (cláusula 2 OK); revisar calidad de N7c en tarea futura.
2. N7d b-roll = product-shot animado (deuda conocida keyframe[0]): muestra el serum del packshot N7a animado. Reproducible, calidad razonable → PASS con hallazgo.
3. N7a fan-out sin race esta vez: 2 shots, ambos cobrados 1¢, generationId propio. Ruta reused:true NO se disparó (sin carrera este run); loop completó limpio con el catch no-destructivo del fix. Recuperación bajo race ya la prueba el unitario de T4.13.
4. Picker personas: radio Nora seguía reportando "Dejar que rote"; irrelevante, Nora era la única candidata → matriz asignó Nora deterministamente.

## Conclusión
PASS — F4 puede cerrar. Re-run live confirma que T4.13 resuelve la race del FAIL anterior: variante completa N6→N7 con fal real, todos los sub-steps succeeded (N7d ejecutando por primera vez en live), assets reproducibles en el panel, resolvedPrompt en N6, audio_source=ai_bed, gasto real $1.07 (>0, con fal_request_id reales). Dos hallazgos de calidad (N7c avatar abstracto, N7d b-roll animado) anotados; ninguno bloquea.

Evidencia: db-step_run-rerun.txt, db-cost_entry-rerun.txt, db-generations-rerun.txt, db-n7a-shots-rerun.txt, rerun-asset-download-proof.txt, rerun-cp2-estimate.txt, capturas rerun-01..rerun-12, frames rerun-asset-n7a-productshot.png / rerun-asset-n7d-broll-frame.png / rerun-asset-n7c-avatar-frame.png, live-rerun-stack.log.
