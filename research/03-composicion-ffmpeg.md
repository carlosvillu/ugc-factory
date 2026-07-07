# Composición programática de vídeo UGC: análisis de OSS (UGCVidGen, hook-body-cta-builder) y estado del arte

> Investigación para el PRD de la plataforma "URL de producto → anuncios UGC en vídeo 9:16 (TikTok/Reels) vía fal.ai".
> Tema: la **capa de composición/post-procesado** (concatenar escenas, quemar subtítulos, música, normalización de formato) — es decir, todo lo que ocurre *después* de que la IA genere los clips de avatar/voz/b-roll.
> Fecha: 2026-07-06. Ambos repos objetivo fueron **clonados y analizados a nivel de código** (no solo README).

---

## 1. Resumen ejecutivo

- **Los dos proyectos asignados existen** y fueron verificados/clonados:
  - `vishnuhimself/UGCVidGen` (Python) — 68 stars, 13 forks, creado y congelado en feb-2025.
  - `Pajush/hook-body-cta-builder` (React/TypeScript + ffmpeg.wasm) — 0 stars, creado abr-2026, activo, con app pública en Vercel.
- **Matiz importante**: UGCVidGen **no invoca FFmpeg directamente**: usa **MoviePy 1.0.3** (que envuelve FFmpeg para decode/encode y usa ImageMagick para el texto). Y **no tiene segmento "body"**: compone solo Hook + CTA. `hook-body-cta-builder` sí ejecuta comandos FFmpeg reales (vía WASM) y sí implementa la matriz Hook×Body×CTA, pero **no hace overlays de texto ni subtítulos**.
- El patrón técnico más valioso extraído de ambos (y confirmado por el estado del arte) es: **"normalizar cada clip una sola vez → concatenar con stream copy → mezclar audio al final"**. Esto convierte la generación de N variantes en una operación casi gratuita: re-encodear solo el clip que cambia (p. ej. el hook) y re-concatenar sin re-encode.
- **fal.ai ya expone endpoints FFmpeg gestionados** (`fal-ai/ffmpeg-api/compose`, `merge-videos`, `merge-audio-video`, `merge-audios`) que cubren concatenación y mezcla A/V con coste ~$0.0002/seg, **pero no soportan quemar subtítulos ni overlays de texto** — el elemento más característico del estilo UGC/TikTok. Por tanto, la capa de subtítulos exige infraestructura propia (FFmpeg + ASS/libass) o Remotion (con licencia de empresa).
- **Recomendación**: tratar la composición como un **servicio propio de render basado en FFmpeg nativo en workers** (contenedor con ffmpeg + libass + fuentes), con subtítulos word-by-word en formato ASS generados desde los timestamps del TTS/whisper. Remotion queda como opción "premium" si se quieren animaciones de captions más ricas y preview React, aceptando su licencia de pago ($0.01/render, mínimo $100/mes en plan Automators). Los endpoints ffmpeg de fal.ai sirven como atajo de MVP solo para merges sin subtítulos.

---

## 2. Verificación de recursos (existencia y discrepancias)

| Recurso citado | ¿Existe? | Realidad verificada |
|---|---|---|
| "UGCVidGen (Python + FFmpeg)" | ✅ Sí | [github.com/vishnuhimself/UGCVidGen](https://github.com/vishnuhimself/UGCVidGen). 68★, 13 forks. Último push: 2025-02-26 (proyecto de un solo commit-burst, abandonado desde entonces). **Usa MoviePy 1.0.3, no FFmpeg directo**; FFmpeg es dependencia de sistema de MoviePy. El script se llama `UGCReelGen.py`. Sin licencia formal en el repo (el README dice "MIT" pero no hay fichero LICENSE). |
| "opera sobre hook_videos/cta_videos/music/final_videos y un CSV de hooks" | ✅ Sí | Confirmado en código: constantes `HOOK_VIDEOS_FOLDER`, `CTA_VIDEOS_FOLDER`, `MUSIC_FOLDER`, `OUTPUT_FOLDER="final_videos"`, `HOOKS_CSV="hooks.csv"`. **No existe carpeta `body_videos`**: la estructura es Hook(+texto overlay) → CTA, sin body. |
| "hook-body-cta-builder (React/TypeScript + ffmpeg.wasm)" | ✅ Sí | [github.com/Pajush/hook-body-cta-builder](https://github.com/Pajush/hook-body-cta-builder), de Pavla Duranova. React 19 + Vite + Zustand + Tailwind 4 + `@ffmpeg/ffmpeg` 0.12. App desplegada: [hook-body-cta-builder.vercel.app](https://hook-body-cta-builder.vercel.app/). 0★ (proyecto personal, abr-2026, activo). **No genera texto/subtítulos**; solo concat + música. Sin fichero LICENSE (README: "Feel free to use"). |
| `UGC_deep_research.md` §4.2: "UGCVidGen … usando FFmpeg" | ⚠️ Matiz | Indirectamente cierto (MoviePy→FFmpeg), pero el overlay de texto lo renderiza **ImageMagick** (dependencia extra no mencionada en requirements y fuente clásica de errores de instalación de MoviePy 1.x). |
| `UGC_deep_research.md` §4.2: "permite montar pipelines tipo Hook-Body-CTA" (UGCVidGen) | ⚠️ Impreciso | UGCVidGen solo compone **2 segmentos (Hook + CTA)**. La estructura completa Hook×Body×CTA solo está en `hook-body-cta-builder`. |
| Remotion, editly, FFCreator, MoviePy (estado del arte) | ✅ | Ver §6. `editly` estuvo ~2 años sin mantenimiento y ha sido retomado por un nuevo maintainer (release candidate); FFCreator estancado; MoviePy sigue vivo (v2.x); Remotion es el estándar de facto con licencia comercial. |
| Endpoints FFmpeg de fal.ai | ✅ | `fal-ai/ffmpeg-api/compose`, `/merge-videos`, `/merge-audio-video`, `/merge-audios` existen y están documentados ([fal.ai/models/fal-ai/ffmpeg-api/compose/api](https://fal.ai/models/fal-ai/ffmpeg-api/compose/api)). **Sin soporte de subtítulos** (confirmado también por hilo de la comunidad n8n). |

---

## 3. Análisis en profundidad: UGCVidGen

**Repo**: <https://github.com/vishnuhimself/UGCVidGen> · Clonado en scratchpad y leído completo (82 MB, incluye assets de ejemplo: 5 hook videos, 1 CTA, 5 pistas mp3, fuentes Poppins/BeVietnamPro).

### 3.1 Stack y estructura

```
UGCReelGen/
├── UGCReelGen.py          # único fichero de código (361 líneas)
├── hooks.csv              # id,text  (los "hooks" son TEXTOS, no vídeos)
├── hook_videos/           # clips de vídeo de fondo para el hook (b-roll estilo selfie)
├── cta_videos/            # clip final de llamada a la acción
├── music/                 # .mp3/.wav/.m4a elegidos al azar
├── fonts/                 # .ttf para el overlay
└── final_videos/          # salida final_video_{N}.mp4
```

Dependencias (`requirements.txt`): `moviepy==1.0.3`, `pandas`, `numpy`, `tqdm`, `Pillow`. FFmpeg como binario de sistema. (ImageMagick implícito para `TextClip`.)

### 3.2 Modelo de datos de los hooks

El insight clave: **el hook es un dato (texto en CSV), no un asset**. El vídeo de hook es intercambiable; el mensaje vive en el overlay:

```csv
id,text
1,"um so if you're trying to create viral marketing videos without any editing skills, listen up"
4,"bruh i wish i had known about this video generator when i was struggling with content creation"
11,"wdym you're still manually editing all your marketing videos??"
```

Nótese el registro: minúsculas, muletillas ("um so", "bruh", "wdym"), tono conversacional — es una mini-librería de plantillas de hooks UGC ya con voice-and-tone correcto, útil como referencia para nuestros prompts de guion.

Estado persistido en ficheros planos:
- `used_hooks.txt` — hooks ya consumidos (evita repetir un hook entre lotes; el proceso se detiene cuando se agotan).
- `video_list.txt` — CSV manual de linaje: `hook_video,hook_text,cta_video,music_file,final_video`. Es un **manifest de trazabilidad creativa** rudimentario: permite saber qué combinación produjo cada MP4 (imprescindible para atribuir performance de ads a componentes).
- `video_creation.log` — logging estándar.

### 3.3 Pipeline de composición (MoviePy)

Por cada vídeo (selección **aleatoria** de hook video + hook text no usado + CTA + música):

1. **Normalización 9:16 por "scale-to-fill + center-crop"** (no letterbox):

```python
TARGET_RESOLUTION = (1080, 1920)
def resize_video(clip, target_resolution):
    scale = max(target_w/clip_w, target_h/clip_h)   # cubrir el frame
    clip = clip.resize(width=new_w, height=new_h)
    return clip.crop(x1=..., y1=..., width=target_w, height=target_h)  # crop centrado
```

2. **Overlay de texto del hook** con `TextClip` (method='caption' → auto-wrap a `width-120px`, centrado, y=200px desde arriba), con **capa de "glow"/sombra**: duplica el texto en negro con stroke más grueso y opacidad 0.2 debajo del texto blanco principal (stroke negro 2px). Es la aproximación al estilo "caption TikTok" con contraste garantizado sobre cualquier fondo:

```python
text_clip_args = {
  "txt": hook_text, "fontsize": 70, "color": "white",
  "font": "./fonts/BeVietnamPro-Bold.ttf",
  "method": 'caption', "size": (hook_clip.w - 120, None),
  "align": 'center', "stroke_color": 'black', "stroke_width": 2,
}
combined_hook = CompositeVideoClip([hook_clip] + glow_clips + [main_text])
```

3. **Concatenación** `concatenate_videoclips([combined_hook, cta_clip])` (re-encode completo; MoviePy no hace stream copy).
4. **Música**: loop por repetición si es más corta que el vídeo, `subclip(0, dur)`, volumen 0.3, y **reemplaza por completo el audio original** (`set_audio`). No hay ducking ni mezcla voz+música.
5. **Encode**: `write_videofile(fps=24, codec="libx264", preset='medium')` — sin `pix_fmt`, sin `faststart`, sin control de bitrate/CRF explícito, audio AAC por defecto de MoviePy.

### 3.4 Comandos FFmpeg equivalentes (lo que hace por debajo)

Para el PRD conviene tener la traducción a FFmpeg puro de este pipeline:

```bash
# 1. Normalizar + overlay de texto (equivalente drawtext) en un paso
ffmpeg -i hook.mp4 -vf "scale=1080:1920:force_original_aspect_ratio=increase,\
crop=1080:1920,fps=24,setsar=1,\
drawtext=fontfile=fonts/BeVietnamPro-Bold.ttf:text='...hook...':fontsize=70:\
fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=200" \
 -c:v libx264 -preset medium -an hook_norm.mp4

# 2. Concat + música (reemplazando audio)
ffmpeg -f concat -safe 0 -i list.txt -stream_loop -1 -i music.mp3 \
 -filter_complex "[1:a]volume=0.3[a]" -map 0:v -map "[a]" -shortest \
 -c:v copy -c:a aac out.mp4
```

### 3.5 Valoración

**Fortalezas conceptuales**: (a) hooks como datos en CSV desacoplados de los assets → exactamente el modelo que necesita nuestro generador de guiones IA; (b) manifest de linaje por vídeo; (c) tracking de hooks usados; (d) scale-to-fill+crop como política de normalización 9:16.

**Debilidades técnicas** (no copiar): MoviePy 1.0.3 es lento (re-encode de todo, frame a frame vía Python), frágil (ImageMagick), sin paralelismo, texto estático (sin sincronía palabra a palabra), selección aleatoria en vez de matriz exhaustiva, sin body, sin mezcla voz+música, sin `yuv420p`/`faststart` (riesgo de incompatibilidades de reproducción). Proyecto sin mantenimiento desde feb-2025.

---

## 4. Análisis en profundidad: hook-body-cta-builder

**Repo**: <https://github.com/Pajush/hook-body-cta-builder> · App: <https://hook-body-cta-builder.vercel.app/> · Autora: Pavla Duranova. Clonado y leído completo.

### 4.1 Stack y arquitectura

- React 19 + TypeScript + Vite + Tailwind 4; estado global con **Zustand** (`src/state/projectStore.ts`).
- **ffmpeg.wasm** (`@ffmpeg/ffmpeg` 0.12) con doble build: **multithread** (`/ffmpeg-mt`, requiere `SharedArrayBuffer`) y **singlethread** (`/ffmpeg-st`) como fallback; los binarios core se auto-descargan en `postinstall` (`scripts/download-ffmpeg.mjs`) y se sirven localmente, con fallback a CDNs (unpkg/jsdelivr).
- Para habilitar multithreading en producción configura **COOP/COEP** (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) tanto en `public/_headers` como en `vercel.json` — detalle operativo imprescindible si algún día quisiéramos render en el navegador.
- Abstracción limpia de motor de render: `src/engine/EngineInterface.ts` define `IEngine { load(), probe(file), buildCombination({clips, music, normalizeOptions, mixAudioOptions, onProgress, onStage}) }` y `WasmEngine` es la única implementación. **Este interface es un buen esqueleto para nuestro "CompositionService"** (se podría implementar con FFmpeg nativo server-side sin tocar el resto).
- Todo el procesado es **local en el navegador** (privacidad); límites documentados: ~20 vídeos por lote, ~1 min/clip, 1.5–5 GB de RAM.

### 4.2 Modelo de datos

```ts
// src/state/types.ts
export type ClipType = 'hook' | 'body' | 'cta'
export interface CombinationResult {
  id: string                 // hookId_bodyId_ctaId
  clips: ClipItem[]          // orden de concatenación
  hook?: ClipItem; body?: ClipItem; cta?: ClipItem
  filename: string           // `${projectName}-${hook.name}-${body.name}-${cta.name}.mp4`
  status: 'idle' | 'rendering' | 'done' | 'error'
  progress: number; outputBlob?: Blob
}
export interface NormalizeSettings { width; height; fps /*0=auto*/; autoRotate; autoRotateDirection }
export interface AudioSettings { fadeOut; fadeOutDuration; replaceOriginalAudio; musicVolume /*0..2*/ }
```

Defaults: **1080×1920, 30 fps, música a 0.8, fadeOut 1 s, conservar audio original** (mezclándolo con la música). El **naming convention del fichero codifica la combinación** — trazabilidad creativa gratis al subir a TikTok/Meta Ads.

### 4.3 Generación de combinaciones (`src/lib/combinations.ts`)

Producto cartesiano puro Hook×Body×CTA con degradación a 2-de-3 grupos:

- Si hay clips en los 3 grupos → `hooks × bodies × ctas` (todas las ternas).
- Si solo hay 2 grupos con clips → todos los pares (H×B, H×C o B×C).
- Con <2 grupos no genera nada.

No hay deduplicación ni muestreo: con 5 hooks × 3 bodies × 2 CTAs se generan 30 renders. El render (`CombinationsList.tsx: renderAll()`) es **secuencial** (un `for` con `await`), no paralelo — limitación razonable en WASM, pero en servidor querremos un pool de workers.

### 4.4 Pipeline FFmpeg real (`src/engine/WasmEngine.ts`) — el corazón del proyecto

**Fase 1 — Normalización por clip (una vez, con caché).** Cada clip se re-encodea a formato canónico; el resultado se cachea en el FS virtual de ffmpeg.wasm con clave `nombre|tamaño|mtime|w|h|fps|autorotate` → **si un clip participa en 10 combinaciones solo se normaliza 1 vez**:

```
ffmpeg -y -i clip_0.mp4 -map 0:v:0 \
  -vf "[transpose=1,]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1" \
  -c:v libx264 -preset fast -crf 23 -an -pix_fmt yuv420p -movflags +faststart norm_cache_X.mp4
```

Detalles: mismo patrón **scale-to-fill + center-crop** que UGCVidGen (sin letterbox); `setsar=1` para evitar mismatches de aspecto en el concat; **auto-rotate opcional** con `transpose=1|2` cuando la orientación del clip (probe) no coincide con la del target (landscape→portrait); `fps` forzado a un valor común (o "auto": media de los fps de los clips, resuelta por probe); vídeo **sin audio** (`-an`).

**Audio original por separado** (si no se reemplaza): se extrae y normaliza cada pista a formato canónico para poder concatenarla con stream copy:

```
ffmpeg -y -i clip_0.mp4 -vn -map 0:a:0 -c:a aac -ar 48000 -ac 2 aud_cache_X.m4a
```

(Si el clip no tiene audio, se captura la excepción y se continúa — tolerancia a clips mudos.)

**Fase 2 — Concatenación con concat demuxer + stream copy (sin re-encode):**

```
# concat_list.txt:  file 'norm_cache_A.mp4' \n file 'norm_cache_B.mp4' ...
ffmpeg -y -f concat -safe 0 -i concat_list.txt -c copy concat_out.mp4
# ídem para el audio original concatenado → concat_original_audio.m4a
```

Esta es la razón por la que la normalización previa debe ser estricta (mismo codec, resolución, fps, SAR, sample rate): el concat demuxer con `-c copy` es casi instantáneo pero exige streams homogéneos.

**Fase 3 — Audio final** (tres caminos):

1. *Sin música, conservando audio original*: mux simple `-map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -shortest`.
2. *Música + voz original* (**el caso de nuestro producto**: voiceover TTS + BGM): la música se recorta primero a la duración exacta del vídeo (evita los cuelgues conocidos de `-stream_loop`+`-shortest` en wasm) y luego:

```
ffmpeg -y -i concat_out.mp4 -i voz_concat.m4a -i music_trimmed.m4a \
 -filter_complex "[2:a]volume=0.80,afade=t=out:st=DUR-1:d=1[bg];\
[1:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]" \
 -map 0:v:0 -map "[aout]" -c:v copy -c:a aac mixed_out.mp4
```

3. *Música reemplazando audio*: `-map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -af "volume=...,afade=..."`.

Nótese que en las fases 2–3 **el vídeo ya nunca se re-encodea** (`-c:v copy`); solo se transcodifica el audio, que es barato.

**Otros detalles de ingeniería reutilizables**: probe "casero" ejecutando `ffmpeg -i X -f null -` y parseando `Duration:`/`WxH`/`fps` del log (ffprobe no está en ffmpeg.wasm; en servidor usaríamos `ffprobe -print_format json`); limpieza defensiva del FS virtual entre renders; captura de los últimos 120 logs de ffmpeg para adjuntar el "tail" a los mensajes de error; callbacks `onProgress`/`onStage` por etapas → mapeables a estados de UI de un job de render.

### 4.5 Valoración

**Fortalezas**: el pipeline normalize-once → concat-copy → audio-mix es **exactamente la arquitectura correcta** para producir matrices de variantes baratas; interface de motor desacoplada; naming/ID de combinaciones trazable; manejo de orientación y fps heterogéneos.

**Limitaciones**: sin texto/subtítulos/overlays de ningún tipo; sin transiciones (corte seco — que, por otra parte, es lo nativo en UGC); render secuencial en navegador con techo de RAM; proyecto de nicho con 0 stars y sin licencia formal (usarlo como referencia de diseño, no como dependencia).

---

## 5. La "gramática" de composición UGC extraída de ambos proyectos

Síntesis de patrones que nuestro pipeline debería heredar:

1. **Estructura de anuncio = secuencia tipada de segmentos**: `Hook → Body → CTA` (con variantes 2-de-3). Cada segmento es un asset independiente y direccionable.
2. **El mensaje del hook es un dato** (texto/guion versionable en CSV/DB), separado del asset visual; los assets visuales de hook son intercambiables.
3. **Variantes = producto cartesiano** de pools de segmentos, con ID/filename que codifica la combinación (`{project}-{hook}-{body}-{cta}.mp4`) para atribución de performance.
4. **Normalización canónica agresiva y cacheada**: 1080×1920 (scale-to-fill + center-crop, jamás letterbox), fps fijo, `setsar=1`, H.264 `yuv420p` CRF ~23, audio AAC 48 kHz estéreo, `+faststart`. Normalizar 1 vez por asset, no por variante.
5. **Concat demuxer + `-c copy`** para ensamblar variantes a coste casi cero.
6. **Audio en dos capas**: voz (del segmento) + música de fondo con `volume` ~0.3–0.8 relativo, `amix duration=first`, `afade` out final. (Mejora pendiente en ambos: **sidechain ducking** — bajar la música cuando habla la voz: `sidechaincompress`.)
7. **Texto quemado con contraste garantizado** (stroke/glow negro sobre texto blanco, fuente bold, safe margins ~80–120 px, posición y≈200 px bajo el borde superior para no chocar con la UI de TikTok).
8. **Registro de linaje** (qué hook/body/cta/música → qué MP4) como artefacto de primera clase.

---

## 6. Estado del arte: post-procesado programático de vídeo (2026)

### 6.1 FFmpeg nativo (el sustrato de todo)

Todas las herramientas del ecosistema (MoviePy, editly, Remotion en su fase de encode, fal.ai ffmpeg-api, Creatomate…) terminan en FFmpeg. Filtros/técnicas clave para nuestro caso:

- **Normalización 9:16**: `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1` (crop-to-fill) o `...=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2` (letterbox; evitar en UGC). Para b-roll horizontal reutilizado, alternativa estética: fondo blur (`split[a][b];[a]scale=1080:1920,boxblur=20[bg];[bg][b]overlay=...`).
- **Concatenación**: (a) *concat demuxer* + `-c copy` — instantáneo, exige streams homogéneos (nuestro caso tras normalizar); (b) *concat filter* (`[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1`) — tolera heterogeneidad pero re-encodea; (c) transiciones con `xfade`/`acrossfade` si se quisieran (en UGC el corte seco es la norma).
- **Texto**: `drawtext` (estático, requiere build con libfreetype/fontconfig) — suficiente para hooks estáticos tipo UGCVidGen.
- **Subtítulos quemados**: `-vf "ass=subs.ass"` (libass) o `subtitles=subs.srt:force_style='...'`. **ASS es el formato correcto para el estilo TikTok**: soporta posicionamiento, fuentes, bordes, colores por palabra y tags karaoke (`\k`) — con word-level timestamps se genera highlight palabra a palabra sin re-render por frame.
- **Audio**: `amix=inputs=2:duration=first`, `volume`, `afade`, `apad`, **`loudnorm` (EBU R128, target ~-14 LUFS** recomendado para social) y `sidechaincompress` para ducking automático de la música bajo la voz.
- **Contenedor social-ready**: `-c:v libx264 -profile:v high -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 128k -ar 48000`. TikTok/Reels: 1080×1920, ≤60 s (ads: 9–15 s óptimo), H.264/AAC MP4.

### 6.2 Subtítulos estilo TikTok: el sub-problema con más opciones

Cadena canónica: **audio de la voz → word-level timestamps → agrupación en "páginas" de 1–4 palabras → render con highlight de palabra activa → burn-in**.

- **Fuente de timestamps**: si la voz es TTS nuestro (p. ej. ElevenLabs vía fal.ai o minimax/kokoro), muchos TTS ya devuelven character/word timings — **evita el paso de ASR**. Fallback: `whisper.cpp` / OpenAI Whisper con `word_timestamps=true` (fal.ai también ofrece endpoints de whisper).
- **Remotion**: `@remotion/captions` con **`createTikTokStyleCaptions()`** (agrupa tokens en páginas configurables por `combineTokensWithinMilliseconds`; valor bajo → animación palabra a palabra) + `@remotion/install-whisper-cpp`. Template oficial listo: [remotion-dev/template-tiktok](https://github.com/remotion-dev/template-tiktok) ([docs](https://www.remotion.dev/docs/captions/create-tiktok-style-captions)). Es la vía con captions animados más ricos (React/CSS: bounce, scale, emoji).
- **Vía ASS/libass pura (sin runtime de navegador)**: generar `.ass` con tags karaoke desde los word timestamps y quemar con un solo comando ffmpeg. OSS de referencia: [jurczykpawel/subtitle-burner](https://github.com/jurczykpawel/subtitle-burner) (6 estilos de animación word-level, whisper en navegador, self-hostable), [auto-subs (PyPI)](https://pypi.org/project/auto-subs/) (genera .ass karaoke word-by-word + `--burn`). Ejemplo de evento ASS word-highlight:

```
Dialogue: 0,0:00:01.20,0:00:02.05,TikTok,,0,0,0,,{\k35}this {\k28}changed {\k42}everything
```

- Proyectos integrados que ya hacen "escenas + captions + música + 9:16" y sirven de referencia arquitectónica: **[gyoridavid/short-video-maker](https://github.com/gyoridavid/short-video-maker)** (MCP + REST; Remotion para captions, whisper.cpp para timestamps, ffmpeg para el ensamblado final — el análogo OSS más cercano a nuestra capa de composición), **MoneyPrinterTurbo** (MoviePy+ffmpeg, pipeline completo guion→assets→subtítulos→BGM) y ShortGPT.

### 6.3 Frameworks de composición programática

| Herramienta | Estado (jul-2026) | Modelo | Pros | Contras para nosotros |
|---|---|---|---|---|
| **FFmpeg CLI/filtergraph** (en worker propio) | Estándar, eterno | Comandos/filtros | Máximo control y velocidad; stream copy; ASS karaoke; coste = CPU propia | Filtergraphs complejos = "lenguaje" propio; sin preview |
| **Remotion** ([remotion.dev](https://www.remotion.dev/)) | Muy activo; ecosistema captions/Lambda/Editor Starter; agent skills | React → frames → encode | Captions TikTok de fábrica, preview Player en la web app, Lambda/Cloud Run para escalar | **Licencia**: gratis solo ≤3 empleados; plan Automators **$0.01/render + $100/mes mínimo** ([license](https://www.remotion.dev/docs/license)); render más caro en CPU que ffmpeg puro |
| **editly** ([mifi/editly](https://github.com/mifi/editly)) | Resucitado tras ~2 años parado (nuevo maintainer, release candidate) ([discussion #308](https://github.com/mifi/editly/discussions/308)) | JSON5 declarativo → ffmpeg | Spec declarativa de clips/capas/transiciones, muy alineada con "composition spec" | Riesgo de mantenimiento; instalación nativa (canvas/gl) problemática (M1, serverless) |
| **FFCreator** | Estancado | Node + canvas/GL | Rápido para slideshows | Comunidad china poco activa, API anticuada |
| **MoviePy 2.x** | Vivo, popular en el mundo Python-AI | Python frame a frame | Simplicidad; ecosistema Python | Lento (re-encode todo), ImageMagick/text, no apto para matrices grandes |
| **ffmpeg.wasm** | Estable (0.12) | FFmpeg en navegador | Zero-server, privacidad (cf. hook-body-cta-builder) | 1.5–5 GB RAM, secuencial, sin libass garantizado, COOP/COEP; no apto como motor principal SaaS |
| **fal-ai/ffmpeg-api** (`compose`, `merge-videos`, `merge-audio-video`) | Activo | JSON (tracks/keyframes) gestionado | Zero-infra, mismo proveedor que nuestra generación IA, ~$0.0002/s output, webhooks/queue | **Sin subtítulos/drawtext/overlays**; primitivas limitadas; menos control de calidad |
| **Creatomate / Shotstack / JSON2Video** (SaaS de render) | Activos | JSON template → render API | Templates con captions incluidos, sin infra | Coste por render recurrente, lock-in, menos diferenciación técnica |

### 6.4 fal.ai ffmpeg-api en detalle (por ser nuestro proveedor)

- **`fal-ai/ffmpeg-api/compose`** ([docs](https://fal.ai/models/fal-ai/ffmpeg-api/compose/api)): entrada = `tracks[]`, cada track `{id, type: 'video'|'audio'|'image', keyframes: [{url, timestamp(ms), duration(ms)}]}`; salida `{video_url, thumbnail_url}`; precio **$0.0002/seg de output** (~$0.006 por vídeo de 30 s). Modela pistas paralelas con clips posicionados en el tiempo — suficiente para concat de escenas + pista de voz + pista de música.
- **`/merge-videos`** ([docs](https://fal.ai/models/fal-ai/ffmpeg-api/merge-videos/api)): `video_urls[]` en orden + `target_fps` (default: mínimo de los inputs) + `resolution` (presets `portrait_16_9` etc. o `{width,height}` 512–2048) — es decir, **hace la normalización+concat por nosotros**.
- **`/merge-audio-video`**: `video_url` + `audio_url` + `start_offset` (para colocar voiceover).
- **Limitación crítica confirmada** ([hilo n8n](https://community.n8n.io/t/endpoint-to-merge-audio-video-and-subtitles-in-fal-ai/188008)): **no hay endpoint para quemar subtítulos** ni overlays de texto; la comunidad recomienda self-host ffmpeg o Creatomate para ese paso. También carece de: control de volumen relativo/ducking documentado, fades, drawtext, LUFS.

---

## 7. Qué papel debe jugar la capa de composición en nuestro pipeline

### 7.1 Posición en el pipeline

```
URL producto → análisis IA (facetas) → guion por segmentos (hook/body/cta, con texto overlay + VO script)
   → generación IA por segmento (fal.ai: avatar/talking-head, b-roll, product shots)  [clips crudos]
   → TTS (voz + word timestamps)
   ────────────────────────────────────────────────────────────────────────────
   →  CAPA DE COMPOSICIÓN (este informe):
      1. Normalizar cada clip a canónico 1080×1920/30fps/H.264/yuv420p (cacheado por asset)
      2. Ensamblar variantes Hook×Body×CTA vía concat demuxer -c copy
      3. Alinear voz TTS por segmento; mezclar música (volumen ~0.2–0.3 bajo voz, ducking, fade-out, loudnorm -14 LUFS)
      4. Generar .ass estilo TikTok desde word timestamps y quemarlo (burn-in)
      5. Overlays de marca/CTA (drawtext/logo overlay) y safe-zones
      6. Encode final social-ready (+faststart) + thumbnail + manifest de linaje
   ────────────────────────────────────────────────────────────────────────────
   → QA/preview → publicación/descarga → (futuro) feedback de performance por combinación
```

La capa de composición es **donde se materializa la economía del producto**: la generación IA es la parte cara (~$/clip); la composición convierte K clips generados en K_h×K_b×K_c anuncios por céntimos. Un producto con 3 hooks × 2 bodies × 2 CTAs = **12 anuncios pagando solo 7 generaciones IA**. Es también donde se garantiza el "look TikTok" (captions, música, formato) que los modelos generativos aún no producen de forma fiable y donde se imprime la trazabilidad creativa (qué hook ganó).

### 7.2 Recomendación de implementación

**Núcleo (recomendado): worker propio de FFmpeg nativo** (contenedor Docker: `ffmpeg` con libass + libfreetype + fuentes propias + `ffprobe`), orquestado por una cola de jobs (una job = una variante; paralelizable horizontalmente). Justificación: es la única opción que cubre el 100 % de la gramática de §5 (incluidos subtítulos ASS karaoke, ducking y loudnorm), a coste marginal ≈ CPU, sin licencias ni lock-in. Portar el diseño de `IEngine`/`buildCombination` y la caché de normalizados de hook-body-cta-builder, y el manifest de linaje de UGCVidGen.

**Atajo de MVP (opcional)**: para una demo sin infra, `fal-ai/ffmpeg-api/merge-videos` + `merge-audio-video` resuelven concat+voz+música con el mismo API key que ya usamos — aceptando **anuncios sin subtítulos quemados** (o subtítulos "nativos" subidos como .srt a la plataforma de ads, que TikTok también acepta). No es destino final: los captions quemados son parte esencial del estilo UGC.

**Capa premium (evaluar en fase 2): Remotion** si queremos (a) captions animados ricos (bounce/scale/emoji) más allá de ASS, (b) preview interactivo del anuncio en la web app con `@remotion/player`, (c) plantillas visuales editables. Coste: plan Automators $0.01/render + $100/mes mínimo + renders más lentos. Híbrido razonable: FFmpeg para ensamblado/normalización + Remotion solo para el "caption layer" en el tier de pago.

**Descartar como núcleo**: MoviePy (lento/frágil), editly/FFCreator (riesgo de mantenimiento), ffmpeg.wasm (RAM/secuencial; solo tendría sentido para un futuro "editor de retoques" client-side).

---

## 8. Implicaciones para el PRD

1. **Definir la "Composition Spec" como contrato central del producto** (inspirada en editly/fal compose/CombinationResult): JSON con `segments[] {type: hook|body|cta, video_asset, vo_audio, vo_words[{word,start,end}], overlay_text}`, `music {asset, volume, fade_out, ducking}`, `captions {style, position, max_words_per_page}`, `output {w:1080, h:1920, fps:30, max_duration}`. Todo lo que genera la IA debe desembocar en este contrato; el renderer lo consume.
2. **El modelo de datos debe tratar hooks/bodies/CTAs como entidades independientes y combinables**, no como "vídeos": tabla de segmentos + tabla de variantes (combinación) + manifest de linaje (segmento→variante→plataforma→métricas). El filename/ID codifica la combinación (patrón hook-body-cta-builder).
3. **Requisito técnico de render**: normalización canónica cacheada por asset (1080×1920 crop-to-fill, fps 30, H.264 CRF≈23 `yuv420p`, AAC 48 kHz estéreo, `setsar=1`, `+faststart`) + concat demuxer con stream copy. KPI interno: coste de render por variante ≪ coste de generación IA; re-render de una variante nueva con assets ya normalizados < 10 s.
4. **Los subtítulos quemados word-by-word son un requisito de producto** (estilo TikTok) y **no los cubre fal.ai** → presupuestar el worker FFmpeg+libass (o Remotion) desde el principio. Exigir al módulo TTS que devuelva **word-level timestamps** (elección de voz condicionada a ello) para evitar un paso extra de whisper alignment.
5. **Audio como sistema de dos capas** (voz por segmento + música global): volumen música ~0.2–0.3 relativo, `sidechaincompress` (ducking), `afade` out 1 s, `loudnorm` a -14 LUFS. Decidir origen de la música (librería licenciada propia vs upload del usuario — implicación legal para ads).
6. **La cola de render es un componente de arquitectura de primera clase**: job por variante, estados `idle/rendering/done/error` con `progress` y `stage` (patrón observado en hook-body-cta-builder, mapeable directo a UI), reintentos, webhooks (compatible con el queue model de fal si se usa su ffmpeg-api en MVP).
7. **Guardrails de formato de plataforma** en el renderer: duración objetivo 9–15 s (ads), safe-zones de TikTok (texto fuera de los ~120 px inferiores y laterales derechos), thumbnail auto-extraído, validación con ffprobe antes de marcar el job como done.
8. **Decisión de build-vs-buy explícita en el PRD** con los tres escalones: (MVP) fal ffmpeg-api sin captions → (v1) worker FFmpeg propio con ASS → (v2 opcional) Remotion para captions premium + preview. Documentar el trigger de cada salto.
9. **Reutilizar como specs de referencia**: el CSV de hooks de UGCVidGen (tono/registro para el prompt de guiones), su `video_list.txt` (manifest mínimo de linaje) y el `IEngine` de hook-body-cta-builder (interface del CompositionService). Ninguno de los dos repos es apto como dependencia (mantenimiento/licencia): **copiar patrones, no código**.
10. **Riesgo de licencias a vigilar**: Remotion (company license), fuentes tipográficas para burn-in (usar OFL: Poppins/Be Vietnam Pro son Google Fonts OFL), música (librería con licencia para paid ads), y ausencia de LICENSE en ambos repos analizados.

---

## Referencias

- UGCVidGen — <https://github.com/vishnuhimself/UGCVidGen>
- hook-body-cta-builder — <https://github.com/Pajush/hook-body-cta-builder> · app: <https://hook-body-cta-builder.vercel.app/>
- GitHub Topic ugc-ads — <https://github.com/topics/ugc-ads>
- fal.ai FFmpeg API compose — <https://fal.ai/models/fal-ai/ffmpeg-api/compose/api>
- fal.ai merge-videos — <https://fal.ai/models/fal-ai/ffmpeg-api/merge-videos/api>
- fal.ai merge-audio-video — <https://fal.ai/models/fal-ai/ffmpeg-api/merge-audio-video/api>
- Limitación subtítulos fal (n8n community) — <https://community.n8n.io/t/endpoint-to-merge-audio-video-and-subtitles-in-fal-ai/188008>
- Remotion — <https://www.remotion.dev/> · captions TikTok: <https://www.remotion.dev/docs/captions/create-tiktok-style-captions> · template: <https://github.com/remotion-dev/template-tiktok> · licencia: <https://www.remotion.dev/docs/license>
- editly (nuevo maintainer) — <https://github.com/mifi/editly> · <https://github.com/mifi/editly/discussions/308>
- subtitle-burner — <https://github.com/jurczykpawel/subtitle-burner>
- auto-subs (ASS karaoke) — <https://pypi.org/project/auto-subs/>
- short-video-maker (Remotion+whisper+ffmpeg, MCP/REST) — <https://github.com/gyoridavid/short-video-maker>
- ffmpeg.wasm — <https://github.com/ffmpegwasm/ffmpeg.wasm>
