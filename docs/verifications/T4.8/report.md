# Verificación T4.8 — N7d: b-roll por escena

- **Tarea**: T4.8 · N7d: b-roll por escena (`planning.md`)
- **Fecha**: 2026-07-17
- **Ejecutor**: verifier (agente) · agent-browser 0.27.x · sesión `t4.8`
- **Sistema**: T4.8 sin commitear en el árbol sobre commit `393072a` (T4.5) · docker compose dev (`ugc-postgres-dev` up) + migraciones + `pnpm seed:gallery` (18 model_profiles) + `pnpm dev` web propio en :3005 (mismo `DATABASE_URL` localhost:55432/ugc + `ASSETS_DIR` /tmp/ugc-assets-dev). NO se modificó código de producto: los scripts de verificación viven en `docs/verifications/T4.8/` y se corrieron desde copias temporales en `apps/worker/scripts/` (workspace deps), borradas al terminar.

## Verificación esperada (literal de planning.md)
> para una variante de conversión (21–34 s) se generan exactamente los clips del presupuesto §7.5 (1 avatar + 2 b-roll), 9:16 720p+, producto fiel en las escenas R2V; enums anotados en `model_profile`.

Alcance de T4.8 (regla del split): solo el executor N7d de **b-roll** (los 2 b-roll de la variante de conversión). El "1 avatar" es de N7c (T4.7). Foco: los 2 clips de body por i2v, y al menos un clip por R2V con producto fiel.

## Pasos ejecutados
1. **Gate previo** `pnpm gate` → verde (1897 tests, 182 files; lint/typecheck/format/knip/readme OK). Evidencia: `gate.txt`.
2. **Enums en model_profile** (BD sembrada): consulta directa de los 3 perfiles Veo. Evidencia: `enums-db.txt`.
3. **Packshot de producto** (prep): `fal-ai/flux-2` → frasco sérum ámbar, cap negro, etiqueta "GLOW", 576×1024, 1¢. Keyframe i2v y referencia r2v. Evidencia: `00-packshot-product.png`, `gen-packshot.txt`.
4. **Guion de conversión** sembrado: hook(10s)+body(6s)+body(7s)+cta(5s), 2 escenas de body ≤ maxDuration(8). `SCRIPT_ID=01KXRN431RVWJ9NG3EP5ZM0XM1`.
5. **Ruta i2v — executor N7d contra fal REAL**: `makeN7dExecutor` stepless sobre el guion, `fal-ai/veo3.1/image-to-video`. Output: EXACTAMENTE 2 clips (bodySceneIndex 0→6s, 1→8s); hook/cta sin b-roll. Evidencia: `drive-i2v.txt`.
6. **Ruta r2v — executor N7d contra fal REAL**: mismo guion, `fal-ai/veo3.1/reference-to-video` + packshot. 2 clips r2v (8s cada uno; r2v durations=[8]). Evidencia: `drive-r2v.txt`.
7. **Persistencia (BD)**: los 4 `broll_clip` con generation + cost_entry. Evidencia: `persistence-db.txt`.
8. **9:16 720p + silencio (ffprobe)**: cada clip 720×1280, duración=enum, **0 streams de audio**. Evidencia: `ffprobe.txt`.
9. **Descarga por endpoint real**: login navegador :3005 (cookie ugc_session), `GET /api/assets/[id]/download` de los 4 → 200 video/mp4, sha256(bytes)=`asset.checksum`. Evidencia: `download-endpoint.txt`.
10. **Fidelidad R2V**: frames medios de los 2 clips r2v vs packshot → producto fiel. Evidencia: `frame-r2v-clip1.png`, `frame-r2v-clip2.png`.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Conversión → EXACTAMENTE 2 clips de b-roll (body), no hook/cta | Executor N7d: 2 clips, bodySceneIndex 0/1; hook y cta sin b-roll | drive-i2v.txt, drive-r2v.txt | OK |
| 2 | 9:16 720p+ | Los 4 clips 720×1280 (9:16 vertical, exacto 720p) | ffprobe.txt | OK |
| 3 | Producto fiel en R2V | 2 clips r2v reproducen frasco ámbar/cap negro/etiqueta "GLOW" fielmente | frame-r2v-clip1/2.png, 00-packshot | OK |
| 4 | Enums en model_profile i2v y r2v | i2v: aspects[auto,9:16,16:9] durations[4,6,8] res[720p,1080p,4k] maxDuration 8 · r2v: aspects[9:16,16:9] durations[8] res[720p,1080p,4k] maxDuration 8 | enums-db.txt | OK |
| 5a | broll_clip persistido, generation completed, cost_entry fal/seconds | 4 asset broll_clip con duration_s; 4 generation completed; 4 cost_entry provider=fal unit=seconds, quantity entero, amount=20¢×dur | persistence-db.txt | OK |
| 5b | Descargable con checksum íntegro por endpoint | 4× 200 video/mp4, Content-Length OK, sha256(bytes)=asset.checksum | download-endpoint.txt | OK |
| 5c | B-roll SILENCIOSO (generate_audio:false) | 0 streams de audio en los 4 mp4 (Veo omitió la pista) | ffprobe.txt | OK |

## Coste real
- Packshot flux-2 (prep): $0,01
- i2v (executor): 6s→$1,20 + 8s→$1,60 = **$2,80**
- r2v (executor): 8s + 8s = **$3,20**
- **Total: $6,01** (Veo 3.1 $0,20/s sin audio, verificado en cost_entry). Estimado ~$4 · autorizado ~$4 · cap $12.
- **Desviación +50% ($4→$6,01)**: conduje el executor completo por AMBAS rutas sobre el guion de conversión (2 i2v + 2 r2v). Deliberado: probar "exactamente 2 clips" EN VIVO en la superficie correcta (el executor, no el service-smoke de 1 clip) exige un run completo por ruta. Bajo cap. Coste unitario EXACTO al sembrado (20¢/s), sin sorpresa de precio.

## Veredicto
**PASS** — N7d genera exactamente los 2 b-roll de una variante de conversión (i2v y r2v), 9:16 720p, silenciosos, producto fiel en R2V, persistidos como broll_clip completed + cost_entry por segundo y descargables con checksum íntegro por el endpoint real; enums i2v/r2v sembrados exactos en model_profile.

Notas / rarezas:
- El conteo "exactamente 2 clips" está blindado además por el test permanente `n7d-broll.test.ts` (ESPINA + troceo + guards catálogo/dinero), verde en el gate. Aquí se probó EN VIVO conduciendo el executor real sobre un guion de conversión real.
- Había un `pnpm dev` UGC previo en :3001 (tree/DB desconocidos) que daba 500 en el download sin auth; lo ignoré y levanté mi propio server en :3005 sobre el DATABASE_URL/ASSETS_DIR reales, donde sin auth da el 401 correcto y con auth sirve los clips. El 500 es artefacto del server viejo, ajeno al veredicto.
- Base `fal-ai/veo3.1` reetiquetado i2v→t2v en el seed: ningún código de producto referencia el endpoint base (grep limpio), el relabel no rompe nada.
