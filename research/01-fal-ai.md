# Catálogo y API de fal.ai para generación de anuncios UGC (vídeo 9:16)

**Fecha de investigación:** 6 de julio de 2026
**Ámbito:** catálogo de modelos de fal.ai (text-to-video, image-to-video, avatar/lipsync, TTS, imagen), API (clientes JS/Python, queue, webhooks, storage, auth, límites) y estimación de coste de un anuncio UGC de 15–30 s.
**Método de verificación:** todas las afirmaciones clave se han contrastado contra las model pages y docs oficiales de fal.ai (URLs citadas en cada sección) mediante búsqueda y fetch directo el 2026-07-06. Donde el dato procede de una fuente terciaria o de un snapshot antiguo se marca explícitamente como **[verificar]**.

---

## 0. Resumen ejecutivo

- fal.ai es hoy (julio 2026) el agregador de referencia de modelos generativos de vídeo/imagen/audio con **pricing pay-per-use sin suscripción** (por segundo de vídeo, por imagen/megapíxel, por 1.000 caracteres de TTS) y una **Queue API asíncrona con webhooks firmados** ideal para un pipeline de generación de anuncios.
- Todo el stack necesario para un anuncio UGC (guion aparte) existe dentro de fal: **keyframes/product shots** (Nano Banana 2/Pro, Seedream 4.5, FLUX.2, GPT Image 2), **vídeo 9:16 con audio nativo** (Veo 3.1, Kling 3.0, Seedance 2.0, Sora 2, Wan 2.6, HappyHorse-1.0, Grok Imagine, Pixverse v5.6), **avatares parlantes** (Kling AI Avatar v2, OmniHuman v1.5, VEED Fabric 1.0, VEED Avatars, InfiniTalk), **lipsync** (sync lipsync 2.0/pro, LatentSync, Kling LipSync) y **TTS multilingüe** (ElevenLabs v3/Turbo, MiniMax Speech, Kokoro, etc.). Incluso hay utilidades de **composición FFmpeg** (`fal-ai/ffmpeg-api/compose`) para ensamblar el anuncio final sin infraestructura propia de render.
- El coste de generación de un anuncio de 30 s oscila entre **~$0,20 (avatar de librería VEED + Kokoro)** y **~$21 (Sora 2 Pro 1080p)**; el rango "sweet spot" calidad/precio para UGC está en **$1,5–5 por variante** (detalles en §6).

---

## 1. Modelos text-to-video e image-to-video relevantes para UGC 9:16

### 1.1 Tabla comparativa (precios verificados en model pages de fal, julio 2026)

| Modelo (endpoint base) | Precio | Duración | Resoluciones | 9:16 | Audio nativo |
|---|---|---|---|---|---|
| **Veo 3.1** `fal-ai/veo3.1` (+`/fast`, `/image-to-video`, `/reference-to-video`, `/first-last-frame-to-video`, extend) | Standard 720p/1080p: $0,20/s sin audio, **$0,40/s con audio**; 4K: $0,40–0,60/s. Fast: $0,10/s sin audio, **$0,15/s con audio**; 4K $0,30–0,35/s. Existe tier "lite" (~$0,05/s **[verificar]**) | 4/6/8 s por clip; extensible ~148 s encadenando (7 s/paso, 20 pasos) | 720p / 1080p / 4K, 24 fps | Sí (`aspect_ratio: "auto"|"16:9"|"9:16"`) | Sí: diálogo con lipsync, SFX y música |
| **Kling 3.0 (V3)** `fal-ai/kling-video/v3/{standard,pro}/text-to-video` (también i2v) | Standard: $0,084/s sin audio, **$0,126/s con audio**, $0,154/s con voice control. Pro: $0,112 / **$0,168** / $0,196/s (ej. oficial: 5 s pro audio+voz = $0,98) | 3–15 s nativos, multi-shot con prompt por plano | hasta 1080p | Sí **[verificar enum exacto en API schema]** | Sí, con **voice control** (voz dirigida) en ZH/EN/JA/KO/**ES** |
| **Kling O3** `fal-ai/kling-video/o3/{standard,pro}/...` | O3 Standard con audio ≈ $0,224/s (ej.: $1,12 / 5 s) **[verificar tabla completa]** | 3–15 s | 1080p | Sí | Sí; orientado a referencias: multi-imagen, elementos de vídeo, coherencia multi-personaje |
| **Seedance 2.0 (ByteDance)** `bytedance/seedance-2.0/{text-to-video,image-to-video,reference-to-video}` (+`/fast/...`) | Standard 720p: **$0,3034/s**; Fast 720p: **$0,2419/s** (480p más barato **[verificar]**). Audio incluido sin sobrecoste | `auto` o 4–15 s | 480p / 720p | Sí (`aspect_ratio`: auto, 21:9, 16:9, 4:3, 1:1, 3:4, **9:16**) | Sí (`generate_audio: true` por defecto); acepta también imagen+vídeo+audio como referencia |
| **Seedance 1.0 Pro** `fal-ai/bytedance/seedance/v1/pro/text-to-video` | $2,5 / 1M tokens de vídeo; ≈ **$0,62 por 5 s 1080p** (tokens = alto×ancho×fps×dur/1024) | 5–10 s | hasta 1080p | Sí | No |
| **Sora 2 (OpenAI)** `fal-ai/sora-2/text-to-video` (+`/pro`, `image-to-video/pro`) | Sora 2: **$0,10/s**. Pro: **$0,30/s 720p**, $0,50/s 1080p legacy, $0,70/s true 1080p | 4/8/12 s (hasta 25 s extendido) | 720p; Pro hasta 1080p | Sí (9:16 y 16:9) | Sí, diálogo sincronizado + ambiente |
| **Wan 2.6 (Alibaba)** `wan/v2.6/{text-to-video,image-to-video,reference-to-video}` | **$0,10/s 720p**, $0,15/s 1080p; variantes **Flash desde $0,05/s** | hasta 15 s | 720p / 1080p | Sí **[verificar enum]** | Sí (diálogo EN/ZH); acepta `audio_url` propio |
| **Wan 2.5 (preview)** `fal-ai/wan-25-preview/text-to-video` | $0,05/s 480p, $0,10/s 720p, $0,15/s 1080p | 5/10 s | 480p/720p/1080p | Sí | Sí + permite conducir el vídeo con un audio subido (mp3/wav/…) |
| **HappyHorse-1.0 (Alibaba ATH)** `alibaba/happy-horse/{text-to-video,image-to-video,reference-to-video,video-edit}` | **$0,14/s 720p**, $0,28/s 1080p | 3–15 s | hasta 1080p | Sí **[verificar enum]** | Sí: lipsync nativo en 7 idiomas (EN, ZH, cantonés, JA, KO, DE, FR) |
| **Grok Imagine Video 1.5 (xAI)** `xai/grok-imagine-video/{text-to-video,image-to-video,edit-video}` | **$0,05/s 480p, $0,07/s 720p** (ej. oficial: 10 s 720p con audio ≈ $0,70) | hasta 10 s | 480p/720p, 24 fps | Sí (16:9, **9:16**, 4:3, 3:4, 2:3, 3:2, 1:1) | Sí: diálogo con lipsync, ambiente y SFX |
| **Pixverse v5.6** `fal-ai/pixverse/v5.6/text-to-video` (también i2v, effects; v5.5 disponible) | Base 5 s: $0,35 (360/540p), **$0,45 (720p)**, $0,75 (1080p); 8 s = 2×; 10 s = 2,2× (sin 1080p a 10 s). Audio con sobrecoste (v5.5: +$0,05 **[verificar en v5.6]**) | 5/8/10 s | 360p–1080p | Sí (histórico de Pixverse; **[verificar enum]**) | Opcional con sobrecoste |
| **LTX-2 (Lightricks)** `fal-ai/ltx-2/text-to-video/fast` (+ pro) | Fast: **$0,04/s 1080p**, $0,08/s 1440p, $0,16/s 2160p; Pro $0,10/s 1080p | 6–20 s (>10 s exige 25 fps y 1080p); Pro >20 s | 1080p–4K, 25/50 fps | **No: solo 16:9** → descartado para vertical nativo | Sí |
| **Hunyuan Video 1.5 (Tencent)** `fal-ai/hunyuan-video-v1.5/text-to-video` | **$0,075/s** | ~5 s (121 frames) | 480p | **[verificar]** | No documentado |

Fuentes (model pages y landings oficiales):
- Veo 3.1: https://fal.ai/models/fal-ai/veo3.1 · https://fal.ai/veo-3.1 · https://fal.ai/models/fal-ai/veo3.1/reference-to-video/api · https://fal.ai/models/fal-ai/veo3.1/fast/first-last-frame-to-video/api
- Kling 3.0/O3: https://fal.ai/kling-3 · https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video · https://fal.ai/models/fal-ai/kling-video/v3/pro/text-to-video · https://fal.ai/models/fal-ai/kling-video/o3/standard/image-to-video
- Seedance 2.0: https://fal.ai/seedance-2.0 · https://fal.ai/models/bytedance/seedance-2.0/text-to-video · https://fal.ai/models/bytedance/seedance-2.0/image-to-video · https://fal.ai/models/bytedance/seedance-2.0/fast/text-to-video
- Seedance 1.0 Pro: https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/text-to-video
- Sora 2: https://fal.ai/models/fal-ai/sora-2/text-to-video · https://fal.ai/models/fal-ai/sora-2/text-to-video/pro · https://fal.ai/models/fal-ai/sora-2/image-to-video/pro
- Wan 2.5/2.6: https://fal.ai/models/fal-ai/wan-25-preview/text-to-video · https://fal.ai/wan-2.6 · https://fal.ai/models/wan/v2.6/text-to-video
- HappyHorse-1.0: https://fal.ai/happyhorse-1.0 · https://fal.ai/learn/devs/happyhorse-1-0-what-do-we-know-so-far
- Grok Imagine: https://fal.ai/grok-imagine
- Pixverse: https://fal.ai/models/fal-ai/pixverse/v5.6/text-to-video · https://fal.ai/learn/devs/pixverse-v5-5-developer-guide
- LTX-2: https://fal.ai/models/fal-ai/ltx-2/text-to-video/fast
- Hunyuan 1.5: https://fal.ai/models/fal-ai/hunyuan-video-v1.5/text-to-video

### 1.2 Notas de selección para UGC vertical

1. **Audio nativo con diálogo** (el avatar "habla" ya en el clip generado, sin TTS+lipsync aparte): Veo 3.1, Kling 3.0 (con *voice control* y soporte de **español**), Seedance 2.0, Sora 2, HappyHorse-1.0 (lipsync nativo 7 idiomas), Grok Imagine, Wan 2.6. Esto habilita un pipeline de una sola pasada: prompt con guion → clip hablado 9:16.
2. **Consistencia de producto**: los endpoints *reference-to-video* (Seedance 2.0 R2V, Veo 3.1 `reference-to-video`, Wan 2.6 R2V, Kling O3 con elementos multi-imagen) aceptan imágenes del producto real como referencia — crítico para que el producto del anuncio sea el del cliente y no una alucinación.
3. **Riesgo Sora 2**: la propia página de fal muestra aviso de "elevated latency and timeouts originating from the upstream Sora provider" y fuentes terceras reportan **sunset de la API Sora 2 el 24-09-2026** (https://costgoat.com/pricing/sora). No construir dependencias duras sobre Sora 2.
4. **LTX-2 queda descartado** para 9:16 nativo (solo 16:9), pese a su precio imbatible ($0,04/s 1080p); solo serviría con crop/reframe posterior.
5. **Duración**: ningún modelo genera 30 s de una pasada a coste razonable salvo Kling 3.0 / Seedance 2.0 / Wan 2.6 / HappyHorse (15 s) y LTX-2 Pro; un anuncio de 30 s se compone normalmente de 2–4 clips cosidos (ver `ffmpeg-api` en §5.6).

---

## 2. Modelos de avatar parlante y lipsync en fal

### 2.1 Avatar a partir de imagen + audio ("talking head")

| Modelo | Endpoint | Precio | Inputs | Notas |
|---|---|---|---|---|
| **Kling AI Avatar v2 Standard** | `fal-ai/kling-video/ai-avatar/v2/standard` | **$0,0562/s** | imagen (jpg/png/webp/gif/avif) + audio (mp3/ogg/wav/m4a/aac) + prompt opcional | Duración = duración del audio. La mejor relación calidad/precio para talking heads. |
| **Kling AI Avatar v2 Pro** | `fal-ai/kling-video/ai-avatar/v2/pro` | **$0,115/s** | ídem | Más detalle facial y lipsync más fino (close-ups). |
| **OmniHuman v1.5 (ByteDance)** | `fal-ai/bytedance/omnihuman/v1.5` (también v1 en `fal-ai/bytedance/omnihuman`) | **$0,14/s** | 1 imagen + audio (máx. **30 s**) | "Film-grade": cuerpo entero, movimiento de cámara, emociones desde la forma de onda; multi-personaje en v1.5. |
| **VEED Fabric 1.0** | `veed/fabric-1.0` (+ `veed/fabric-1.0/fast`) | **$0,08/s 480p, $0,15/s 720p** (fast: $0,10/$0,20) | imagen + audio | Clips hasta **5 min**. Partner oficial VEED en fal. |
| **InfiniTalk** | `fal-ai/infinitalk` | **$0,20/s** (720p ×2) | imagen + audio | Lipsync con expresiones naturales. |
| **VEED Avatars (librería UGC)** | `veed/avatars/text-to-video` | **$0,35/minuto** | **texto + avatar de librería** (estilo UGC, p. ej. `emily_primary`) | Text-to-video directo con voz incluida: el más barato con diferencia; librería limitada de avatares "creator-style". |

Fuentes: https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard · https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/pro · https://fal.ai/models/fal-ai/bytedance/omnihuman · https://fal.ai/models/veed/fabric-1.0 · https://blog.fal.ai/veed-fabric-1-0-on-fal-turn-any-image-into-a-talking-video/ · https://fal.ai/models/fal-ai/infinitalk · https://fal.ai/models/veed/avatars/text-to-video · https://fal.ai/explore/best-avatar-models

### 2.2 Lipsync sobre vídeo existente (re-sincronizar labios a un audio nuevo)

| Modelo | Endpoint | Precio | Notas |
|---|---|---|---|
| **sync. lipsync 2.0** | `fal-ai/sync-lipsync/v2` | **$3/min** | Estándar para contenido conversacional. |
| **sync. lipsync-2-pro** | `fal-ai/sync-lipsync/v2/pro` | **$5/min** | Para close-ups y trabajo comercial premium. |
| **sync. lipsync 1.9** | `fal-ai/sync-lipsync` | $0,7/min **[verificar, snapshot 2025]** | Legacy barato. |
| **LatentSync** | `fal-ai/latentsync` | **$0,20/vídeo** (hasta 40 s) + $0,005/s extra **[verificar, snapshot 2025]** | Open source (ByteDance); calidad menor, coste mínimo. |
| **Kling LipSync** | `fal-ai/kling-video/lipsync/audio-to-video` y `/text-to-video` | $0,14/vídeo **[verificar, snapshot 2025]** | Variante text-to-video hace TTS interno. |
| **Tavus Hummingbird** | `fal-ai/tavus/hummingbird-lipsync/v0` | $2,1/min (mín. 15 s) **[verificar, snapshot 2025]** | — |

Fuentes: https://fal.ai/models/fal-ai/sync-lipsync/v2 · https://fal.ai/models/fal-ai/sync-lipsync/v2/pro · https://fal.ai/models/fal-ai/latentsync · https://fal.ai/models/fal-ai/kling-video/lipsync/audio-to-video

**Patrón de uso para UGC:** (a) generar B-roll del avatar con un i2v cualquiera y re-lipsyncar con sync-2 al voiceover final, o (b) usar directamente Kling AI Avatar/Fabric/OmniHuman con el audio TTS — (b) es más barato y simple; (a) da más control de plano/movimiento.

---

## 3. Modelos TTS / voz en fal

| Modelo | Endpoint | Precio | Notas para UGC |
|---|---|---|---|
| **ElevenLabs Eleven v3** | `fal-ai/elevenlabs/tts/eleven-v3` | **$0,10/1k caracteres** | El más expresivo (audio tags, emociones); ~70 idiomas. |
| **ElevenLabs Turbo v2.5** | `fal-ai/elevenlabs/tts/turbo-v2.5` | **$0,05/1k** | Rápido, 32 idiomas; el caballo de batalla. |
| **ElevenLabs Multilingual v2** | `fal-ai/elevenlabs/tts/multilingual-v2` | $0,10/1k | — |
| **ElevenLabs Text-to-Dialogue v3** | `fal-ai/elevenlabs/text-to-dialogue/eleven-v3` | $0,10/1k | Diálogo multi-speaker (formatos "dos amigas comentan"). |
| **ElevenLabs Sound Effects** | `fal-ai/elevenlabs/sound-effects` | $0,002/s | SFX (whoosh, pops) para el montaje. |
| **MiniMax Speech-02 HD / Turbo** | `fal-ai/minimax/speech-02-hd`, `.../speech-02-turbo` | HD **$0,10/1k**; Turbo ~$0,03/1k **[verificar]** | 30+ idiomas; también existen **Speech-2.8 HD/Turbo** en fal (más recientes). |
| **MiniMax Voice Clone** | `fal-ai/minimax/voice-clone` | $1/voz **[verificar, snapshot 2025]** | Clonado con ≥10 s de audio; la voz se borra si no se usa en 7 días. Base para "founder twin". |
| **MiniMax Voice Design** | `fal-ai/minimax/voice-design` | — | Crear voces desde descripción textual. |
| **Kokoro** | `fal-ai/kokoro/spanish` (y `american-english`, `british-english`, `french`, `hindi`, `italian`, `japanese`, `mandarin-chinese`, `brazilian-portuguese`) | **$0,02/1k** | Open source, ultra barato; calidad correcta para faceless/testing masivo. |
| **Chatterbox (Resemble)** | — | $0,025/1k | Con voice cloning. |
| **PlayAI TTS / Dialog** | `fal-ai/playai/tts/dialog` | ~$0,05/1k **[verificar; precio no visible en la page]** | Multi-speaker; PlayAI es además customer case de fal. |
| Otros en catálogo | Qwen3-TTS ($0,09/1k), Index TTS 2.0 ($0,002/s), Dia TTS ($0,04/1k), Orpheus ($0,05/1k), Inworld, VibeVoice 7B, Maya1, xAI TTS v1 | — | Lineup completo en la página de exploración. |

Fuentes: https://fal.ai/models/fal-ai/elevenlabs/tts/eleven-v3 · https://fal.ai/models/fal-ai/elevenlabs/tts/turbo-v2.5 · https://fal.ai/elevenlabs · https://fal.ai/models/fal-ai/minimax/speech-02-hd · https://fal.ai/models/fal-ai/minimax/voice-design/api · https://fal.ai/explore/text-to-speech-apis · https://fal.ai/models/fal-ai/playai/tts/dialog/llms.txt · https://fal.ai/customer-case/playai-and-fal

**Español:** cubierto por ElevenLabs (v3/multilingual/turbo), MiniMax (30+ idiomas), Kokoro (`fal-ai/kokoro/spanish`) y el voice control de Kling 3.0 (incluye español con acentos regionales).

**Música de fondo:** `fal-ai/ace-step` (~$0,005/s **[verificar, snapshot 2025]**) y `fal-ai/mmaudio-v2` ($0,001/s, foley/ambiente sobre vídeo mudo **[verificar]**). Alternativa: librería musical propia (licencias) + merge.

---

## 4. Modelos de imagen para keyframes y product shots

| Modelo | Endpoint | Precio | Uso en el pipeline |
|---|---|---|---|
| **Nano Banana** (Gemini 2.5 Flash Image) | `fal-ai/nano-banana` (+`/edit`) | **$0,039/imagen** | Edición conversacional barata; keyframes rápidos. |
| **Nano Banana 2** (Gemini 3.1 Flash Image) | `fal-ai/nano-banana-2` (+`/edit`) | **$0,08/imagen** (2K ×1,5; 4K ×2; 0.5K ×0,75; +$0,015 web search; +$0,002 high thinking) | Hasta **14 imágenes de referencia**, 1–4 variaciones/request, consistencia de hasta 5 personas, texto preciso. Ideal para *product shots* con el producto real de referencia. |
| **Nano Banana Pro** (Gemini 3 Pro Image) | `fal-ai/nano-banana-pro` (+`/edit`; alias preview `fal-ai/gemini-3-pro-image-preview`) | **$0,15/imagen** (1K/2K), $0,30 (4K); edit $0,15 | Máxima calidad; infografías/texto en imagen. |
| **Seedream 4.5 (ByteDance)** | `fal-ai/bytedance/seedream/v4.5/text-to-image` y `/edit` | **$0,04/imagen** (hasta 4 MP) | T2I + edición unificadas; hasta **10 imágenes de referencia por edit** ("replace the product in Figure 1 with that in Figure 2"). Existe **Seedream 5.0 Lite** (`.../v5/lite/text-to-image`) con web search y reasoning. |
| **FLUX.2** | `fal-ai/flux-2` (dev), `fal-ai/flux-2-pro`, `fal-ai/flux-2-flex`, max; `fal-ai/flux-2-trainer` (LoRA) | dev **$0,012/MP**; pro **$0,03/MP** (1920×1080 ≈ $0,045); flex $0,05–0,06/MP; max $0,07/MP | Fotorrealismo top; flex = mejor tipografía y hasta 10 refs (14 MP input). **LoRA trainer** para estilo de marca/avatar consistente. |
| **FLUX.1** (legacy) | `fal-ai/flux/dev` ($0,025/MP), `fal-ai/flux-pro/v1.1` ($0,04/MP), `v1.1-ultra` ($0,06/img), FLUX Kontext (edición) | — | Sigue disponible; Kontext útil para ediciones dirigidas **[verificar pricing Kontext]**. |
| **GPT Image 2 (OpenAI)** | ver landing | **$0,01/img** (low 1024×768) a **$0,41/img** (high 4K) | Fotografía de producto brand-consistent, texto pixel-perfect. |
| **Grok Imagine Image (xAI)** | `xai/grok-imagine-image` (+`/edit`) | **$0,02/img**; edit $0,022 | Barato para exploración de ángulos. |
| **Ideogram v3** | `fal-ai/ideogram/v3` | $0,03–0,09/img | El mejor en texto/rótulos para thumbnails y overlays estáticos. |

Fuentes: https://fal.ai/models/fal-ai/nano-banana · https://fal.ai/models/fal-ai/nano-banana-2 · https://fal.ai/models/fal-ai/nano-banana-pro · https://fal.ai/nano-banana-pro · https://fal.ai/models/fal-ai/gemini-3-pro-image-preview · https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/text-to-image · https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/edit · https://fal.ai/models/fal-ai/bytedance/seedream/v5/lite/text-to-image · https://fal.ai/flux-2 · https://fal.ai/models/fal-ai/flux-2-pro · https://fal.ai/models/fal-ai/flux-2-flex · https://fal.ai/gpt-image-2 · https://fal.ai/grok-imagine

**Patrón clave "URL de producto → product shot → vídeo":** descargar las fotos del producto de la URL → `seedream/v4.5/edit` o `nano-banana-2/edit` con las fotos como referencia para generar el producto en manos de un "creator" en escenario UGC (baño, coche, escritorio) en 9:16 → usar esa imagen como primer frame en un *image-to-video* (Kling v3 i2v, Seedance 2.0 i2v, Grok Imagine i2v) o como referencia en *reference-to-video*. Así el producto mostrado es fiel al real.

**Utilidades adicionales:** upscale de vídeo `fal-ai/topaz/upscale/video` ($0,1/s **[verificar]**), quitar fondos (`fal-ai/ben/v2/image`, Bria/BiRefNet), y acceso a LLMs vía `openrouter/router` en fal (https://fal.ai/models/openrouter/router/api) por si se quiere unificar también la capa de análisis/guion bajo la misma API key **[evaluar coste vs API directa]**.

---

## 5. La API de fal: clientes, queue, webhooks, storage, auth y límites

Docs raíz: https://docs.fal.ai/ (redirige a https://fal.ai/docs/...)

### 5.1 Autenticación

- API key desde el dashboard, formato `key_id:key_secret`, expuesta como env var **`FAL_KEY`**.
- Header REST: `Authorization: Key $FAL_KEY`.
- **Nunca en el navegador**: usar proxy server-side (paquete `@fal-ai/server-proxy` con adaptadores para Next.js/Express) o generar las llamadas desde el backend.

### 5.2 Clientes oficiales

- **JavaScript/TypeScript**: `npm install @fal-ai/client` (repo: https://github.com/fal-ai/fal-js)
- **Python**: `pip install fal-client` (https://pypi.org/project/fal-client/)

```ts
import { fal } from "@fal-ai/client";

// Sencillo: subscribe = submit a la queue + polling automático
const result = await fal.subscribe("bytedance/seedance-2.0/text-to-video", {
  input: {
    prompt: "Selfie video, young woman in her car, excited, talking to camera about...",
    aspect_ratio: "9:16",
    resolution: "720p",
    duration: "12",
    generate_audio: true,
  },
  logs: true,
  onQueueUpdate: (u) => { if (u.status === "IN_PROGRESS") console.log(u.logs); },
});
console.log(result.data.video.url);
```

### 5.3 Queue API (asíncrona) — la base para un pipeline de anuncios

Base URL: **`https://queue.fal.run`** (la síncrona es `https://fal.run/{model_id}`, no recomendada para vídeo). Docs: https://fal.ai/docs/model-apis/model-endpoints/queue

- **Submit**: `POST https://queue.fal.run/{model_id}` → `{ request_id, queue_position }`.
- **Estados**: `IN_QUEUE` → `IN_PROGRESS` → `COMPLETED`.
- **Status**: `GET .../requests/{request_id}/status` (con `logs=1` opcional); el cliente expone `fal.queue.status(...)` / `handler.status(with_logs=True)`.
- **Streaming de estado**: `handler.iter_events()` (Python) / iteración async (JS).
- **Resultado**: `fal.queue.result(model, { requestId })` / `handler.get()`.
- **Cancelación**: `fal.queue.cancel(...)` / `handler.cancel()` (PUT `.../cancel`).
- **Prioridad**: `priority: "normal" | "low"` en submit (para apps propias).

```python
import fal_client

handler = fal_client.submit(
    "fal-ai/kling-video/ai-avatar/v2/standard",
    arguments={"image_url": avatar_url, "audio_url": voiceover_url},
    webhook_url="https://api.miapp.com/webhooks/fal",
)
# devuelve request_id inmediatamente; el resultado llega por webhook
```

### 5.4 Webhooks (recomendado frente a polling)

Docs: https://fal.ai/docs/model-apis/model-endpoints/webhooks

- Se pasa `webhook_url` (Python) / `webhookUrl` (JS) en el submit; fal hace POST al completar.
- **Payload OK**: `{ "request_id": "...", "gateway_request_id": "...", "status": "OK", "payload": { ...output del modelo... } }`. En error: `"status": "ERROR"` + campo `error`; si el output no serializa: `payload: null` + `payload_error`.
- **Retries**: timeout inicial de 15 s; si falla, **10 reintentos a lo largo de 2 horas** → el handler debe ser **idempotente** (clave: `request_id`).
- **Verificación de firma** (imprescindible en producción): headers `X-Fal-Webhook-Request-Id`, `X-Fal-Webhook-User-Id`, `X-Fal-Webhook-Timestamp`, `X-Fal-Webhook-Signature`; mensaje = `request_id\nuser_id\ntimestamp\nsha256(body)`; firma **ED25519** verificada contra JWKS público: `https://rest.fal.ai/.well-known/jwks.json` (cachear ≤24 h; tolerancia ±5 min en timestamp contra replay).

### 5.5 Storage / ficheros

Docs: https://docs.fal.ai/reference/client-libraries/javascript/storage

- **JS**: `const url = await fal.storage.upload(file)` → URL en el CDN **fal.media**; si pasas un `File`/binario como input, el cliente hace **auto-upload**.
- **Python**: `fal_client.upload_file("path/to/audio.wav")` → URL pública para pasar a cualquier endpoint.
- Todos los endpoints aceptan URLs públicas (también data URIs) — el patrón natural es: assets del producto en tu bucket/S3 → pasar URLs firmadas o subir a fal.media.
- Los outputs (mp4, png, mp3) se devuelven como URLs en fal.media; **descargar y persistir en storage propio** (no hay SLA documentado de retención **[verificar retención exacta]**).

### 5.6 Composición y post-proceso dentro de fal

- **`fal-ai/ffmpeg-api/compose`**: componer vídeo final desde múltiples pistas/fuentes (timeline JSON) — https://fal.ai/models/fal-ai/ffmpeg-api/compose (~$0,0002/s de cómputo, coste marginal).
- **`fal-ai/ffmpeg-api/merge-videos`**, **`/merge-audio-video`**, **`/merge-audios`**: concatenar clips de escena, pegar voiceover/música al vídeo. https://fal.ai/models/fal-ai/ffmpeg-api/merge-audio-video
- Esto permite ensamblar Hook (avatar) + Body (b-roll) + CTA (product shot animado) + voz + música **sin infraestructura FFmpeg propia** (aunque para subtítulos estilo TikTok probablemente haga falta render propio con Remotion/FFmpeg **[gap: los endpoints ffmpeg de fal no documentan subtítulos]**).

### 5.7 Límites, fiabilidad y billing

- **Concurrencia**: por defecto ~**10 requests concurrentes por usuario** entre todos los endpoints (ampliable vía soporte/enterprise) **[fuente terciaria, verificar con fal]**; guías de terceros citan ~60 req/min en tier Pro.
- **429**: respetar `Retry-After`; fal reintenta internamente con backoff hasta 10 veces en picos temporales (doc "Reliability": https://fal.ai/docs/documentation/model-apis/inference/reliability).
- **Ojo operacional**: hay un issue conocido donde revocar una API key no libera slots `IN_PROGRESS` (https://github.com/fal-ai/fal/issues/939) — rotar keys con cuidado.
- **Billing**: pay-per-use puro, sin mínimos ni suscripción ("you only pay for the computing power you consume"); vídeo por segundo de output, imagen por unidad o megapíxel, TTS por 1.000 caracteres; enterprise con contrato (https://fal.ai/pricing y https://fal.ai/docs/documentation/model-apis/pricing). También alquilan GPU (H100 desde ~$1,89/h) para modelos propios.
- Referencia histórica útil: gist comunitario con dump de precios de 227 endpoints (snapshot ~mediados 2025, **desactualizado** — p. ej. solo llega a Veo 2): https://gist.github.com/azer/6e8ffa228cb5d6f5807cd4d895b191a4

---

## 6. Estimación de coste de un anuncio UGC de 15–30 s

Supuestos: guion de ~75–80 palabras ≈ **500 caracteres** para 30 s de locución; anuncio 9:16 720p; los costes de LLM para análisis/guion no se incluyen (son ~$0,01–0,05/anuncio con cualquier LLM frontier, despreciables frente al vídeo).

### 6.1 Coste por componente (30 s)

| Componente | Opción económica | Opción estándar | Opción premium |
|---|---|---|---|
| Voiceover (500 chars) | Kokoro: **$0,01** | ElevenLabs Turbo v2.5: **$0,025** | Eleven v3 / MiniMax HD: **$0,05** |
| Imagen avatar (1) | Grok Imagine: $0,02 | Nano Banana: $0,039 | Nano Banana Pro: $0,15 |
| Product shots (3 edits con referencia) | Seedream 4.5: $0,12 | Nano Banana 2: $0,24 | Nano Banana Pro: $0,45 |
| Avatar parlante 30 s | VEED Avatars (librería): **$0,175** | Kling Avatar v2 Std: **$1,69** / Fabric 480p: $2,40 | OmniHuman v1.5: $4,20 / Kling Avatar v2 Pro: $3,45 |
| B-roll 30 s con audio nativo | Grok Imagine 720p: **$2,10** / Wan 2.6 Flash: $1,50 | Kling v3 Std (audio): **$3,78** / HappyHorse 720p: $4,20 / Veo 3.1 Fast: $4,50 | Seedance 2.0 Std: $9,10 / Veo 3.1 Std: $12 / Sora 2 Pro: $9–21 |
| Lipsync 30 s (si aplica) | LatentSync: $0,20 | sync-2: $1,50 | sync-2-pro: $2,50 |
| Música/SFX | mmaudio-v2: $0,03 | ace-step: $0,15 | ElevenLabs SFX: ~$0,06 + librería |
| Ensamblaje ffmpeg-api | ~$0,01 | ~$0,01 | ~$0,01 |

### 6.2 Escenarios completos (30 s, una variante)

| # | Receta | Desglose | **Total aprox.** |
|---|---|---|---|
| A | **Ultra-low-cost faceless/testing masivo**: Kokoro + Grok Imagine t2v 480p (3×10 s) + 3 product shots Seedream | 0,01 + 1,50 + 0,12 + 0,01 | **~$1,65** |
| A' | **Mínimo absoluto con avatar**: VEED Avatars (voz incluida) + 2 product shots | 0,175 + 0,08 | **~$0,26** |
| B | **Avatar UGC estándar** (hook avatar 12 s + b-roll 18 s): ElevenLabs Turbo + imagen avatar Nano Banana + Kling Avatar v2 Std (12 s = $0,67) + Wan 2.6 Flash b-roll (18 s = $0,90) + product shots + compose | 0,025 + 0,039 + 0,67 + 0,90 + 0,12 + 0,01 | **~$1,80** |
| C | **Full avatar 30 s** (todo talking head): Eleven v3 + Fabric 480p 30 s | 0,05 + 2,40 | **~$2,50** |
| D | **Una sola pasada con voz nativa**: Kling v3 Standard con audio + voice control, 2×15 s multi-shot | 30 s × $0,154 | **~$4,62** |
| E | **Premium cinemático**: Veo 3.1 Standard con audio (4×8 s) + keyframes Nano Banana Pro | 32 s × 0,40 + 0,45 | **~$13,25** |
| F | **Máximo absoluto**: Sora 2 Pro true 1080p 30 s | 30 × 0,70 | **~$21,00** |

**Regla rápida para el modelo de negocio:** una variante UGC razonable cuesta **$1,5–5**; un batch de test de 10 hooks ≈ **$15–50**; 100 variantes/mes ≈ **$150–500** de COGS en fal. A 15 s (en vez de 30) todos los escenarios se reducen aproximadamente a la mitad. Margen típico de las plataformas SaaS del sector (Arcads ~$110/10 vídeos) frente a estos COGS: 5–20×.

---

## 7. Discrepancias detectadas respecto a `UGC_deep_research.md`

Verificación de los recursos que el documento base cita y que tocan el ámbito fal/modelos:

1. **"Seedance 2.0"** — EXISTE y está en fal desde abril 2026 (`bytedance/seedance-2.0/*`). Matiz: **máximo 720p y 4–15 s**; el documento no menciona límites de resolución. (https://fal.ai/seedance-2.0)
2. **"Veo 3.1"** — EXISTE en fal (`fal-ai/veo3.1`, tiers fast/lite, hasta 4K, 9:16 nativo). Correcto.
3. **"Sora 2"** — EXISTE en fal (`fal-ai/sora-2/*`), **pero** el documento omite dos riesgos: aviso vigente de latencia/timeouts del proveedor upstream en la propia page de fal, y reportes de terceros de **sunset de la API el 24-09-2026** (https://costgoat.com/pricing/sora). No apoyar el producto en Sora 2.
4. **"Grok Video"** — el nombre correcto del producto es **Grok Imagine** (xAI); en fal son los endpoints `xai/grok-imagine-video/*` (Video 1.5 desde 31-05-2026, líder del arena I2V). El documento usa un nombre informal. (https://fal.ai/grok-imagine)
5. **"Happy Horse 1"** — EXISTE (sorprendentemente): **HappyHorse-1.0 de Alibaba ATH**, lanzado 27-04-2026, con fal como API partner oficial (`alibaba/happy-horse/*`). Nombre casi correcto. (https://fal.ai/happyhorse-1.0)
6. **"Nano Banana Pro"** y **"GPT Image 2"** — ambos EXISTEN y están en fal (`fal-ai/nano-banana-pro`, GPT Image 2 desde abril 2026). Correcto.
7. **Omisión relevante del documento base**: menciona MUAPI como capa de API del template Open-AI-UGC y no menciona **fal.ai en absoluto**, cuando fal cubre hoy el 100% del stack de generación (vídeo+avatar+voz+imagen+compose) con un solo proveedor, una sola key y un solo modelo de billing — exactamente el rol que el PRD necesita.
8. El documento atribuye el stack "Seedance 2.0, Veo 3.1, Sora 2" como estándar 2026 — confirmado, pero a fecha de hoy habría que añadir **Kling 3.0/O3** (con voice control en español), **HappyHorse-1.0** y **Grok Imagine Video 1.5** como top del arena, todos disponibles en fal.

---

## 8. Implicaciones para el PRD

### Arquitectura
1. **fal puede ser el único proveedor de generación** (vídeo, avatar, voz, imagen, música, compose) → una sola API key, un solo webhook handler, un solo sistema de costes. Diseñar no obstante una **capa de abstracción de modelos** (registry con `endpoint_id`, coste/s, capacidades, aspect ratios) porque el catálogo rota cada 4–8 semanas (Veo 3→3.1, Seedance 1→2, Kling v2→v3/O3, Pixverse v5.5→v5.6 en menos de un año).
2. **Pipeline asíncrono obligatorio**: Queue API + `webhook_url` + verificación ED25519 (JWKS `https://rest.fal.ai/.well-known/jwks.json`) + handlers idempotentes por `request_id`. Un anuncio = DAG de 5–10 jobs fal (imagen → i2v ×N escenas → TTS → avatar/lipsync → compose); modelar como state machine con persistencia de `request_id` por paso.
3. **Concurrencia por defecto ~10 requests simultáneas**: instrumentar una cola interna propia con rate limiting y solicitar aumento enterprise antes del lanzamiento; manejar 429 + `Retry-After`.
4. **Persistir outputs inmediatamente** en storage propio (URLs de fal.media sin retención garantizada documentada).

### Selección de modelos (decisión de producto por tier)
5. Ofrecer 2–3 **tiers de calidad** mapeados a recetas concretas: *Test* (~$0,3–1,7: VEED Avatars/Grok Imagine/Kokoro), *Standard* (~$2–5: Kling Avatar v2 + Wan 2.6/Kling v3 + ElevenLabs), *Premium* (~$9–13: Veo 3.1/Seedance 2.0 + OmniHuman + Eleven v3). El COGS por variante ($1,5–5 en el sweet spot) soporta pricing por créditos con margen 5–20×.
6. **9:16 nativo confirmado** en: Veo 3.1, Seedance 2.0, Sora 2, Grok Imagine, (Kling v3, Wan 2.6, HappyHorse y Pixverse con enum por confirmar en schema). **Evitar LTX-2** (solo 16:9) pese a su precio.
7. Para **fidelidad de producto**: usar edición con referencias (Seedream 4.5 edit / Nano Banana 2 edit, 10–14 imágenes de referencia) + endpoints *reference-to-video* (Seedance 2.0 R2V, Veo 3.1 R2V, Wan 2.6 R2V, Kling O3). Este es el diferenciador técnico clave del producto "URL → anuncio".
8. Los modelos con **voz nativa + voice control** (Kling 3.0 en español; HappyHorse lipsync 7 idiomas) permiten un pipeline de una sola pasada que compite en coste con TTS+avatar; mantener ambas rutas y decidir por A/B de calidad.
9. **No depender de Sora 2** (riesgo de sunset septiembre 2026 + inestabilidad upstream ya visible en fal).

### Riesgos y deuda de verificación
10. Precios verificados hoy pero volátiles (fal ha repricing frecuente); construir la tabla de costes como **config data, no hardcode**, e idealmente recalcular contra las model pages/`llms.txt` de fal (cada model page expone `/llms.txt` y `/api` machine-readable).
11. Quedan por confirmar contra el API schema: enums exactos de `aspect_ratio` en Kling v3/Wan 2.6/HappyHorse/Pixverse v5.6, sobrecoste de audio en Pixverse v5.6, precios vigentes de los ítems marcados **[verificar]** (snapshot 2025: LatentSync, Kling LipSync, ace-step, mmaudio, Topaz, sync 1.9, voice-clone MiniMax).
12. **Subtítulos estilo TikTok** (word-by-word, karaoke) no están cubiertos por los endpoints ffmpeg de fal → planificar render propio (Remotion/FFmpeg + ASR con `fal-ai/elevenlabs/speech-to-text` a $0,03/min o Whisper) como componente fuera de fal.
