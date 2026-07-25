# T5.9 Fase A — Modelo de coste verificado contra `model_profile` (BD dev, $0 fal)

Fecha: 2026-07-24. Fuente: `docker exec ugc-postgres-dev psql -U ugc -d ugc`.

## Precios confirmados en `model_profile`
| endpoint | kind | coste | durations enum |
|---|---|---|---|
| fal-ai/veo3.1/image-to-video | i2v | **20¢/s** | [4,6,8] |
| fal-ai/bytedance/omnihuman/v1.5 | avatar | **16¢/s** | (deriva del audio) |
| fal-ai/flux-2 | image | **1.2¢/megapixel** | — |
| fal-ai/elevenlabs/tts/eleven-v3 | tts | **10¢/1k chars** | — |
| fal-ai/ace-step | music | **0.02¢/s** | — |

## Endpoints REALES del recipe `premium` (los que se generarán)
- avatar (N7c, hook)  → `fal-ai/bytedance/omnihuman/v1.5` = **16¢/s** (deriva de la duración del audio de voz; NO deduplica: audio idioma-específico)
- broll (N7d, body)   → `fal-ai/veo3.1/image-to-video` = **20¢/s**, enum [4,6,8]
- cta (N7f, reusa broll endpoint) → `fal-ai/veo3.1/image-to-video` = **20¢/s**, enum [4,6,8]
- voice (N7b)         → `fal-ai/elevenlabs/tts/eleven-v3` = **10¢/1k chars**  (⚠ el brief decía 5¢/turbo-v2.5; el recipe premium usa eleven-v3 a 10¢. Sigue siendo calderilla)
- keyframes (N7a)     → **HARDCODEA flux-2** (1.2¢/MP), NO el `nano-banana-pro` del campo `shots` del recipe (asimetría deliberada, `generation.ts`)
- music (N7e)         → `fal-ai/ace-step` = 0.02¢/s (1 bed por variante, calderilla)

## Estimación propia del recipe premium (campo `est_cost_30s_*`)
`est_cost_30s_min_cents=900`, `est_cost_30s_max_cents=1300` → **$9–13 POR VARIANTE de 30s** (sin dedup, ad completo).
⇒ 12 variantes naive = **$108–156**. La feasibility <$15 depende ENTERAMENTE del dedup + de que las escenas sean cortas.

## Dedup (derivado del código, NO observable en CP3)
- **content_hash del b-roll/CTA** = `{resolvedPrompt=DEFAULT_BROLL_PROMPT (idioma-neutral, el executor N7d/N7f NO pasa prompt), modelProfileId, image_url=keyframe fal_url, duration:"Ns", aspect, resolution, __dedup_salt}`.
  - N7d salt = `"bodySceneIndex:clipIndex"`; N7f salt = `"cta:ctaSceneIndex:clipIndex"` (disjuntos).
  - NO incluye variantId ni language ni texto del guion.
- **Keyframe N7a** = `{route:'ai_packshot', briefId: batch.briefId}` → briefId es POR LOTE, seed=índice-de-shot, SIN variantId ⇒ **1 set de keyframes byte-idéntico compartido por las 12 variantes** (mismo `image_url`). ESTA es la asunción load-bearing del dedup cross-variante y cross-idioma.
- ⇒ Un b-roll de body con (mismo keyframe, misma duración cuantizada, mismo salt) COLAPSA a 1 asset a través de variantes E idiomas. Solo se multiplica por: nº de buckets de duración distintos × nº de clips (troceo) × nº de sceneIndex distintos.
- **Avatar (N7c)**: NO deduplica (consume el audio de N7b, idioma-específico) ⇒ **12 avatares siempre**. Duración = la del audio TTS del hook. ES EL TÉRMINO QUE DOMINA EL COSTE.

## Término dominante (avatar)
12 × (segundos de hook) × 16¢. A ~5s/hook ≈ $9.60 (dos tercios del budget). A ~3s ≈ $5.76.
⇒ La feasibility la deciden: (1) duración media del hook, (2) nº de clips i2v únicos de body tras dedup.
