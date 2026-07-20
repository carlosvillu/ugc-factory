# Verificación T5.3 — Concat + mezcla de audio (worker FFmpeg)

- **Tarea**: T5.3 · Concat + mezcla de audio → máster intermedio (`planning.md`, §9.7)
- **Fecha**: 2026-07-20
- **Ejecutor**: verifier (agente escéptico, contexto fresco) · suite media + script instrumentado propio
- **Sistema**: commit staged `760037d` · imagen worker `ugc-worker:t5.1` (linux/amd64, **ffmpeg 5.1.9**, ffprobe 5.1.9) · inputs 100 % sintéticos lavfi · sin BD (resolveAssetKey inyectado como Map)

## Verificación esperada (literal de planning.md)
> master intermedio de una variante real sin glitches en los cortes; `ffmpeg -af ebur128` mide −14 LUFS ±1; el ducking es audible y visible en la waveform.

## Pasos ejecutados

1. **Gate previo** (`pnpm gate`, raíz, host) → **VERDE**: 212 test files, **2201 tests passed**, exit 0. Evidencia: `gate.txt`. (El gate NO corre la capa media — gated por RUN_MEDIA + imagen — por eso los pasos 2–4 la ejercen aparte.)
2. **Auditoría de honestidad de los asserts** (antes de ejecutar nada):
   - `measureIntegratedLufs` parsea el `I: … LUFS` REAL del bloque Summary de `ebur128` (regex sobre stderr, último match), NO un valor fijado. Rango del test `[−15, −13]` = −14±1 del PRD.
   - El test de ducking IMPORTA `buildDuckingGraph` de `@ugc/services` (producción) y renderiza SOLO la rama del bed ducked — no reimplementa el graph (principio 9).
   - `-c copy`: unit test del gate (`buildConcatArgs` contiene `-c:v copy`) + suite media confirma perfil intacto + duración sumada.
   - `assertVideoProfile` (default) asserta el perfil canónico COMPLETO: 1080×1920 + 30/1 fps + h264 + yuv420p + SAR 1:1, no solo duración.
   - Test del fade anclado a duración real: `maxDurationS: 30` >> duración real ~9 s → un fade anclado al cap sería inerte; el test mide caída ≥8 dB en la cola → muerde el bug que el implementer corrigió.
3. **Suite media del implementer reproducida independientemente** en la imagen del worker con `RUN_MEDIA=1 REQUIRE_MEDIA=1 pnpm test:media` → **13/13 passed** (7 de T5.3 + 6 de T5.2, sin skips silenciosos). Evidencia: `media-suite.txt`.
4. **Script instrumentado PROPIO** (`verify-instrumented.mjs`) a través de la producción `composeMaster`/`buildDuckingGraph`, persistiendo los másters y emitiendo los números crudos. Evidencia: `instrumented-output.txt`.
5. **Raw ffmpeg independiente** sobre los másters persistidos (fuera de mi parser): `ffmpeg -af ebur128` y `ffprobe` directos → confirman los mismos números.

> **Nota de curación de evidencia**: los binarios `masters/` (3 .mp4 de ~15 MB + 1 .m4a; 47 MB) se EXCLUYERON del commit — el repo es público y son REGENERABLES corriendo `verify-instrumented.mjs` o la suite media en la imagen del worker. Los NÚMEROS crudos (duración, `I: LUFS`, RMS del ducking) que constituyen la evidencia real quedan en `instrumented-output.txt`. Las referencias a `masters/*.mp4` en la tabla de abajo apuntan al fichero del que se midió cada número, no a un binario committeado.

## Resultado observado vs esperado

| # | Cláusula | Esperado | Observado (medido en ffmpeg real) | Evidencia | OK |
|---|---|---|---|---|---|
| 1 | Máster sin glitches (concat `-c copy`) | duración = suma (2+3+2=7 s), perfil H.264/1080×1920/30fps intacto, sin re-encode | duración **7.000 s exacta**; H.264 / **1080×1920** / **30/1 fps** / yuv420p / SAR 1:1; audio AAC 48k stereo | instrumented-output.txt, masters/master-concat.mp4, raw ffprobe | OK |
| 2a | −14 LUFS ±1 (con bed) | I in [−15,−13] | **I = −14.0 LUFS** (raw ebur128 Summary) | masters/master-bed.mp4, instrumented-output.txt | OK |
| 2b | −14 LUFS ±1 (sin bed) | I in [−15,−13] | **I = −14.0 LUFS** | masters/master-novo.mp4, instrumented-output.txt | OK |
| 3 | Ducking audible/visible ≥6 dB | RMS(antes) − RMS(durante voz) ≥ 6 dB con `buildDuckingGraph` de producción | before **−21.13 dB** → during **−31.72 dB** → caída **10.59 dB** | masters/ducked.m4a, instrumented-output.txt | OK |
| — | Fade anclado a duración real | test discriminante muerde (cap >> duración) | suite media: caída ≥8 dB en la cola | media-suite.txt | OK |

Números crudos clave (todos de ffmpeg 5.1.9 en la imagen):
- Concat master: ffprobe `duration=7.000000`, `1080x1920`, `30/1`, `h264`, `yuv420p`.
- master-bed.mp4: `Integrated loudness: I: -14.0 LUFS` (raw, confirmado dos veces).
- master-novo.mp4: `I: -14.0 LUFS`.
- ducked.m4a: graph exacto `[0:a][1:a]sidechaincompress=threshold=0.03:ratio=12:attack=20:release=300:makeup=1[ducked]`, drop 10.59 dB.

## Coste real
**$0** — T5.3 es puro ffmpeg local con inputs sintéticos lavfi. Auditado el diff: ninguna importación de fal/firecrawl/anthropic/openai (solo menciones en comentarios). Coincide con el estimado ($0).

## Veredicto
**PASS** — las tres propiedades observables de la Verificación se cumplen sobre la salida REAL de ffmpeg, medida a través del código de producción `composeMaster`/`buildDuckingGraph`: concat sin re-encode con duración=suma y perfil canónico intacto (7.000 s, 1080×1920/30fps/h264), loudness integrado −14.0 LUFS clavado con y sin bed, y ducking de 10.59 dB (≥6 dB). Gate verde (2201), suite media 13/13 en la imagen amd64.

**Notas / rarezas (aunque PASS):**
- El LUFS mide −14.0 EXACTO (no en el borde del rango): loudnorm single-pass sobre tono sintético estable; el margen ±1 del PRD queda holgado. Sin bandera roja.
- `REQUIRE_MEDIA=1` confirmó que no hubo skips disfrazados de verde (el trap del incidente #6). Los tests corrieron en amd64/ffmpeg real, NO con el ffmpeg del Mac.
- La suite T5.2 (`normalize-asset.test.ts`, 6 tests) NO se rompió pese a los ficheros compartidos que T5.3 tocó (`materializeToBytes`, `makeMediaTestStorage`).
- El script instrumentado carga el loader `tsx` de la workspace desde `apps/worker` (para resolver `@ugc/*`); es artefacto de verificación, vive solo bajo `docs/verifications/T5.3/`, no toca código de producto.
