# 00 — Dossier consolidado: plataforma "URL de producto → anuncios UGC 9:16"

> Síntesis de los informes 01–08 y de `UGC_deep_research.md`. Fecha: 2026-07-06.
> Documento opinionado: donde había opciones, aquí hay una recomendación y su justificación. Las alternativas descartadas se citan solo cuando el descarte es una decisión relevante.

---

## 1. Síntesis ejecutiva del estado del arte

**El mercado ha validado la categoría pero nadie ha construido el producto completo.** En julio de 2026 conviven:

- **Plataformas comerciales** (Arcads $110/mes, MakeUGC $59, Tagshop $29, HeyGen $29, CreateUGC ~$27, Loova $15): todas hacen avatar+voz+render, pero **ninguna une los tres pasos** de nuestra tesis. Tagshop y CreateUGC parten de URL con análisis superficial (título+precio+imágenes); Arcads tiene la matriz de variantes (hooks×actores×CTAs) pero es script-first; HeyGen tiene calidad de avatar pero "energía corporativa" (C+ en contenido tipo TikTok). Los dos líderes tienen ~3/5 en Trustpilot por billing agresivo y calidad inferior a las demos: **la vara real es más baja que su marketing**.
- **OSS**: fragmentario y mucho menor de lo que aparenta. Open-AI-UGC (162★) es un wrapper de UI sobre MUAPI sin ningún LLM, guion ni análisis; los pipelines n8n son prototipos frágiles pero contienen los mejores prompts públicos de análisis/guion; Prizmad publica solo su superficie MCP (el motor es cerrado); ~la mitad del topic `ugc-ads` son escaparates vacíos. **Lo reutilizable son patrones, no código**: webhook+polling fallback, `request_id` único, definición declarativa de modelos, esqueleto INGEST→ANALYZE→SCRIPT→PROMPT→RENDER→COMPOSE→DELIVER.
- **fal.ai cubre hoy el 100% del stack de generación** (vídeo 9:16 con audio nativo, avatares parlantes, lipsync, TTS multilingüe, imagen con referencias, incluso FFmpeg gestionado) con una sola key, Queue API asíncrona con webhooks firmados y pay-per-use. Coste de un anuncio de 30 s: de $0,26 (VEED Avatars) a $21 (Sora 2 Pro); **sweet spot $1,5–5/variante**. Excepción crítica: su capa LLM está deprecated → el análisis va directo a Anthropic/Google.
- **Librerías de prompts**: la anatomía del prompt UGC ganador está estandarizada (casting + beats temporizados + cámara con reglas + imperfecciones deliberadas + fidelity guards + compliance). Existen datasets de miles de prompts (YouMind 4.488 para Seedance, renoise-ai 3.217) pero **nadie tipa variables ni las conecta a datos de producto** — ahí está nuestro diferencial.
- **Distribución/compliance**: TikTok y Meta ya exigen disclosure de AIGC en ads (toggle + detección automática con rechazo); la FTC prohíbe testimonios IA que simulen clientes reales; el EU AI Act Art. 50 obliga a marcado machine-readable desde el **2 de agosto de 2026**. TikTok regala Symphony (avatares+Seedance dentro de Ads Manager): generar "un vídeo con avatar" ya es commodity first-party.

**Hueco competitivo verificado**: *URL → análisis estratégico multifaceta (beneficios, audiencia con niveles de consciencia, objeciones con contraargumento, ángulos) → matriz de anuncios UGC 9:16 multi-plataforma con compliance integrado*. Nadie genera guiones desde objeciones; nadie ofrece trazabilidad extraído-vs-inferido; nadie integra galería facetada + variables tipadas + generación multi-modelo + linaje creativo. **La integración es el producto.**

---

## 2. Arquitectura de referencia recomendada

Decisión global: **monolito modular TypeScript** (no microservicios, no n8n como motor) con un worker de render separado. El core del pipeline son ~4 llamadas LLM + N llamadas fal (demostrado por gossip-pipeline); la complejidad está en el estado, no en el cómputo.

```
┌────────────┐   ┌──────────────────────────────┐   ┌─────────────────────┐
│  Cliente    │──▶│  API + Orquestador (Next.js) │──▶│  fal.ai (Queue API) │
│  Next.js    │   │  · Inngest: pipeline DAG      │◀──│  webhooks ED25519   │
│  App Router │◀──│  · webhooks fal/Stripe        │   └─────────────────────┘
└────────────┘   │  · LLM: Anthropic directo      │   ┌─────────────────────┐
                 └───────┬──────────────┬─────────┘──▶│  Firecrawl /scrape  │
                         ▼              ▼             └─────────────────────┘
                 ┌────────────┐  ┌─────────────────┐
                 │ Postgres    │  │ Worker FFmpeg    │
                 │ (Neon/Supa) │  │ (Docker: ffmpeg  │
                 │ + R2/S3     │  │ +libass+fuentes) │
                 └────────────┘  └─────────────────┘
```

### 2.1 Cliente
- **Next.js (App Router) + TypeScript + Tailwind**. Wizard de 3–4 pasos (URL → brief editable → ángulos/guiones → render), no más de ~5 decisiones antes del primer vídeo (patrón validado por todos los competidores con tracción).
- UX table stakes: coste visible antes de generar, preview gratis de voz/avatar, spinner→vídeo con polling de 3 s contra nuestra API (la API key de fal jamás toca el navegador), galería con estado por tarjeta, brief editable campo a campo con marcas "extraído" vs "inferido".
- Overlay de safe zones conmutable (TikTok / Meta / Universal ~875×978 px sobre 1080×1920).

### 2.2 Servidor y sistema de jobs asíncronos
- **Inngest (o equivalente durable-execution sobre Postgres) como orquestador**: un anuncio es un DAG de 5–10 jobs (brief → guion → imágenes → TTS → avatar/b-roll → compose) con estados explícitos (enum, no strings libres), timeouts, reintentos y compensación de créditos. Descarto submit-síncrono-sin-cola (limitación central de Open-AI-UGC) y n8n en producción (estado implícito, bugs de endpoints hardcodeados).
- **Patrón fal**: submit a `queue.fal.run` con `webhook_url` + verificación de firma ED25519 (JWKS de `rest.fal.ai`) + **polling lazy en el read-path como fallback** (el mejor hallazgo arquitectónico del OSS: resiliente a webhooks perdidos y funciona en local). Handlers idempotentes por `request_id` (fal reintenta 10 veces en 2 h). Usar SIEMPRE `status_url`/`response_url` de la respuesta, nunca reconstruir URLs (bug real observado).
- **Cola interna con rate limiting propio**: la concurrencia por defecto de fal es ~10 requests simultáneas; gestionar 429 + `Retry-After` y pedir ampliación enterprise antes de lanzar.
- **Persistir cada output inmediatamente en R2/S3** (fal.media no documenta retención) y cada artefacto intermedio (brief, guion, prompt resuelto) en Postgres: habilita reanudación, remix ("regenera solo el guion") y auditoría.
- Créditos: **ledger de transacciones + decremento atómico** (`UPDATE ... WHERE credits >= cost`) + refund automático en fallo (fal no cobra jobs fallidos; trasladar la garantía). Stripe Checkout + webhook con firma verificada y plan validado server-side; prohibido cualquier endpoint donde el cliente dicte precio/créditos.

### 2.3 Base de datos
**Postgres** (Neon o Supabase) con Prisma/Drizzle. JSONB para el ProductBrief y las facetas de la galería; columnas desnormalizadas para parámetros de generación (modelId, aspectRatio, duration, resolution) para filtrado/analytics. Ver §3.

### 2.4 Integración fal.ai
- **fal como único proveedor de generación de media**, pero detrás de una **capa de abstracción `ModelProfile`** (endpoint, capacidades, aspect ratios, coste/s, prompt adapter): el catálogo rota cada 4–8 semanas y los precios cambian → la tabla de costes es **config data en BD, no hardcode**, recalculable contra las model pages/`llms.txt` de fal.
- **No depender de Sora 2** (aviso de inestabilidad upstream en la propia page de fal + reportes de sunset de API el 24-09-2026).
- LLM/visión **fuera de fal** (su `any-llm` está deprecated): Anthropic directo con structured outputs y prompt caching.

### 2.5 Capa de composición
Es donde se materializa la economía (3 hooks × 2 bodies × 2 CTAs = 12 anuncios pagando 7 generaciones IA) y el "look TikTok" que los modelos aún no producen de forma fiable. Escalones explícitos:
1. **MVP**: `fal-ai/ffmpeg-api/merge-videos` + `merge-audio-video` (~$0,006/vídeo de 30 s) — acepta anuncios sin subtítulos quemados solo como demo.
2. **v1 (obligatorio pronto)**: **worker propio FFmpeg nativo en Docker** (ffmpeg + libass + fuentes OFL: TikTok Sans, Poppins). Pipeline: normalización canónica cacheada por asset (1080×1920 scale-to-fill+crop, 30 fps, H.264 CRF 23 `yuv420p`, `setsar=1`, `+faststart`) → concat demuxer con `-c copy` → audio en dos capas (voz + música a 0,2–0,3 con `sidechaincompress` y `loudnorm` −14 LUFS) → **subtítulos ASS karaoke word-by-word** generados desde los word timestamps del TTS → export con C2PA. Los subtítulos quemados son requisito de producto y **fal no los cubre**.
3. **v2 opcional**: Remotion solo para caption layer premium y preview interactivo (licencia $0,01/render + $100/mes mínimo).

Descartados como núcleo: MoviePy (lento/frágil), editly/FFCreator (mantenimiento), ffmpeg.wasm (RAM/secuencial).

---

## 3. Modelo de datos preliminar

Núcleo (supera el mínimo `User/Creation` del OSS, que es insuficiente):

```
User / Organization
 └─ Project                      # 1 producto/campaña
     ├─ BrandKit                 # por DOMINIO (logo, paleta, tono) — se extrae 1 vez
     ├─ UrlAnalysis              # por URL: estado (parsed/analyzing/done/failed),
     │    └─ ProductBrief        #   JSONB conforme al schema del informe 07 §4.3:
     │                           #   product, benefits, audience(segments+awareness),
     │                           #   pain_points, objections(+counter), social_proof,
     │                           #   brand, pricing, assets(images+video_suitability),
     │                           #   angles[5-10]. Cache por url_normalizada+content_hash.
     │                           #   Campos con evidence/confidence (extraído vs inferido).
     ├─ AdScript                 # 1 por ángulo×variante: hook, scenes[]{t, narration,
     │                           #   visual, camera, emotion}, subtitles[], cta,
     │                           #   tone, versión, editable por el usuario
     ├─ Generation (job DAG)     # fal request: requestId UNIQUE, modelProfileId,
     │    └─ GenerationStep      #   resolvedPrompt (auditable), inputs por slot,
     │                           #   estado enum + retry_count + coste real, qa{}
     ├─ Asset                    # toda pieza binaria con LINAJE: kind (product_image,
     │                           #   keyframe, tts_audio+word_timestamps, avatar_clip,
     │                           #   broll_clip, final_video, thumbnail), url R2,
     │                           #   parentAssetIds[], normalized_cache_key
     └─ AdVariant                # combinación Hook×Body×CTA: compositionSpec JSON,
                                 #   filename codifica la combinación, export preset,
                                 #   metadatos de publicación (ad_caption, aigc flags),
                                 #   perf stats futuras (hook_rate, ctr)
CreditTransaction                # ledger: delta, motivo, generationId, refunds
```

Galería de prompts (entidades del informe 05 §8, resumidas):

```
PromptTemplate    # slug SEO, kind, body con slots {namespace.field}, beats[],
                  # variables tipadas (VariableSpec: tipo, required, source),
                  # assetSlots (@product/@character/@style...), guardPackIds[],
                  # 5 facetas: format[], hookAngles[], verticals[], platforms[],
                  # aesthetics[]; status/featured/license/compliance
PromptVersion     # inmutable; toda Generation referencia templateId@version
GuardPack         # negative prompts componibles: general / vertical / fidelity / platform
HookLine, CtaLine # librerías con ángulo/objetivo, interpolables
Avatar            # entidad persistente: demografía, personalidad, referenceImages ≥2K
                  # (identity lock), voiceId, owner (sistema vs cliente)
ModelProfile      # fal endpoint, capacidades, costPerSecond, promptAdapter
```

Reglas: JSON seed versionado en git + validador en CI (patrón renoise-ai); ningún template `published` sin thumbnail; el compilador de prompts inyecta siempre beats + fidelity guards + guard pack de compliance del vertical.

---

## 4. Pipeline completo URL → vídeo

| # | Paso | Herramienta/modelo recomendado | Coste aprox. |
|---|---|---|---|
| 1 | **Clasificar URL** (shopify/amazon/woo/custom) | Regex determinista | $0 |
| 2 | **Fast path estructurado** | `GET {url}.json` (Shopify) + JSON-LD/OG parser propio | $0 |
| 3 | **Render + scrape** | Firecrawl `/scrape` con `formats: [markdown, images, branding, product, screenshot]`; stealth para Amazon. Fallback barato: Jina Reader | $0,002–0,02 |
| 4 | **Análisis visual** (clasificar imágenes `hero/broll/unusable`, paleta, social proof renderizado) | Gemini 3 Flash o Claude Haiku 4.5, imágenes ≤1080p | $0,005–0,02 |
| 5 | **Síntesis del ProductBrief** (1 sola llamada, todas las facetas se retroalimentan) | **Claude Sonnet 5** con structured outputs + prompt caching + bloque anti prompt-injection (copiado de Firecrawl) | $0,07–0,10 |
| 6 | **Validación + revisión humana** | Checks deterministas (precio P1==P4, ≥1 imagen hero, hooks ≤12 palabras) + UI de brief editable. Doble entrada tipo Prizmad: si el scraping falla, campos manuales | $0 |
| 7 | **Guiones por ángulo** (N variantes) | Claude Sonnet 5, temp ~0.8: estructura Hook(0–3s)/Body/CTA con timing duro (word_count÷2.5=segundos), voz UGC anti-anuncio, disclosure automático, subtitles[] con timestamps | ~$0,02/guion |
| 8 | **Compilación de prompt de vídeo** | Selección de `PromptTemplate` de la galería (determinista por facetas) + interpolación de variables tipadas desde el brief + guard packs + adapter del `ModelProfile` | ~$0,01 |
| 9 | **Product shots / keyframes** (fidelidad de producto) | `bytedance/seedream/v4.5/edit` (default, $0,04/img) o `nano-banana-2/edit` ($0,08) con las fotos reales como referencia → producto en manos del creator en escenario UGC 9:16 | $0,12–0,24 (3 imgs) |
| 10 | **Voiceover** con word timestamps | **ElevenLabs Turbo v2.5** vía fal ($0,05/1k chars); Kokoro ($0,02/1k) en tier Test; Eleven v3 en Premium | $0,01–0,05 |
| 11 | **Avatar parlante** (segmento hook, 10–12 s) | **Kling AI Avatar v2 Standard** ($0,0562/s) con imagen de la entidad Avatar + audio TTS; VEED Avatars ($0,35/min) en tier Test; OmniHuman v1.5 en Premium | $0,17–1,70 |
| 12 | **B-roll** (15–20 s) | **Kling v3 Standard i2v con audio** o **Wan 2.6/Flash** desde los keyframes del paso 9; `reference-to-video` (Seedance 2.0 R2V) cuando el producto deba regenerarse en escena. Ruta alternativa de una pasada: Kling 3.0 con voice control en español | $0,90–3,80 |
| 13 | **Composición** | Worker FFmpeg propio: normalize-once → concat `-c copy` → amix+ducking+loudnorm → **ASS karaoke burn-in** desde los timestamps del TTS → thumbnail + manifest de linaje. (MVP: fal ffmpeg-api sin captions) | ~$0,01 |
| 14 | **Export + compliance** | Preset master 1080×1920 H.264 `yuv420p` `+faststart`, AAC 128k, −14 LUFS, ≤60 s; firma **C2PA**; JSON de metadatos de campaña (ad_caption ≤100 chars, brand_name, flags AIGC, checklist Spark/Advantage+) | $0 |
| 15 | **Entrega** | projectUrl/shareUrl/downloadUrl (nunca URL cruda de storage), galería con linaje por variante | $0 |

Tiempo objetivo comunicado al usuario: **< 5 min por vídeo** (benchmark del mercado: 2–5 min; Prizmad 3–8 min).

---

## 5. Estimación de costes por vídeo generado

**Análisis por URL: ~$0,08–0,15** (<5% del COGS → no degradar el modelo de síntesis; optimizar con caching de briefs, no con downgrade).

COGS de generación por variante de 30 s (mitad para 15 s):

| Tier | Receta | COGS |
|---|---|---|
| **Test** (hook-testing masivo) | VEED Avatars o Grok Imagine + Kokoro + Seedream shots | **$0,3–1,7** |
| **Standard** (default) | ElevenLabs Turbo + Kling Avatar v2 Std (12 s) + Wan 2.6/Kling v3 b-roll (18 s) + shots + compose | **$1,8–5** |
| **Premium** | Eleven v3 + OmniHuman/Veo 3.1 o Seedance 2.0 Std | **$9–13** |

Referencias de mercado: Prizmad ~$3–6/vídeo (venta), Arcads percibido a ~$11/vídeo (caro), Tagshop ancla <$1. **Recomendación**: cobrar por *vídeo terminado* (no créditos-por-segundo-por-modelo), banda $29–79/mes, margen 5–20× sobre COGS; batch de 10 hooks ≈ $15–50 de COGS. Regeneración parcial (solo la escena cambiada) con descuento: técnicamente casi gratis gracias al normalize-once+concat, y ataca la queja nº1 del mercado (el "re-generation tax" de Arcads).

---

## 6. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Rotación del catálogo/precios de fal** (Veo 3→3.1, Kling v2→v3 en <1 año) | Roturas y márgenes erróneos | `ModelProfile` como config data en BD; recalcular contra `llms.txt` de las model pages; abstracción provider (interfaz submit/status/webhook permite swap a Replicate/MUAPI) |
| **Sunset de Sora 2** (reportado 24-09-2026) + inestabilidad upstream | Pipeline caído | No construir dependencias sobre Sora 2; defaults en Kling/Wan/Seedance |
| **Fidelidad de producto** (el mayor riesgo de calidad de la categoría) | Anuncios con producto "alucinado" | Edición con referencias (Seedream 4.5 / NB2, 10–14 refs) + reference-to-video + fidelity guards en todo prompt + clasificación `video_suitability` con fallback a upload/packshot IA |
| **Lip-sync/voz en español degradados** (debilidad explotable de MakeUGC) | Calidad no competitiva en nuestro mercado | A/B interno de ambas rutas (TTS+avatar vs Kling 3.0 voice control ES); QA checklist antes de entregar |
| **Compliance AIGC** (toggle TikTok, detección Meta, FTC testimonials, EU AI Act 2-ago-2026) | Rechazo de ads, responsabilidad legal *también nuestra* como proveedor | C2PA en cada export desde el día 1; guardrails de guion (rol "creator-style actor", nunca "customer"; reformular testimonios como demo); `banned_or_risky_claims` en el brief; checklist de publicación por plataforma |
| **Prompt injection desde la landing analizada** | Brief corrupto/malicioso | Bloque anti-injection estilo Firecrawl en todos los prompts que consumen web; validación determinista post-parse |
| **Concurrencia fal ~10 + webhooks perdidos** | Jobs colgados | Cola interna con rate limiting; webhook+polling fallback; timeouts/expiración de jobs (carencia observada en todo el OSS) |
| **Retención de fal.media sin SLA** | Pérdida de outputs | Descargar y persistir en R2/S3 inmediatamente |
| **Moderación de caras reales** (Seedance bloquea uploads de caras) | Fricción en "founder twin" | Diseñar asumiendo Face Review; posponer clonado a fase 2 |
| **Créditos sin ledger / carreras / sin refund** (anti-patrones observados) | Fraude, soporte, churn | Ledger + decremento atómico + refund automático en fallo + preflight de coste visible |
| **TikTok Symphony gratis** (competidor first-party) | Commoditización del "vídeo con avatar" | Diferenciarse en lo que Symphony no hace: análisis multifaceta de URL, multi-plataforma, matriz de ángulos/objeciones, compliance multi-jurisdicción |
| **Trust deficit del sector** (Trustpilot ~3/5 en los líderes) | Oportunidad, no solo riesgo | Billing honesto: preview gratis, rollover parcial, refund policy clara, regeneración con descuento |
| **Licencias** (Remotion company license, música en ads, fuentes) | Coste/legal | FFmpeg+libass core (sin licencia); fuentes OFL (TikTok Sans); música propia generada (ace-step) o librería licenciada — nunca trending sounds |
| **Subtítulos no cubiertos por fal** | Sin "look TikTok" | Presupuestar el worker FFmpeg+ASS desde el principio; exigir word timestamps al TTS |

---

## 7. Preguntas abiertas para cerrar el PRD

Consolidadas y deduplicadas de los ocho informes; ordenadas por cuánto bloquean el PRD.

**Producto y alcance**
1. **¿Quién es el ICP del MVP?** ¿E-commerce DTC que compra el resultado (wizard simple) o marketer técnico/agencia que quiere la matriz y la API? Condiciona UX, pricing y si la superficie MCP/API es día-1 o fase 2.
2. **¿Qué orígenes de URL soporta v1?** Shopify + dominio propio es barato y fiable; **¿entra Amazon** (requiere stealth/proveedor específico y expectativas rebajadas)?
3. **¿Idiomas de lanzamiento?** ¿ES+EN desde el día 1? Condiciona la elección TTS (ElevenLabs vs Kling voice control ES) y el QA de lip-sync.
4. **¿La matriz de variantes (hooks×avatares×CTAs) es MVP o fase 2?** Es LA feature del media buyer y nuestro pipeline la da casi gratis, pero añade superficie de UI.
5. **¿Editor post-render en MVP?** En 2026 es table stakes, pero si las captions van bien quemadas puede posponerse. ¿Trim + estilo de caption + música es suficiente?
6. **¿Galería de prompts pública/SEO + repo OSS companion como canal de adquisición** (playbook HeyDreaming/YouMind)? Decisión de go-to-market que afecta al modelo de datos (slugs públicos, licencias).
7. **¿Publicación directa a Meta/TikTok?** Recomendación: no en MVP (OAuth caro, valor marginal); confirmar.

**Pricing y economía**
8. **¿Suscripción con créditos, packs one-off, o híbrido?** ¿Con rollover (diferenciador de confianza) o sin él (estándar del sector)? ¿Unidad de cobro = vídeo terminado (recomendado) confirmada?
9. **¿Free tier con watermark o trial de pago ($1 tipo MakeUGC)?** ¿Cuál es el presupuesto de COGS aceptable por usuario gratuito?
10. **¿Se exponen los 2–3 tiers de calidad (Test/Standard/Premium) al usuario o la plataforma elige el modelo automáticamente?**

**Técnica**
11. **¿Subtítulos quemados en el MVP** (implica construir el worker FFmpeg+ASS desde el inicio y hosting con contenedores, no solo Vercel) **o se acepta un MVP sin captions** usando fal ffmpeg-api? Recomendación: worker propio desde v1; confirmar el trade-off de tiempo.
12. **¿Restricciones de stack/hosting?** El worker FFmpeg y los webhooks exigen algo más que serverless puro (Railway/Fly/ECS para el worker). ¿Preferencias existentes (Vercel, Supabase, etc.)?
13. **¿Render por plataforma (TikTok vs Reels con safe zones/duración/caption propios) en MVP, o un único master universal** (safe zone intersección ~875×978 px)? Recomendación: master universal en MVP, variantes por plataforma en fase 2.

**Compliance y contenido**
14. **¿Postura por defecto ante el ángulo "testimonial"?** ¿Bloqueado y reformulado como demo (recomendado, FTC-safe) o permitido con disclosure visible "AI-generated presenter"? ¿C2PA obligatorio en todo export desde el día 1 (recomendado por el EU AI Act) aunque añada fricción?
15. **¿Música: generada por IA (ace-step) por defecto, librería licenciada propia (coste de licencias para paid ads), o upload del usuario?**
16. **¿"Founder twin"/clonado de avatar y voz en el roadmap?** Todos los competidores lo gatean a tiers Pro y tiene fricción de moderación de caras reales; recomendación: fase 2+, confirmar que no es requisito de lanzamiento.

**Datos y verificación pendiente**
17. **Deuda de verificación antes de fijar precios en el PRD**: enums exactos de `aspect_ratio` en Kling v3/Wan 2.6/HappyHorse, sobrecoste de audio en Pixverse v5.6, precios marcados [verificar] (LatentSync, ace-step, mmaudio, voice-clone MiniMax), y pricing real in-app de Arcads/Tagshop (fuentes contradictorias). ¿Quién y cuándo lo cierra?
18. **¿Se instrumenta el flywheel de performance (hook rate, thumbstop, CTR por variante) desde el día 1** aunque sea solo captura manual/CSV, para alimentar el scoring futuro de la galería? Es el gap de mercado señalado en todos los informes.

---

## Mapa de informes fuente

| Informe | Tema | Aportación principal a este dossier |
|---|---|---|
| 01 | Catálogo y API fal.ai | Modelos, precios, Queue API/webhooks, tiers de coste (§2.4, §4, §5) |
| 02 | Open-AI-UGC | Patrón webhook+polling, anti-patrones de créditos, Stripe (§2.2) |
| 03 | Composición FFmpeg | Worker propio, normalize-once, ASS karaoke, economía de variantes (§2.5) |
| 04 | Pipelines agentic | Esqueleto de 7 etapas, prompts de análisis/guion, superficie MCP (§4) |
| 05 | Librerías de prompts | Anatomía del prompt UGC, galería facetada, variables tipadas (§3) |
| 06 | Plataformas comerciales | Table stakes, pricing, posicionamiento, trust deficit (§1, §5) |
| 07 | Análisis de URL | Pipeline P0–P5, ProductBrief schema, costes de análisis (§4) |
| 08 | Specs TikTok/Reels | Presets de export, safe zones, compliance AIGC/FTC/EU (§4, §6) |
