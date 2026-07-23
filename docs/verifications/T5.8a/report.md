# T5.8a — Normalizar el bed musical antes del mix de N8 · VERIFICACIÓN

**Veredicto: PASS**

- **Fecha**: 2026-07-23
- **Verificador**: verifier (contexto fresco, escéptico)
- **Coste real**: $0 (contra el bed guardado `docs/verifications/T4.9/04-music-bed.wav`, sin llamadas a fal)

## Sistema / entorno

- **Superficie**: solo media/backend (grafo ffmpeg). NO hay superficie UI -> no aplica agent-browser. Se ejecuta el test de media con **ffmpeg REAL** contra el modulo bajo prueba.
- **ffmpeg/ffprobe**: `/usr/local/bin/ffmpeg`, `/usr/local/bin/ffprobe` -- ffmpeg 4.4.1. Presentes -> clausula 1 VERIFICABLE.
- **Codigo bajo prueba**: el fix vive en el arbol de trabajo (UNCOMMITTED). HEAD = `d0f9fb6`. `git diff packages/services/src/compose-master.ts` muestra el `aformat=channel_layouts=stereo[bedfmt]` adyacente al `sidechaincompress`. El test importa `buildDuckingGraph` y `composeMaster` desde `@ugc/services` (produccion real, no reimplementacion).
- **Bed real de T4.9**: probe confirma `channels=2`, `channel_layout=unknown` -- el disparador exacto del bug.

## Texto literal de la Verificacion

"componer un master con voz + bed real de T4.9 (ducking activo) produce un MP4 valido (antes: ComposeError); el ducking sigue midiendo la atenuacion >=6 dB del bed bajo la voz (paridad con la Verificacion de T5.5d/T4.9). Coste $0."

## Resultado por clausula

| # | Clausula | Esperado | Observado | OK |
|---|---|---|---|---|
| 1 | Master con voz + bed real de T4.9 (ducking activo) -> MP4 valido (antes: ComposeError) | composeMaster compone; mime=video/mp4; perfil de video ~9s; pista audio AAC | Test "composeMaster produce un MP4 valido..." PASA con el fix | OK |
| 2 | El ducking sigue midiendo >=6 dB de atenuacion del bed bajo la voz | caida >=6 dB del bed en la ventana con voz | Test de paridad PASA; verificacion independiente: 16.0 dB (bed-only -14.39 dB vs con-voz -30.41 dB) | OK |

**Comando ejecutado (literal de la Verificacion):**
`RUN_MEDIA=1 REQUIRE_MEDIA=1 pnpm exec vitest run --project worker:media compose-master`
-> **10 passed (10)** con el fix (01-media-test-fix.txt, 02-media-test-verbose.txt, 04-media-test-restored.txt).

Los 3 tests del bloque T5.8a:
- CONTROL NEGATIVO: el bed real de T4.9 (unknown) SIN el aformat rompe la mezcla -- PASA (self-contained rejects.toThrow).
- el bed real de T4.9 (unknown) pasa el buildDuckingGraph de PRODUCCION y sigue hundiendose >=6 dB -- PASA (clausula 2).
- composeMaster produce un MP4 valido con voz + bed real de T4.9 (ducking activo) -- PASA (clausula 1, end-to-end).

## Control negativo INDEPENDIENTE (la prueba de que el test MUERDE)

Reintroducido el bug **en produccion** (eliminado el `aformat=channel_layouts=stereo[bedfmt];` de buildDuckingGraph, dejando `[bedLabel][voiceLabel]sidechaincompress`), backup del fix uncommitted a scratchpad primero (NO git checkout -- habria destruido el fix uncommitted), y re-ejecutado el test:

- composeMaster produce un MP4 valido... -> **FAILS** con:
  `ComposeError: composeMaster: ffmpeg fallo en «mux del master» (codigo 1)`
  stderr: `The following filters could not choose their formats: Parsed_sidechaincompress_1`
- El test aislado de ducking >=6 dB **sigue VERDE mutado** -- confirma el "punto latente": el bug NO se ve en un sidechaincompress con -map [ducked] (sin amix rio abajo); solo aflora cuando el amix del master completo fuerza la negociacion de formatos. Por eso el detector real es el test end-to-end de composeMaster, y lo es.
- Evidencia: 03-media-test-mutated-negcontrol.txt (1 failed | 9 passed).

Fix restaurado desde backup (checksums MD5 identicos) -> re-ejecutado -> **10 passed** (04-media-test-restored.txt). git diff confirma el aformat de vuelta.

## Verificacion independiente adicional (fuera del codigo del implementer)

Ejecutado el grafo de ducking de produccion a mano con ffmpeg contra el bed real (05-ducked-real-bed.m4a) y medido RMS por ventanas:
- Ventana sin voz (0.5-1.5s): -14.39 dB
- Ventana con voz (2.5-3.5s): -30.41 dB
- Atenuacion: **16.0 dB >= 6 dB** -- sin ComposeError. Confirma paridad e independencia del reporte del implementer.

## Rarezas

- **Arbol de trabajo sucio mas alla de T5.8a**: git status muestra ficheros de orchestrator, web, regen-checkpoint, batch.repo, planning.md, etc. -- trabajo en curso ajeno. El test de media aisla @ugc/services; los unicos ficheros que inciden en este resultado son packages/services/src/compose-master.ts y apps/worker/test/media/compose-master.test.ts. La precondicion de "git status limpio" NO se cumple; se anota, no bloquea (scope aislado). El fix esta UNCOMMITTED -- pendiente de commit por el bucle.
- **Fallo pre-existente ajeno**: compose-variant.test.ts tiene un fallo de drift de c2patool (toContain('Validated')) senalado por T5.7. NO esta en el scope de este proyecto vitest (worker:media compose-master solo toco compose-master.test.ts), asi que ni siquiera se ejecuto aqui. Ajeno a T5.8a, confirmado.

## Evidencias

- docs/verifications/T5.8a/01-media-test-fix.txt -- 10 passed con el fix.
- docs/verifications/T5.8a/02-media-test-verbose.txt -- resultados por test (verbose).
- docs/verifications/T5.8a/03-media-test-mutated-negcontrol.txt -- control negativo: composeMaster ROJO con ComposeError.
- docs/verifications/T5.8a/04-media-test-restored.txt -- 10 passed tras restaurar el fix.
- docs/verifications/T5.8a/05-ducked-real-bed.m4a -- ducking de produccion contra el bed real (verificacion independiente).
