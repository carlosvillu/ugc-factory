# Verificación T4.7b — N7c: clip de avatar VEED (Test, voz propia + ASR del clip)

- **Tarea**: T4.7b · N7c ruta VEED (`planning.md:616`)
- **Fecha**: 2026-07-20
- **Ejecutor**: verifier (contexto fresco, independiente) · smoke stepless (`runGenerateVeedAvatar`) DENTRO de la imagen del worker · psql/ffprobe/curl directos
- **Sistema**: diff de T4.7b (fix del contrato de submit) SIN commitear sobre commit `b9961ec` (T5.1) · docker compose dev (`ugc-postgres-dev`, host :55432) · `pnpm seed:gallery` RE-EJECUTADO tras el fix (VEED con `capabilities.avatarId` + `cost.minBilledSeconds`)
- **Imagen de verificación**: `ugc-veed-verify:t4.7b`, **RECONSTRUIDA** `FROM ugc-worker:t5.1` desde el árbol con el fix. Arch **x86_64/amd64** (bajo qemu, arch de DEPLOY). ffmpeg **y** ffprobe = los binarios de la imagen (`/usr/bin/{ffmpeg,ffprobe}` v5.1.9 amd64, Debian bookworm), NO el ffmpeg del Mac.

## Verificación esperada (literal de planning.md)
> clip VEED real (text-to-video, voz de librería) con lipsync aceptable a juicio humano; el ASR sobre el audio EXTRAÍDO del clip produce word timestamps que cubren el 100 % de las palabras.

## Veredicto

**PASS objetivo (cláusulas 1-3)** — la cadena VEED completa corre end-to-end contra fal REAL: clip generado (`completed`), audio extraído con ffmpeg EN LA IMAGEN del worker, ASR sobre el audio extraído con **100% de cobertura** de word timestamps. Money-path correcto: el clip factura **35¢** (floor de 1 min), NO 0¢ (el bug de degradación) ni ~3¢ (sin floor). **Cláusula 4 (lipsync): PENDIENTE de juicio humano** — clip preparado en `clip-veed.mp4` + `LIPSYNC-para-juicio-humano.md`.

El FAIL previo (submit `{prompt}` → 422 de fal) queda RESUELTO: el submit ahora manda `{text, avatar_id: "emily_vertical_primary"}` (verificado en el `inputs` de la generación). Historia del FAIL#1 preservada en `fal-422-schema-mismatch.txt` + `generation-failed-row.txt`.

## Resultado por cláusula

| # | Esperado | Observado (fuente independiente: psql / ffprobe in-image / jsonb) | Evidencia | OK |
|---|---|---|---|---|
| 1 | Clip VEED `completed`, `avatar_clip` mp4 descargable, coste 35¢ (floor 1 min, NO 0¢) | generation `completed`; `inputs={text, avatar_id:"emily_vertical_primary"}` (fix, sin `prompt`); asset `avatar_clip` video/mp4 h264+aac, 3.469.014 B, 5.457s; **cost_actual=35**; checksum del fichero == checksum del asset (descarga íntegra) | smoke-output.txt, ffprobe-clip.txt, word-timestamps.json | ✅ |
| 2 | Audio EXTRAÍDO con ffmpeg REAL en la imagen del worker (incident #6) | asset `tts_audio` audio/wav **pcm_s16le 44100Hz mono**, 481.358 B, 5.457s (== dur del clip). ffmpeg que lo extrajo: `/usr/bin/ffmpeg` v5.1.9 amd64 de la imagen (arch x86_64), NO Mac | ffprobe-wav.txt, ffmpeg-ffprobe-in-image.txt | ✅ |
| 3 | ASR sobre audio extraído → 100% word timestamps + 2 cost_entry `fal` | **14/14 palabras con start+end (100%, 0 sin tiempo)**; transcripción == hook de entrada; **DOS cost_entry provider='fal'**: clip 35¢ (quantity=5s real) + ASR 0¢ (5s→round(5/60·3)=0, sub-céntimo correcto) | word-timestamps.json, psql cost_entry | ✅ |
| 4 | Lipsync aceptable (juicio humano) | Clip + hook + timestamps preparados; **PENDIENTE de juicio del usuario** | clip-veed.mp4, LIPSYNC-para-juicio-humano.md | ⏳ |

## El check más duro (incidente #6) — ffmpeg EN LA IMAGEN: EJECUTADO ✅

Esta vez la cadena SÍ llegó a la extracción. El WAV se produjo con el ffmpeg de la imagen de producción (`/usr/bin/ffmpeg` v5.1.9 amd64, log `audio_track_extracted` bytes=481358), NO con el ffmpeg del Mac. Salida `pcm_s16le 44100Hz mono` (el `-vn -acodec pcm_s16le -ac 1` del wrapper), duración 5.457s == duración del clip. ffprobe (nuevo load-bearing del money-path para medir la duración: VEED NO emite `duration`) confirmado presente en la misma imagen. La extracción NO se degradó a Mac en ningún momento.

## Money-path (el bug de FAIL#1 en su segunda cara) — VERIFICADO ✅

- **Antes** (dos bugs): submit `{prompt}` → 422 (nunca clip); y `falVideoCostOf` degradaba `unit:'minute'` a 0¢.
- **Ahora**: clip real de 5.457s → `billedSeconds=max(5.457, 60)=60` → `round(60/60·35)=35¢`. `cost_entry` del clip: **amount_cents=35, quantity=5, unit=seconds** — el ledger cobra el mínimo real (35¢) pero registra la duración REAL (5s) como quantity (verdad granular honesta). NO es 0¢. NO es ~3¢.
- fal request `019f7e79...` COMPLETED, inference_time 26.6s (render real completo).

## Coste real

- **Esta corrida: 35¢** (clip, floor 1 min) + **0¢** (ASR, 5s sub-céntimo) = **35¢** registrados en 2 `cost_entry` fal. vs estimado ~36¢ (dentro; ~$0,30 autorizado). Cap ×3 = $1,08 no rozado.
- **⚠ Gasto adicional del probe de setup (FAIL#1, ya reportado):** el sondeo de `avatar_id` usó `emily_primary` (resultó VÁLIDO, variante no-vertical) → arrancó inferencia real 35.37s antes de un cancel tardío → probablemente **~35¢ facturados**. Total real de T4.7b ≈ **70¢** (35¢ probe accidental + 35¢ corrida buena). Ambos son ~35¢ = el mínimo de 1 min de VEED, lo que CORROBORA que el floor `minBilledSeconds:60` acierta con el mínimo real de VEED.
- **Verificación del cargo real**: VEED no expone billing por API con esta key (`/billing/*` → Not Found). El importe registrado (35¢) coincide con el estándar VEED 35¢/min · 1 min mínimo; **confirmar el cargo exacto en el dashboard de fal del usuario** (dos cargos de ~35¢ hoy: probe + corrida buena).

## Cláusula 4 — LIPSYNC (juicio humano) · PENDIENTE

Preparado para el usuario en `docs/verifications/T4.7b/`:
- `clip-veed.mp4` (5.457s, avatar `emily_vertical_primary`, voz de librería embebida).
- Hook de entrada: «Tired of ads that feel fake? This one is different, watch what happens next.»
- ASR del audio extraído (prueba de que la voz dice el hook): «Tired of ads that feel fake? This one is different. Watch what happens next».
- `word-timestamps.json` (14 palabras con tiempos).

Pregunta al usuario: ¿el avatar habla el hook con lipsync aceptable? Con su OK, el veredicto pasa a PASS completo.

## Rarezas / notas

- **ASR a 0¢ NO es un bug**: 5s a 3¢/min = 0,27¢ → `Math.round`=0¢. El `cost_entry` existe (fila presente), con `quantity=5s` como verdad granular. Correcto para el ledger agregado (mismo criterio sub-céntimo que N7b/T4.5). En clips más largos el ASR facturaría >0.
- **avatar_id como dialecto del modelo**: el fix lo pone en `capabilities.avatarId` del catálogo (como `aspectValues`), no en código. El guard lanza loud si un perfil VEED no lo declara (probado indirectamente: la re-siembra fue OBLIGATORIA — una BD rancia sin `avatarId` habría hecho throw).
- **Descarga HTTP no re-ejercida en vivo** (web dev no levantado): la integridad del `avatar_clip` descargable se probó por checksum (fichero == asset) sobre el MISMO service path que T4.7 ya verificó vía `GET /api/assets/[id]/download` (auth 401→200, checksum íntegro). Sin hallazgo.
- **Imagen `ugc-veed-verify:t4.7b`** disponible para futuras re-verificaciones (Dockerfile en scratchpad; reconstruir desde el árbol vigente + `docker run` con `host.docker.internal:55432` + FAL_KEY de `.env`).
