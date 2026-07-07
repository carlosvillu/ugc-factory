# 05 — Librerías de prompts para vídeo UGC/ads: diseño de nuestra "galería gigante de prompts"

> Investigación realizada el 2026-07-06. Todos los repos citados fueron **clonados y leídos a nivel de código** (no solo README) en `scratchpad/repos/`. Cada recurso se verificó contra su nombre en `UGC_deep_research.md`; las discrepancias se marcan con ⚠️ y se recogen en la sección 2.

---

## 1. Resumen ejecutivo

- El ecosistema OSS de prompts para vídeo UGC/ads en julio de 2026 tiene **cuatro arquetipos** claramente diferenciados: (1) **README-monolito SEO** (Cliprise: ~33 repos, todo el valor en un solo README por repo), (2) **carpeta de fichas markdown curadas** (HuyLe82US), (3) **dataset JSON + web gallery generada** (renoise-ai, LichAmnesia: `prompts.json` como *single source of truth* + script generador de README), y (4) **CMS propietario que exporta a GitHub + agent skills** (YouMind OpenLab: 14.000+ prompts de imagen y 4.400+ de vídeo Seedance, con `manifest.json` por categorías y un `SKILL.md` que enseña a un agente a buscar/recomendar/remixar).
- La **anatomía de un prompt UGC ganador** está sorprendentemente estandarizada entre librerías: *casting* del avatar + *beats* temporizados (`0-2s / 2-4s / …`) + lenguaje de cámara concreto (no adjetivos) + iluminación + **imperfecciones deliberadas** (poros visibles, autofocus breathing, encuadre imperfecto) + diálogo/hook hablado + **fidelity guards** ("no deformation, drift, or artifacts"; "label stays consistent") + audio implícito + final beat/CTA + restricciones de compliance.
- La **consistencia de personaje** se resuelve hoy con: *identity lock* sobre imagen de referencia, sistema de roles `@image/@video/@audio` de Seedance 2.0, *wardrobe continuity* declarada por CUT, y guards explícitos ("no identity drift", "stable faces").
- Las variables interpolables en el OSS son primitivas (`[brand]`, `[product]`, `___`, `[duration]`); **nadie tiene un sistema tipado de variables**. Ahí está nuestra oportunidad: un modelo de datos con slots tipados que el pipeline de análisis de producto (URL → facetas) rellena automáticamente.
- Riesgo competitivo detectado: **HeyDreaming** (heydreaming.com), el producto detrás de `LichAmnesia/awesome-ad-video-prompts`, hace *exactamente* nuestro pitch: "paste a link, get four scored ad-video variations". Su repo OSS es marketing de contenidos, y su patrón (galería OSS como canal de adquisición) es replicable por nosotros.

---

## 2. Verificación de recursos y discrepancias con `UGC_deep_research.md`

| Recurso citado en el deep research | ¿Existe? | Realidad verificada |
|---|---|---|
| `awesome-ai-ugc-video-prompts` (Cliprise) | ✅ | [github.com/cliprise/awesome-ai-ugc-video-prompts](https://github.com/cliprise/awesome-ai-ugc-video-prompts). ⚠️ Es **un único README** (1.564 líneas) + CHANGELOG; la estructura de carpetas `prompts/`, `workflows/`, `resources/` que aparece dentro es solo "suggested repository structure", **no existe como ficheros**. |
| `awesome-ai-video-ads-prompts` | ✅ | Existe como [cliprise/awesome-ai-video-ads-prompts](https://github.com/cliprise/awesome-ai-video-ads-prompts) (1.776 líneas, mismo formato). ⚠️ El deep research lo citaba sin org. El repo que **mejor encaja** con la descripción ("colección de anuncios con hooks y guiones para varios modelos") es en realidad [LichAmnesia/awesome-ad-video-prompts](https://github.com/LichAmnesia/awesome-ad-video-prompts) (52 prompts, 10 formatos, `prompts.json`). |
| `gracech0322-cmd/seedance-2-prompt-library` | ✅ | [Existe](https://github.com/gracech0322-cmd/seedance-2-prompt-library). ⚠️ No es una "gran librería": es sobre todo una **guía de prompting de 6 dimensiones** + 7 plantillas por estilo (incluida UGC) + workarounds para caras reales. Muy valiosa como doctrina, pobre como dataset. |
| `awesome-seedance-prompts` | ✅ ×2 | ⚠️ Hay **dos repos homónimos** de naturaleza distinta: [HuyLe82US/awesome-seedance-prompts](https://github.com/HuyLe82US/awesome-seedance-prompts) (44 fichas .md en 13 categorías, curator-first con proof clips) y [renoise-ai/awesome-seedance-prompts](https://github.com/renoise-ai/awesome-seedance-prompts) (⚠️ el README dice "290+" pero el dataset real contiene **3.217 JSONs**; además es una web app Next.js completa). |
| YouMind OpenLab (Nano Banana, Seedance, GPT Image) | ✅ | [github.com/YouMind-OpenLab](https://github.com/YouMind-OpenLab). Nano Banana Pro: 10.000+ prompts, 16 idiomas, ~13k stars. GPT Image 2: 2.000+. `awesome-seedance-2-prompts`: **4.488 prompts** (stats del README, actualizado 2026-07-06). ⚠️ Matiz importante: los repos de GitHub son **artefactos generados desde un CMS privado** (`cms-client.ts` contra `CMS_HOST` con API key, vídeos en Cloudflare Stream); el "OSS" es la exportación, no la base de datos viva. El deep research decía "GPT Image 2": correcto (existe repo GPT Image 2 y otro GPT Image 1.5). |
| TikTok Ads Prompt Library (XYZ Lab) | ⚠️ parcial | La URL canónica [xyzlab.com/tiktok-ads-prompt-library](https://xyzlab.com/tiktok-ads-prompt-library/) devuelve **HTTP 404 hoy** y su tienda [stan.store/xyzlab](https://stan.store/xyzlab/p/tiktok-ads-prompt-library) está "under construction". El contenido se verificó solo vía caché de buscador: **40+ prompts, entrega .xlsx**, 4 módulos (Audience Research, Campaign Structure, Video Creation, Reporting & Analysis). Ojo: hay dos dominios distintos, `xyzlab.com` (librerías de prompts) y `xyzlab.co` (plataforma de formación). |
| "TikTok Ads AI Prompt Library – Adzviser" | ⚠️ | Adzviser es un **MCP/data connector de reporting** ([adzviser.com/mcp/tiktok-ads](https://adzviser.com/mcp/tiktok-ads)): sus prompts son de *análisis de campañas*, no de generación de vídeo. No es comparable a nuestra galería creativa. |
| Seedance 2.0 (modelo) | ✅ | Modelo real de ByteDance, primer modelo "quad-modal input" (imagen+vídeo+audio+texto), hasta 1080p y 4–15 s. Disponible vía fal.ai (Fast ≈ $0.03/s, Pro ≈ $0.05/s según comparativas de terceros). Seedance 2.5 está en beta enterprise a julio 2026. |

---

## 3. Análisis detallado por librería

### 3.1 Cliprise: `awesome-ai-ugc-video-prompts` y `awesome-ai-video-ads-prompts`

**Qué son.** La org [cliprise](https://github.com/cliprise) mantiene ~33 repos "awesome-*" que son en realidad una **granja SEO** para cliprise.app (plataforma multi-modelo). Cada repo = un README largo, denso en keywords, con CHANGELOG y sin datos estructurados. A pesar de la motivación SEO, el contenido es **original y de calidad**, especialmente el de UGC.

**Estructura real de ficheros** (verificada tras clonar):

```text
cliprise_awesome-ai-ugc-video-prompts/
  README.md      (1.564 líneas — TODO el contenido)
  CHANGELOG.md
```

**La fórmula de prompt UGC de Cliprise** (el artefacto más reutilizable del repo):

```text
Create a [duration]-second vertical UGC-style video for [product/service].
Audience: [specific audience].
Creator role: [founder / brand creator / product demonstrator / educator / customer-style actor].
Disclosure context if needed: [sponsored/ad/brand demo].
Hook: [first 1 to 3 seconds].
Problem or desire: [what the viewer cares about].
Product moment: [show the product or app clearly].
Demo or proof moment: [visual demonstration, not unsupported claim].
Camera: [handheld but smooth, close-up, phone-style, creator framing].
Setting: [kitchen, bathroom, desk, car, gym, office, store, etc.].
Audio if supported: [natural voice, room tone, music].
CTA: [short and natural].
Restrictions: [no fake claims, no fake testimonials, no fake expert, no distorted hands,
no face warping, no label distortion].
```

**Contenido inventariado del repo UGC:**
- **18 prompts completos** por vertical: meal-planning app, beauty serum, founder AI app, desk organizer, portable blender, budgeting app, fitness, restaurante local, agencia de viajes, curso online, joyería, SaaS, pet product, servicio local, app-store promo, home decor, lead magnet, fashion try-on. Cada uno con bloque "Best for: [plataformas/casos]".
- **Tipología de UGC (6 tipos)**: Founder-style / Product demonstrator / Problem-solution / Educational / Review-style ("use carefully") / App demo.
- **Hook library (8 hooks)**: Problem, Confession, Visual proof, Question, Founder, Product action, Comparison, Time-saving. Ejemplo: `Creator opens with: "I did not realize [problem] was costing me this much time."`
- **CTA library (6 CTAs)** por objetivo: soft product, app, product, lead magnet, course, local service.
- **Negative prompt library por vertical** — oro puro para nuestros "guard packs":

```text
General UGC:   no fake testimonial, no fake review, no fake expert claim, no misleading result,
               no unreadable UI text, no distorted hands, no face warping
Beauty/health: no medical claims, no guaranteed results, no fake before-after,
               no fake dermatologist, no skin distortion, no treatment claims
Finance:       no income guarantees, no fake bank balances, no fake investment returns,
               no real bank logos, no misleading savings claims
App demos:     no fake UI text, no competitor logos, no fake reviews, no fake ratings,
               no distorted screen, no random buttons
```

- **Creative testing matrix** (dimensiones de variación) — directamente mapeable a nuestro generador de variantes:

| Dimensión | Variantes |
|---|---|
| Hook | problem, confession, visual proof, question |
| Creator role | founder, demonstrator, educator, product user-style actor |
| Platform | TikTok, Reels, Shorts, Feed |
| Format | 9:16, 4:5, 1:1 |
| Setting | kitchen, desk, bathroom, gym, living room |
| Product moment | hold, demo, unbox, use, compare |
| CTA | try it, shop now, learn more, get checklist |
| Duration | 6s, 9s, 12s, 15s |

  Con la regla operativa: `3 hooks × 2 creator roles × 2 formats = 12 UGC variants`.

- **QA checklist de 21 puntos** pre-publicación (hook clarity, product early, hands, face stability, label accuracy, safe zone, landing page consistency…).
- **Doctrina de compliance FTC** transversal: "UGC style is not permission to fake real experience". Distingue *testimonial-style como estructura narrativa* (seguro) de *fake customer testimony* (prohibido), con la línea de prompt: `Creator demonstrates the product as an ad concept. Do not present the creator as a real customer and do not include fake personal results.` También: usar **UI abstracta sin texto legible** en demos de apps ("abstract recipe cards without readable fake text") porque el texto generado por IA es ilegible/riesgoso.

**El repo hermano `awesome-ai-video-ads-prompts`** añade la **estructura de anuncio de 6 partes**: `1. Pattern interrupt → 2. Problem or desire → 3. Product moment → 4. Proof or transformation → 5. CTA → 6. Platform-safe final frame`, otros 18 prompts (más orientados a paid social: YouTube in-stream, app install, e-commerce, real estate, music release), una hook library ampliada (Pain, Surprise, Confession, Before/after, Question, Product-in-action, Time-pressure, Scroll-stop visual) y el workflow "AI video ads from one product image" (una imagen → 4 variantes de ad).

**El repo `cliprise/awesome-seedance-2-prompts`** aporta dos piezas clave para nuestro backend sobre fal.ai:

1. **Fórmula image-to-video** (nuestro caso dominante: foto de producto del scraping → vídeo):

```text
Use @image1 as [role: product / character / opening frame / style reference / background].
Preserve [identity, product shape, logo, color, outfit, composition, style].
Create a [duration]-second [aspect ratio] video.
Camera: [one primary movement].
Motion: [subject motion, scene motion, background motion].
Lighting: [preserve or modify lighting].
Audio if supported: [sound direction].
Final beat: [clear final frame].
Restrictions: [what must not change].
```

2. **Sistema de roles de referencia** (evita que el modelo "remixee" las referencias impredeciblemente):

```text
@image1 = character identity reference. Preserve face, hairstyle and outfit.
@image2 = background reference. Use as opening environment and color mood.
@image3 = product reference. Preserve exact product shape and label placement.
@image4 = style reference. Use color grade and lighting only, not composition.
@video1 = camera movement reference. Use the pacing and handheld motion, not the subject.
@audio1 = pacing reference. Sync visual motion to the beat.
```

Y su prompt UGC skincare de referencia, que muestra el estilo "campo: valor":

```text
A creator in a bright bathroom holds a small skincare bottle and shows it to the camera.
Environment: clean bathroom counter, soft daylight, natural home setting.
Camera: handheld but smooth, close-up framing, authentic creator perspective.
Lighting: soft natural daylight, clean skin tones.
Style: UGC-style social ad, casual but polished.
Motion: creator lifts the bottle, turns it slightly toward camera, then gives a subtle approving smile.
Audio if supported: natural room tone and a short spoken hook: "This is the one I actually keep using."
Duration and format: 9 seconds, vertical 9:16.
Restrictions: no fake medical claims, no readable fake label text, no distorted hands,
no face warping, no extra people.
```

**Licencia/ética de reuso**: el README pide explícitamente no copiar la colección tal cual ("Do not copy third-party repositories… prompt collections without permission"). Podemos adoptar **estructura y taxonomía** (no protegibles) y redactar prompts propios.

### 3.2 Librerías Seedance

#### 3.2.1 `gracech0322-cmd/seedance-2-prompt-library` — la doctrina de las 6 dimensiones

Actualizado por última vez 2026-06-12. Su aportación es el **framework de 6 dimensiones** para prompts Seedance 2.0, cada una opcional salvo Content:

| Dimensión | Pregunta clave | Ejemplo |
|---|---|---|
| **Input** | ¿Qué material fuente se usa? | `@Image1 as first frame, @Video1 for camera movement, @Audio1 for background music` |
| **Content** | ¿Qué pasa en la escena? | personaje + escena + acción + mood + líneas de diálogo + SFX |
| **Style** | ¿Qué estética visual/sonora? | visual style, lighting, color tone, texture, atmosphere, music |
| **Camera** | ¿Cómo se filma? | shot size, angle, movement, camera rules, speed. **"Use rules, not adjectives"**: no escribir "cinematic feel", sí "one-take, steady follow shot, transition from medium to close-up" |
| **Structure** | ¿Timeline? | `0–3s… / 3–6s… / 6–10s…` + transiciones + ending (freeze frame / camera stop) |
| **Edit** | ¿Modificar vídeo existente? | 4 tipos: **Extend / Partial Edit / Replace / Re-plot**, p. ej. `Re-plot @Video1. The character picks up the phone instead of walking away… Keep the original cinematic lighting and medium shot camera angle.` |

Su **plantilla UGC** (nótese el sistema de slots `___`):

```text
UGC smartphone video style.
___ (person) recording themselves in ___ (daily place).
They talk about ___ (product / experience).
Natural lighting. Slight handheld camera movement.
End with ___ (casual closing moment).
```

Y su ejemplo real de UGC ad (mínimo viable, de un post de Reddit de r/AI_UGC_Marketing, con imagen de producto de referencia):

```text
engaging ugc ad video of a young white woman in her bathroom talking about how she uses
the reset undereye patches putting them on.
```

**Workarounds de caras reales** (Seedance 2.0 bloquea fotos de caras reales en upload): (1) editar la foto con un editor IA — invalidado desde 2026-03-23; (2) convertir la foto a **line art** — sigue funcionando; (3) **Face Review oficial** de plataformas como SeeGen.AI (~15 s de aprobación). Para editar vídeos con humanos reales: subir screenshot de cara como image reference + vídeo con cara difuminada como video reference + prompt `Replace the dress in @Video1 with the style from @Image2, and swap the person in @Video1 with the face in @Image1. Keep all other details unchanged.` → **Implicación para nosotros**: los flujos de "founder avatar/AI twin" tendrán fricción de moderación según el proveedor del modelo en fal.ai; hay que diseñar el producto asumiendo review de identidad.

#### 3.2.2 `HuyLe82US/awesome-seedance-prompts` — el patrón "ficha curada con proof clip"

44 prompts en ficheros .md dentro de **13 categorías-carpeta**: `01-cinematic-vfx, 02-commercial-product, 03-ugc-social, 04-action-fight, 05-anime-manga, 06-drama-romance, 07-fantasy, 08-horror, 09-sci-fi-cyberpunk, 10-nature-documentary, 11-epic-spectacle, 12-superhero-powers, 13-comedy-meme`. Licencia CC BY 4.0. Contribución solo vía Issues (no PRs) con política de retirada por copyright.

**Anatomía de cada ficha** (transferible a nuestro modelo de datos):

```markdown
# Título
*Descripción de una línea con los "selling points" técnicos.*
[proof clip embebido — vídeo del resultado real]
**Source:** [autor](x.com/...) - [Post](url) · _Created: fecha_
**Prompt:** ```text …```
```

Ejemplo UGC (categoría `03-ugc-social`, nótese la brevedad + control de cámara):

```text
360-degree panoramic camera selfie. The camera rotates counterclockwise, capturing the dessert
shop interior. Then show a woman posing in different scenes, wearing different outfits and
using different props.
```

Y el patrón "template" con guards inline (`10s-boxing-practice-template.md`):

```text
… Shallow depth of field, practical lighting, visceral realism, stable identity.
Duration: 10s. Aspect ratio: 16:9. Photoreal cinematic. Single shot unless specified.
Avoid text, captions, watermarks, logos.
Stress camera movement: smooth parallax, consistent objects, stable faces; no text
```

**Lección**: el *proof clip* (vídeo de ejemplo del resultado) es lo que da confianza en la galería. Sin preview, un prompt no vende.

#### 3.2.3 `renoise-ai/awesome-seedance-prompts` — el mejor modelo de datos OSS encontrado

⚠️ Su README dice "290+", pero el repo contiene **3.217 prompts JSON** en `data/prompts/` + 162 "tips" en `data/tips/` + una **web app Next.js completa** (galería con búsqueda, API de vídeo, OG images) + pipeline CI (`sync-data.yml` diario desde un upstream privado, `validate.ts`, `translate.ts`, `generate-readme.ts` → READMEs en 5 idiomas).

**Schema real** (`src/types/prompt.ts`):

```typescript
export interface Prompt {
  id: string;                 // ID del tweet de origen (clave natural)
  title: string;
  content: string;            // el prompt en idioma original
  description: string;
  language: string;           // 13 idiomas válidos
  author: { name: string; link?: string };
  sourceLink?: string;        // URL del post original (X/Reddit)
  sourcePublishedAt?: string;
  thumbnail?: string;         // requerido en validate.ts
  videoUrl?: string;          // proof clip (self-hosted mirror)
  referenceImages?: string[];
  featured?: boolean;
  tags: string[];
  tips?: string;
  translations?: Record<string, PromptTranslation>;  // {title, content, description, tips}
}
```

`validate.ts` impone: campos requeridos `id, title, content, language, thumbnail`; IDs únicos; idiomas de una lista blanca; URLs http. Es decir: **la calidad del dataset se garantiza con un validador en CI**, patrón que debemos copiar.

**Taxonomía real de tags** (86 únicos, computados sobre los 3.217 JSONs). Top y relevantes para UGC/ads:

```text
2204 Photoreal · 1915 Realistic World · 1624 VFX · 1092 Slow-Mo · 1023 Action · 710 POV
679 Fantasy · 503 Macro · 491 Story · 474 Sports · 457 FPV & Aerial · 425 Portrait & Fashion
323 Transformation · 253 Product Ad · 197 Animals · 166 Heartwarming · 160 Food · 134 Meme & Comedy
126 ASMR · 110 Cooking · 98 F&B · 97 Fashion · 87 Travel Vlog · 66 Tutorial · 63 Luxury
44 Beauty · 43 Influencer · 39 Talk · 33 Model Showcase · 27 GRWM · 22 Tech · 21 Fitness
5 Home · 3 Celeb Parody · 2 Brand Battle
```

Observación clave: los tags mezclan **estética** (Photoreal, Slow-Mo), **género** (Action, Horror), **formato social** (GRWM, Travel Vlog, Influencer, ASMR) y **caso de uso comercial** (Product Ad, Model Showcase). Funciona para browsing pero es **una sola dimensión plana** — en nuestro modelo separaremos facetas (ver §7).

Los `data/tips/*.json` son **notas técnicas de la comunidad** (mismo schema), p. ej. este tip que condensa la práctica de consistencia en Seedance 2.0:

```text
Use the @-mention system to assign roles to each uploaded asset (e.g., @Image1 as first frame,
reference @Video1 for camera movement, use @Audio1 for background music). …
For character consistency, explicitly declare the main character reference in the prompt
(e.g., @Image3 is the main character) to keep face identity consistent across the video.
To recreate a trending creative template, upload the original as @Video1 and prompt to replace
the subject with your own reference image while keeping @Video1's camera work and transitions.
To extend an existing clip, prompt "Extend @Video1 by X seconds"…
For better output quality, use high-quality reference assets (2K/4K images); blurry inputs
produce blurry videos.
```

#### 3.2.4 `LichAmnesia/awesome-ad-video-prompts` — el estándar de "alta artesanía" para prompts de anuncio

52 prompts **originales** (CC BY 4.0) en **10 formatos de anuncio**, mantenido como companion OSS de **HeyDreaming** (competidor: URL de producto → 4 ad videos con scoring). Taxonomía de secciones:

```text
Product Showcase (6) · UGC & Authentic (6) · Before / After (5) · Unboxing & ASMR (5)
Problem → Solution (5) · Lifestyle & Brand (5) · Feature & Explainer (5) · Social & Trend (5)
Luxury & Premium (5) · Food & Beverage (5)
```

Dentro de "Social & Trend" están los formatos virales concretos: `POV Morning Skincare Drop`, `Green-Screen Spec Reveal`, `This Or That Sneaker Split`, `Glow-Up Transformation Whip`, `Expectation Vs Reality Candle`.

**Arquitectura de datos** (la más limpia para un repo pequeño): `prompts.json` como single source of truth → `scripts/generate-readme.mjs` regenera el README → `scripts/image-prompts.json` contiene **prompts de imagen derivados** para generar el póster/preview de cada prompt de vídeo (patrón directamente aplicable: nuestra galería puede autogenerar thumbnails con un modelo de imagen barato en fal.ai antes de gastar en vídeo):

```json
{
  "version": 1,
  "total": 52,
  "sections": [{
    "key": "product-showcase",
    "name": "Product Showcase",
    "brief": "cinematic product showcase / hero beauty shots",
    "prompts": [{
      "title": "Frost-Glass Serum, Condensation Macro",
      "slug": "frost-glass-serum-condensation-macro",
      "prompt": "…",
      "tags": ["skincare", "macro", "condensation", "fog"],
      "duration": "6s",
      "aspect": "9:16"
    }]
  }]
}
```

**Prompt UGC de referencia** (el mejor ejemplo encontrado de anatomía completa en un solo párrafo):

```text
Handheld phone selfie shot into a slightly steamed bathroom mirror, woman early-30s in an
oversized tee, dewy bare skin, no makeup. 0-2s: she leans toward the glass and taps the [brand]
serum bottle against the camera, half-laughing mid-sentence. 2-4s: micro-zoom in as she presses
two drops onto her cheekbone, fingertips spreading in small circles, window light catching the
sheen. 4-6s: she turns her face slowly side to side, raising one eyebrow at her own reflection,
caught genuinely off guard. Warm morning window light, soft skin texture with visible pores,
faint water droplets streaking the mirror. Face shape and skin finish stay consistent across
beats, no deformation, drift, or artifacts. Implied sound: muffled running tap, a quiet
'okay... wow.'
```

Su "How to use" codifica las **tres reglas de artesanía**: (1) sustituir los slots `[product]`/`[brand]`; (2) **conservar el multi-beat timing y el fidelity guard** — "they materially improve output"; (3) para b-roll 9:16, terminar en la marca y **no hornear texto en el vídeo** (subtítulos en post-producción).

### 3.3 YouMind OpenLab — prompts a escala industrial + agent skills

Org: [github.com/YouMind-OpenLab](https://github.com/YouMind-OpenLab). Inventario verificado (julio 2026):

| Repo | Contenido | Escala |
|---|---|---|
| `awesome-nano-banana-pro-prompts` | prompts de imagen (Gemini) con preview | 10.000+, 16 idiomas, ~13k ⭐ |
| GPT Image 2 prompt library | prompts de imagen | 2.000+, ~8.1k ⭐ |
| `awesome-seedance-2-prompts` | prompts de vídeo (cinematic, anime, **UGC**, ads, meme) | **4.488** prompts, 6 featured, ~1.5k ⭐ |
| Grok Imagine prompts | vídeo xAI | pequeño |
| `ai-image-prompts-skill` | **skill de agente** (OpenClaw/Claude Code/Cursor/Codex/Gemini CLI) | 14.687 prompts en 11 categorías |
| `nano-banana-pro-prompts-recommend-skill`, Seedance 2 search skill | skills de recomendación | ~1.7k ⭐ |

**Arquitectura**: CMS privado (Payload-like) → cron de GitHub Actions (2×/día) → genera READMEs multiidioma y JSONs de referencia. El schema interno (`scripts/utils/cms-client.ts` del repo Seedance) revela campos que nuestro modelo debe tener y que los repos simples no tienen:

```typescript
export interface VideoPrompt {
  id: number;
  title: string; content: string; description?: string;
  language: string;
  model: string;                      // ← modelo objetivo del prompt
  featured?: boolean; sort?: number;  // ← curación editorial
  author?: { name: string; link?: string };
  sourceLink?: string; sourcePublishedAt?: string;
  translatedContent?: string;
  sourceVideos?: Array<{ url: string; thumbnail?: string }>;
  videos?: Array<{ cloudflareStream?: {...}; poster?: {...} }>;  // ← hosting propio de proof clips
  results?: { docs: Array<{ video?: {...}; model?: { slug?: string } }> };
                                      // ← ¡resultados del MISMO prompt en VARIOS modelos!
  referenceImages?: Array<...>; sourceReferenceImages?: string[];
  media?: Array<...>;
}
```

El campo `results.docs[].model.slug` es la idea más avanzada del ecosistema: **un prompt canónico con N ejecuciones registradas por modelo**, que permite comparar Seedance vs Veo vs Kling con el mismo prompt.

**El patrón "agent skill"** (`ai-image-prompts-skill/SKILL.md`) define cómo un LLM debe consumir la galería:

- `references/manifest.json` con categorías **dinámicas** por caso de uso: `profile-avatar (1.813), social-media-post (9.169), infographic-edu-visual (585), youtube-thumbnail (214), comic-storyboard (593), product-marketing (5.376), ecommerce-main-image (548), game-asset (662), poster-flyer (881), app-web-design (221), others (1.081)`.
- Registro por prompt minimalista: `{id, title, content, description, sourceMedia[], needReferenceImages}` — el flag booleano `needReferenceImages` distingue prompts text-to-X de los que requieren asset del usuario.
- Reglas operativas para el agente: **nunca cargar el fichero entero** (grep por keywords), **máximo 3 recomendaciones**, **jamás presentar un prompt sin su sample image** ("images are the core value"), primero recomendar plantillas *exactas* de la librería y solo después **remix** con los datos del usuario (flujo en dos fases: select → personalize), fallback explícito "AI-generated, not from library" cuando no hay match, y footer de atribución obligatorio.

**Ejemplo de prompt UGC de élite del dataset Seedance de YouMind** ("Smartphone Vlog Aesthetic Idol Video") — merece estudio porque estructura el prompt por **secciones nombradas**, incluida la continuidad de vestuario por corte:

```text
Style: Photorealistic behind-the-scenes smartphone vlog footage… No cinematic color grading,
no HDR look, no 3D render, no beauty filters.
Lighting: …natural exposure fluctuations and auto white balance typical of smartphone cameras.
Camera: Simulated smartphone camera filmed by another person. Gentle handheld movement, subtle
autofocus breathing, slight rolling shutter during quick pans, occasional imperfect framing,
brief focus hunting and realistic phone compression.
Skin: Extremely realistic skin texture with visible pores and natural imperfections. No skin smoothing.
Physics: Hair, clothing, towels, food, steam… move naturally with realistic weight.
Continuity: Maintain the exact same face, hair, body proportions and identity from the reference
image throughout every scene. No identity drift.
Technical: Authentic 24–30fps smartphone video look with subtle compression artifacts.
Audio: Natural apartment ambience only… No background music. No subtitles.
Wardrobe Continuity: CUT 1 She arrives wearing the exact outfit from the reference image…
CUT 2 She changes into an oversized white graphic T-shirt… [outfit declarado por cada CUT]
CUT 1 — Coming Home … Dialogue: "I'm home." [8 CUTs con acción + diálogo cada uno]
```

### 3.4 Librerías comerciales (XYZ Lab y similares)

- **TikTok Ads Prompt Library (XYZ Lab)** — [xyzlab.com/tiktok-ads-prompt-library](https://xyzlab.com/tiktok-ads-prompt-library/) (⚠️ 404 a fecha de hoy; verificado vía caché). Producto: **40+ prompts en .xlsx** (compatible Google Sheets), copy-paste hacia ChatGPT/Claude, entrega por email tras compra. Módulos: **Audience Research** (ICP, interest & behaviour targeting, lookalikes), **Campaign Structure** (arquitectura por objetivo, testing vs scaling), **Video Creation** (hooks, scripts, voiceovers, "UGC-style scripts", trending audio briefs, text-overlay frameworks) y **Reporting & Analysis** (análisis de exports de Ads Manager, resúmenes "client-ready", detección de creative fatigue). XYZ Lab vende librerías paralelas de [Meta Ads](https://xyzlab.com/meta-ads-prompt-library/) y [Content Creation](https://xyzlab.com/content-prompt-library/).
- **Lección de mercado**: el formato .xlsx sin preview ni versionado es débil frente a una galería web con proof clips; pero su **cobertura del funnel completo** (research → estructura → creativo → reporting) es más amplia que la de cualquier repo OSS, que solo cubre "creativo". Nuestro producto ya cubre research (análisis de URL) + creativo; reporting es una extensión natural.
- **Adzviser** ([adzviser.com/mcp/tiktok-ads](https://adzviser.com/mcp/tiktok-ads)) — no es una librería creativa: es un MCP connector de datos de campañas para agentes (45+ fuentes). Relevante solo como pieza futura de "data flywheel" (leer performance para re-rankear prompts).
- **PromptBase** — prompts sueltos de TikTok ads a ~$3-7/unidad; señal de que hay *willingness to pay* por prompts individuales, pero sin estructura.
- **HeyDreaming** ([heydreaming.com](https://heydreaming.com)) — comercial, citado aquí porque su repo OSS (§3.2.4) revela su playbook: cada prompt de la galería OSS enlaza a `heydreaming.com/prompts/<slug>` ("Generate this into a scored ad video") = **la galería como funnel de adquisición SEO con página indexable por prompt**.

---

## 4. Taxonomía consolidada de categorías (síntesis cross-librería)

Ninguna librería usa una taxonomía multi-eje; todas aplanan. Consolidando las cuatro fuentes, para UGC ads emergen **cinco facetas ortogonales**:

**Faceta 1 — Formato/escena UGC** (qué se ve):
`testimonial-style` (⚠️ siempre como estructura, no como testimonio real), `product-in-hand`, `unboxing`, `asmr`, `pov`, `selfie-talking-head`, `mirror-selfie`, `car-vlog`, `grwm` (get-ready-with-me), `day-in-life / vlog`, `try-on`, `demo / product-in-use`, `app-screen-demo`, `before-after`, `problem-solution`, `founder-explainer`, `educational / tutorial`, `green-screen`, `this-or-that`, `expectation-vs-reality`, `glow-up-transformation`, `street-interview` (visto en ecosistema comercial), `lifestyle-broll`, `product-showcase / hero` (no-UGC, complementario).

**Faceta 2 — Hook/ángulo** (por qué paras el scroll) — consolidada de las hook libraries de Cliprise + deep research:
`pain-point`, `confession`, `question`, `unpopular-opinion` (⚠️ citado en el deep research y en playbooks; en los repos analizados NO existe como categoría, solo como tipo de hook), `visual-proof`, `before-after`, `founder-origin`, `product-action`, `comparison`, `time-saving`, `time-pressure/urgency`, `surprise`, `life-hack`, `social-proof`.

**Faceta 3 — Vertical de producto**: beauty/skincare, food & beverage, fashion/apparel, fitness, home/decor, pets, apps/SaaS, fintech, educación/cursos, servicios locales, viajes, joyería, electrónica. (Cliprise y LichAmnesia demuestran que el prompt cambia sustancialmente por vertical: guard packs y settings distintos.)

**Faceta 4 — Plataforma/placement**: TikTok (Spark-ads-native), Instagram Reels, YouTube Shorts, Facebook Feed/Reels, YouTube in-stream — con implicaciones concretas de safe zones, duración y tono documentadas en Cliprise.

**Faceta 5 — Estética/técnica**: photoreal, smartphone-camera-look, dv-camcorder-retro, cinematic, macro, slow-mo, stop-motion… (la dimensión dominante en los tags de renoise-ai).

---

## 5. Anatomía de un buen prompt de vídeo UGC (síntesis normativa)

Componentes presentes en los mejores prompts de las cuatro fuentes, en orden recomendado:

1. **Declaración de estilo + anti-estilo**: `UGC smartphone video style` + negaciones explícitas de polish: `No cinematic color grading, no HDR look, no beauty filters, no skin smoothing`.
2. **Casting del avatar**: edad aproximada, género, etnia si es relevante para el match de audiencia, vestuario, energía/personalidad, y **rol honesto** (founder / demonstrator / educator / "customer-style actor") — el rol es la palanca de compliance.
3. **Escenario cotidiano con anclas visuales**: bathroom con espejo empañado, cocina con luz de día, coche aparcado, escritorio desordenado. 2-3 anclas máximo.
4. **Beats temporizados** (multi-beat timing): `0-2s: hook físico + frase; 2-4s: producto en acción; 4-6s: reacción/outcome`. Todas las librerías de más calidad lo usan; LichAmnesia afirma que mejora materialmente el output. Para Seedance el equivalente es la dimensión **Structure** (`0–3s / 3–6s…`) o CUTs numerados.
5. **Cámara con reglas, no adjetivos**: `handheld but smooth`, `arm's-length selfie`, `phone clamped to dashboard`, `20–28mm handheld phone perspective`, `micro-zoom`, `snap-pan`, `one-take, no cuts`.
6. **Iluminación motivada**: `warm morning window light`, `golden hour raking sideways`, `candle as key + window-blue rim`.
7. **Imperfecciones deliberadas** (la firma del realismo UGC): `visible pores`, `dewy bare skin, no makeup`, `chipped ceramic mug`, `slight handheld shake`, `autofocus breathing`, `focus hunting`, `rolling shutter during quick pans`, `imperfect framing`, `auto white balance`, `mild highlight clipping`, `24–30fps smartphone look with subtle compression artifacts`.
8. **Diálogo/hook hablado** entrecomillado y corto: `"I had chicken, rice and no idea what to cook."` — con lip-sync natural declarado si el modelo lo soporta.
9. **Momento de producto con fidelidad**: producto pronto y claro + `label clearly readable` cuando interesa, o `abstract cards, no readable fake text` para UI de apps.
10. **Fidelity guards** (cierre técnico obligatorio): `Face shape and skin finish stay consistent across beats, no deformation, drift, or artifacts` / `Bottle keeps consistent label, cap, and shape` / `stable identity, stable faces` / `no extra fingers, no distorted hands, no face warping, no flicker`.
11. **Audio implícito**: `Implied sound: muffled running tap, a quiet 'okay... wow.'` — room tone + un SFX característico + reacción vocal.
12. **Final beat + CTA natural**: `Final beat: product centered in a clean hero frame` + CTA hablado no corporativo.
13. **Formato**: `9 seconds, vertical 9:16` (6–15 s; 6-10 s recomendado para primeras generaciones).
14. **Guard pack de compliance por vertical** (§3.1): médico/financiero/testimonial según categoría del producto.

---

## 6. Técnicas de consistencia de personaje entre escenas

Catálogo completo de técnicas encontradas, ordenadas de menor a mayor complejidad:

1. **Guard textual**: incluir `stable identity`, `no identity drift`, `maintain the same character throughout` en el prompt. Barato, imperfecto, siempre recomendable.
2. **Identity lock sobre imagen de referencia**: `Reference image = strict identity lock… Same face, skin tone, eyes, nose, lips, facial structure, hair, body proportions — recognizably the same person across all panels. Do NOT replace her with…`. Es el patrón dominante en prompts image-to-video.
3. **Sistema de roles `@asset` (Seedance 2.0)**: declarar `@Image3 is the main character` y asignar un rol único a cada referencia (identidad / producto / fondo / estilo / movimiento de cámara). Sin roles, el modelo remezcla referencias impredeciblemente. En fal.ai esto se mapea a los campos de reference images del endpoint correspondiente.
4. **Wardrobe/scene continuity por CUT**: declarar outfit y estado del personaje **en cada corte** (`CUT 1: uniforme del reference image → CUT 2: camiseta oversize…`). Evita que el modelo "reinvente" el vestuario en cada escena y permite cambios narrativos controlados.
5. **Contact sheet / storyboard de 9 paneles**: generar UNA imagen con 9 paneles del mismo personaje (con identity lock) y usar los paneles como first frames de cada clip — técnica vista en el dataset renoise-ai para series multi-escena.
6. **Edit-ops sobre vídeo existente**: `Extend @Video1 by Xs` (misma identidad garantizada por continuidad), `Replace [A] with [B]… keep character consistency`, `Re-plot @Video1… keeping the original character`. Reutilizar un clip aprobado como semilla de variantes es más consistente que regenerar.
7. **Plantilla viral por transferencia**: subir el vídeo de referencia como `@Video1` y pedir `replace the subject with your own reference image while keeping @Video1's camera work and transitions` — consistencia de formato + identidad propia.
8. **Assets de alta resolución**: "use high-quality reference assets (2K/4K images); blurry inputs produce blurry videos" — la consistencia empieza en la calidad del reference.
9. **Gates de moderación de caras reales**: line-art workaround / Face Review oficial (§3.2.1) — a considerar para la feature "clona al founder".

Para nuestro producto: la combinación práctica es **(avatar persistente como reference image generada por nosotros con Nano Banana Pro/Seedream) + roles @asset + guards + wardrobe continuity declarativa**, con el avatar guardado como entidad reutilizable entre anuncios (ver §7).

---

## 7. Variables interpolables: estado del arte y propuesta

Lo que existe: `[brand]`, `[product]` (LichAmnesia); `[duration]`, `[aspect ratio]`, `[specific audience]`, `[creator role]`… (Cliprise, como fórmula documentada, no ejecutable); `___ (person)`, `___ (daily place)` (gracech0322); `○○` (prompts japoneses). **Nadie tipa las variables ni las conecta a datos de producto.**

Nuestra ventaja: el análisis IA de la URL produce exactamente las entidades que los prompts necesitan. Propuesta de **conjunto canónico de variables** con tipo y fuente:

| Variable | Tipo | Fuente |
|---|---|---|
| `{product.name}` / `{product.category}` | string / enum | scraping + clasificador |
| `{product.hero_image}` | asset(image) | scraping → `@image` product reference |
| `{benefit.primary}`, `{benefit[n]}` | string | análisis de beneficios |
| `{pain_point}` | string | análisis de objeciones/pains |
| `{objection}` + `{rebuttal}` | string | análisis de objeciones |
| `{persona.age_range}`, `{persona.descriptor}`, `{persona.setting}` | enum/string | análisis de audiencia |
| `{avatar.ref}` | asset(image) | entidad Avatar (identity lock) |
| `{hook.line}` | string | Hook library × ángulo |
| `{cta.line}` | string | CTA library × objetivo |
| `{claim.safe}` | string | generador de claims con guardrails |
| `{platform}`, `{aspect}`, `{duration}` | enum | configuración de campaña |
| `{setting}` | enum | matriz de testing |

Regla de render: sintaxis `{namespace.field}` con validación de que todos los slots requeridos del template quedan resueltos antes de encolar la generación en fal.ai (equivalente programático al `needReferenceImages` de YouMind: cada template declara sus dependencias).

---

## 8. Modelo de datos propuesto para la galería

Diseño que sintetiza lo mejor de cada fuente: schema JSON versionable (renoise-ai/LichAmnesia), curación editorial y multi-modelo (YouMind), facetas limpias (§4), slots tipados (§7) y guard packs (Cliprise).

### 8.1 Entidades

```typescript
// ── Núcleo ──────────────────────────────────────────────────────────
interface PromptTemplate {
  id: string;                        // ULID
  slug: string;                      // "bathroom-mirror-skincare-truth" → URL pública SEO
  title: string;
  description: string;               // 1 línea, para cards y para retrieval del agente
  kind: "video" | "image" | "script" | "voiceover";  // la galería no es solo vídeo
  body: string;                      // texto con slots {…}; para vídeo multi-escena: por beats
  beats?: Array<{ tStart: number; tEnd: number; action: string; dialogue?: string; camera?: string }>;
                                     // opcional: forma estructurada de los beats (render → body)
  variables: VariableSpec[];         // slots tipados declarados (ver §7)
  assetSlots: Array<{ name: string; role: "product"|"character"|"background"|"style"|"camera_motion"|"audio";
                      required: boolean }>;   // sistema @asset / needReferenceImages generalizado
  guardPackIds: string[];            // negative prompts / restricciones componibles
  defaults: { duration_s: number; aspect: "9:16"|"1:1"|"16:9"|"4:5"; resolution?: string };
  // Facetas (§4) — arrays de refs a taxonomías controladas:
  format: string[];                  // faceta 1: "product-in-hand", "grwm", "unboxing"…
  hookAngles: string[];              // faceta 2: "pain-point", "confession", "unpopular-opinion"…
  verticals: string[];               // faceta 3: "beauty", "saas", "food-beverage"…
  platforms: string[];               // faceta 4: "tiktok", "reels", "shorts"…
  aesthetics: string[];              // faceta 5: "photoreal", "smartphone-look", "macro"…
  freeTags: string[];                // long tail no controlada (estilo renoise-ai)
  // Curación y procedencia (estilo YouMind/renoise):
  status: "draft" | "review" | "published" | "deprecated";
  featured: boolean; sort?: number;
  license: "original" | "cc-by-4.0" | "community-sourced";
  author?: { name: string; link?: string };
  sourceLink?: string; sourcePublishedAt?: string;   // atribución si viene de comunidad
  language: string;
  translations?: Record<string, { title: string; body: string; description: string }>;
  compliance: { testimonialStyle: boolean; requiresDisclosure: boolean; restrictedVerticals: string[] };
  createdAt: string; updatedAt: string;
}

interface VariableSpec {
  name: string;                      // "hook.line"
  type: "string" | "enum" | "number" | "asset:image" | "asset:audio";
  required: boolean;
  source: "product_analysis" | "audience_analysis" | "hook_library" | "cta_library" | "user" | "campaign";
  enumValues?: string[];
  example: string;                   // para preview de la galería sin datos reales
}

// ── Versionado (git-like, inmutable) ────────────────────────────────
interface PromptVersion {
  templateId: string;
  version: number;                   // el template apunta a headVersion
  body: string; beats?: …; guardPackIds: string[];
  changelog: string;
  createdBy: string; createdAt: string;
}
// Toda generación referencia templateId@version → reproducibilidad y comparación A/B entre versiones.

// ── Composición reutilizable ────────────────────────────────────────
interface GuardPack {                // negative-prompt library de Cliprise, componible
  id: string;                        // "guard.ugc.general", "guard.vertical.beauty", "guard.fidelity.product"
  scope: "general" | "vertical" | "fidelity" | "platform";
  lines: string[];                   // ["no fake testimonial", "no distorted hands", …]
}

interface HookLine { id: string; angle: string; text: string;  // "I did not realize {pain_point} was costing me…"
                     verticals: string[]; stats?: PerfStats }
interface CtaLine  { id: string; objective: "app_install"|"purchase"|"lead"|"visit"; text: string }

interface Avatar {                   // consistencia de personaje (§6)
  id: string; name: string;
  demographics: { ageRange: string; gender?: string; ethnicity?: string; style: string };
  personality: string;               // "graceful, soft-spoken" — se inyecta en casting
  referenceImages: string[];         // identity lock, ≥2K
  voiceId?: string;                  // voz TTS asociada (fal.ai / ElevenLabs)
  wardrobeNotes?: string;
  ownerId: string;                   // avatares de sistema vs del cliente (founder twin)
}

// ── Ejecución y flywheel ────────────────────────────────────────────
interface ModelProfile {             // adaptación por modelo de fal.ai
  id: string;                        // "fal:seedance-2.0-pro"
  falEndpoint: string;
  capabilities: { maxDuration: number; refImages: number; refVideos: number; audioIn: boolean;
                  dialogue: boolean; aspect: string[] };
  promptAdapter: string;             // reglas de reescritura del body canónico → dialecto del modelo
  costPerSecond: number;
}

interface GenerationResult {         // el results.docs[] de YouMind, generalizado
  id: string;
  templateId: string; templateVersion: number;
  modelProfileId: string;
  resolvedPrompt: string;            // prompt final tras interpolación (auditable)
  inputs: Record<string, string>;    // valores usados por slot
  videoUrl: string; thumbnailUrl: string;   // proof clip — hosting propio (Cloudflare Stream/R2)
  qa: { handsOk?: boolean; labelOk?: boolean; identityOk?: boolean; notes?: string };  // checklist §3.1
  score?: number;                    // scoring interno (patrón HeyDreaming)
  perf?: PerfStats;                  // hook-rate, CTR… si el usuario conecta ads (flywheel)
  createdAt: string;
}

interface PerfStats { impressions?: number; hookRate?: number; ctr?: number; cvr?: number; sampleSize: number }
```

### 8.2 Relaciones

```text
PromptTemplate 1─N PromptVersion
PromptTemplate N─N GuardPack (componibles por scope)
PromptTemplate N─N {Format, HookAngle, Vertical, Platform, Aesthetic} (facetas controladas)
PromptTemplate 1─N GenerationResult ─N ModelProfile   (mismo prompt, varios modelos → comparador)
Campaign/AdVariant → (PromptTemplate@version, Avatar, HookLine, CtaLine, inputs)  // receta reproducible
Avatar 1─N GenerationResult (trazabilidad de identidad)
```

### 8.3 Decisiones de arquitectura (justificadas por lo observado)

1. **Fichero JSON versionado en git como formato de intercambio + DB como runtime.** El patrón `prompts.json → generator` (LichAmnesia/renoise) es perfecto para seed data, revisión por PR y export OSS; la DB (Postgres + jsonb para facetas) sirve búsqueda, curación y stats. Validador estilo `validate.ts` en CI (campos requeridos, IDs únicos, slots resolubles, guard packs existentes).
2. **Preview obligatorio**: ningún template pasa a `published` sin `thumbnailUrl` (imagen generada barata vía patrón `image-prompts.json`) y deseablemente un proof clip. "Images are the core value" (YouMind).
3. **Prompt canónico model-agnostic + `ModelProfile.promptAdapter`**: los prompts de las librerías son ~90% transferibles entre Seedance/Veo/Kling; lo específico (sintaxis @asset, límites de duración, dialogue support) vive en el adapter, no en el template.
4. **Galería consumible por agentes**: exportar `manifest.json` + ficheros por categoría + un SKILL.md interno con las reglas de YouMind (grep, top-3, select-then-remix). Nuestro propio pipeline de generación es "el agente" que consume la galería.
5. **Página pública por prompt** (`/prompts/<slug>` con proof clip y CTA "generate for your product") = motor SEO demostrado por HeyDreaming y YouMind.

---

## 9. Implicaciones para el PRD

1. **Seed de la galería (semana 1)**: construible legalmente combinando (a) taxonomía y fórmulas propias inspiradas en las estructuras analizadas, (b) los 52 prompts CC BY 4.0 de LichAmnesia como referencia de artesanía (con atribución), (c) redacción propia de ~100-200 templates UGC cubriendo la matriz formato × hook × vertical. **No copiar** los prompts de Cliprise (prohibición explícita) ni datasets community-sourced sin atribución.
2. **El prompt template debe ser estructurado, no un string**: campos separados (casting, setting, beats, cámara, luz, imperfecciones, guards, audio, CTA) que se compilan a texto por modelo. Esto habilita la matriz de variantes (`3 hooks × 2 roles × 2 formats = 12 variantes`) cambiando UN campo por variante — exactamente el workflow de hook-testing que el mercado demanda.
3. **Guard packs como sistema de compliance de primera clase**: por vertical (beauty/finanzas/salud) y por defecto anti-fake-testimonial (rol del avatar = "creator-style actor/demonstrator", nunca "customer"). Es diferenciador frente a competidores y reduce riesgo de rechazo en TikTok/Meta y de violaciones FTC.
4. **Los beats temporizados y fidelity guards no son opcionales**: deben inyectarse automáticamente en todo prompt de vídeo (mejoran materialmente el output según todas las fuentes). El compilador de prompts debe añadir `no deformation, drift, or artifacts` + preservación de label/product + `stable identity` siempre.
5. **Avatar como entidad persistente** con reference images ≥2K, técnica identity-lock y wardrobe continuity; planificar la fricción de moderación de caras reales (Face Review) para la feature "founder twin".
6. **Registrar cada generación como `GenerationResult` con prompt resuelto, modelo y coste** desde el día 1: habilita el comparador multi-modelo (idea YouMind), el scoring (idea HeyDreaming) y el futuro flywheel con datos de ads (hueco de mercado señalado en el deep research §7.2).
7. **Texto en vídeo: no hornear overlays** — subtítulos y text-overlays en post-producción (regla unánime); UI de apps siempre "abstract, no readable fake text".
8. **fal.ai**: Seedance 2.0 (Fast/Pro), Veo 3.1, Kling 3.0 disponibles; diseñar `ModelProfile` para mapear el sistema @asset a los campos de reference del endpoint concreto y presupuestar ~$0.03-0.05/s (Seedance) en el pricing.
9. **La galería es también canal de adquisición**: página pública indexable por prompt + posible repo OSS "awesome-*" companion (playbook HeyDreaming/Cliprise/YouMind, los tres lo explotan).
10. **Gap que podemos ocupar**: nadie une (análisis de producto → variables tipadas → galería facetada → generación multi-modelo → scoring). Cada pieza existe por separado en el ecosistema; la integración es el producto.

---

## Apéndice: fuentes

**Repos clonados y analizados** (en `scratchpad/repos/`):
[cliprise/awesome-ai-ugc-video-prompts](https://github.com/cliprise/awesome-ai-ugc-video-prompts) · [cliprise/awesome-ai-video-ads-prompts](https://github.com/cliprise/awesome-ai-video-ads-prompts) · [cliprise/awesome-ai-tiktok-video-prompts](https://github.com/cliprise/awesome-ai-tiktok-video-prompts) · [cliprise/awesome-seedance-2-prompts](https://github.com/cliprise/awesome-seedance-2-prompts) · [cliprise/awesome-nano-banana-pro-prompts](https://github.com/cliprise/awesome-nano-banana-pro-prompts) · [gracech0322-cmd/seedance-2-prompt-library](https://github.com/gracech0322-cmd/seedance-2-prompt-library) · [HuyLe82US/awesome-seedance-prompts](https://github.com/HuyLe82US/awesome-seedance-prompts) · [renoise-ai/awesome-seedance-prompts](https://github.com/renoise-ai/awesome-seedance-prompts) · [LichAmnesia/awesome-ad-video-prompts](https://github.com/LichAmnesia/awesome-ad-video-prompts) · [YouMind-OpenLab/awesome-seedance-2-prompts](https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts) · [YouMind-OpenLab/ai-image-prompts-skill](https://github.com/YouMind-OpenLab/ai-image-prompts-skill) · [YouMind-OpenLab/nano-banana-pro-prompts-recommend-skill](https://github.com/YouMind-OpenLab/nano-banana-pro-prompts-recommend-skill)

**Web**: [YouMind-OpenLab org](https://github.com/YouMind-OpenLab) · [YouMind Seedance gallery](https://youmind.com/en-US/seedance-2-0-prompts) · [XYZ Lab TikTok Ads Prompt Library](https://xyzlab.com/tiktok-ads-prompt-library/) (404 al fetch directo; contenido vía caché de buscador) · [XYZ Lab Meta Ads](https://xyzlab.com/meta-ads-prompt-library/) · [stan.store/xyzlab](https://stan.store/xyzlab/p/tiktok-ads-prompt-library) (under construction) · [Adzviser TikTok Ads MCP](https://adzviser.com/mcp/tiktok-ads) · [HeyDreaming](https://heydreaming.com) · [fal.ai/explore/models](https://fal.ai/explore/models) · comparativas de modelos jul-2026: [teamday.ai](https://www.teamday.ai/blog/best-ai-video-models-2026), [buildfastwithai.com](https://www.buildfastwithai.com/blogs/seedance-2-5-vs-veo-3-1-vs-kling-3-0-best-ai-video-2026)
