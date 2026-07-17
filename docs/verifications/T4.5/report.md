# Verificación T4.5 — N7b: TTS + word timestamps

- **Tarea**: T4.5 · N7b: TTS + word timestamps (`planning.md` líneas 589–593)
- **Fecha**: 2026-07-17
- **Ejecutor**: verifier (Claude) · verificación BACKEND (script + psql + ffmpeg silencedetect, sin agent-browser — la Verificación es de datos/media, no de UI)
- **Sistema**: commit `18a1b15` + working tree con el diff SIN commitear de T4.5 (16 mod + 16 nuevos). Docker compose dev (Postgres 16), migraciones aplicadas (incl. `0018_redundant_miss_america.sql`), `pnpm seed:gallery` (model_profile=16, incl. kokoro/turbo/ASR). fal REAL.
- **Gate previo**: `pnpm gate` VERDE (174 test files, 1843 tests) antes de verificar.

## Verificación esperada (literal de planning.md)
> para un guion es y otro en, los audios suenan correctos en idioma y voz esperados; los word timestamps cubren el 100 % de las palabras y, medidos contra el onset visible en un editor de waveform (Audacity/`ffmpeg astats`) en 3 palabras concretas, difieren <±100 ms; resultado del `[verificar]` anotado en `model_profile` y en PRD §13.1.

## Preparación (datos propios del verifier)
Creé DOS `ad_script` frescos con narración PROPIA (no la del implementer), 3 escenas naturales cada uno:
- `SCRIPT_EN=TVER45EN1784247420` (language=`en`)
- `SCRIPT_ES=TVER45ES1784247420` (language=`es`)

Disparé la cadena de PRODUCCIÓN vía el smoke del implementer (`getScriptById → resolveVoiceStep → runGenerateAudio`), pero **cada cláusula la medí yo desde fuente cruda** (psql sobre el jsonb / ficheros en disco / ffmpeg), no desde los números del smoke ni desde `computeWordCoverage` (código bajo prueba):
- **en** (tier TEST): `TTS_ENDPOINT=fal-ai/kokoro PROVIDER=kokoro VOICE=af_heart LANGUAGE=en`
- **es** (tier STANDARD): `TTS_ENDPOINT=fal-ai/elevenlabs/tts/turbo-v2.5 PROVIDER=elevenlabs VOICE=Rachel LANGUAGE=es`

## Cláusula 1 — audios generados en 2 idiomas · OBJETIVA · PASS
6 generaciones (3 en + 3 es), TODAS `completed`, cada una con UN asset `tts_audio` descargable y EXACTAMENTE 2 `cost_entry` (unit `chars` + unit `seconds`), verificado por psql directo:

| gen_id | endpoint | status | asset mime | cost_entries |
|---|---|---|---|---|
| 01KXPPYF4YS9E3K7REJMFKW7TQ | fal-ai/kokoro | completed | audio/wav | chars+seconds |
| 01KXPQ1YM3PNWXX67XZMND4VZ1 | fal-ai/kokoro | completed | audio/wav | chars+seconds |
| 01KXPQ23F363JCDT3JVCP9PVN8 | fal-ai/kokoro | completed | audio/wav | chars+seconds |
| 01KXPQ2JH6V213N9S0E5WC6N2Z | fal-ai/elevenlabs/tts/turbo-v2.5 | completed | audio/mpeg | chars+seconds |
| 01KXPQ2QVJDKE2KJST76C4TTYY | fal-ai/elevenlabs/tts/turbo-v2.5 | completed | audio/mpeg | chars+seconds |
| 01KXPQ2YME4ECVTXN5XC58JNFY | fal-ai/elevenlabs/tts/turbo-v2.5 | completed | audio/mpeg | chars+seconds |

6 audios descargados a `audios/` (`en-scene{1,2,3}` / `es-scene{1,2,3}`), bytes idénticos a `asset.bytes`. **JUICIO HUMANO pendiente**: escucharlos y confirmar idioma y voz.

## Cláusula 2 — cobertura 100% de word timestamps · OBJETIVA · PASS
Contado por SQL CRUDO sobre `asset.word_timestamps->'words'` (NO vía `computeWordCoverage`): `type='word'` con `start` Y `end` no nulos y `end>=start`:

| asset | words | timed | untimed |
|---|---|---|---|
| 01KXPQ1YKMCCG460XGJYFYTEE6 (en s1) | 9 | 9 | 0 |
| 01KXPQ23EWTSYF6JZZ2N7QE4G5 (en s2) | 11 | 11 | 0 |
| 01KXPQ28SGCC9PDYZY1R4ND4C4 (en s3) | 8 | 8 | 0 |
| 01KXPQ2QVCSJBSAZ1TJNED5M18 (es s1) | 11 | 11 | 0 |
| 01KXPQ2YM619DMEVVXTCY2GH97 (es s2) | 13 | 13 | 0 |
| 01KXPQ34EXYZ5NG4WZ6GSNSF0C (es s3) | 11 | 11 | 0 |

Cobertura 100% en los 6 assets, 0 palabras sin tiempo.

## Cláusula 3 — precisión ±100 ms · OBJETIVA · PASS
Onset real con `ffmpeg silencedetect` (permitido por la Verificación), 3 palabras precedidas de silencio real, mapeando el `silence_end` inmediatamente anterior al `start` reclamado. Robusto a −30 dB y −35 dB.
Comando: `ffmpeg -i <audio> -af silencedetect=noise=-30dB:d=0.05 -f null -`

| Palabra | Audio | start reclamado | onset medido | diff = medido − reclamado |
|---|---|---|---|---|
| "this" | en-scene1-hook.wav | 1.120 s | 1.136 s | +16 ms |
| "Just" | en-scene2-body.wav | 0.379 s | 0.309 s | −70 ms |
| "Consigue" | es-scene3-cta.mp3 | 0.140 s | 0.108 s | −32 ms |

(Extra 4ª: "Honestly," @0.419 → 0.337 = −82 ms.) Todas |diff| < 100 ms. Cubre AMBOS modelos. Waveforms: `waveform-en-scene1.png`, `waveform-es-scene3.png`.

## Cláusula 4 — `[verificar]` observado en vivo · PENDIENTE de anotar en CLOSE (no bloquea)
Observado EN VIVO para AMBOS modelos:
- **kokoro (test)**: output TTS solo `{audio:{url}}`; sin timestamps nativos.
- **elevenlabs-turbo (standard)**: idem, no emitió timestamps nativos.
- Prueba en BD: el jsonb sellado trae `language_code`/`language_probability`/`speaker_id` por elemento — shape EXACTO del ASR `fal-ai/elevenlabs/speech-to-text`, no del TTS.
- eleven-v3 (premium) NO corrido → deferred.

Conclusión: NO hay timestamps nativos en los TTS observados → ruta por defecto = ASR encadenado (lo que implementa el servicio).

Estado de anotación: **NO anotado todavía**. PRD §13.1 (L593) y §16 (L600) siguen como deuda ABIERTA; `model_profile` no tiene columna de nota (solo `verified_at`). Anotarlo es trabajo del CLOSE del bucle, no del verifier. No es FAIL.

## Coste real
- Ledger `cost_entry`: 0¢ por fila (12 filas) → 0¢ registrado (sub-céntimo redondeado a entero).
- Gasto fal REAL fraccionario: TTS ≈ 1,29¢ + ASR ≈ 1,02¢ = **≈ 2,31¢ ($0,023)**. Muy por debajo del cap $0,90 y del estimado $0,30 (narración corta). Sin reintentos.

## Veredicto
**PASS (partes objetivas)** — 2 idiomas generados (6/6 `completed`, asset `tts_audio` + 2 cost_entry cada una), cobertura word timestamps 100% en los 6 assets (jsonb crudo), onset <±100 ms en 3 palabras (+16 / −70 / −32 ms), cubriendo ambos modelos.

**Para el usuario (juicio humano)**: escuchar los 6 audios de `audios/` y confirmar idioma/voz; opcional validar 1 waveform.
**Para el CLOSE del bucle (no FAIL)**: anotar el `[verificar]` (TTS sin timestamps nativos → ASR) en `model_profile` y PRD §13.1/§16.

**Rarezas**: (1) `fal_status_payload` guarda el payload de STATUS, no el OUTPUT crudo del TTS → "sin timestamps nativos" se evidencia por el shape ASR del jsonb sellado. (2) Todos los cost_entry son 0¢ por redondeo a entero de céntimo (gasto real sub-céntimo) — correcto, a tener en cuenta en la conciliación de T7.6.
