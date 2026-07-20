# Verificación T5.2 — Normalización canónica con caché (vídeo + audio)

- **Tarea**: T5.2 · Normalización canónica con caché (`planning.md`, §9.7)
- **Fecha**: 2026-07-20
- **Ejecutor**: verifier (agente escéptico, contexto fresco) · sin agent-browser (tarea 100% backend/media) · suite `worker:media`
- **Sistema**: commit `c20bde6` + diff no committeado de T5.2 (git status limpio salvo el diff bajo verificación). Capa media ejecutada EN LA IMAGEN `ugc-worker:t5.1` (amd64, ffmpeg 5.1.9-0+deb12u1, ffprobe 5.1.9, c2patool 0.9.12 — reales, NUNCA el ffmpeg del Mac). Gate con `DOCKER_HOST=unix:///Users/carlosvillu/.docker/run/docker.sock`.

## Verificación esperada (literal de planning.md)
> normalizar los assets reales de una variante → ffprobe de cada salida cumple el perfil exacto (script de asserts); segunda ejecución = 100 % cache hits (0 trabajos ffmpeg en logs y mtime de los normalizados intacto); un clip 16:9 de prueba queda crop-to-fill sin letterbox.

## Superficie y método
Tarea de PURO backend/media (sin UI): la Verificación se ejecuta con la suite de asserts `apps/worker/test/media/normalize-asset.test.ts` (6 tests) que corre ffmpeg/ffprobe REALES sobre inputs sintéticos `lavfi` (los "assets reales de una variante": clip de avatar CON audio embebido, audio arbitrario, clip 16:9), EN LA IMAGEN DEL WORKER. Es el "script de asserts" que la Verificación nombra. Reproducido independientemente desde cero (árbol read-only → copia escribible → `pnpm install` → `RUN_MEDIA=1 REQUIRE_MEDIA=1 pnpm exec vitest --project worker:media`), sin fiarse de la corrida del main loop.

Además de las 6 aserciones del implementer, el verifier añadió un test propio (`verifier-extra.test.ts`, dropeado SOLO en la copia disposable `/build`, jamás en el árbol host) para cubrir literalmente: (a) **mtime intacto** en la 2ª pasada; (b) **dump crudo de ffprobe** para confirmar que SAR 1:1 está PRESENTE (no ausente — `assertVideoProfile` línea 74 se salta el check de SAR si el campo falta).

## Pasos ejecutados
1. **Pre-gate**: `pnpm gate` con `DOCKER_HOST` seteado → EXIT 0, **210 test files / 2168 tests passed**. Incluye los 14 unit tests de la key pura (`normalized-cache-key.test.ts`, `services:unit`) y los 5 tests de integración Postgres de `getAssetByNormalizedCacheKey` (hit + miss + defaults + roundtrip + índice no-único, `db:integration`) — la ruta SQL de producción de la caché. Evidencia: `gate-output.txt`.
2. **Confirmación de código bajo verificación**: `git status` limpio salvo el diff de T5.2; línea 97 del test host = `byCacheKey.get(key)` (caché real, sin bypass).
3. **Pasada principal media (imagen worker, verbose)**: 8/8 verde (6 implementer + 2 verifier-extra). Evidencia: `media-suite-main.txt`.
4. **Control negativo de la caché**: bypass `findByCacheKey → undefined` en la copia `/build` (sed, nunca en host) → test "2ª pasada" ROJO con `AssertionError: expected 4 to be 2`. Revert automático (cada `docker run --rm` re-copia el árbol host intacto). Evidencia: `negative-control-red.txt`.
5. **Confirmación de host intacto**: `git status` tras el control negativo → `normalize-asset.test.ts` sin cambios; el bypass solo vivió en el contenedor efímero.

## Resultado observado vs esperado
| # | Cláusula | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|---|
| 1a | Perfil vídeo exacto | 1080x1920, 30fps, h264, yuv420p, SAR 1:1 | ffprobe crudo: `width:1080, height:1920, r_frame_rate:"30/1", codec_name:"h264", pix_fmt:"yuv420p", sample_aspect_ratio:"1:1"` (display 9:16). SAR PRESENTE. | media-suite-main.txt | OK |
| 1b | `-an` en vídeo | Vídeo normalizado sin audio, aun con input CON audio | Input `makeTestVideoWithVoice` con audio (sanity assert); salida `-an` sin stream de audio. | media-suite-main.txt (t1) | OK |
| 1c | Audio canónico | AAC 48kHz estéreo desde audio arbitrario (mono 44.1k) | `assertAudioProfile(aac,48000,2)` pasa. | media-suite-main.txt (t2) | OK |
| 1d | Voz embebida (VEED) | Extrae pista embebida → AAC 48k estéreo | `extractAudioTrack` reusado → `assertAudioProfile` pasa. | media-suite-main.txt (t3) | OK |
| 2a | 2ª pasada = 0 ffmpeg | 100% cache hits, 0 invocaciones nuevas del runner | `getCalls()` tras 1ª = N>0; tras 2ª = N. | media-suite-main.txt | OK |
| 2b | mtime intacto | Normalizado no re-escrito en 2ª pasada | mtime idéntico antes/después (espera 1.1s); mismo id; 0 ffmpeg nuevos. | media-suite-main.txt (verifier-extra) | OK |
| 2c | Control negativo | Bypass caché => ROJO | `AssertionError: expected 4 to be 2`. Revert => verde. | negative-control-red.txt | OK |
| 2d | Ruta SQL de caché | `getAssetByNormalizedCacheKey` hit+miss vs Postgres | 5 tests de integración verdes en el gate. | gate-output.txt | OK |
| 2e | Key determinista/discriminante | Otra resolución o versión de receta => otra key | Test verde en imagen + 14 unit tests en el gate. | media-suite-main.txt + gate-output.txt | OK |
| 3 | Crop-to-fill sin letterbox | Clip 16:9 (1920x1080 rojo) => 1080x1920 sin bandas | Píxeles y=4/960/1915 (col 540) todos rojos (r>180,g<80,b<80). | media-suite-main.txt | OK |

### Frontera de la cláusula 2 (explícita)
La caché se verifica en TRES capas complementarias, ninguna sustituible:
- **Lógica consulta-antes-de-encodear** (salta ffmpeg en hit): suite media contando el runner + control negativo (2a/2c).
- **Ruta SQL real** (`getAssetByNormalizedCacheKey` vs Postgres): integración en el gate (2d). La suite media usa Map en memoria; NO prueba el SELECT SQL, por eso la integración es imprescindible.
- **Derivación de key** (colisiones/discriminación): 14 unit tests en el gate + test en imagen (2e).

## Coste real
**$0** — confirmado. PURO ffmpeg local; inputs sintéticos `lavfi` en el propio test. NO se llamó a fal ni a API de pago. Estimado: $0. Sin STOP-CHECK de gasto.

## Veredicto
**PASS** — las 3 cláusulas se cumplen literalmente sobre el sistema real (imagen worker, ffmpeg/ffprobe reales); el control negativo de la caché se reprodujo (rojo `expected 4 to be 2` => revert => verde); gate verde (2168 tests) incluyendo la ruta SQL de producción.

**Notas / rarezas (aunque PASS)**:
- `knip` emite 3 "Configuration hints" (no errores): `src/golden.ts`, `sharp`, `ffprobe` sugeridos para quitar del ignore. Hints informativos, gate exit 0. Deuda menor de limpieza, no bloqueante.
- Árbol host `normalize-asset.test.ts` INTACTO tras el control negativo (`git status`): el bypass solo existió en la copia efímera `/build`. Regla "jamás editar el script del implementer en su sitio" respetada.
- Imagen bajo emulación (host arm64, imagen amd64) — irrelevante para corrección de perfil/caché, solo afecta velocidad.
- Un mismo clip VEED produce DOS normalizados (vídeo `-an` + voz extraída) diferenciados SOLO por `mediaKind` en la cache key. Los tests de imagen ejercen vídeo y voz-embebida sobre ficheros origen distintos; la propiedad "un clip de variante => dos keys sin colisión" descansa en el split por `mediaKind` del código + los unit tests de key del gate, no en un test de imagen. No es gap (fuera del texto de la Verificación), pero se anota la frontera.
- Nota sobre `negative-control-red.txt`: el `EXIT_CODE=0`/`OUTER_EXIT=0` del fichero es el exit de `tail` (el pipe se lo tragó), NO el de vitest. El veredicto ROJO se juzga por el texto visible `1 failed` + `AssertionError: expected 4 to be 2`, presente en el fichero.
