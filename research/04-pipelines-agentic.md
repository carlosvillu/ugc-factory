# Pipelines agentic OSS: de URL de producto a anuncio UGC

**Tema:** análisis de código real de los pipelines OSS que van de URL/foto de producto a anuncio de vídeo UGC — Prizmad (MCP server + agent-skills), n8n-ai-ads-generator (Shopify → Sora 2 vía fal.ai) y NBGC (fotos → UGC ads vía Gemini), más dos hallazgos adicionales del topic `ugc-ads` de GitHub.

**Fecha de investigación:** 2026-07-06.
**Método:** todos los repos fueron clonados con `git clone --depth 1` y se leyó el código fuente completo (no solo READMEs). Los endpoints públicos de Prizmad (`/api/v1/templates`, `/api/v1/avatars`) se consultaron en vivo para verificar el catálogo real.

---

## 0. Resumen de verificación de recursos

| Recurso citado | ¿Existe? | Realidad verificada |
|---|---|---|
| **Prizmad MCP server** (`prizmad/Prizmad-MCP-server`) | ✅ Sí | Repo real y npm package `@prizmad/mcp-server`. **Pero** el OSS es solo un *bridge* stdio de ~810 líneas: todo el motor de generación es SaaS cerrado en `prizmad.com`. API pública verificada en vivo: 22 templates, exactamente 50 avatares. |
| **Prizmad agent-skills** (`prizmad/agent-skills`) | ✅ Sí | 5 ficheros SKILL.md + `index.json` con digests SHA-256, servidos también en `https://prizmad.com/.well-known/agent-skills/`. |
| **n8n-ai-ads-generator** (`AhsanRiaz786/n8n-ai-ads-generator`) | ✅ Sí | Workflow n8n de 45 nodos (`workflow.json`, 93 KB). Es un **bot de Telegram**, no un pipeline headless. Usa GPT-4o + **fal.ai queue API** con `fal-ai/sora-2/image-to-video`. Sin voz ElevenLabs ni avatares (están en roadmap). Contiene un bug: el status-check apunta a `fal-ai/veo3`. |
| **NBGC-Next-Gen-Content-Photos-to-UGC-Ads** (`ubachan/NBGC-...`) | ⚠️ Existe pero está **vacío** | El repo contiene únicamente un README de portfolio (un diagrama mermaid de 3 cajas y badges). **No hay workflow n8n, ni prompts, ni código.** La "demo live" (nbgc.pages.dev) no arranca. "Gemini Vision + Motion AI" es copy de marketing, no un stack inspeccionable. |
| Equivalente real a NBGC | ✅ | `Alex-safari/Hollywood-Quality-UGC-Ad-Generator`: workflow n8n completo (foto de producto → GPT-4o vision → Gemini 2.5 Pro → Sora 2 vía Kie.ai) con prompts embebidos. Analizado como sustituto. |
| Hallazgo adicional | ✅ | `stevenleon30/gossip-pipeline`: 3 agentes Claude en secuencia (researcher → writer → visual director → Seedance en Replicate). El pipeline agentic "de código puro" más limpio del topic. |

Fuentes: [GitHub topic ugc-ads](https://github.com/topics/ugc-ads) · [prizmad/Prizmad-MCP-server](https://github.com/prizmad/Prizmad-MCP-server) · [prizmad/agent-skills](https://github.com/prizmad/agent-skills) · [AhsanRiaz786/n8n-ai-ads-generator](https://github.com/AhsanRiaz786/n8n-ai-ads-generator) · [ubachan/NBGC-Next-Gen-Content-Photos-to-UGC-Ads](https://github.com/ubachan/NBGC-Next-Gen-Content-Photos-to-UGC-Ads) · [Alex-safari/Hollywood-Quality-UGC-Ad-Generator](https://github.com/Alex-safari/Hollywood-Quality-UGC-Ad-Generator) · [stevenleon30/gossip-pipeline](https://github.com/stevenleon30/gossip-pipeline)

---

## 1. Prizmad: el patrón "SaaS con superficie de agente"

### 1.1 Arquitectura real

Prizmad **no publica su pipeline**: publica tres superficies de acceso a un motor cerrado, y ahí está la lección de diseño:

```
Agente (Claude/ChatGPT/Cursor/n8n)
   │
   ├── MCP remoto:  https://prizmad.com/api/mcp   (streamable-http, OAuth 2.1 + DCR)
   ├── MCP stdio:   npm @prizmad/mcp-server        (bridge de 810 líneas → REST)
   └── REST API:    https://prizmad.com/api/v1/*   (OpenAPI + Scalar docs)
           │
           └── Motor cerrado: scraping de URL → guion → creatives → avatar →
               voz ElevenLabs → captions → música → CTA → composición → render
```

El repo OSS (`src/index.ts`, único fichero de código) registra 9 tools MCP que son *wrappers* 1:1 de los endpoints REST. El valor analizable no es el motor sino **el contrato agente↔pipeline**, que está muy bien resuelto.

### 1.2 Las 9 tools y su diseño

| Tool | Auth | Función |
|---|---|---|
| `list_templates` | No | Catálogo con features, duraciones y coste en tokens |
| `list_avatars` | No | 50 presets con `recommendedVoiceId` (ElevenLabs) |
| `recommend_template` | No | Top-3 templates desde `intent` + constraints — **selección hecha en el cliente MCP**, no en el servidor |
| `list_my_videos` | Sí | Historial ("remix my last video") |
| `upload_image` | Sí | URL o base64 → URL hosteada (re-encode WebP, 2048×2048 max) |
| `create_video` | Sí | Lanza render; devuelve `videoId` inmediatamente |
| `get_video_status` | Sí | Snapshot o `wait: true` (long-poll server-side con `notifications/progress`) |
| `get_download_url` | Sí | URL mp4 autenticada |
| `create_video_batch` | Sí | 1–20 renders en paralelo con pre-check de coste total |

Decisiones de diseño destacables extraídas del código:

**a) Discovery sin auth.** `list_templates` y `list_avatars` son públicos deliberadamente para que el agente pueda explorar el catálogo antes de autenticar.

**b) Recomendación determinista, no LLM.** `recommend_template` es un filtro + scoring de keywords implementado en TypeScript dentro del propio MCP server (filtra por `hasAvatar`/`hasVoiceover`/`targetDurationSec`/`maxTokens`, puntúa por solape de tokens del `intent` con nombre/descripción/categoría, penaliza coste):

```typescript
const score = (t: Tpl): number => {
  let s = 0;
  const haystack = `${t.name} ${t.description} ${t.category}`.toLowerCase();
  for (const tok of intentTokens) if (haystack.includes(tok)) s += 5;
  s += t.features.length;
  s -= t.cost * 0.1;
  return s;
};
```

**c) Long-poll con progreso en vez de polling del agente.** `get_video_status({wait:true})` bloquea server-side hasta 10 min, poll interno cada 5 s, y emite `notifications/progress` MCP con el paso en curso extraído de un array `steps: [{step, status}]` del estado del render. Esto elimina el problema clásico de agentes que hacen polling compulsivo y queman contexto:

```typescript
const inFlight = stepsArr.find((s) => s.status === "running");
const message = inFlight
  ? `Rendering — ${inFlight.step.replace(/_/g, " ")} (${progress}%)`
  : `Rendering — ${progress}%`;
await sendProgress(progress, message);
```

**d) Sanitización de salida para el agente.** `sanitizeStatusForAgent()` elimina las URLs crudas de storage (`videoUrl`, `thumbnailUrl` de Vercel Blob) de todo lo que ve el LLM, y sustituye por tres URLs canónicas con semántica de audiencia + un campo `hint` que le dice al agente qué hacer:

| Campo | Semántica |
|---|---|
| `projectUrl` | Dashboard del dueño (`/projects/<id>`) — link primario |
| `shareUrl` | Página pública (`/share/<token>`) — solo para terceros |
| `downloadUrl` | Stream mp4 autenticado proxificado por el dominio |

**e) Errores de negocio en lenguaje natural.** Los 402/403 (sin plan Pro, sin tokens) se convierten en frases listas para que el asistente las repita al usuario, con URL de upgrade/top-up incluida (`formatVideoCreateError`).

**f) Hints embebidos en cada respuesta.** Todas las respuestas de tool llevan un campo `hint` que guía el siguiente paso del agente ("Pass the chosen templateId to create_video", "Wait 60 seconds before calling get_video_status again"). El prompting del flujo vive en el servidor, no en el system prompt del cliente.

### 1.3 El esquema de `create_video`: la superficie de personalización acotada

El parámetro clave: **`productUrl` (a scrapear) O producto explícito** (`productTitle`/`productDescription`/`productPrice`/`productImages`). Después, presets enumerados + hints de texto libre:

| Parámetro | Valores |
|---|---|
| `tone` | `energetic · professional · friendly · luxury · funny` |
| `captionStyle` (8) | `classic · bold-impact · karaoke · pop · bounce · neon · typewriter · glow` |
| `musicStyle` (9) | `energetic · friendly · professional · luxury · funny · cinematic · lo-fi · hip-hop · acoustic` |
| `ctaStyle` (3) | `classic` (pill verde "LINK BELOW") · `blurred-photo` · `dark-solid` |
| `imageStyle` (10) | `warm-golden · bright-neutral · cool-diffused · window-light · earthy-ambient · studio-clean · moody-dramatic · pastel-soft · nordic-minimal · sunset-warm` |
| `imagePromptHint` / `videoPromptHint` / `musicPromptHint` | Texto libre ≤ 400 chars, **en capa sobre** el preset |
| `script` | Guion custom opcional; si se omite, lo genera la IA |
| `avatarPresetId` + `voiceId` | ElevenLabs voice ID; default = voz recomendada del avatar |
| `duration` | 10–60 s · `language`: en, es, fr, de, ru… (15 idiomas con lip-sync) |

El patrón "**preset enumerado + hint de texto libre opcional, y si se omite → aleatorio en render**" es la mejor resolución vista del dilema control-vs-simplicidad para agentes.

### 1.4 Catálogo real verificado (API en vivo, julio 2026)

`GET https://prizmad.com/api/v1/templates` → **22 templates en 3 categorías**, con coste en tokens y flags `requires: {avatar, voice}`:

- **`product-showcase`** (6, coste 4–5, 15–25 s): slideshows con música ± voiceover, sin avatar (`showcase-dynamic`, `showcase-narrated`, `showcase-price`…). Features: `Music, Voiceover, Creatives, Compositing`.
- **`avatar-pitch`** (8, coste 8–10, 14–32 s): avatar parlante ± fotos de producto intercaladas (`product-in-hand`, `product-on-table`, `quick-pitch`, variantes `+ Product Photo` / `+ Two Product Photos`). Features añaden `Avatar, Handheld product / Tabletop product`.
- **`hooks`** (8, coste 12, 30–60 s): plantillas de hook de reacción (`Hook Surprise/Shock/Jaw Drop/Mind Blown/Wow…`) — la categoría más cara, pensada para hook-testing.

`GET /api/v1/avatars` → 50 avatares `{id: "F01", name: "Sofia", gender, age, imageUrl, recommendedVoiceId: "cgSgspJ2msm6clMCkdW9", badge: "Top Pick"}`. Los `recommendedVoiceId` son IDs reales de ElevenLabs — confirma ElevenLabs como proveedor de voz.

La taxonomía de features (`Music`, `Voiceover`, `Avatar`, `Creatives`, `Handheld product`, `Compositing`) revela los **módulos internos del motor**: generación de imágenes de producto ("Creatives"), avatar con producto en mano, composición final.

### 1.5 Economía y gating (del SKILL.md)

- Starter $99/mes (80 tokens ≈ 16–20 ads) · Pro $249/mes (350 tokens ≈ 70–87 ads) · Agency custom. ~$3–6/vídeo.
- **La API/MCP requiere plan Pro**; la UI funciona en cualquier plan. Tokens del plan no acumulan; los top-ups sí.
- Rate limits: 10 req/min REST, 30 req/min MCP.
- Tiempo de generación: 3–8 min/vídeo.

---

## 2. Prizmad agent-skills: distribución de conocimiento para agentes

Repo: [prizmad/agent-skills](https://github.com/prizmad/agent-skills). Cinco paquetes SKILL.md (markdown + YAML frontmatter `name/description/version`) + `index.json` de discovery (schema `https://schemas.agentskills.io/discovery/0.2.0/schema.json`) con **digest SHA-256 por skill** para cacheo:

| Skill | Contenido | Cuándo lo carga el host |
|---|---|---|
| `prizmad-video-ads` | Qué es Prizmad, plataformas, pricing, hechos "para groundear" | El usuario pega una URL de producto |
| `mcp-server` | Referencia completa de las 9 tools + knobs + convención de URLs | El agente va a manejar el MCP |
| `oauth` | OAuth 2.1 Authorization Code + PKCE + DCR paso a paso (RFC 7591/8414/9728/7636/8707), client_credentials, rotación de refresh | El host implementa el handshake |
| `api-usage` | Endpoints REST, auth, reglas de plan/tokens | Uso directo de REST sin MCP |
| `markdown-negotiation` | Content negotiation `Accept: text/markdown` en toda página pública, con header `x-markdown-tokens` y `Content-Signal: ai-train=yes` | El agente quiere leer /pricing etc. sin scraping |

Ideas reutilizables:

1. **Doble publicación**: el repo GitHub es fuente de verdad, espejado a `https://prizmad.com/.well-known/agent-skills/` en cada deploy. Discovery estándar para cualquier agente.
2. **La `description` del frontmatter es la señal de carga** ("load-bearing signal"): el host lee `index.json`, decide por descripción, y solo inyecta el SKILL.md relevante (≤200 líneas cada uno). Presupuesto de contexto controlado.
3. **Stack completo de descubrimiento máquina**: server card MCP (`/.well-known/mcp/server-card.json`), OpenAPI (`/openapi.json`), API catalog RFC 9727 (`/.well-known/api-catalog`), OAuth metadata, JWKS, y **WebMCP** (tools registradas en `navigator.modelContext` cuando el usuario visita la web: `get_pricing`, `list_faq`, `create_video_ad(url)`…).
4. **"Key facts an agent should ground on"**: una sección de hechos canónicos (precios, tiempos, legalidad de AI ads en Meta/TikTok/Google) para que el agente no alucine al vender el producto. Marketing dirigido a LLMs.

---

## 3. n8n-ai-ads-generator: el pipeline URL→vídeo más completo en OSS

Repo: [AhsanRiaz786/n8n-ai-ads-generator](https://github.com/AhsanRiaz786/n8n-ai-ads-generator). Un solo `workflow.json` (45 nodos) + README. Bot de Telegram: recibe URL de Shopify + nº de anuncios (1–5) y devuelve N vídeos de 12 s, 9:16, generados con **Sora 2 vía fal.ai**. Coste declarado: GPT-4o ~$0.10–0.30 + Sora 2 (fal.ai) ~$1.50–3.00 por vídeo de 12 s → **~$2–4/anuncio**.

### 3.1 Flujo completo (reconstruido de las `connections` del JSON)

```
Telegram Trigger
  → Parse Message (reset?) → [Clear Memory] → AI Agent (GPT-4o + Simple Memory)
  → Parse Agent Response {link, no_of_ads, reply} → Send reply → ¿datos completos?
  → Process Form Data → Clean Url (quita ?variant=) → Validate Input
  ── INGESTA ──
  → Fetch Shopify Product  (GET {url}.json  ← API pública de Shopify)
     ├─ ok  → Clean Shopify Data   (GPT-4o: limpia HTML, extrae 5 key_benefits)
     └─ 404 → Fetch Full Page (HTML) → Extract from HTML (GPT-4o: scraping por LLM)
  → Parse Shopify Data (Code: normaliza, valida, FALLBACK a datos crudos si el LLM falla)
  ── ESTRATEGIA ──
  → AI Style Selector (GPT-4o, temp 0.7: product_analysis + N ad_styles)
  → Create Ad Variations (Code: producto ⨯ estilos → N items; FALLBACK a 3 estilos hardcoded)
  ── GUION ──
  → Generate Ad Script (GPT-4o, temp 0.8: N guiones de 3 escenas Hook/Action/CTA)
  → Parse Script Data (Code: 1 item por anuncio, enriquecido con datos de producto)
  ── PROMPT DE VÍDEO ──
  → [Video Generation Loop] por anuncio:
      Generate Video Prompt (Code: escenas + style guide + tono → prompt monolítico)
      → Prompt Optimizer (GPT-4o: reescritura a 120–150 palabras con timing exacto)
      → Prepare Video Generation
  ── RENDER (fal.ai queue) ──
      → POST https://queue.fal.run/fal-ai/sora-2/image-to-video
           {prompt, image_url: 1ª foto de producto, duration: 12, aspect_ratio: "9:16"}
      → Parse Video Response (request_id, retry_count: 0, max_retries: 30)
      → [Status Check Loop]: GET .../requests/{id}/status → ¿COMPLETED?
           no → Wait 30s → repetir
           sí → Get Result (response_url) → Extract Video URL
  ── ENTREGA ──
      → Download Video File (binario) → Send to Telegram
```

### 3.2 Los 5 prompts del pipeline (extraídos literalmente del JSON)

**Paso 0 — Agente conversacional de intake** (system prompt del nodo `AI Agent`): recolecta `{link, no_of_ads}` con memoria de conversación (`memoryBufferWindow` con key = `chat.id`), reglas explícitas de "no volver a pedir lo ya dado", y **salida JSON forzada** `{link, no_of_ads, reply}` con few-shot de 4 escenarios.

**Paso 1a — Scraping por LLM** (`Extract from HTML`, fallback cuando no hay `.json` de Shopify): "Extract full product data from this raw HTML content and return it in Shopify API-compatible JSON format… RETURN ONLY this exact JSON format". Normaliza cualquier tienda al **esquema Shopify** como formato pivote:

```json
{ "product": { "title", "body_html", "product_type", "vendor",
  "tags": [], "variants": [{"price"}], "images": [{"src"}],
  "key_benefits": ["…x5"], "currency": "USD" } }
```

**Paso 1b — Limpieza** (`Clean Shopify Data`): mismo esquema, limpia HTML, deduplica imágenes (mín. 3), **extrae 5 key_benefits** de la descripción.

**Paso 2 — AI Style Selector** (el prompt más valioso del repo; system: *"expert marketing strategist and creative director"*). Análisis multi-faceta del producto + generación de N estilos diferenciados para A/B testing. Incluye en el propio prompt una taxonomía por categoría de producto y por tono:

- *Category considerations*: Beauty→transformación/before-after; Tech→innovación/problem-solving; Fashion→expresión/social appeal; Health→trust/ciencia; Home→confort/rutinas; Food→sensorial; Fitness→energía/logro.
- *Tonos*: `energetic, professional, friendly, luxury, playful, authentic, dramatic` (cada uno con "good for…").
- *Camera & lighting styles*: `Dynamic, Cinematic, Natural, Studio, Lifestyle`.

Salida (JSON estricto):

```json
{
  "product_analysis": {
    "category", "target_audience", "price_positioning": "budget/mid-range/premium",
    "key_selling_points": ["…"], "recommended_emotions": ["…"]
  },
  "ad_styles": [{
    "name", "tone", "style", "approach", "focus",
    "camera_style", "lighting_style", "target_emotion", "why_effective"
  }]
}
```

Reglas finales: "exactamente N estilos, genuinamente diferentes, cada uno con un propósito estratégico distinto, apropiados para price point y audiencia". **Esto es exactamente la fase "análisis multi-faceta" del producto que queremos construir** (producto→beneficios→audiencia→ángulos), aunque le faltan objeciones.

**Paso 3 — Generate Ad Script** (system: *"expert ad copywriter specializing in 12-second viral video ads"*, temp 0.8). Estructura fija de 3 escenas con timing:

- **Scene 1 Hook (0–3 s)**: apertura visual impactante, un solo selling point, cámara con dolly-in/close-up.
- **Scene 2 Action (3–8 s)**: producto en uso/múltiples ángulos, movimiento constante.
- **Scene 3 Conclusion (8–12 s)**: hero shot + precio + CTA; **reglas duras**: "Scene 3 MUST include: 'holds steady for 2 seconds, fade begins at 11.5s'", "narration must be tight — finish by 11 seconds", "Scene 3 describes a STATIC final frame".

Salida por anuncio: `{variation_id, script_full (20–30 palabras), hook, scenes[3]{narration, visual_description, camera_work, lighting, key_action, emotion}, subtitles[4]{start,end,text}, cta, target_emotion}`. Nótese que genera `subtitles` con timestamps aunque el workflow aún no los quema en el vídeo (roadmap).

**Paso 4 — Prompt Optimizer** (el segundo prompt más valioso; system: *"expert AI video prompt optimizer… 80-100 words"*). Convierte el guion estructurado en un único prompt narrativo para Sora 2 con un procedimiento en 4 pasos dentro del prompt:

1. **Análisis de timing de narración**: `word_count ÷ 2.5 = seconds_needed`; 20–30 palabras = óptimo; 31–35 = tight (fade a 11.5 s); 36+ = overlong (⚠️ warning + cut a 12 s). Regla crítica en mayúsculas: el audio debe terminar dentro de los 12 s, no puede cortarse.
2. **Reglas de especificidad visual** con pares ❌→✅: *"dynamic movement" → "camera pushes in from 5 feet to 2 feet over 3 seconds"*; *"person enjoying" → "woman smiles, eyes close briefly, exhales contentedly"*. Exige distancias de cámara, colores con nombre exacto, acciones medibles, emociones observables.
3. **Adaptación por categoría** (tech/fashion/food/beauty/home/fitness, cada una con estilo de cámara y luz).
4. **Formato de salida**: narrativa cohesionada de 120–150 palabras con final obligatorio (posición de cámara, overlay de precio a los 10–11 s, hold, fade) + "4K photorealistic quality". Incluye 3 ejemplos completos (beauty/tech/food) — few-shot de ~200 palabras cada uno.

**Paso 5 — Ensamblado programático** (`Generate Video Prompt`, nodo Code): concatena escenas + un `styleGuide` fijo (quality/lighting/camera/aesthetic/color/consistency) + tono, y añade `negative_prompt` (no usado por Sora, definido igualmente) y `image_url = productImages[0]` — **el anclaje visual del producto se hace vía image-to-video, no por prompt**.

### 3.3 Integración fal.ai (patrón submit + poll)

```json
POST https://queue.fal.run/fal-ai/sora-2/image-to-video
Authorization: Key <FAL_KEY>          ← n8n httpHeaderAuth
{ "prompt": final_prompt, "image_url": <1ª imagen producto>,
  "duration": 12, "aspect_ratio": "9:16" }
→ { request_id, status_url, response_url }

GET https://queue.fal.run/fal-ai/veo3/requests/{request_id}/status   ⚠️ BUG
→ {status: IN_QUEUE|IN_PROGRESS|COMPLETED, response_url}

GET {response_url}  →  { data: { video: { url } } }   (parser tolera 4 formas)
```

- **Polling**: cada 30 s (`Wait 30s`), contador `retry_count` con `max_retries: 30` (= 15 min máx) transportado dentro del item.
- **⚠️ Bug/leftover documentado**: el submit va a `fal-ai/sora-2` pero el status-check está hardcodeado a `fal-ai/veo3/requests/{id}/status` — resto de una versión anterior con Veo 3. La lección: **usar siempre `status_url`/`response_url` devueltos por el submit**, nunca reconstruir la URL.
- Segundo bug menor: en `Prepare Video Generation`, la variable `optimizedPrompt` cuidadosamente saneada se descarta y `final_prompt` se asigna con acceso directo `$input.first().json.message.content`.

### 3.4 Gestión de estado entre pasos (el patrón n8n)

1. **Enriquecimiento acumulativo del item**: cada nodo Code devuelve `{...datosAnteriores, camposNuevos}`; el item JSON que viaja por el pipe es el "estado del anuncio" (producto + estilo + guion + prompt + request_id + retry_count).
2. **Referencias cruzadas a nodos previos**: `$('Parse Shopify Data').item.json` permite a cualquier nodo leer la salida de un paso anterior sin arrastrarla — n8n actúa como blackboard.
3. **Fan-out por variante**: `Parse Script Data` emite N items (uno por anuncio) y `splitInBatches` procesa cada vídeo secuencialmente (los loops `Video Generation Loop`/`Status Check Loop`/`File Upload Loop` son la forma n8n de un `for` con estado).
4. **Fallbacks defensivos en cada frontera LLM**: todo parser de salida LLM (a) tolera 3–4 formatos de respuesta, (b) extrae JSON con regex `/\{[\s\S]*\}/`, (c) limpia fences markdown, y (d) tiene **fallback determinista** (datos crudos de Shopify, 3 estilos hardcoded, guion genérico de 3 escenas). El pipeline nunca muere por un LLM caprichoso — degrada calidad.
5. **Heurística `requires_human`**: regex sobre `product_type + title` (`/apparel|clothing|jewelry|cosmetic|beauty|food|supplement|health/i`) para decidir si el anuncio necesita presencia humana — proto-decisión de "¿avatar o showcase?".

### 3.5 Lo que le falta (declarado en su roadmap)

Voiceover ElevenLabs, subtítulos quemados, memoria de marca, batch por CSV, soporte no-Shopify robusto, métricas A/B. Es decir: genera **vídeo con audio nativo de Sora 2**, sin capa de voz/captions/música propia — justo las capas que Prizmad sí compone.

---

## 4. NBGC y su sustituto real: Hollywood-Quality-UGC-Ad-Generator

### 4.1 NBGC: discrepancia confirmada

[ubachan/NBGC-Next-Gen-Content-Photos-to-UGC-Ads](https://github.com/ubachan/NBGC-Next-Gen-Content-Photos-to-UGC-Ads) contiene **un único fichero README.md** con un diagrama mermaid de 3 cajas (`Raw Photo → Gemini Vision AI → Ad Copy & Design → UGC Asset Ready`), badges de n8n/Gemini/Cloudflare y un link a una demo (`nbgc.pages.dev`) que se queda en "Initializing Application...". No hay workflow exportado, prompts, ni esquemas. Es un repo-escaparate de portfolio. **No aporta nada técnico reutilizable** más allá de confirmar el patrón conceptual foto→visión→copy.

### 4.2 Sustituto analizado: Alex-safari/Hollywood-Quality-UGC-Ad-Generator

Workflow n8n real (`47_AI Ads Sora.json`) del mismo género (foto de producto → anuncio):

```
Form (foto + aspect ratio + descripción)
  → Upload a Google Drive (webContentLink como URL pública)
  → Analyze image (GPT-4o vision) ─ análisis YAML exhaustivo SOLO del producto
  → Creative Director (Gemini 2.5 Pro vía OpenRouter, agent + structured output parser)
      ─ prompt cinematográfico "Sora 2 Timeline Prompting Structure"
  → Sub-workflow "Kie.ai Sora 2 Image to video" (executeWorkflow)
  → Download Video → Upload a Drive + registro en Baserow (tabla de vídeos generados)
```

**Prompt 1 — análisis visual estructurado (GPT-4o):** genera un YAML exhaustivo del producto **ignorando el fondo**: `identification (category/brand/model)`, `physical_structure`, `materials_and_surfaces`, `color_analysis` con **paleta HEX** (`dominant_hex`, `accent_1_hex`…), `distinctive_details (logos/text/controls)`, `condition_assessment`, `lighting_on_subject`. Objetivo declarado: *"enough detail for AI systems to recreate the product with high fidelity in any new environment"*. Es la técnica clave de **consistencia de producto** cuando el modelo de vídeo no acepta referencia de imagen fuerte.

**Prompt 2 — Creative Director (Gemini):** produce un "timeline prompt" con bloque de dirección creativa + desglose temporal:

```
Vibe: [tono] / Format: [9:16 social short…] / Genre: [lifestyle…]
[0–3s] HOOK:   CAM: … SVX: … EMOTION: …
[3–6s] CONTEXT: CAM: … SVX: … EMOTION: …
[6–9s] CLIMAX:  CAM: … VO: "línea de voz" SVX: … EMOTION: …
[9–12s] RESOLUTION: CAM: … TRANSITION: … SVX: …
```

con dos ejemplos few-shot completos (iPhone 17, Heineken). El formato `CAM/VO/SVX/EMOTION` por tramo de 3 s es una convención de prompting para Sora 2 que merece adoptarse.

**Persistencia:** cada render se registra en Baserow (fila con metadata) y los binarios en Google Drive — un "asset ledger" de tres piezas (input, prompt, output) que el workflow de Telegram no tiene.

---

## 5. Hallazgo adicional: gossip-pipeline (agentes Claude puros, sin n8n)

[stevenleon30/gossip-pipeline](https://github.com/stevenleon30/gossip-pipeline) — TypeScript, ~400 líneas, tres agentes Claude (`claude-sonnet-4-6`) en secuencia con **contratos TypeScript explícitos** entre pasos:

```
researchProduct(name, url) → ResearchOutput { product, factsKnownToYou[], angles[{angle, hook}] (x3) }
writeScript(research, angleIndex) → ScriptOutput { script, scenes[{time, text, emotion, visual}], caption, hashtags[] }
directVisuals(script) → VisualsOutput { scenePrompts[{sceneIndex, duration, prompt, voiceoverText}] }
generateClip(prompt, duration) → Replicate bytedance/seedance-1-lite {9:16, 720p, 24fps, 5-10s}
```

Detalles con valor:

- **Cada paso persiste su JSON a disco** (`output/research.json`, `script.json`, `visuals.json`) → pipeline reanudable e inspeccionable; el humano puede elegir `angleIndex` entre paso 1 y 2 (human-in-the-loop barato).
- El prompt del Researcher pide **ángulos "gossip-worthy"**, no facts: *"drama, controversy, 'I can't believe this works', before/after shock, hidden detail"* — 3 ángulos con su hook. Es la versión mínima del "ángulos de venta" de nuestro producto.
- El Writer impone **voz UGC nativa**: *"sound like a real person texting their best friend… 'literally', 'I'm not even kidding', 'wait wait wait'… The product should be the punchline, not the pitch"* + **disclosure #ad automático** (cumplimiento FTC embebido en prompt).
- El Visual Director fuerza **anti-cinematográfico**: *"UGC aesthetic, NOT cinematic. Think iPhone footage, natural light, real bedrooms or cafés"* + *"avoid prompts that could trigger model safety filters"*.
- Bug ilustrativo: `index.ts` llama a `video.generateVoiceover(...)` que **no existe** en `video.ts` — el paso de voz quedó a medias. (El propio autor: "Not a developer, just stubborn".)

Este repo demuestra que el esqueleto completo cabe en 3 llamadas LLM + 1 llamada de vídeo, sin orquestador pesado.

---

## 6. El esqueleto de orquestación destilado

Cruzando los cuatro pipelines, todos convergen en las mismas etapas con distinto grado de sofisticación:

| Etapa | n8n-ads (URL) | Hollywood (foto) | gossip (nombre/URL) | Prizmad (URL, cerrado) |
|---|---|---|---|---|
| 1. Intake | Agente Telegram + memoria | Form | env vars | tool `create_video` |
| 2. Ingesta producto | Shopify `.json` + LLM-scrape fallback | GPT-4o vision → YAML | conocimiento del modelo | scraper propio |
| 3. Análisis/ángulos | Style Selector (categoría, audiencia, price point, N estilos) | — | 3 ángulos gossip + hooks | interno |
| 4. Guion | 3 escenas Hook/Action/CTA con timing | timeline CAM/VO/SVX | escenas + caption + hashtags | interno (tone/duration/language) |
| 5. Prompt de vídeo | Prompt Optimizer (timing narración, especificidad) | Creative Director | Visual Director (UGC aesthetic) | interno + `*PromptHint` |
| 6. Render | fal.ai queue (sora-2 i2v, 9:16, 12 s) | Kie.ai Sora 2 | Replicate Seedance | motor propio multi-paso |
| 7. Post/composición | — | — | — (voz a medias) | voz ElevenLabs + captions + música + CTA + compositing |
| 8. Entrega/estado | Telegram + loops de polling | Drive + Baserow | ficheros JSON/mp4 | projectUrl/shareUrl/downloadUrl + wait:true |

**Esqueleto canónico a replicar** (síntesis):

```
INGEST     productUrl → ProductFacts {title, description, price, currency, images[],
           product_type, vendor, tags[], key_benefits[5], requires_human}
           · ruta rápida: {url}.json si es Shopify · fallback: HTML → LLM extractor
           · formato pivote estilo Shopify (lingua franca del e-commerce)

ANALYZE    ProductFacts → CreativeStrategy {product_analysis {category, target_audience,
           price_positioning, key_selling_points, recommended_emotions, objections[]*},
           ad_styles[N] {name, tone, camera_style, lighting_style, target_emotion, why_effective}}
           (*objections no existe en ningún OSS analizado — es nuestro diferencial)

SCRIPT     (ProductFacts ⨯ AdStyle) → AdScript {script_full ≤30 palabras, hook,
           scenes[3] {timestamp, narration, visual_description, camera_work, lighting, emotion},
           subtitles[] {start, end, text}, cta}
           · estructura Hook(0-3s)/Action(3-8s)/CTA(8-12s) con reglas duras de timing

PROMPT     AdScript → VideoPrompt (LLM "optimizer": word_count÷2.5=segundos,
           especificidad ❌→✅, adaptación por categoría, ending obligatorio con fade)

RENDER     fal.ai queue: submit → {request_id, status_url, response_url}
           → poll status_url (30-60 s) con retry_count/max_retries → response_url → mp4
           · image-to-video con foto de producto como anclaje de fidelidad

COMPOSE    voz (ElevenLabs) + captions (preset) + música (preset) + end-card CTA
           (solo Prizmad lo tiene; es la capa que separa "clip" de "anuncio")

DELIVER    URLs con semántica de audiencia (project/share/download), long-poll con
           progreso por paso, asset ledger (input+prompts+outputs persistidos)
```

**Principios de orquestación observados:**

1. **JSON estricto en cada frontera LLM** + parser tolerante (fences, regex `{...}`, multiformato) + **fallback determinista por etapa**.
2. **Estado = documento acumulativo** que viaja por el pipeline (item n8n / ficheros JSON); cada etapa añade, ninguna borra. Persistir cada artefacto intermedio habilita reanudación, remix y human-in-the-loop.
3. **Fan-out temprano de variantes** (estilos → N guiones → N renders) como primitivo de A/B testing; batch con pre-check de coste (Prizmad: 1–20).
4. **Async-first con submit+poll**; hacia el agente, convertir el polling en long-poll con eventos de progreso por paso.
5. **Superficie de configuración = presets enumerados + hints de texto libre + default aleatorio**.
6. **Los prompts codifican playbooks de marketing** (taxonomías por categoría de producto, fórmulas de hook, timing de narración) — son el activo diferencial, más que el glue code.

---

## 7. Implicaciones para el PRD

### 7.1 Arquitectura

1. **No usar n8n como motor del producto.** Los workflows n8n analizados son excelentes prototipos pero frágiles (bugs de endpoint hardcodeado, estado implícito en expresiones `$('Nodo')`, loops manuales para polling). El esqueleto cabe en un servicio propio con cola de jobs (submit/poll fal.ai) + los contratos JSON del §6. gossip-pipeline demuestra que el core son ~4 llamadas; nuestro valor añadido es el análisis multi-faceta y la composición.
2. **Pipeline de 7 etapas con artefactos persistidos** (ProductFacts → CreativeStrategy → AdScript[] → VideoPrompt[] → RenderJob[] → ComposedAd[] → Delivery). Cada artefacto en DB/storage con versión: habilita remix ("regenera solo el guion"), auditoría y reanudación tras fallo — nada de esto existe si el estado vive solo en memoria del workflow.
3. **fal.ai queue como patrón de render**: usar SIEMPRE `status_url`/`response_url` de la respuesta de submit (el bug veo3/sora-2 del workflow de referencia es el ejemplo perfecto de por qué); `retry_count`/`max_retries` en el job; webhooks de fal (`fal_webhook`) en producción en lugar de poll de 30 s.
4. **Anclaje de producto vía image-to-video** (foto real como `image_url`) + análisis visual estructurado tipo Hollywood (YAML con paleta HEX, materiales, logos) para las escenas donde el producto se regenera. Son técnicas complementarias de fidelidad de producto — el mayor riesgo de calidad de la categoría.
5. **Capa de composición propia** (voz ElevenLabs vía fal.ai, captions estilo preset, música, end-card CTA): es lo que convierte un clip de Sora/Veo en un *anuncio*. Ningún OSS la tiene completa; Prizmad la vende a 8–12 tokens/vídeo. Su taxonomía interna (`Music/Voiceover/Avatar/Creatives/Compositing`) es un buen mapa de módulos.

### 7.2 Producto

6. **Sistema de templates con coste explícito**: 3 categorías probadas por el mercado (product-showcase sin avatar ~barato, avatar-pitch medio, hooks caro) con `requires:{avatar,voice}`, rango de duración y coste en tokens. Publicar el catálogo sin auth (discovery para agentes).
7. **Fase de análisis como diferencial**: el AI Style Selector del workflow n8n es la mejor base OSS (categoría, audiencia, price positioning, N estilos con why_effective) pero **nadie genera objeciones ni las contraargumenta en el guion** — hueco directo para nuestro pitch "analiza en múltiples facetas (objeciones, ángulos)".
8. **Variantes como primitivo core**: N estilos → N guiones → N renders en un solo request (batch 1–20 con pre-check de coste). El A/B de hooks es el caso de uso nº1 del segmento.
9. **Presets + hints**: adoptar la superficie exacta de Prizmad como referencia (8 caption / 9 music / 3 CTA / 10 image styles + 3 promptHints ≤400 chars + omitido→random). Está validada frente a agentes reales.
10. **Voz UGC en los prompts de guion**: combinar las reglas duras de timing del workflow n8n (word_count÷2.5, fade a 11.5 s) con la voz anti-anuncio de gossip-pipeline ("the product is the punchline, not the pitch") y el disclosure #ad automático. Los prompts del §3.2 y §5 son punto de partida directo.

### 7.3 Superficie de agente (go-to-market técnico)

11. **Exponer el producto como MCP server remoto + REST desde el diseño** (no como añadido): OAuth 2.1 + PKCE + DCR same-origin, tools de discovery sin auth, `recommend_template` determinista, `wait:true` con notifications/progress, hints en cada respuesta, errores 402/403 en lenguaje natural con URL de acción. El repo de Prizmad es literalmente una plantilla copiable (MIT).
12. **Publicar agent-skills** (`/.well-known/agent-skills/index.json` + SKILL.md con digests) y considerar markdown content-negotiation. Coste bajo, posiciona el producto en el ecosistema de agentes donde ya viven los compradores técnicos.
13. **Semántica de URLs de salida** (projectUrl/shareUrl/downloadUrl, nunca la URL cruda de storage): resuelve a la vez seguridad, branding y UX de agente.

### 7.4 Riesgos y deuda observada

14. **Salidas LLM**: presupuestar parsers tolerantes + fallbacks deterministas por etapa (patrón universal en todos los repos); mejor aún, structured outputs nativos del proveedor.
15. **Coste por anuncio**: referencia de mercado $2–4 (12 s Sora 2 en fal.ai, sin composición) y $3–6 (Prizmad completo). Diseñar la economía de tokens desde el día 1; Prizmad gatea la API tras plan Pro para proteger márgenes — decisión a replicar o no conscientemente.
16. **No confiar en repos del topic `ugc-ads` sin clonar**: ~la mitad son escaparates sin código (NBGC, los ~10 repos "scorecard" de clipcurator). El ecosistema OSS real utilizable son: el patrón MCP de Prizmad, los prompts del workflow de AhsanRiaz786, el análisis YAML de Hollywood y el esqueleto de gossip-pipeline.

---

### Apéndice: rutas locales de los repos clonados

```
/private/tmp/claude-501/.../scratchpad/repos/Prizmad-MCP-server/           (src/index.ts)
/private/tmp/claude-501/.../scratchpad/repos/prizmad-agent-skills/         (5 × SKILL.md, index.json)
/private/tmp/claude-501/.../scratchpad/repos/n8n-ai-ads-generator/         (workflow.json, 45 nodos)
/private/tmp/claude-501/.../scratchpad/repos/NBGC-Next-Gen-Content-Photos-to-UGC-Ads/  (solo README)
/private/tmp/claude-501/.../scratchpad/repos/Hollywood-Quality-UGC-Ad-Generator/       (47_AI Ads Sora.json)
/private/tmp/claude-501/.../scratchpad/repos/gossip-pipeline/              (src/{agents,video,index}.ts)
```

**URLs de referencia:**
- https://github.com/prizmad/Prizmad-MCP-server · https://www.npmjs.com/package/@prizmad/mcp-server
- https://github.com/prizmad/agent-skills · https://prizmad.com/.well-known/agent-skills/index.json
- https://prizmad.com/api/v1/templates · https://prizmad.com/api/v1/avatars (verificados en vivo 2026-07-06)
- https://github.com/AhsanRiaz786/n8n-ai-ads-generator
- https://github.com/ubachan/NBGC-Next-Gen-Content-Photos-to-UGC-Ads · https://nbgc.pages.dev (no funcional)
- https://github.com/Alex-safari/Hollywood-Quality-UGC-Ad-Generator
- https://github.com/stevenleon30/gossip-pipeline
- https://github.com/topics/ugc-ads
- fal.ai queue API: https://queue.fal.run/fal-ai/sora-2/image-to-video (patrón submit+poll)
