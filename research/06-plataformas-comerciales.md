# Teardown de plataformas comerciales de AI UGC Ads

**Fecha de investigación:** 6 de julio de 2026
**Plataformas analizadas:** Arcads, MakeUGC, Tagshop AI, Loova (Agents), HeyGen (UGC/Reel generator), CreateUGC
**Objetivo:** decidir qué UX y features debe tener nuestro producto (URL de producto → análisis IA multifaceta → anuncios de vídeo UGC 9:16 vía fal.ai) para estar a la altura del mercado, y qué es over-engineering para un MVP.

---

## 0. Verificación de existencia (julio 2026)

| Plataforma | ¿Existe hoy? | URL verificada | Notas |
|---|---|---|---|
| Arcads | Sí | https://www.arcads.ai/ | Activa, líder de la categoría en gama alta |
| MakeUGC | Sí | https://makeugc.ai/ | Activa; ha migrado de planes "N vídeos/mes" a un modelo de créditos |
| Tagshop AI | Sí | https://tagshop.ai/ | Activa; pivotó de "social commerce" a AI UGC video ads |
| Loova (Agents) | Sí | https://loova.ai/ y https://loova.ai/ai-agent/intro | Existe como "Loova Agents"; es una plataforma multi-modelo generalista con un "Ads Studio", no un producto puro de UGC ads |
| HeyGen (UGC) | Sí | https://www.heygen.com/avatars/ugc y https://www.heygen.com/apps/ugc-video-generator | HeyGen es plataforma general de avatares con vertical de UGC ads; no hay un producto separado llamado "Reel generator" — es el "UGC Video Generator" app |
| CreateUGC | Sí | https://www.createugc.ai/ | Activa (la web bloquea scrapers con 403; datos vía reviews de terceros) |

**Discrepancias de nombre/concepto detectadas:**
- **"HeyGen (UGC/Reel generator)"**: no existe un producto de HeyGen llamado literalmente "Reel generator". Los productos reales son **"UGC Avatars"** (heygen.com/avatars/ugc) y la app **"UGC Video Generator"** (heygen.com/apps/ugc-video-generator), más la landing "UGC Video Ads" para marketing. Mismo concepto, otro nombre.
- **"Loova (Agents)"**: Loova Agents existe, pero es un **agente director de vídeo genérico** ("The First Director-Like AI Video Agent") sobre una plataforma multi-modelo (Seedance 2.0, Kling O1/3.0, VEO 3.1, Sora 2 Pro, GPT Image 2, Nano Banana 2). El UGC es solo una de sus verticales (Ads Studio). No es un competidor "puro" como Arcads o MakeUGC.
- Los datos de pricing difieren fuertemente entre fuentes de 2026 para Arcads y MakeUGC (ver secciones y §7); ambas empresas parecen haber cambiado de modelo de planes durante 2025–2026.

---

## 1. Arcads — el estándar de calidad de la categoría

**URL:** https://www.arcads.ai/ · Trustpilot ~2.8–3.3/5 (127–142 reviews, muy polarizado)

### 1.1 Flujo de usuario

Flujo clásico (documentado en reviews):
1. **Input: script.** El usuario pega el copy del anuncio en el navegador. Arcads **no parte de URL de producto**; el input primario es el guion. La home actual enmarca el flujo como "Choose your model" → "Shape your ad" → "Start from proven formats".
2. **Selección de actor:** librería filtrable por edad, género, etnia, escenario (casa, oficina, exterior) y "vibe". La web actual anuncia **"1,000+ Captivating AI Actors"** (reviews de 2025 hablaban de 300+; han escalado la librería). Preview de voz del actor **gratis** (no consume créditos).
3. **Background:** fondos estándar o subir fondo propio.
4. **Generación:** render de vídeo de hasta ~90 s en **2–5 minutos**.
5. **Export:** MP4 crudo. Históricamente **sin editor integrado** — captions, b-roll, música y gráficos se hacían fuera. La home actual anuncia "Add B-Rolls, music, captions and transitions in one click" marcado como **"Soon!"** (aún no disponible en julio 2026).

Novedades de UX en la web actual: **"infinite canvas"** colaborativo ("Create your workflow… to create, test and scale ads faster as a team") y una biblioteca de **"proven formats"** (plantillas de formatos ganadores: Product Showcase, Unboxing, Talking Actors, Camera Angle, Swap actor, Background Remover, Extend videos).

### 1.2 Features diferenciales

- **Batch mode / hook testing:** generar docenas o cientos de variaciones combinando hooks, actores y CTAs en una sola operación. Ejemplo citado en reviews: **"10 hooks × 5 actors × 3 CTAs = 150 unique creatives"**. Es LA feature que define su posicionamiento para performance marketers.
- **Speech-to-speech:** grabas tu propia voz con el pacing/énfasis deseado y Arcads la transfiere al actor. Soluciona el problema "AI voice sounds like AI voice".
- **Control de emoción por texto:** "full emotion control. Just write how you want it" (p. ej. "Surprised") — dirección emocional embebida en el guion.
- **Actores capturados de personas reales:** "cloned from real, consenting performers using motion capture tech" → micro-expresiones, parpadeo y cambios de peso naturales. Es la base de su ventaja de realismo.
- **Generación de cara custom + product-in-hand:** "Generate a face… And make them hold your product".
- **Localización:** traducción a 30+ idiomas (algunas fuentes citan 74+).
- **API** en tier alto para generación programática.

### 1.3 Pricing y modelo de créditos

Fuentes de 2026 discrepan (ver §7). Las dos versiones documentadas:

| Fuente | Starter | Creator | Pro |
|---|---|---|---|
| eesel.ai (2026) | $110/mes → **10 vídeos** | $220/mes → **20 vídeos** | Custom + API |
| candidcodes (mayo 2026) | $110/mes → "up to 50 AI videos" + 600 s de avatar hablando | $220/mes → "up to 100" + 1.200 s | $550/mes, ilimitado, cloning de actor |

Modelo de créditos: **1 crédito = 1 vídeo generado**; los créditos **no hacen rollover**; el preview de voz es gratis; cada re-generación (aunque el cambio sea mínimo) cuesta un crédito entero ("re-generation tax"). Coste efectivo ≈ **$11/vídeo** en la lectura de eesel; sin free trial.

### 1.4 Debilidades conocidas

- **Precio**: la más cara de la categoría; "got a sub for a month, used 10 credits in like 15 mins, canceled sub same day" (usuario citado por eesel). El coste real por *anuncio usable* es mucho mayor que $11 porque iterar quema créditos.
- **Sin editor / post-producción externa** (hasta que salga lo anunciado como "Soon").
- **Calidad inconsistente entre actores**: "Some actors perform better than others—testing required"; quejas en Trustpilot de vídeos "glitchy" con lip-sync fallido que no se parecen a las demos de marketing.
- **Pricing opaco** (no se puede modelar coste sin crear cuenta) y **sin trial**.
- Limitado a talking-head; poco storytelling multi-escena.

**Fuentes:** [arcads.ai](https://www.arcads.ai/) · [eesel.ai/blog/arcads-ai-pricing](https://www.eesel.ai/blog/arcads-ai-pricing) · [ezugc.ai/blog/arcads-ai](https://www.ezugc.ai/blog/arcads-ai) · [candidcodes.com/blog/arcads-review](https://candidcodes.com/blog/arcads-review) · [trustpilot.com/review/arcads.ai](https://www.trustpilot.com/review/arcads.ai)

---

## 2. MakeUGC — el volumen barato con fricción de calidad

**URL:** https://makeugc.ai/ · Trustpilot ~2.7–3.2/5 (variable por página)

### 2.1 Flujo de usuario

La web lo resume en 3 pasos: **"Write your script → Pick an avatar → Generate video"**. Flujo detallado (fluxnote, 2026):
1. **Selección de avatar:** 500+ (la home hoy dice **"1000+ realistic AI actors"**) filtrados por etnia, edad, género, escenario.
2. **Script:** pegar guion propio, o usar el **Video Agent** para generarlo desde datos del producto; también **PDF-to-script**.
3. **Escena:** fondo, activar **product-in-hand** (solo Growth/Pro), elegir **hand gestures**.
4. **Generación:** ~2 minutos; descarga MP4.
5. **Editor:** la home actual anuncia "Add captions, music, B-roll and trims right inside the editor" (reviews de principios de 2026 aún describían salida como "raw, unedited MP4"; el editor es reciente).

### 2.2 Features diferenciales

- **Product in Hand:** "Let any AI actor naturally hold and present your product on camera" (resultados inconsistentes según usuarios).
- **Motion Control:** "Re-create any avatar performing the exact same movements" — replicar los movimientos exactos de un vídeo de referencia.
- **Video Agent:** agente que analiza vídeos de referencia y "rebuilds the flow using your product and creator images" → clonar estructuras de anuncios ganadores.
- **Content Library:** "Hundreds of real, high-performing videos filtered by niche, style, and format" — swipe file integrado.
- **AI Workflows:** "Create any custom automated workflow in a few steps".
- **Batch Mode** para variantes A/B (gated a plan Growth+).
- **Custom avatar** ("Build your own AI actor": genera una cara y que presente tu producto) — Pro.
- Integración de voz **ElevenLabs**; 50+ idiomas; export HD/2K/4K; **API** ($99–$299/mes).

### 2.3 Pricing y modelo de créditos

Dos generaciones de pricing conviven en las fuentes (ver §7):

- **Web actual (julio 2026), modelo de créditos:** Startup **$59/mes → 500 créditos**; Growth **$79/mes → 1.000 créditos** (incluye Batch Mode); Pro **$149/mes → 2.000 créditos**; Enterprise custom. API Starter $99 (2.000 créditos), API Pro $299 (6.000). Créditos consumidos por generación según "model, duration, and resolution"; **sin rollover**; packs extra comprables. **Trial de $1** (3 días). Todos los planes de pago incluyen 30 días de "Seedance 2.0 Fast" ilimitado (señal de que por debajo usan modelos de vídeo de terceros tipo Seedance).
- **Reviews de 2025/inicios de 2026, modelo por vídeo:** Startup $49/5 vídeos; Growth $69/10 vídeos (product-in-hand); Pro $119/20 vídeos (API, custom avatars).

### 2.4 Debilidades conocidas

- **Lip-sync**: el fallo más citado; correcto en inglés/español pero "noticeable drift and misalignment… in other European languages like German".
- **Voces planas**: sin rango emocional ni prosodia humana.
- **Facturación/refunds**: Trustpilot lleno de quejas de cobros tras cancelar el trial y política "no refund after generation" que choca con el marketing de "try risk free".
- **Calidad inconsistente**: "videos that can still look noticeably AI-generated"; product-in-hand irregular.
- **Créditos que expiran** cada mes.
- Gating agresivo: product-in-hand y gestos solo en tiers medios/altos.

**Fuentes:** [makeugc.ai](https://makeugc.ai/) · [fluxnote.io/guides/makeugc-ai-review](https://fluxnote.io/guides/makeugc-ai-review) · [trustpilot.com/review/makeugc.ai](https://www.trustpilot.com/review/makeugc.ai) · [gethookd.ai](https://www.gethookd.ai/learn/makeugc-ai-reviews-pricing-alternatives-is-this-video-ad-tool-worth-it/) · [superscale.ai/alternatives/makeugc/pricing](https://superscale.ai/alternatives/makeugc/pricing)

---

## 3. Tagshop AI — el más cercano a nuestra tesis (URL → vídeo)

**URL:** https://tagshop.ai/ · G2 y web propia citan ~4.9/5 (143+ reviews en su propia landing; tomar con cautela)

### 3.1 Flujo de usuario

Es la plataforma cuyo flujo más se parece a nuestro producto — parte de la **URL del producto** y usa un **agente conversacional**:

1. **Input:** "Share Your Video Idea — Tell the AI what you want to create. Share your product, campaign goal, target audience, **or simply paste a product URL**."
2. **Extracción automática:** el URL-to-Video "Automatically pulls the product title, images, key benefits, and pricing" y genera el script persuasivo.
3. **Conversación con el AI Video Agent:** "Have a natural conversation with the agent. It asks the right questions to understand your brand, messaging, visuals, and creative preferences." — es decir, refina brief por chat en vez de formularios.
4. **Selección de avatar:** 1.000+ presentadores AI (edades, etnias, estilos).
5. **Customización:** editar script, elegir voz, ajustes; editor integrado con timeline, text overlays y auto-captions con fuentes customizables.
6. **Output:** "a complete UGC-style video with script, AI avatar, voiceover, scenes, captions, and B-roll — ready to use". Multi-aspect-ratio.
7. **Publicación directa a Meta y TikTok** desde la plataforma.

### 3.2 Features diferenciales

- **URL-to-Video** como flujo primario (nuestro mismo concepto).
- **AI Twin:** sube un vídeo de ~15 s de ti mismo y crea un avatar custom que replica apariencia, voz y gestos.
- **Voice cloning** con muestra de audio.
- **75+ idiomas**.
- **Variaciones ilimitadas** para A/B testing, refresh de campañas y localización.
- **Publicación directa** a Meta/TikTok (ningún otro de los 6 lo destaca tanto).
- Formatos: product reviews, testimonials, tutorials, unboxing.

### 3.3 Pricing

| Plan | Precio | Incluye |
|---|---|---|
| Free | $0 | tier gratuito con límites (watermark/quotas no documentadas públicamente) |
| Starter/Basic | **$29/mes** ($11/mes anual) | 5 vídeos, avatares, script AI, export sin watermark, URL-to-Video, hasta 2 min, 1080p |
| Growth/Scale | **$99/mes** | 20 vídeos, límites ampliados |
| Advanced | **$249/mes** | 50 vídeos, custom creators, 4K |
| Agency/Enterprise | Custom | para 50+ vídeos/mes |

Marketing propio: coste por vídeo <$1 y "6–90+ videos daily" (claims de vendor). Es el pricing de entrada más agresivo de los competidores puros junto a CreateUGC.

### 3.4 Debilidades conocidas

- **Rigidez de avatares:** "certain avatars appear slightly stiff or exhibit unnatural movements".
- **Control limitado de gestos/expresiones** (petición recurrente de usuarios).
- **Gap de autenticidad** vs creadores reales.
- Web de pricing confusa/incompleta (la página oficial de pricing no muestra tabla a scrapers; datos vía reviews); señal de pricing cambiante.
- Review score de su propia web (4.9) probablemente inflado; en G2/Capterra hay pocas reviews independientes.

**Fuentes:** [tagshop.ai](https://tagshop.ai/) · [tagshop.ai/ai-ugc-video-ad-generator](https://tagshop.ai/ai-ugc-video-ad-generator) · [ampifire.com (review)](https://ampifire.com/blog/tagshop-ai-reviews-features-pricing-is-this-video-ad-generator-worth-it/) · [g2.com/products/tagshop-ai/reviews](https://www.g2.com/products/tagshop-ai/reviews)

---

## 4. Loova (Agents) — agregador multi-modelo con vertical de ads

**URL:** https://loova.ai/ · https://loova.ai/ai-agent/intro

### 4.1 Qué es realmente

Loova NO es una plataforma de UGC ads: es un **"AI Image & Video Generator | All-in-One Creative Playground"** que agrega modelos top (Seedance 2.0, Kling O1/3.0, VEO 3.1, Sora 2 Pro, Wan 2.7, GPT Image 2, Nano Banana 2, Seedream 5.0, Grok Imagine) bajo una sola suscripción de créditos. **Loova Agents** es su agente director: "The First Director-Like AI Video Agent". El UGC ads es una vertical dentro de su **Ads Studio**.

### 4.2 Flujo de usuario (Agents)

1. **Input:** describe la visión del vídeo en lenguaje natural.
2. **Planning:** el agente analiza la idea y **planifica escenas** (rol de "director": guion + shot list).
3. **Canvas infinito:** storyboard visual donde organizar escenas y explorar direcciones creativas.
4. **Generación en tiempo real** mientras refinas la narrativa; el agente elige/orquesta modelos.

### 4.3 Features del Ads Studio (nombres exactos)

- **"AI UGC Ad Maker"**
- **"Viral Ad Clone"** — replica formatos de anuncios virales/trending.
- **"URL to Video Ad"** — convierte un link de producto en anuncio de vídeo (mismo concepto que el nuestro, pero como tool suelta, no como pipeline con análisis multifaceta).
- **"Product Avatar Video"** — demos de producto con avatar.
- Claim de calidad: "GPT Image 2 + Seedance 2.0… UGC-style videos, realistic avatars, even the small details feel real."

### 4.4 Pricing (créditos por segundo de vídeo, no por vídeo)

| Plan | Precio (anual) | Créditos/mes | Notas |
|---|---|---|---|
| Lite | $15/mes | 300 | Seedance 2.0 Mini $0.25/s, Fast $0.40/s; 2 vídeos concurrentes |
| Pro | $39.20/mes (norm. $49) | 1.200 | Seedance 2.0 $0.32/s; "365 unlimited" Kling O1 + Motion Control; 6 concurrentes |
| Max | $69.30/mes (norm. $99) | 3.000 | Seedance $0.23/s, Fast $0.14/s, Mini $0.09/s; 2K en imagen; 8 concurrentes |
| Ultimate | $137.40/mes (norm. $249) | 8.000 | créditos extra "80% cheaper"; 12 concurrentes |

Claves del modelo: precio **por segundo y por modelo** (p. ej. Seedance 2.0 a $0.05–0.40/s según tier y variante), ofertas "365 UNLIMITED" para modelos concretos, y descuentos agresivos permanentes (52% OFF). Es el pricing más parecido al **coste real de infraestructura** (como fal.ai) trasladado al usuario.

### 4.5 Debilidades

- No está especializado: el flujo UGC no tiene análisis de producto/audiencia, ni librería de actores curada, ni batch de hooks documentado.
- Complejidad de elección (decenas de modelos y precios por segundo) — UX de "playground", no de "dame mi anuncio".
- Poca evidencia independiente de calidad de su URL-to-Video Ad; sin reviews de peso (Trustpilot/G2 casi inexistentes).
- Marca joven; pricing en promoción perpetua (señal de presión competitiva).

**Fuentes:** [loova.ai](https://loova.ai/) · [loova.ai/pricing](https://loova.ai/pricing) · [loova.ai/ai-agent/intro](https://loova.ai/ai-agent/intro) · [producthunt.com/products/loova-agents](https://www.producthunt.com/products/loova-agents)

---

## 5. HeyGen (UGC Video Generator) — el gigante generalista bajando al UGC

**URL:** https://www.heygen.com/avatars/ugc · https://www.heygen.com/apps/ugc-video-generator

### 5.1 Flujo de usuario (UGC Video Generator app)

1. **"Choose your format"** — plantilla de UGC ad o desde cero.
2. **"Write or paste your ad script"** — con hooks, beneficios y CTA. (No pide URL de producto ni foto en el flujo base.)
3. **"Pick your presenter"** — 1.100+ avatares "creator-style… designed to look like everyday creators"; refinado por **text prompts** ("adjust style, outfits, and environments").
4. **Render y export** — 9:16 (TikTok/Reels), 1:1, 16:9; HD y 4K con captions embebidas.

### 5.2 Features diferenciales

- **AI Product Placement:** integra el producto de forma natural en el frame + overlays de marca, logos y fondos custom.
- **Batch de variantes:** "Generate dozens of UGC ad variations from one script in minutes"; "Deploy hundreds of AI persona variations by mixing faces, voices, and tones" → A/B testing nativo.
- **Avatar cloning (Digital Twin):** desde un vídeo de ~2 min; también avatares generados desde foto o descripción de texto (Avatar IV: lip-sync natural, micro-expresiones, movimiento corporal).
- **Video Translator:** 175+ idiomas preservando voz y lip-sync del hablante original.
- **AI Video Editor** y **Video Agent** (genera scripts, elige B-roll, edita).
- **Voice cloning.**

### 5.3 Pricing y modelo de créditos

- Free: $0 — 3 vídeos/mes, máx. 3 min, watermark.
- **Creator: $29/mes** — vídeos "ilimitados" con avatares estándar + créditos premium limitados (una fuente: 200 créditos/mes; Avatar IV = 20 créditos/min → 10 min/mes; otra fuente: Avatar IV capado a 5 min/mes). Ampliación: +$15/mes por 300 créditos generativos; +$15/mes por priority processing (sin él, colas de 10–30 min en horas pico).
- Team: $39/seat/mes (mín. 2 seats). Pro ~$99/mes según fuentes. Business $149/mes + $20/seat (4K, custom avatars, SSO). Enterprise custom.
- Coste real citado para uso profesional del plan Creator: **$29 + $15 + $15 = ~$59/mes**.

### 5.4 Debilidades para el caso de uso UGC ads

- **"Unlimited" engañoso:** lo ilimitado es el avatar estándar; el Avatar IV (el único con calidad UGC competitiva) se agota rápido → quejas de transparencia.
- **Energía equivocada para social:** review con tests reales le da **C+** en contenido tipo TikTok — "avatar energy didn't match TikTok-style scripts". HeyGen brilla en corporate/training, no en anuncios nativos de feed.
- Expresiones repetitivas en vídeos largos ("expressions got repetitive around minute 7").
- Colas de procesamiento sin el add-on de prioridad.
- Sin flujo URL→anuncio: exige guion ya escrito o usar su Video Agent genérico.

**Fuentes:** [heygen.com/avatars/ugc](https://www.heygen.com/avatars/ugc) · [heygen.com/apps/ugc-video-generator](https://www.heygen.com/apps/ugc-video-generator) · [ezugc.ai/blog/heygen-review](https://www.ezugc.ai/blog/heygen-review) · [arcade.software/post/heygen-pricing](https://www.arcade.software/post/heygen-pricing) · [admakeai.com/blog/heygen-vs-arcads](https://admakeai.com/blog/heygen-vs-arcads)

---

## 6. CreateUGC — el low-cost e-commerce con URL como input

**URL:** https://www.createugc.ai/ ("AI Video Generator for eCommerce Ads that Sell"). La web bloquea scraping (HTTP 403); detalles vía review con hands-on de successtechservices.com.

### 6.1 Flujo de usuario (el más guiado de los 6 — wizard puro)

1. Click **"create a new video"**.
2. Elegir formato **"product reaction"** (variante realista o regular).
3. **Pegar el link del producto** — auto-extrae datos de **Amazon, AliExpress, WordPress, WooCommerce y Shopify**.
4. Elegir las **fotos del producto** que aparecerán en el vídeo.
5. Formato de vídeo (recomienda **9:16 vertical**).
6. Idioma y duración (recomienda corta).
7. Elegir **AI influencer** y preescuchar muestras de voz.
8. Elegir **tono del guion**: "Funny", "Selling" (recomendado para conversión) o "Professional".
9. **Generar** el anuncio terminado.

### 6.2 Features diferenciales

- **URL → vídeo con integraciones e-commerce explícitas** (Amazon/AliExpress/Shopify/WooCommerce) — el matching de plataformas de origen más amplio de los 6.
- Formato "product reaction" (avatar reaccionando al producto) y **product-in-hand** (tier Standard+).
- Scripts auto-generados en 3 tonos + **"Inspiration Videos" library** de anuncios de alto rendimiento de TikTok/Facebook/Instagram para modelar.
- Filtro de avatares por género/etnia; multi-aspect (9:16, 1:1, 16:9); 30+ idiomas en tiers altos; subida de voz custom.

### 6.3 Pricing

| Plan | Precio | Vídeos/mes | Avatares | Features |
|---|---|---|---|---|
| Base | ~$26.90/mes (entry $19.90/mes anual) | 10 | 20 | voces AI, 3 scripts, multi-formato |
| Standard | ~$40/mes | 20 | 120 | **product-in-hand**, 30+ idiomas |
| Max | n/d | 50 | 1.000+ | volumen |

### 6.4 Debilidades

- **Uncanny valley:** "the realism can feel a little uncanny at first".
- Un vídeo generado es "a first pass": hacen falta variantes para que algo funcione, y las cuotas mensuales son pequeñas.
- Pricing poco transparente (requiere contacto para tiers altos); free trial limitado.
- Poca huella de reviews independientes (riesgo de churn/calidad no auditada).

**Fuentes:** [createugc.ai](https://www.createugc.ai/) · [successtechservices.com/ai-ugc-ads](https://www.successtechservices.com/ai-ugc-ads/) · [designrevision.com/blog/ugc-creator-pricing](https://designrevision.com/blog/ugc-creator-pricing)

---

## 7. Tabla comparativa y discrepancias de datos

### 7.1 Comparativa

| | Arcads | MakeUGC | Tagshop AI | Loova | HeyGen | CreateUGC |
|---|---|---|---|---|---|---|
| **Input primario** | Script | Script (o Video Agent) | **URL / brief conversacional** | Prompt en lenguaje natural | Script + template | **URL de producto** |
| **URL → vídeo** | No | Parcial (Video Agent) | **Sí (core)** | Sí (tool suelta) | No | **Sí (core)** |
| **Actores/avatares** | 1.000+ (motion capture real) | 1.000+ | 1.000+ | n/a (generativo) | 1.100+ | 20–1.000+ según plan |
| **Clonado de avatar** | Pro (actor cloning) | Pro (custom avatar) | **AI Twin (15 s de vídeo)** | No | **Digital Twin (2 min) + foto/texto** | No |
| **Product-in-hand** | Sí | Sí (Growth+) | vía escenas/B-roll | Product Avatar Video | AI Product Placement | Sí (Standard+) |
| **Script writer IA** | No (copy externo) | Video Agent + PDF | Sí (desde URL) | Agente director | Video Agent | Sí, 3 tonos |
| **Batch/hook testing** | **Sí (hooks×actores×CTAs)** | Batch Mode (Growth+) | "unlimited variations" | No documentado | "dozens of variations from one script" | No |
| **Editor integrado** | "Soon" | Sí (captions, música, B-roll, trims) | Sí (timeline, overlays, captions) | Canvas | AI Video Editor | No documentado |
| **Publicación directa** | No | No | **Meta + TikTok** | No | No | No |
| **Precio entrada** | $110/mes | $59/mes (trial $1) | $29/mes (free tier) | $15/mes | $0 / $29/mes | ~$20–27/mes |
| **Unidad de cobro** | 1 crédito = 1 vídeo | créditos por modelo/duración/resolución | vídeos/mes | **créditos por segundo y modelo** | créditos premium por minuto | vídeos/mes |
| **Reputación** | Trustpilot 2.8–3.3/5 | Trustpilot 2.7–3.2/5 | 4.9 (self-reported) | sin masa crítica | sólida en general, C+ en UGC social | sin masa crítica |

### 7.2 Discrepancias entre fuentes (importante para no citar datos falsos en el PRD)

1. **Arcads – vídeos por plan:** $110/mes = "10 videos" (eesel, 2026) vs "up to 50 AI videos + 600 s avatar" (candidcodes, mayo 2026). Probable cambio de estructura de planes en 2026 separando "AI videos" (generativos) de segundos de avatar. **No citar $11/vídeo como dato firme sin re-verificar en app.**
2. **Arcads – tamaño de librería:** 300+ (reviews 2025) vs 1.000+ (web actual). Usar 1.000+.
3. **MakeUGC – pricing:** $49/$69/$119 por 5/10/20 vídeos (reviews) vs $59/$79/$149 por 500/1.000/2.000 créditos (web actual). La web manda: **modelo de créditos multi-modelo** (incl. Seedance 2.0 Fast) es lo vigente.
4. **HeyGen – límite Avatar IV en Creator:** "5 min/mes" (ezugc) vs "200 créditos = 10 min/mes" (arcade.software). Orden de magnitud consistente (minutos, no horas), cifra exacta incierta.
5. **HeyGen – precio de entrada:** $24/mes (landing app, anual) vs $29/mes (mensual). Ambos correctos según billing.
6. **Tagshop – pricing:** su propia página de pricing no expone tabla; los números ($29/$99/$249 y "Basic $29 one time / 5 videos") vienen de terceros y de snippets contradictorios (suscripción vs one-time). Verificar in-app antes de citarlo en materiales de venta.
7. **"HeyGen Reel generator" y "Loova Agents (UGC)"** no existen como productos con ese nombre exacto — ver §0.
8. **CreateUGC:** ninguna fuente primaria accesible (403); todos los datos son de una única review hands-on + snippets. Fiabilidad media.

---

## 8. Patrones de UX comunes (lo que el mercado ya ha decidido)

1. **Wizard de 3–4 pasos** como flujo canónico: input (script o URL) → avatar → ajustes → render. Nadie con tracción pide más de ~5 decisiones antes del primer vídeo.
2. **El input está migrando de script → URL/brief conversacional.** Los dos entrantes de bajo coste (Tagshop, CreateUGC) y Loova ya parten de URL; los incumbentes (Arcads, HeyGen, MakeUGC) siguen script-first pero añaden agentes que escriben el guion. Nuestra tesis (URL → análisis multifaceta → anuncios) ataca exactamente el hueco.
3. **Preview gratis, render de pago.** Preescucha de voz/actor sin coste; el crédito se quema solo en el render final (Arcads). Reduce muchísimo la fricción de compra.
4. **El render tarda 2–5 min** y todos lo comunican como "minutes". Colas largas (HeyGen sin priority: 10–30 min) generan quejas inmediatas.
5. **Batch/variantes como feature premium**, no básica: Batch Mode (MakeUGC Growth+), batch hooks (Arcads), variations (HeyGen). El comprador es un media buyer que piensa en matrices hook×actor×CTA.
6. **Créditos mensuales sin rollover** es el estándar (y la mayor fuente de resentimiento en reviews). El "re-generation tax" (pagar crédito entero por un retoque) es la queja nº1 de valor.
7. **Trust deficit generalizado:** Trustpilot ~3/5 en los dos líderes por (a) calidad real < demos de marketing y (b) prácticas de billing/refund. Hay una oportunidad clara de diferenciarse con billing honesto y previews reales.
8. **El editor integrado se está volviendo table stakes en 2026:** MakeUGC y Tagshop ya lo tienen, Arcads lo anuncia "Soon". Entregar un MP4 crudo ya se percibe como producto incompleto.

---

## 9. Implicaciones para el PRD

### 9.1 Features table stakes (mínimo para "estar a la altura")

- **Input por URL de producto** con extracción automática de título, imágenes, beneficios y precio (Tagshop y CreateUGC ya lo hacen; CreateUGC lista integraciones explícitas: Amazon, AliExpress, Shopify, WooCommerce). Nuestro análisis multifaceta (producto/beneficios/audiencia/objeciones/ángulos) es MÁS profundo que lo que muestra cualquiera de los 6 → es nuestro diferencial, hay que exponerlo en la UI, no esconderlo.
- **Librería de avatares filtrable** (género, edad, etnia, escenario/vibe). No necesitamos 1.000; necesitamos 20–50 *buenos y consistentes* — la queja real del mercado es la varianza de calidad entre actores, no la cantidad.
- **Guion generado por IA con tonos** (mínimo: selling / professional / funny, como CreateUGC) y editable antes del render.
- **Preview gratuito de voz/actor antes de gastar crédito** (patrón Arcads). Innegociable para la conversión.
- **Render 9:16 nativo** + export MP4 con **captions embebidas** (HeyGen las incluye; MakeUGC fue castigado por no incluirlas). 1:1 y 16:9 pueden esperar.
- **Tiempo de render comunicado y < ~5 min** con estado visible del job.
- **Multi-idioma básico** (ES/EN mínimo; el lip-sync degradado en idiomas no ingleses es la debilidad explotable de MakeUGC).

### 9.2 Features diferenciales que valen la pena (fase 2, post-MVP)

- **Matriz de variantes (hook testing):** generar N hooks × M avatares desde un solo análisis de URL. Es LA feature por la que Arcads cobra $110+/mes y la razón de compra del media buyer. Nuestro análisis de "ángulos de venta" mapea 1:1 a esto: cada ángulo → un hook → una variante. Diferencial natural de nuestro pipeline.
- **Ángulos basados en objeciones:** ninguno de los 6 genera guiones desde objeciones detectadas del producto/reviews. Hueco claro.
- **Editor ligero post-render** (trim, caption styling, música) — table stakes en 2026, pero puede ser fase 2 si las captions ya van embebidas bien.
- **Regeneración parcial barata** (solo re-render de la escena/hook cambiado): ataca directamente el "re-generation tax", la queja nº1 de Arcads. Con fal.ai por segundos, técnicamente viable y monetizable como ventaja de pricing.
- **Product-in-hand / product placement:** deseado pero notoriamente inconsistente en MakeUGC y CreateUGC. Meterlo cuando la calidad del modelo (p. ej. imagen compuesta + image-to-video en fal.ai) lo permita sin uncanny valley; mientras tanto, alternar talking-head con B-roll de las imágenes del producto extraídas de la URL (patrón Tagshop: "script, avatar, voiceover, scenes, captions, and B-roll" como paquete).

### 9.3 Over-engineering para un MVP (no construir aún)

- **Clonado de avatar (AI Twin / Digital Twin):** todos lo gatean a tiers Pro; el comprador de MVP (e-commerce/DTC probando creativos) no lo necesita.
- **Voice cloning y speech-to-speech.**
- **Publicación directa a Meta/TikTok:** solo Tagshop lo tiene; el usuario descarga y sube al Ads Manager sin dolor. OAuth con Meta/TikTok es coste alto y valor marginal en MVP.
- **Canvas infinito / workflows / agente director** (Arcads, Loova, MakeUGC Workflows): UX de power-user para equipos; irrelevante hasta tener retención.
- **Editor de timeline completo, 4K, 175 idiomas, motion control, viral ad clone.**
- **API pública** (Arcads Pro, MakeUGC API): solo cuando haya demanda inbound.
- **Librería de 1.000+ avatares:** curación > volumen.

### 9.4 Decisiones de pricing sugeridas por el análisis

- **Banda competitiva:** $29–79/mes con free tier o trial barato. Arcads demuestra que $110 de entrada sin trial genera churn inmediato; Tagshop/CreateUGC anclan la entrada en ~$20–29.
- **Unidad de cobro recomendada: vídeo terminado** (simple, como Arcads/Tagshop/CreateUGC), con costes internos gestionados en segundos de fal.ai. Evitar exponer "créditos por segundo por modelo" (Loova): correcto para prosumers, hostil para marketers.
- **Diferenciadores de confianza baratos de construir:** rollover parcial de créditos, regeneración con descuento, preview gratis, refund policy clara — todo lo contrario del patrón de quejas de Trustpilot de Arcads/MakeUGC.
- **Benchmark de coste unitario:** el mercado percibe $11/vídeo (Arcads) como caro y <$1/vídeo (claim Tagshop) como ancla low-cost. Con fal.ai (avatar + TTS + lip-sync ~30 s de vídeo), hay margen sano cobrando $2–5/vídeo efectivo.

### 9.5 Posicionamiento resultante

El hueco competitivo verificado: **"URL → análisis estratégico multifaceta → matriz de anuncios UGC 9:16"**. Tagshop y CreateUGC hacen URL→vídeo pero con análisis superficial (título+beneficios+precio) y sin matriz de ángulos; Arcads tiene la matriz pero sin URL ni análisis; HeyGen tiene calidad de avatar pero energía equivocada para social y sin flujo de producto. Nadie une los tres pasos, y las dos marcas líderes tienen ~3/5 en Trustpilot por promesas infladas y billing agresivo — la vara de "estar a la altura" es más baja de lo que su marketing sugiere.
