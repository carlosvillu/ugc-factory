# T5.26 — Shortlist de voces `es` de origen español para Maya (juicio humano)

Generado por el bucle dev-loop el 2026-07-30 como orientación para la decisión de producto
(qué voz reemplaza a Sarah, origen inglés, en `Maya.voice_map.es`). Coste real fal **$0,09**.

Cada candidata = 1 voiceover N7b real vía el camino de producción `runGenerateAudio`
(endpoint `fal-ai/elevenlabs/tts/eleven-v3`, `language_code=es`), misma narración española con
fonemas discriminantes (s/z, r vibrante). Las 3 aceptadas por fal (cero 422), `reused=false`.

| # | Nombre | voiceId | Origen | Asset | Veredicto usuario |
|---|---|---|---|---|---|
| 1 | Aitana | `AxFLn9byyiDbMn5fmyqu` | España, cálida/expresiva | `01KYST11TPSG5R29336DPMCJXW` | — |
| 2 | **Afrodita** | `6Pd8chnUWvPJasJAi15C` | España peninsular, narrativa | `01KYST1EHKE81FR8KTCY5KFVNT` | **ELEGIDA** (2026-07-30) |
| 3 | Carolina | `UOIqAnmS11Reiei1Ytkc` | España es_ES | `01KYST1TEBWEQECNGXMF790GVM` | — |

Referencia de comparación: `docs/verifications/T5.9/rescoped-2026-07-30/voices/maya-es.mp3` (Sarah, origen inglés — la que se sustituye).

Los MP3 se enviaron al usuario para el A/B; NO se commitean al repo público (peso; el juicio ya está emitido).
