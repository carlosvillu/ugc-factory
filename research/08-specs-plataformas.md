# 08 — Especificaciones y buenas prácticas de TikTok e Instagram Reels para anuncios UGC (julio 2026)

> Investigación para el PRD de la plataforma "URL de producto → análisis IA → anuncio de vídeo UGC (guion, avatar, voz, render 9:16)" con fal.ai como backend de generación.
>
> Alcance: formatos técnicos, safe zones, duración óptima por objetivo, estilos nativos de caption, Spark Ads (TikTok), Advantage+ y Partnership Ads (Meta), políticas de contenido IA y etiquetado obligatorio, benchmarks de hook-rate/CTR, diferencias TikTok vs Reels, e implicaciones directas para los presets de export y metadatos del producto.
>
> Todas las afirmaciones llevan cita. Cuando la fuente es un blog de terceros (no documentación oficial de TikTok/Meta) se indica. Fecha de la investigación: 6 de julio de 2026.

---

## 1. Resumen ejecutivo

1. **Un único master 9:16 a 1080×1920 (o 1440×2560 para Meta) sirve para ambas plataformas**, pero las *safe zones* difieren: TikTok ocupa sobre todo el lateral derecho (iconos de engagement) y la banda inferior (~480 px); Meta unificó en marzo de 2026 la safe zone de Stories y Reels (14 % arriba, 20–35 % abajo, 6 % laterales). La intersección de ambas define un "área segura universal" de ~875×980 px centrada-alta dentro del frame 1080×1920.
2. **Duración óptima**: TikTok recomienda oficialmente 21–34 s para performance ads y hook en los primeros 3 s; en Reels el sweet spot práctico es 15–30 s con hook en los primeros 2–3 s. Para hook-testing masivo, la industria trabaja con variantes de 8–15 s.
3. **Ambas plataformas exigen ya divulgación de contenido IA en ads**: TikTok con un toggle obligatorio "This ad contains AI-generated content" en Ads Manager (etiqueta AIGC visible; el ad se rechaza si se detecta AIGC no declarado) y Meta con etiqueta "AI info" + detección automática (a partir de junio 2026 también para herramientas third-party en ads SIEP). El producto **debe** emitir metadatos C2PA y flags de disclosure junto con cada vídeo.
4. **Regulación externa**: la FTC Rule on Consumer Reviews and Testimonials (vigente desde octubre 2024) prohíbe testimonios generados por IA que se presenten como experiencias reales de consumidores; el EU AI Act (Art. 50) obliga desde el **2 de agosto de 2026** a marcar el contenido sintético (multas de hasta 15 M€ o 3 % de facturación). Esto condiciona los tipos de guion que el producto puede generar por defecto ("testimonial" es la categoría de mayor riesgo).
5. **Benchmarks**: hook rate (3-second views/impressions) bueno ≥ 25–30 % en Meta; thumbstop en TikTok (2s views/impressions) aceptable 50–60 %; CTR medio de TikTok ads orientados a conversión ~0,84 % (bueno: 0,8–1,5 %); CPM TikTok mediano ~13 $ vs ~14 $ en Meta (2026, en convergencia). UGC-style supera consistentemente al creative pulido (hasta 3–4× CTR según fuente).
6. **TikTok = alcance barato y descubrimiento; Reels/Meta = conversión y ROAS**, especialmente en tickets > 50 $. Los números exactos de la investigación previa (3,4×/2,1×/+19 %/+24 %/+31 %) **no son trazables a ninguna fuente pública verificable** — la dirección es correcta, las cifras concretas no deben citarse en el PRD.
7. Los formatos publicitarios "nativos UGC" de cada plataforma (Spark Ads en TikTok, Partnership Ads en Meta) requieren cuentas/códigos de autorización de un perfil real. Un vídeo 100 % IA de nuestra plataforma se publicará normalmente como **non-Spark In-Feed Ad** (TikTok) o ad normal de Advantage+ (Meta), salvo que el cliente lo publique primero como orgánico en su propio perfil — flujo que conviene documentar en el producto.

---

## 2. TikTok: especificaciones técnicas de anuncios In-Feed

### 2.1 Specs oficiales (Auction In-Feed Ads)

Fuente oficial: [TikTok Ads Manager — Auction In-Feed Ads specs](https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads).

**Non-Spark Ads (vídeo subido directamente a Ads Manager):**

| Parámetro | Valor oficial |
|---|---|
| Aspect ratio recomendado | 9:16 vertical (soporta también 16:9 y 1:1) |
| Resolución mínima | 540×960 px (9:16); 960×540 (16:9); 640×640 (1:1) |
| Resolución recomendada por la industria | 1080×1920 px |
| Formatos | .mp4, .mov, .mpeg, .3gp, .avi |
| Duración | hasta 10 minutos |
| Tamaño de fichero | ≤ 500 MB |
| Bitrate | ≥ 516 kbps (mínimo técnico; en la práctica exportar a 8–12 Mbps) |
| Brand name | máx. 20 caracteres (alfabeto latino), 10 en CJK; una sola línea |
| Ad caption (descripción) | texto blanco, fuente uniforme no personalizable; **no** admite links clicables, `@` ni hashtags; límite práctico ~100 caracteres latinos |
| Foto de perfil (opcional) | 98×98 px 1:1, .jpg/.png, < 50 KB, elementos clave en los 66×66 px centrales |

**Spark Ads (post orgánico promocionado):** formatos .mp4/.mov, duración "sin restricciones", el caption se extrae del post orgánico (máx. 4 líneas visibles, emojis permitidos) y **no puede editarse una vez autorizado** ([TikTok help — captions Spark Ads](https://ads.tiktok.com/help/article/about-captions-and-translations-for-spark-ads)).

Nota práctica: aunque el máximo es 10 min, TikTok y todos los playbooks de performance recomiendan vídeos cortos; ver §4.

### 2.2 Safe zones de TikTok

TikTok publica plantillas descargables de safe zone en su Business Help Center (versiones LTR y RTL, con y sin anchor) — [TikTok In-Feed specs](https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads). Las medidas concretas más citadas por las guías 2026 para un canvas 1080×1920 ([Zeely](https://zeely.ai/blog/tiktok-safe-zones/), [TikAdSuite](https://tikadsuite.com/blog/tiktok-ad-safe-zones/), [EzUGC](https://www.ezugc.ai/blog/tiktok-safe-zones-guide)):

| Zona | Margen a evitar (1080×1920) | UI que la ocupa |
|---|---|---|
| Superior | ~130–150 px | barra de estado, "Following / For You", search |
| Inferior | ~480–500 px | username, caption del ad, CTA button, música, barra de navegación |
| Derecha | ~140 px | avatar, like, comment, share, disco de música |
| Izquierda | ~44–64 px | margen de recorte entre dispositivos |

**Área útil resultante: banda central de ~896×1290 px, desplazada hacia arriba.** El texto de hook debe ir en el centro visual del frame — es la única región garantizada en todos los dispositivos ([Zeely](https://zeely.ai/blog/tiktok-safe-zones/)).

Implicación: el CTA "burned-in" del vídeo no debe ir pegado abajo (lo tapa el caption + CTA button del propio ad); debe colocarse en el tercio medio.

### 2.3 Audio

- 93 % de los usuarios de TikTok consumen con sonido activado; los ads mudos están fuertemente penalizados en rendimiento ([Benly specs guide](https://benly.ai/learn/tiktok-ads/tiktok-video-specs), blog).
- **Música**: las cuentas Business y los anuncios solo pueden usar la **Commercial Music Library (CML)** (~1 M de pistas licenciadas para uso comercial) o música con licencia propia; el catálogo general/trending sounds **no** está licenciado para uso comercial ([TikTok CML User Terms](https://www.tiktok.com/legal/page/global/commercial-music-library-user-terms/en), [TikTok Support](https://support.tiktok.com/en/business-and-creator/creator-and-business-accounts/commercial-use-of-music-on-tiktok)). Además, los "Commercial Sounds" solo pueden usarse en los placements listados como "Usable Placements" — usarlos fuera de TikTok (p. ej. reutilizar el mismo render en Reels) requiere licencia aparte.
- Implicación directa: nuestro producto debe generar **música/beds propios (generados por IA o royalty-free)**, nunca depender de sonidos de la plataforma, porque el mismo MP4 se exporta a ambas plataformas.

---

## 3. Instagram Reels: especificaciones técnicas de anuncios

### 3.1 Specs oficiales (Meta Ads Guide)

Fuente oficial: [Facebook Ads Guide — Video en Instagram Reels](https://www.facebook.com/business/ads-guide/update/video/instagram-reels):

| Parámetro | Valor oficial |
|---|---|
| Aspect ratio | 9:16 |
| Resolución recomendada | **1440×2560 px** (mínimo 500 px de ancho para vídeos ≥ 30 s) |
| Formatos | MP4, MOV |
| Compresión | H.264, píxeles cuadrados, frame rate fijo, escaneo progresivo |
| Audio | AAC estéreo, ≥ 128 kbps |
| Duración | 0 s a 15 min según la Ads Guide (ver nota abajo) |
| Tamaño máximo | 4 GB |
| Primary text | máx. ~44 caracteres visibles antes de truncar |
| Música | **los ads no pueden usar música licenciada comercial**; Meta recomienda audio original o su Sound Collection royalty-free |

**Nota sobre duración**: la Ads Guide oficial admite hasta 15 min en el placement Reels (objetivo awareness), pero múltiples guías operativas 2026 tratan **90 s como el tope práctico de delivery para Reels ads** y 15–30 s como sweet spot de rendimiento ([Get-Ryze](https://www.get-ryze.ai/blog/facebook-ad-sizes-complete-specs-guide-for-2026), [Jon Loomer](https://www.jonloomer.com/meta-video-ad-length-requirements/)). Para nuestro caso de uso (UGC ads de 15–40 s) la discrepancia es irrelevante: exportar siempre ≤ 60 s.

### 3.2 Safe zones de Meta (Stories + Reels unificadas, marzo 2026)

En **marzo de 2026 Meta consolidó las safe zones de Facebook/Instagram Stories y Reels en una única safe zone 9:16**: un solo asset vertical funciona en ambos placements sin recortes distintos ([Billo — Meta Ads Safe Zones 2026](https://billo.app/blog/meta-ads-safe-zones/), corroborado por [Lucid Media](https://www.lucidmedia.co.nz/blog/instagram-facebook-ad-safe-zones-2026/) y [AdNabu](https://blog.adnabu.com/meta-ads/meta-safe-zones/); la regla porcentual coincide con la Ads Guide oficial).

Regla oficial de la Ads Guide: dejar libre **≥ 14 % arriba, ≥ 35 % abajo (20 % para Stories-only) y ≥ 6 % a cada lado**.

| Canvas | Top (14 %) | Bottom (35 %) | Laterales (6 %) | Área segura |
|---|---|---|---|---|
| 1080×1920 | ~269 px | ~672 px | ~65 px | ~950×979 px |
| 1440×2560 | ~358 px | ~896 px | ~87 px | ~1266×1306 px |

La banda inferior de Reels es mayor que la de TikTok porque acumula: username, primary text, CTA button, iconos y la barra de audio. Ads Manager incluye un **"Safe Zone Guardrail"**: overlay de zonas seguras/inseguras en la preview del ad durante el setup ([Billo](https://billo.app/blog/meta-ads-safe-zones/)).

### 3.3 Safe zone universal (TikTok ∩ Meta) para un solo master

Intersección de ambas plataformas sobre 1080×1920 (cálculo propio a partir de §2.2 y §3.2):

- Top: **270 px** (manda Meta)
- Bottom: **672 px** (manda Meta)
- Izquierda: **65 px** (manda Meta)
- Derecha: **140 px** (manda TikTok)
- **Área segura universal resultante: ~875×978 px** (centro-superior del frame)

Esto debe ser un overlay/guía en el editor del producto y una restricción de layout para el motor de captions.

---

## 4. Duración óptima por objetivo

Datos oficiales y de benchmarks:

- **TikTok (oficial)**: recomienda creativos de **21–34 s** para performance ads, con la propuesta de valor en los **primeros 3 s** (mejor recall) y el hook completo en los primeros 6 s ([TikTok — Creative best practices](https://ads.tiktok.com/help/article/creative-best-practices)). El 63 % de los ads con mejor CTR presentan el producto en los primeros 3 s (dato TikTok citado por [MB adv](https://www.mbadv.agency/tiktok-ads/creative-best-practices)).
- **TikTok (spec page histórica)**: sugiere vídeos cortos de 9–15 s para engagement en subasta.
- **Meta/Reels**: mantener el ad **< 15 s** con hook de movimiento en los primeros 2 s (guía "designed for Reels"); sweet spot práctico 15–30 s ([Get-Ryze](https://www.get-ryze.ai/blog/facebook-ad-sizes-complete-specs-guide-for-2026), [Vizup](https://www.tryvizup.com/blog/meta-ad-specs-2026-every-dimension-size-you-need)).
- **Señal de calidad TikTok**: que ≥ 40 % de las impresiones alcancen los 6 s de visionado predice mejor conversión ([Dataslayer](https://www.dataslayer.ai/blog/tiktok-ads-reporting-metrics-dashboards-2025)).

**Tabla de presets de duración propuesta (síntesis):**

| Objetivo | TikTok | Reels | Estructura |
|---|---|---|---|
| Hook testing / awareness | 8–15 s | 6–15 s | hook (0–3 s) + 1 beneficio + CTA |
| Conversión estándar (UGC pitch) | 21–34 s | 15–30 s | hook (0–3 s) → value prop (3–15 s) → proof/demo (15–25 s) → CTA (últimos 5 s) |
| Storytelling / objeciones | 35–60 s | 30–60 s | hook → problema → 2–3 objeciones → CTA |

---

## 5. Estilo nativo de captions/subtítulos

Lo que hace que un anuncio "parezca UGC nativo" en 2026:

- **Subtítulos burned-in** (hardcoded en el vídeo): mejoran watch time y completion —señales primarias del algoritmo— y garantizan legibilidad sin depender del reproductor ([Blitzcut](https://blitzcutai.com/blog/auto-captions-vs-manual-captions-tiktok), [OpusClip](https://www.opus.pro/blog/tiktok-caption-subtitle-best-practices)).
- **Chunks de 3–7 palabras por pantalla**, máx. ~2 líneas, sincronizados con el habla; legibles a velocidad de scroll ([OpusClip](https://www.opus.pro/blog/tiktok-caption-subtitle-best-practices)).
- **Estilo tipográfico nativo TikTok**: bold, blanco con contorno/sombra negra (o negro sobre blanco), imitando el estilo "classic" del editor nativo. La fuente **TikTok Sans está publicada en Google Fonts** (licencia abierta), por lo que el producto puede embeberla legalmente en el render para lograr look 100 % nativo ([Google Fonts — TikTok Sans](https://fonts.google.com/specimen/TikTok+Sans)). Para Reels, el estilo nativo equivalente son las caption-styles de Instagram (bold blanco, fondo tipo "pill" translúcido).
- **Posición**: bloque de captions en el centro/tercio medio-bajo del frame pero **siempre dentro de la safe zone universal** (§3.3) — nunca sobre la zona del CTA/caption del sistema ni bajo los iconos de la derecha ([Sleepy Motion](https://sleepymotion.com/blog/captions-best-practices-for-captions-on-tiktok-instagram-and-more-p8me)).
- **Auto-captions de plataforma**: TikTok genera captions automáticos (~85–90 % de precisión); si un Spark Ad ya lleva captions burned-in idénticos, el sistema filtra el duplicado ([TikTok help — captions Spark Ads](https://ads.tiktok.com/help/article/about-captions-and-translations-for-spark-ads)). Con burned-in de calidad no dependemos de esa precisión.
- El ad caption del sistema (texto blanco no personalizable en TikTok; ~44 chars visibles en Reels) es un campo de metadatos aparte que nuestro producto también debería generar (ver §12).

---

## 6. TikTok Spark Ads: requisitos y funcionamiento

Spark Ads = promocionar un post orgánico (propio o de un creador) como ad, conservando engagement orgánico. Fuentes: [About Spark Ads](https://ads.tiktok.com/help/article/spark-ads), [Spark Ads creation guide](https://ads.tiktok.com/help/article/spark-ads-creation-guide), [Insense](https://insense.pro/blog/tiktok-spark-ads).

**Flujo de autorización (video code / Spark code):**
1. El creador (o la cuenta de la marca) activa `Settings → Creator tools → Ad settings`.
2. En el vídeo concreto: `⋯ → Ad settings → Ad authorization ON` → elegir ventana de autorización (**7, 30, 60 o 365 días**) → `Generate code`.
3. El código (string alfanumérico, un código **por vídeo**, no por cuenta) se entrega al advertiser, que lo introduce en Ads Manager (`Assets → Creative → Spark Ads posts`).

**Restricciones clave:**
- Máx. 10.000 Spark Ads por cuenta de Ads Manager.
- El caption no puede editarse tras autorizar; expira la autorización → el ad deja de servir.
- El vídeo debe cumplir las Community Guidelines y Advertising Policies (incluida la política AIGC, §8.1).

**Rendimiento (por qué importa)**: datos TikTok/industria — completion rate +134 % vs In-Feed estándar, engagement +142 %, CTR ~1,8 % vs ~1,1 % de ads normales, CPA 28–35 % menor ([Amra & Elma](https://www.amraandelma.com/tiktok-spark-ads-statistics/), [Benly](https://benly.ai/learn/tiktok-ads/tiktok-spark-vs-regular-ads); cifras de blogs que citan benchmarks internos de TikTok — tratar como orden de magnitud).

**Implicación para nuestro producto**: un vídeo generado por IA solo puede ser Spark Ad si antes se publica como orgánico en un perfil TikTok real (normalmente el de la marca) y se genera su código. El producto debería: (a) exportar el MP4 + caption listos para publicación orgánica, (b) documentar el flujo de Spark code, y (c) recordar el toggle AIGC (§8.1).

---

## 7. Meta: Advantage+ y Partnership Ads

### 7.1 Advantage+ (sales campaigns + creative)

- "Advantage+" es la familia de automatización de **Meta** (Facebook + Instagram a la vez; no es un producto "de Instagram" como sugiere la investigación previa). Las campañas se llaman **Advantage+ sales campaigns** (antes "Advantage+ shopping campaigns") ([Bir.ch guide](https://bir.ch/blog/advantage-plus-sales-campaigns-guide), [AdNabu](https://blog.adnabu.com/facebook/meta-advantage-plus-sales-campaigns/)).
- Desde comienzos de 2026, las campañas nuevas de Sales/Leads/App Promotion arrancan con los **Advantage+ creative enhancements activados por defecto** (mejoras automáticas: recortes, música, overlays, variaciones de texto, animación de imágenes) ([AdMove](https://www.admove.ai/blog/meta-advantage-creative-best-practices-for-2026), blog — verificar en Ads Manager al implementar).
- Con el ranking **Andromeda**, la palanca principal ya no es el targeting sino el **volumen y diversidad de creativos**: los playbooks 2026 recomiendan alimentar cada campaña con 10–50 assets y refrescarlos cada 2–4 semanas, con mix que incluye 30–40 % UGC ([AdMove](https://www.admove.ai/blog/meta-advantage-creative-best-practices-for-2026), [OptiFOX](https://optifox.in/blog/meta-ads-best-practices-2026/); blogs). **Esto es exactamente el caso de uso de nuestro producto: generar variantes UGC en volumen.**
- 9:16 vertical es el formato prioritario de todo el inventario Meta 2026.

### 7.2 Partnership Ads (el "Spark Ads" de Meta)

- Partnership Ads (evolución de branded content ads) permiten publicar ads desde el handle de un creador con permiso. Requisitos: cuenta Professional del creador, permiso explícito content-level (con o sin ad code) o account-level ([Instagram Help — eligibility](https://help.instagram.com/1372533836927082)).
- Cambios 2026 reportados por prensa del sector: Meta exige formato Partnership Ads para **todo contenido de creador con compensación** (pagado, gifted o afiliado); correr "UGC-style ads" simulando contenido orgánico de creador sin la etiqueta se clasifica como *Deceptive Practice* (rechazo + penalización de account health), y el whitelisting requiere re-verificación de consentimiento cada 90 días ([ContentGrip](https://www.contentgrip.com/meta-branded-content-rules-update/), [Social Native](https://www.socialnative.com/articles/meta-partnership-ads-updates-how-brands-can-capitalize-in-2026/); blogs — validar contra Branded Content Policies oficiales antes del PRD final).
- Matiz importante para nosotros: un avatar IA **no es un creador** — los ads generados por nuestra plataforma publicados desde la cuenta del anunciante no necesitan Partnership Ads; lo que sí necesitan es el disclosure de IA (§8.2). El riesgo aparece si el ad **simula ser un testimonio de una persona real** (§8.3).

---

## 8. Políticas de contenido generado por IA y etiquetado obligatorio

### 8.1 TikTok

**Contenido orgánico** ([TikTok Newsroom, sept. 2023](https://newsroom.tiktok.com/en-us/new-labels-for-disclosing-ai-generated-content)):
- Obligatorio etiquetar contenido "completamente generado o significativamente editado por IA" que muestre imágenes/audio/vídeo realistas (synthetic media policy). Label manual del creador + detección automática.
- TikTok integró **C2PA Content Credentials** (primera gran plataforma, 2024-2025): el contenido con metadatos C2PA se **auto-etiqueta como AIGC** al subirse ([AuditSocials](https://www.auditsocials.com/blog/tiktok-ai-content-disclosure-rules-2026), blog; la integración C2PA es anuncio oficial de TikTok de mayo 2024).

**Ads** ([TikTok Ads — ad disclaimers](https://ads.tiktok.com/help/article/about-ad-disclaimers-in-tiktok-ads-manager), [TikTok Ads — misleading content policy](https://ads.tiktok.com/help/article/tiktok-ads-policy-misleading-and-false-content)):
- Existe un **toggle de self-disclosure "This ad contains AI-generated content"** a nivel de ad en Ads Manager; aplica a imágenes/vídeo/audio completamente generados por IA o material real modificado significativamente por IA. Genera una **etiqueta AIGC visible** en el ad.
- El toggle **no puede desactivarse** tras el submit (solo cambiando el creativo); duplicar campañas lo resetea.
- **Si TikTok detecta AIGC no declarado, el ad se rechaza o restringe.**
- El contenido creado con la suite propia **TikTok Symphony** (Creative Studio, Digital Avatars — avatares de actores licenciados, voiceover en 30+ idiomas) se etiqueta como IA automáticamente y pasa revisiones de seguridad ([TikTok Newsroom — Symphony](https://newsroom.tiktok.com/en-us/tiktok-symphony-updates), [TikTok For Business](https://ads.tiktok.com/business/en/blog/tiktok-symphony-ai-creative-suite)). Symphony es además **el competidor first-party de nuestro producto** — gratis dentro de Ads Manager, con generación Seedance integrada ([Symphony Creative Studio](https://ads.tiktok.com/creative/creativestudio/home/en)).
- Adicional para TikTok Shop: [AI-Generated Content Restrictions](https://seller-us.tiktok.com/university/essay?knowledge_id=491489038501663) impone requisitos propios a AIGC en contenido de e-commerce.

### 8.2 Meta

- **Etiqueta "AI info"** (antes "Made with AI", renombrada en 2024): se aplica a contenido orgánico y ads creados/editados significativamente con IA; para ads generados con las herramientas generativas propias de Meta (Advantage+ creative) el etiquetado es **automático** ([Meta Help — AI en ads](https://www.meta.com/help/artificial-intelligence/355108217670024/), [Meta Transparency Center](https://transparency.meta.com/governance/tracking-impact/labeling-ai-content/)).
- **Ads SIEP (social issues, elections, politics)**: divulgación **obligatoria** cuando el ad contiene imagen/vídeo fotorrealista o audio realista creado o alterado digitalmente (incluye herramientas third-party) que muestre a personas reales haciendo/diciendo algo que no hicieron, personas/eventos realistas inexistentes, o footage alterado. Incumplir → rechazo del ad; reincidencia → penalizaciones ([Meta SIEP policy](https://transparency.meta.com/policies/ad-standards/SIEP-advertising/SIEP/), [Social Media Today](https://www.socialmediatoday.com/news/metas-new-disclosure-requirements-digitally-altered-ad-content/704266/)).
- **Desde el 1 de junio de 2026 Meta usa detección automática** para identificar media de ads creado/editado con herramientas GenAI de terceros ([About Meta — midterms 2026](https://about.fb.com/news/2026/02/meta-prepares-for-2026-us-midterms/)). Guías del sector 2026 reportan que la autodeclaración de IA en Ads Manager es ya requisito general (no solo SIEP) y que el "Undisclosed AI Content" se ha convertido en causa relevante de rechazo de ads ([AdAmigo](https://www.adamigo.ai/blog/meta-ai-disclosure-rules-advertisers-know), [CineRads](https://www.cinerads.com/blog/ai-ugc-facebook-ad-policy); blogs — el detalle exacto del enforcement para ads comerciales no-SIEP debe verificarse en el Help Center al implementar).
- Meta detecta IA en imágenes también vía metadatos estándar (IPTC/C2PA) acordados con la industria — otra razón para emitir provenance metadata correcto.

### 8.3 Regulación externa (aplica al producto, no solo a las plataformas)

- **FTC — Rule on Consumer Reviews and Testimonials** (16 CFR 465, vigente desde 21-oct-2024): prohíbe crear, comprar o difundir **testimonios de consumidores falsos, incluidos los generados por IA**, que aparenten ser de una persona real con experiencia real del producto. No prohíbe avatares/virtual influencers per se, pero un "UGC ad" donde un avatar IA afirma *"compré este producto y me cambió la vida"* sin disclosure es exactamente el patrón prohibido. Agencias y proveedores de estas creatividades **también son responsables** ([FTC press release](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials), [FTC Q&A](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers), [Sidley](https://datamatters.sidley.com/2024/08/30/u-s-ftcs-new-rule-on-fake-and-ai-generated-reviews-and-social-media-bots/)).
- **EU AI Act, Art. 50** (transparencia, aplicable desde el **2 de agosto de 2026**): los proveedores de sistemas que generen contenido sintético deben **marcar los outputs como generados artificialmente en formato machine-readable** (Art. 50(2)) y los deployers deben divulgar deepfakes (Art. 50(4)); los deepfakes en publicidad comercial **no** se benefician del carve-out artístico. Sanciones hasta 15 M€ o 3 % de facturación mundial. Hay un Code of Practice on Transparency en borrador (icono interino "AI"/"IA") ([Art. 50 — AI Act](https://artificialintelligenceact.eu/article/50/), [Comisión Europea — Code of Practice](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content), [Kirkland & Ellis](https://www.kirkland.com/publications/kirkland-alert/2026/02/illuminating-ai-the-eus-first-draft-code-of-practice-on-transparency-for-ai)).
- Conclusión: **como "provider/deployer" que genera vídeo sintético para campañas en la UE, nuestro producto tiene obligaciones legales propias de marcado (C2PA/watermark) además de las de las plataformas.**

---

## 9. Benchmarks de creatividades UGC (hook rate, CTR, CPM)

Definiciones estándar de la industria (métricas custom sobre Ads Manager):

- **Hook rate** = 3-second video plays ÷ impressions ([Motion metrics](https://help.motionapp.com/en/articles/8991407-motion-metrics-for-meta-and-tiktok), [Vaizle](https://insights.vaizle.com/hook-rate-hold-rate/)).
- **Thumbstop rate (TikTok)** = 2-second views ÷ impressions.
- **Hold rate** = ThruPlays (15 s) ÷ 3-second views.

**Benchmarks 2025–2026** (blogs de performance; rangos, no verdades absolutas):

| Métrica | Malo | Aceptable | Bueno | Excelente | Fuente |
|---|---|---|---|---|---|
| Hook rate Meta (3 s/impr.) | < 20 % | 20–25 % | 25–30 % | > 30–40 % | [Billo](https://billo.app/blog/hook-rate-to-hold-rate/), [AdManage](https://admanage.ai/blog/what-is-a-good-hook-rate-for-facebook-ads) |
| Thumbstop TikTok (2 s/impr.) | < 50 % | 50–60 % | 60–65 % | > 65 % | [Dataslayer](https://www.dataslayer.ai/blog/tiktok-ads-reporting-metrics-dashboards-2025) |
| CTR TikTok (conversión) | < 0,5 % | ~0,84 % (media) | 0,8–1,5 % | > 1,5 % | [Triple Whale](https://www.triplewhale.com/blog/tiktok-benchmarks), [MB adv](https://www.mbadv.agency/tiktok-ads/metrics-and-costs) |
| 6-second views TikTok | < 20 % impr. | — | ≥ 40 % impr. | — | [Dataslayer](https://www.dataslayer.ai/blog/tiktok-ads-reporting-metrics-dashboards-2025) |
| CPM TikTok | — | ~13,26 $ mediana 2026 (+16 % YoY) | 6–10 $ | < 6 $ | [MB adv](https://www.mbadv.agency/tiktok-ads/metrics-and-costs) |
| CPM Meta | — | ~14,19 $ mediana | 8–14 $ (Reels) | — | [MB adv](https://www.mbadv.agency/tiktok-ads/metrics-and-costs), [Stackmatix](https://www.stackmatix.com/blog/tiktok-ads-vs-instagram-ads-2026) |

**UGC vs creative pulido**: UGC-style logra ~3–4× CTR y ~50 % menos CPC que brand ads pulidos; los TikTok ads con contenido de creador logran +26 % ROAS ([Showcase UGC stats](https://www.showca.se/post/ugc-statistics), [Influee](https://influee.co/blog/tiktok-ugc), [Stackmatix](https://www.stackmatix.com/blog/tiktok-ugc-ads-strategy); blogs).

**Práctica de hook-testing**: generar 3–5 hooks por cuerpo de anuncio y cortar a las 24–48 h los que no superen el umbral de hook rate — coherente con el playbook descrito en la investigación previa.

---

## 10. TikTok vs Instagram Reels: diferencias de rendimiento

Síntesis de los datos 2026 disponibles ([Stackmatix](https://www.stackmatix.com/blog/tiktok-ads-vs-instagram-ads-2026), [MB adv](https://www.mbadv.agency/tiktok-ads/metrics-and-costs), [AdCreate](https://adcreate.com/blog/instagram-reels-vs-tiktok-which-for-video-ads); blogs):

| Dimensión | TikTok | Instagram Reels |
|---|---|---|
| CPM | ~6–10 $ (mediana global ~13 $, subiendo +16 % YoY) | ~8–14 $ (mediana Meta ~14 $) |
| CPC / tráfico | más barato | más caro |
| CTR de formatos nativos | Spark Ads ~2,4× CTR vs in-feed estándar | Partnership Ads ~+13 % CTR vs ads estándar |
| Conversión / ROAS e-commerce | menor CVR media; fuerte en < 50 $ e impulso | mayor CVR y ROAS, especialmente ticket > 50 $ |
| Rol típico en funnel | descubrimiento, awareness, hook-testing barato | conversión, retargeting, ROAS predecible |
| Demografía fuerte | 16–30 | 25–45 |

- La brecha de CPM **se está cerrando** (TikTok +16 % YoY en 2025–26): la ventaja de coste de TikTok es real pero decreciente ([MB adv](https://www.mbadv.agency/tiktok-ads/metrics-and-costs)).
- La recomendación operativa de la investigación previa (TikTok/Spark para awareness; Meta/Advantage+ para conversión) **queda confirmada direccionalmente** por múltiples fuentes independientes.
- **Las cifras concretas del deep research (3,4× views, 2,1× menor coste por impresión, +19 % CTR, +24 % ATC, +31 % AOV para Reels) no aparecen en ninguna fuente pública localizable** — no citarlas en el PRD (ver §13).

---

## 11. Estrategia creativa nativa que el generador debe imitar

Patrones que definen "nativo" en 2026 y que el motor de generación debe implementar como reglas:

1. **Hook en 0–3 s** con pattern interrupt (pregunta, afirmación polémica, resultado antes/después, producto en mano) — TikTok oficial ([Creative best practices](https://ads.tiktok.com/help/article/creative-best-practices)).
2. **Look handheld/selfie**: cámara frontal, luz natural, encuadre imperfecto; el avatar habla a cámara ("talking head UGC").
3. **Captions burned-in estilo nativo** (§5) sincronizados palabra a palabra o por chunks.
4. **Sonido siempre**: voz en primer plano + bed musical propio (nunca trending sounds sin licencia, §2.3).
5. **CTA hablado + CTA en texto** en el tercio medio, últimos 3–5 s.
6. **Estructura Hook → Value → Proof → CTA** (secuencias 0-3/3-15/15-25/25-34 s).
7. **Variantes por ángulo de venta** (pain point, life hack, unpopular opinion, demo, comparativa) — el análisis multi-faceta de la URL del producto alimenta directamente esta matriz.

---

## 12. Implicaciones para el PRD

### 12.1 Presets de export (motor de render)

**Preset master universal (por defecto):**
- MP4, H.264 High Profile, píxeles cuadrados, escaneo progresivo, frame rate fijo 30 fps.
- 1080×1920 (9:16); ofrecer variante 1440×2560 para Meta como opción "HQ" (es la resolución recomendada oficial de Reels).
- Vídeo 8–12 Mbps VBR; audio AAC estéreo ≥ 128 kbps (Meta lo exige como mínimo); loudness objetivo ≈ −14 LUFS (normalización de plataformas).
- ≤ 500 MB (límite TikTok; el de Meta, 4 GB, nunca se alcanzará).
- Duraciones preset por objetivo: **Hook test 8–15 s / Conversión 21–34 s (TikTok) y 15–30 s (Reels) / Story 35–60 s** (§4). Cap duro de export: 60 s.

**Safe zones como constraint de layout (no solo overlay):**
- Modo "universal": todo texto/CTA/logo dentro del área ~875×978 px (top 270, bottom 672, left 65, right 140 sobre 1080×1920).
- Modos por plataforma: TikTok (top 130, bottom 484, right 140, left 44) y Meta unified 9:16 (14 %/35 %/6 %).
- El editor debe mostrar overlays de safe zone conmutables (TikTok / Reels / Universal), replicando el "Safe Zone Guardrail" de Meta.

**Motor de captions:**
- Estilo nativo por plataforma: TikTok Sans (Google Fonts, embebible) con blanco+contorno negro; estilo "pill" para Reels.
- Chunks de 3–7 palabras, máx. 2 líneas, posicionados en el tercio medio dentro de safe zone; sincronización con timestamps del TTS (fal.ai devuelve audio→ usar forced alignment o timestamps del modelo de voz).

### 12.2 Metadatos y compliance (diferenciador de producto)

1. **Provenance obligatorio**: firmar cada export con **C2PA Content Credentials** ("digitalSourceType: trainedAlgorithmicMedia"). Efecto: TikTok auto-etiqueta AIGC (cumplimiento pasivo), Meta lo detecta vía metadatos, y cumplimos EU AI Act Art. 50(2) como provider (aplicable 2-ago-2026). Verificar qué metadatos emite fal.ai por modelo y añadir la firma C2PA en nuestro pipeline de post-procesado si falta.
2. **Checklist de publicación por plataforma** adjunto a cada export (JSON + UI):
   - TikTok: `aigc_disclosure: true` → recordar activar el toggle "This ad contains AI-generated content" (el ad se rechaza si se detecta sin declarar); música = solo la pista generada/licenciada incluida; si va como Spark Ad → flujo de video code (7/30/60/365 días).
   - Meta: flag "AI-generated" en Ads Manager; nunca marcar como Partnership Ad (no hay creador real); si el anunciante es SIEP → disclosure obligatorio reforzado.
3. **Guardrails de guion (FTC/EU)**: el generador de scripts debe tener un modo por defecto que evite testimonios en primera persona falsos ("I bought this…") o los reformule como demostración/beneficios ("This does X…"), y una opción de disclosure visible ("AI-generated presenter") cuando el usuario elija el ángulo "testimonial". Documentar en ToS que el cliente es responsable del uso, pero recordar que **agencias/proveedores también son responsables bajo la FTC rule**.
4. **Metadatos de campaña exportables**: junto al MP4, generar `ad_caption` (≤ 100 chars TikTok, sin @/#/links; ≤ 44 chars visibles Meta), `brand_name` (≤ 20 chars), hook label, ángulo, duración, objetivo recomendado y plataforma destino — listos para pegar en Ads Manager o push via API.

### 12.3 Producto / roadmap

- **Variantes por plataforma como feature de primera clase**: mismo guion → dos renders (timing de hook, safe zone, caption style y duración ajustados por plataforma), no un único fichero "para todo".
- **Métricas creativas nativas**: instrumentar hook rate, thumbstop, hold rate y 6s-view como vocabulario del producto (targets: hook ≥ 30 % Meta, thumbstop ≥ 60 % TikTok, ≥ 40 % impresiones a 6 s) para cerrar el loop generación→performance.
- **Posicionamiento vs Symphony**: TikTok regala Symphony Creative Studio (avatares + Seedance) dentro de Ads Manager. Nuestro diferencial debe ser: multi-plataforma (TikTok+Meta con un clic), análisis profundo de la URL del producto (ángulos/objeciones), control de marca, y compliance multi-jurisdicción — no "generar un vídeo con avatar", que ya es commodity first-party.
- **Volumen para Advantage+**: Meta pide 10–50 creativos por campaña y refresh cada 2–4 semanas → el pricing/packaging debe soportar lotes de variantes (matriz hooks × ángulos × avatares), no vídeos unitarios.

---

## 13. Discrepancias detectadas respecto a `UGC_deep_research.md`

1. **Estadísticas TikTok vs Reels sin fuente verificable**: las cifras "3,4× más visualizaciones, 2,1× menor coste por impresión, +19 % CTR, +24 % add-to-cart, +31 % AOV" (§2 del deep research, cita [4]) no aparecen en ninguna fuente pública localizable mediante búsqueda extensiva (julio 2026). La *dirección* (TikTok más barato/alcance; Reels mejor conversión/AOV) sí está corroborada por múltiples fuentes independientes, pero esos multiplicadores concretos deben tratarse como no verificados y no citarse en el PRD.
2. **"Advantage+ de Instagram"**: Advantage+ es la suite de automatización de **Meta** (Facebook e Instagram conjuntamente), y la nomenclatura actual es "Advantage+ sales campaigns" (no campañas de Instagram). Matiz de naming relevante para el PRD.
3. **Afirmación implícita de que las creatividades IA se publican igual que cualquier UGC**: hoy ambas plataformas exigen disclosure explícito de AIGC en ads (toggle TikTok; label/flag Meta) y hay detección automática con rechazo del ad como enforcement; el deep research no menciona ninguna obligación de etiquetado, que es un requisito de producto crítico.
4. **Spark Ads**: el deep research los presenta solo como "impulsar publicaciones de creadores"; falta el detalle operativo (código por vídeo, ventanas de autorización 7/30/60/365 días, caption no editable, límite 10.000/cuenta) y el hecho de que un vídeo 100 % IA necesita publicarse primero como orgánico para poder ser Spark Ad.
5. **No verificado en esta investigación (fuera de mi alcance temático)**: la existencia real de los repos/modelos citados en el deep research (Open-AI-UGC, "Happy Horse 1", Prizmad MCP, YouMind OpenLab, etc.) corresponde a otro research track; el nombre de modelo "Happy Horse 1" y la afirmación de "10.000 prompts en 16 idiomas" tienen apariencia de baja fiabilidad y deben verificarse antes de usarse.

---

## 14. Fuentes principales

**Oficiales:**
- TikTok Ads Manager — Auction In-Feed Ads specs: https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads
- TikTok Ads Manager — About Spark Ads / creation guide: https://ads.tiktok.com/help/article/spark-ads · https://ads.tiktok.com/help/article/spark-ads-creation-guide
- TikTok Ads Manager — Ad disclaimers (toggle AIGC): https://ads.tiktok.com/help/article/about-ad-disclaimers-in-tiktok-ads-manager
- TikTok Ads Manager — Captions y Spark Ads: https://ads.tiktok.com/help/article/about-captions-and-translations-for-spark-ads
- TikTok — Creative best practices: https://ads.tiktok.com/help/article/creative-best-practices
- TikTok Newsroom — AI labels: https://newsroom.tiktok.com/en-us/new-labels-for-disclosing-ai-generated-content
- TikTok Newsroom / For Business — Symphony: https://newsroom.tiktok.com/en-us/tiktok-symphony-updates · https://ads.tiktok.com/business/en/blog/tiktok-symphony-ai-creative-suite
- TikTok — Commercial Music Library User Terms: https://www.tiktok.com/legal/page/global/commercial-music-library-user-terms/en
- Meta Ads Guide — Instagram Reels video: https://www.facebook.com/business/ads-guide/update/video/instagram-reels
- Meta Help — AI en ads: https://www.meta.com/help/artificial-intelligence/355108217670024/
- Meta Transparency Center — Labeling AI content / SIEP: https://transparency.meta.com/governance/tracking-impact/labeling-ai-content/ · https://transparency.meta.com/policies/ad-standards/SIEP-advertising/SIEP/
- Instagram Help — Partnership ads eligibility: https://help.instagram.com/1372533836927082
- FTC — Reviews & Testimonials Rule: https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials · https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers
- EU AI Act Art. 50: https://artificialintelligenceact.eu/article/50/ · https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content
- Google Fonts — TikTok Sans: https://fonts.google.com/specimen/TikTok+Sans

**Sectoriales/blogs (usados para benchmarks y safe zones en px; fiabilidad media):**
- Billo (safe zones Meta 2026, hook rate): https://billo.app/blog/meta-ads-safe-zones/ · https://billo.app/blog/hook-rate-to-hold-rate/
- Zeely / TikAdSuite / EzUGC (safe zones TikTok px): https://zeely.ai/blog/tiktok-safe-zones/ · https://tikadsuite.com/blog/tiktok-ad-safe-zones/
- MB adv (benchmarks CPM/CTR TikTok 2026): https://www.mbadv.agency/tiktok-ads/metrics-and-costs
- Triple Whale (benchmarks TikTok por industria): https://www.triplewhale.com/blog/tiktok-benchmarks
- Dataslayer (thumbstop/6s views): https://www.dataslayer.ai/blog/tiktok-ads-reporting-metrics-dashboards-2025
- Stackmatix (TikTok vs Instagram 2026): https://www.stackmatix.com/blog/tiktok-ads-vs-instagram-ads-2026
- AdMove / AdNabu / Bir.ch (Advantage+ 2026): https://www.admove.ai/blog/meta-advantage-creative-best-practices-for-2026 · https://blog.adnabu.com/facebook/meta-advantage-plus-sales-campaigns/
- ContentGrip / Social Native (Partnership Ads 2026): https://www.contentgrip.com/meta-branded-content-rules-update/
- OpusClip / Blitzcut / Sleepy Motion (captions nativos): https://www.opus.pro/blog/tiktok-caption-subtitle-best-practices
- Jon Loomer (duraciones por placement Meta): https://www.jonloomer.com/meta-video-ad-length-requirements/
- Amra & Elma / Benly (Spark Ads stats): https://www.amraandelma.com/tiktok-spark-ads-statistics/
- Kirkland & Ellis / Jones Day (EU AI Act code of practice): https://www.kirkland.com/publications/kirkland-alert/2026/02/illuminating-ai-the-eus-first-draft-code-of-practice-on-transparency-for-ai
