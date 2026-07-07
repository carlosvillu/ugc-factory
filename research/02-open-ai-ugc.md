# Análisis en profundidad: Open-AI-UGC (Anil-matcha)

> Informe de investigación para el PRD de nuestra plataforma "URL de producto → análisis IA → anuncios de vídeo UGC 9:16" (TikTok / Instagram Reels, generación vía fal.ai).
>
> Fecha de análisis: 2026-07-06. Repo clonado con `git clone --depth 1` y analizado fichero a fichero (no solo el README).

---

## 1. Resumen ejecutivo

**El repo existe y es real**: [`https://github.com/Anil-matcha/Open-AI-UGC`](https://github.com/Anil-matcha/Open-AI-UGC), MIT license, ~162 stars, último commit el **29 de junio de 2026** (merge de PR #4). Demo en vivo: [open-ai-ugc.vercel.app](https://open-ai-ugc.vercel.app/).

**Hallazgo principal**: a pesar de venderse como "alternativa open source a Arcads y MakeUGC", el proyecto es **mucho más pequeño de lo que sugiere su marketing**. Son ~2.270 líneas de JavaScript (37 ficheros, 732 KB con lockfile). Es un **wrapper fino de UI sobre MUAPI** (un agregador de modelos de vídeo tipo fal.ai) con auth de Google, créditos y Stripe. **No contiene**:

- Generación de guiones (no hay ninguna llamada a un LLM en todo el código).
- Análisis de producto/URL.
- Librería de avatares/actores.
- Voz/TTS/lipsync.
- Prompts embebidos (cero prompt engineering — el usuario pega su propio prompt).
- Composición/edición de vídeo (subtítulos, música, CTA).

Lo que **sí** aporta y es valioso como referencia arquitectónica: el **patrón async de jobs** (submit → webhook + polling de respaldo → update de fila `Creation`), el **esquema Prisma mínimo viable** para un SaaS de generación, el **sistema de créditos con coste variable por modelo/duración/resolución**, y el flujo **Stripe Checkout one-off + webhook → top-up de créditos**.

Nota estratégica importante: el autor (Anil Chandra Naidu Matcha, cofundador de Vadootv/UUKI, ecosistema SamurAIGPT) está directamente vinculado a **MUAPI** — el repo funciona como funnel de marketing hacia muapi.ai (badge "Powered by MuAPI", UTM tags en todos los enlaces, comunidad Reddit r/muapi, artículos en Medium del propio autor promocionando MUAPI). No es un proyecto comunitario neutral. [Perfil GitHub](https://github.com/Anil-matcha) · [Medium](https://medium.com/@anilmatcha/openai-sora-2-api-text-to-video-generation-with-audio-exclusive-on-muapi-ai-3223d3623c1d)

---

## 2. Verificación de existencia y datos del repo

| Dato | Valor verificado |
| --- | --- |
| URL | `https://github.com/Anil-matcha/Open-AI-UGC` — **existe** |
| Licencia | MIT (según README; no hay fichero LICENSE en el árbol clonado) |
| Stars | ~162 |
| Lenguaje | JavaScript 95% (JSX, un único `.ts`: `prisma.config.ts`) |
| Último commit | `2a0f8a8` — 2026-06-29 (Merge PR #4 de jaiprasad04) — **activo** |
| Topics | open-source, stripe, nextjs, saas-template, muapi, image-to-video, text-to-video, tiktok-ads, ai-video-generator, ai-ugc, ai-actors |
| Demo | https://open-ai-ugc.vercel.app/ |
| Tamaño real | 37 ficheros, ~2.270 líneas JS/JSX (sin contar lockfile) |

Proyectos hermanos del mismo autor citados en el README (relevantes para otras líneas de investigación): [Generative-Media-Skills](https://github.com/SamurAIGPT/Generative-Media-Skills) (skills para Claude Code/Codex que orquestan modelos de imagen/vídeo), [Vibe-Workflow](https://github.com/SamurAIGPT/Vibe-Workflow) (workflow builder por nodos), [AI-Youtube-Shorts-Generator](https://github.com/SamurAIGPT/AI-Youtube-Shorts-Generator), [Free-AI-Social-Media-Scheduler](https://github.com/Anil-matcha/Free-AI-Social-Media-Scheduler), [happyhorse-comfyui](https://github.com/Anil-matcha/happyhorse-comfyui), [seedance2-comfyui](https://github.com/Anil-matcha/seedance2-comfyui).

---

## 3. Stack técnico

De `package.json` (verificado):

- **Next.js 16.2.3** (App Router) + **React 19.2.4**
- **Prisma 7.7.0** + `@prisma/adapter-pg` + PostgreSQL (Neon/Supabase/Railway)
- **NextAuth 4.24** con `@next-auth/prisma-adapter` (solo Google OAuth)
- **Stripe 22.0.1** (server) + `@stripe/stripe-js`
- **Tailwind CSS v4** + Framer Motion 12 + react-icons + react-hot-toast + axios
- Sin tests, sin CI, sin Dockerfile. Deploy pensado para **Vercel** (webhooks públicos requeridos).

Estructura real de rutas (difiere del README, ver §11):

```
src/
├── app/
│   ├── page.js                        # Studio: picker de modelo, prompt, upload imágenes, polling
│   ├── gallery/page.js                # Historial de creaciones (el README lo llama "dashboard")
│   ├── pricing/page.js                # 4 packs de créditos one-off (el README describe 3 suscripciones)
│   ├── login/page.js                  # Login Google
│   └── api/
│       ├── generate/route.js          # POST → submit a MUAPI + crear Creation + descontar créditos
│       ├── upload/route.js            # POST → proxy a MUAPI /upload_file → URL hosteada
│       ├── creations/route.js         # GET → lista de creaciones del usuario
│       ├── creations/[id]/route.js    # GET → 1 creación + POLLING FALLBACK a MUAPI
│       ├── webhook/muapi/route.js     # POST → callback de render terminado
│       ├── webhook/stripe/route.js    # POST → checkout.session.completed → +créditos
│       ├── checkout/route.js          # POST → Stripe Checkout (usa config.js server-side) ← usado por la UI
│       ├── checkout/stripe/route.js   # POST → Stripe Checkout (plan VIENE DEL CLIENTE) ← ruta duplicada/insegura
│       └── auth/[...nextauth]/route.js
├── components/ (Navbar, Footer, FloatingToolbar, ui/Button, ui/Card)
└── lib/ (auth.js, prisma.js, stripe.js, config.js, utils.js, services/{billing,user}.js)
```

---

## 4. Esquema de base de datos (Prisma)

`prisma/schema.prisma` completo — 5 modelos, 4 de ellos son el boilerplate estándar de NextAuth (`Account`, `Session`, `User`, `VerificationToken`). El único modelo de dominio es `Creation`:

```prisma
model User {
  id            String    @id @default(cuid())
  name          String?
  email         String?   @unique
  emailVerified DateTime?
  image         String?
  credits       Int       @default(10)   // ← 10 créditos gratis al registrarse
  accounts      Account[]
  sessions      Session[]
  creations     Creation[]
}

model Creation {
  id           String   @id @default(cuid())
  type         String?  // "video" (el valor "image" está previsto pero nunca se usa)
  title        String?  // prompt truncado a 50 chars
  prompt       String?  @db.Text
  url          String?  @db.Text        // URL del vídeo final (hosteado por MUAPI)
  createdAt    DateTime @default(now())
  userId       String

  requestId    String?  @unique         // ← clave de correlación con el job de MUAPI
  status       String   @default("processing")  // processing|pending|starting|queued|completed|failed
  error        String?  @db.Text

  // Parámetros de generación (desnormalizados en columnas)
  modelId      String?
  aspectRatio  String?
  resolution   String?
  duration     Int?
  mode         String?                  // solo Grok: fun|normal|spicy
  inputImages  String?  @db.Text        // JSON array de URLs serializado como string

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

Observaciones para nuestro diseño:

- `requestId @unique` como clave de correlación webhook↔fila es el patrón central. Simple y funciona.
- `inputImages` como JSON-en-string con parseo defensivo (try JSON.parse, fallback a split por comas) es un olor de diseño; en Postgres moderno debería ser `Json` o tabla hija.
- **No hay** entidades para: proyecto/campaña, producto, guion, variantes, avatar, voz, assets intermedios, transacciones de créditos (ledger). El descuento de créditos es un `decrement` sin historial — imposible auditar o reembolsar con precisión.
- Los estados son strings libres copiados de MUAPI, sin enum ni máquina de estados.

---

## 5. Qué es MUAPI y qué expone

**MUAPI (muapi.ai)** es un agregador de APIs de generación (imagen, vídeo, audio, 3D, LLM) — el competidor directo de **fal.ai**, Replicate y WaveSpeed. Pay-as-you-go por llamada, sin suscripción, 0% de cargo en tareas fallidas. Expone 20+ modelos: Veo 3.1, Sora 2, Seedance 2/2.5, Kling, Wan, FLUX, Midjourney (proxy), Happy Horse, etc. [muapi.ai](https://muapi.ai/) · [docs](https://muapi.ai/docs/api-reference) · [inferencehub.org/providers/muapi](https://inferencehub.org/providers/muapi)

Patrón de API (verificado en docs y en el código del repo):

1. **Auth**: header `x-api-key`.
2. **Submit**: `POST https://api.muapi.ai/api/v1/{model-endpoint}` con `prompt`, `image_url`/`images_list`, parámetros del modelo y `webhook_url` opcional → responde `{ request_id, status: "processing", cost: {...} }`.
3. **Poll**: `GET /api/v1/predictions/{request_id}/result` → `status` ∈ queued→pending→processing→completed|failed|cancelled, con `outputs: [url]`.
4. **Webhook**: si se pasó `webhook_url`, MUAPI hace POST al terminar con `{ id|request_id, status, outputs, error }`.
5. **Upload**: `POST /api/v1/upload_file` (multipart) → `{ url, file_id }` (URL hosteada usable como referencia).
6. **Costes**: objeto `cost` (`amount_usd`, `amount_credits`, `refunded`) en cada respuesta + headers `X-MuAPI-Cost-USD` / `X-MuAPI-Cost-Credits`.
7. **Sandbox**: claves de test (`is_test: true`) con respuestas mock sin coste.

**Equivalencia con fal.ai**: el patrón es casi idéntico al de fal.ai (queue.fal.run → submit → status → result, webhooks opcionales, storage de ficheros). Todo lo aprendido aquí se traslada 1:1 a fal.ai cambiando endpoints y auth (`Authorization: Key ...`).

---

## 6. Modelos soportados: verificación de existencia

Los 4 modelos del repo **existen realmente** (julio 2026) — ninguno es inventado:

| Modelo (id en código) | Proveedor real | Endpoint MUAPI usado en el código | ¿Existe en fal.ai? |
| --- | --- | --- | --- |
| `veo-3-1` (Veo 3.1) | Google DeepMind | `api/v1/veo3.1-image-to-video` | Sí — [`fal-ai/veo3.1`](https://fal.ai/models/fal-ai/veo3.1) ($0.20/s sin audio, $0.40/s con audio) |
| `seedance-2` (Seedance 2) | ByteDance (lanzado 2026-04-09) | `api/v1/seedance-2-image-to-video` | Sí — [`bytedance/seedance-2.0/image-to-video`](https://fal.ai/models/bytedance/seedance-2.0/image-to-video) ($0.3024/s 720p; fast $0.2419/s) |
| `grok-video` (Grok Imagine) | xAI | `api/v1/grok-imagine-image-to-video` | Disponible vía agregadores; en fal.ai como grok-imagine (verificar endpoint exacto en catálogo) |
| `happy-horse` (Happy Horse 1) | **Alibaba** (Future Life Lab, Taotian Group; debut 2026-04-07, #1 en Artificial Analysis) | `api/v1/happy-horse-1-image-to-video-720p` | Sí — [`alibaba/happy-horse/image-to-video`](https://fal.ai/models/alibaba/happy-horse/image-to-video) |

"Happy Horse 1" sonaba a codename inventado pero es un modelo real de Alibaba con salida nativa 1080p, audio sincronizado generado conjuntamente y un transformer de 15B/40 capas. [WaveSpeed blog](https://wavespeed.ai/blog/posts/what-is-happyhorse-1-0-ai-video-model/) · [muapi.ai/happyhorse-1](https://muapi.ai/happyhorse-1)

Definición de modelos en el frontend (`src/app/page.js`, array `MODELS`) — cada modelo declara sus parámetros y la UI se autoconstruye:

```js
{
  id: "grok-video",
  name: "Grok Video",
  api: "https://api.muapi.ai/api/v1/grok-imagine-image-to-video",
  params: {
    aspect_ratio: { options: ["9:16","16:9","2:3","3:2","1:1"], default: "2:3" },
    mode:         { options: ["fun","normal","spicy"], default: "normal" },
    resolution:   { options: ["480p","720p"], default: "480p" },
    duration:     { min: 6, max: 30, default: 6 },
  },
}
```

Este patrón declarativo (params → dropdowns/sliders generados dinámicamente) es de lo más reutilizable del repo: añadir un modelo = ~10 líneas en `MODELS` + 1 línea en `MODEL_ENDPOINTS` del backend.

---

## 7. Flujo de generación end-to-end (verificado en código)

```
Usuario                    Next.js (Vercel)                       MUAPI
  │  1. sube imágenes  ──▶  POST /api/upload  ──────────────▶  POST /api/v1/upload_file
  │                          (proxy multipart)  ◀─ {url} ──────┘
  │  2. escribe prompt
  │     (refs @image1..7)
  │  3. Generate ─────────▶  POST /api/generate
  │                          ├─ auth (getServerSession)
  │                          ├─ calcula créditos (modelo×duración×resolución)
  │                          ├─ check créditos usuario
  │                          ├─ POST {model-endpoint} ────────▶  submit job
  │                          │    payload: {prompt, images_list,
  │                          │      image_url, webhook_url, ...settings}
  │                          │  ◀── {request_id} ──────────────┘
  │                          ├─ prisma.creation.create (status=processing)
  │                          └─ prisma.user.update (decrement créditos)
  │  4. UI hace polling ───▶  GET /api/creations/[id] cada 3s
  │                          └─ si sigue activo: GET predictions/{id}/result
  │                             (fallback por si el webhook falla)      ▲
  │                                                                     │
  │                    POST /api/webhook/muapi  ◀── render terminado ───┘
  │                          └─ findUnique({requestId}) → update status+url
  │  5. spinner → <video>
```

Detalles clave del código:

**Cálculo de créditos** (`src/app/api/generate/route.js`, duplicado en el frontend para mostrar el coste):

```js
if (modelId === "grok-video")      requiredCredits = duration * (resolution === "720p" ? 10 : 5);
else if (modelId === "veo-3-1")    requiredCredits = duration * (resolution === "4k" ? 740 : resolution === "1080p" ? 650 : 500);
else if (modelId === "happy-horse") requiredCredits = duration * 36;
else if (modelId === "seedance-2")  requiredCredits = duration * 50;
```

Es decir: Grok 6s@480p = 30 créditos; Veo 8s@720p = 4.000 créditos; Seedance 5s = 250; Happy Horse 5s = 180. La lógica de negocio de pricing por modelo está **hardcodeada en dos sitios** (route + page) — fuente de bugs de divergencia.

**Payload a MUAPI** — pasa las imágenes en dos formatos a la vez para cubrir todos los modelos:

```js
const payload = {
  prompt,
  images_list: images,
  image_url: images?.[0],          // algunos modelos requieren image_url
  webhook_url: `${process.env.WEBHOOK_URL}/api/webhook/muapi`,
  ...settings                      // aspect_ratio, duration, resolution, mode
};
```

**Sintaxis de referencias inline en el prompt**: `@image1`, `@image2`… hasta 7 imágenes ("`@image1 holding the bottle, walking through @image2`"). La resolución de esas referencias la hace el modelo/MUAPI, no el repo.

**Webhook MUAPI** (`webhook/muapi/route.js`): busca `Creation` por `requestId`, y según `data.status`/`data.outputs` marca `completed` (con `url = outputs[0]`), `failed` (con `error`) o actualiza el estado intermedio. **Sin verificación de firma ni autenticación**: cualquiera que conozca un `request_id` puede falsificar el callback.

**Polling de respaldo** (`creations/[id]/route.js`): si la fila sigue en estado activo, el GET consulta directamente `GET /api/v1/predictions/{requestId}/result` y sincroniza la BD. Esto hace el sistema resiliente a webhooks perdidos y funcional en localhost sin túnel. **Este patrón doble (webhook + lazy polling en el read-path) es el mejor hallazgo arquitectónico del repo.**

**Polling del frontend** (`page.js`): `setInterval` de 3s contra `/api/creations/[id]` mientras el estado ∈ {processing, pending, starting, queued}; al completar, swap de spinner a `<video autoPlay loop>`.

---

## 8. Integración Stripe

Modelo de negocio implementado: **packs de créditos one-off** (mode: "payment", no suscripciones).

- **`POST /api/checkout`** (la que usa la UI): recibe `planId`, valida contra `config.stripe.plans` **en el servidor**, crea Checkout Session con `metadata: { userId, credits }`.
- **`POST /api/webhook/stripe`**: verifica firma con `stripe.webhooks.constructEvent(body, signature, webhookSecret)` (correcto), y en `checkout.session.completed` hace `UserService.addCredits(userId, credits)` leyendo el metadata.
- **`POST /api/checkout/stripe`** (segunda ruta, aparentemente muerta): recibe el objeto `plan` **completo desde el cliente** y crea la sesión con `unit_amount: parseFloat(plan.price.replace("$",""))*100` y `metadata.credits: plan.credits`. **Vulnerabilidad**: un cliente podría comprar N créditos a $0. No está referenciada por la UI actual, pero está desplegada.

Inconsistencia flagrante de fuentes de verdad:

| Fuente | Basic | Standard | Pro | Business |
| --- | --- | --- | --- | --- |
| `pricing/page.js` (lo que ve el usuario) | $5 / 100 cr | $10 / 250 cr | $20 / 600 cr | $50 / 2.000 cr |
| `lib/config.js` (lo que realmente se acredita) | $5 / **1.000 cr** | $10 / **2.000 cr** | $20 / **4.000 cr** | $50 / **10.000 cr** |
| README | "Free / Pro $19.99 / Elite $49.99, suscripción" | — | — | — |

El usuario paga lo que ve pero recibe 10× más créditos de los anunciados; y el README describe un pricing (suscripciones de 3 tiers) que no existe en el código.

Otros defectos del flujo de créditos:

- Créditos por defecto al registrarse: 10. Pero la generación más barata (Grok 6s@480p) cuesta 30. **Un usuario nuevo no puede generar nada gratis**, contradiciendo el README ("10 free credits… 1 credit per generation").
- Check + decrement de créditos **no atómicos** (dos queries separadas, sin transacción ni `WHERE credits >= X`): condición de carrera con requests concurrentes.
- Créditos descontados al hacer submit, **sin refund si el render falla** (el README lo reconoce).
- No hay ledger de transacciones de créditos.

---

## 9. Prompts embebidos

**No hay ninguno.** Grep exhaustivo del código: no existe ni una llamada a un LLM, ni plantillas de guion, ni system prompts. El único rastro es config muerta en `lib/config.js`:

```js
ai: {
  apiKey: process.env.MUAPIAPP_API_KEEY  // (env var MUAPIAPP_API_KEY, jamás definida en .env.example ni usada)
  generationCost: 10,
  model: "gpt-4o",   // nunca se usa en ningún sitio
},
```

El único texto orientativo para el usuario es el placeholder de la UI: *"Reference uploaded images using @image(n) followed by a space — e.g. @image1 a sunset over the ocean."*

Conclusión: **toda la inteligencia de "UGC ad" (guion, hook, ángulo, persona) recae en el usuario**. Este repo no compite con nuestro producto en la capa de inteligencia; solo en la capa de render.

---

## 10. Manejo de jobs: resumen del patrón

1. Submit síncrono dentro del request HTTP del usuario (sin cola propia; el "queue" es MUAPI).
2. Persistencia inmediata de la fila `Creation` con `requestId` y `status: processing`.
3. Doble vía de actualización: webhook push (producción) + polling lazy en el read-path (fallback/desarrollo).
4. Polling del cliente cada 3s contra la API propia (no contra MUAPI directamente — la API key nunca toca el cliente).
5. Estados: `queued → pending/starting → processing → completed | failed`.

Limitaciones: sin reintentos, sin timeout/expiración de jobs colgados (si MUAPI nunca responde y el usuario no vuelve a mirar la creación, queda en `processing` para siempre), sin idempotencia en el webhook, sin cola para pipelines multi-paso.

---

## 11. Discrepancias detectadas (README/marketing vs código real)

1. **"Generate AI UGC video ads with realistic AI actors, scripts, and voiceovers"** (description de package.json): no hay scripts (guiones) ni voiceovers generados; los "AI actors" son solo imágenes de referencia que sube el usuario.
2. README: "1 credit per generation", "10 free credits" utilizables → código: coste variable 30–5.920 créditos; los 10 gratis no alcanzan para nada.
3. README: pricing de 3 suscripciones (Free/Pro $19.99/Elite $49.99) → código: 4 packs one-off ($5–$50) con créditos inconsistentes entre página y backend (100 vs 1.000, etc.).
4. README (sección Architecture): menciona `dashboard/page.js`, `components/saas/Navbar.jsx`, `saas/AuthButtons.jsx` → no existen; los reales son `gallery/page.js`, `components/Navbar.js`, `components/FloatingToolbar.jsx`.
5. README: "Async job pipeline — the dashboard polls and updates live" → cierto solo para la última generación en la página principal; la galería NO hace polling (carga una vez).
6. `FloatingToolbar.jsx` con botones "Talking Actors / Video / Image" es decorativo — no está conectado a nada (el import está muerto).
7. `Creation.type` prevé "image" pero solo se genera vídeo.
8. `.env.example` define `UGC_API_KEY`; `lib/config.js` referencia `MUAPIAPP_API_KEY` (nunca definida) — config muerta.
9. Vulnerabilidades reseñables si alguien lo despliega tal cual: webhook MUAPI sin firma; ruta `checkout/stripe` con precio/créditos controlados por el cliente; carrera en créditos.

**Discrepancias respecto a `UGC_deep_research.md` (nuestro doc previo)**: la ficha del proyecto en §4.1 es correcta en lo esencial (existe, es plantilla Next.js+Stripe+MUAPI, modelos Veo 3.1/Seedance 2/Grok Video/Happy Horse 1 — los 4 verificados como reales), pero **sobrestima el alcance**: sugiere una plataforma "tipo Arcads" completa, cuando en realidad no hay guiones, ni voz, ni librería de actores, ni multi-tenant real — es un playground de prompts sobre MUAPI con billing.

---

## 12. Qué es reutilizable para nuestro producto y qué no

### Reutilizable como referencia arquitectónica

1. **Patrón webhook + polling fallback en el read-path** (§7): adoptarlo tal cual con fal.ai (fal soporta webhooks en `queue.fal.run` y polling de status). Resuelve dev local y webhooks perdidos con muy poco código.
2. **`requestId @unique` en la tabla de jobs** como correlación con el proveedor de inferencia.
3. **Definición declarativa de modelos** (array `MODELS` con `params` → UI autogenerada): ideal para nuestro selector de modelo de render en fal.ai, y para el pricing dinámico por modelo/duración/resolución.
4. **Coste en créditos = f(modelo, duración, resolución)** mostrado antes de generar: buena UX; nosotros deberíamos centralizarla en un único módulo compartido server/client (aquí está duplicada).
5. **Proxy de upload** (cliente → nuestra API → storage del proveedor): la API key nunca llega al navegador. Con fal.ai, equivale a usar su Storage API o R2/S3 propio.
6. **Stripe Checkout one-off + webhook con metadata `{userId, credits}`**: flujo mínimo correcto (la ruta `/api/checkout` + `BillingService.handleWebhook` con verificación de firma es copiable; la ruta duplicada insegura, no).
7. **Boilerplate NextAuth + Prisma + créditos en `User`**: punto de partida razonable, aunque hoy elegiríamos NextAuth v5/Auth.js o Better Auth.
8. Las **tablas de capacidades por modelo** (aspect ratios, duraciones, resoluciones por modelo — §6) son datos útiles directamente para nuestro PRD.

### NO reutilizable / hay que construirlo nosotros

1. **Toda la capa de inteligencia**: análisis de URL de producto, extracción de beneficios/audiencia/objeciones/ángulos, generación de guiones con estructura Hook-Body-CTA, variantes. Este repo no tiene nada de eso — es exactamente el hueco que nuestro producto llena.
2. **Pipeline multi-paso**: aquí 1 generación = 1 llamada a 1 modelo. Nuestro flujo (guion → avatar → voz/TTS → lipsync → render → subtítulos/música) necesita un orquestador de jobs real (cola con pasos, reintentos, compensación de créditos), no un submit síncrono.
3. **Voz y lipsync**: ausentes por completo (los modelos con audio nativo tipo Happy Horse/Seedance 2 generan audio "del mundo", no un guion locutado controlado).
4. **Librería de avatares/actores**: no existe; solo "sube tu imagen".
5. **El sistema de créditos tal cual** (sin ledger, sin atomicidad, sin refunds): rehacer con tabla de transacciones y decremento condicional atómico.
6. **MUAPI como proveedor**: nuestro producto usa fal.ai; MUAPI es intercambiable pero está controlado por el propio autor del repo (riesgo de neutralidad/continuidad). Los 4 modelos están disponibles en fal.ai (§6).

---

## 13. Implicaciones para el PRD

1. **Posicionamiento**: el "competidor OSS" real es débil — Open-AI-UGC valida la demanda (162 stars, PRs de terceros, demo activa) pero no resuelve el problema completo. Nuestro diferencial (análisis de URL → facetas → guiones → vídeo end-to-end) no está cubierto por ningún OSS de este autor. Podemos citar este repo como "estado del arte OSS" y demostrar que solo cubre el ~20% final del pipeline (render).
2. **Arquitectura de jobs a especificar en el PRD**: adoptar el patrón webhook + polling fallback + `requestId` único, pero sobre una **cola multi-paso** propia (p. ej. pgboss/Inngest/Trigger.dev) porque nuestro pipeline tiene 4–6 pasos encadenados con costes distintos. Definir máquina de estados explícita (enum) con timeout y reintentos — carencias observadas aquí.
3. **Modelo de datos mínimo a superar**: además de `User/Creation`, el PRD debe incluir `Product` (URL analizada + facetas extraídas), `Script` (variantes, hook/body/cta), `Job`/`JobStep`, `CreditTransaction` (ledger) y `Asset` (imágenes de referencia, audio, vídeo intermedio y final). La desnormalización de parámetros de generación en columnas (aspectRatio, resolution, duration, modelId) es útil para filtrado/analytics — mantenerla.
4. **Créditos y pricing**: el coste variable por modelo×segundo×resolución es el estándar de facto (igual en fal.ai: Veo 3.1 $0.20–0.40/s, Seedance 2 $0.24–0.30/s). El PRD debe definir: única fuente de verdad del pricing (módulo compartido o tabla en BD), preflight de coste visible antes de generar, decremento atómico (`UPDATE ... WHERE credits >= cost`), y refund automático en fallo (fal.ai no cobra jobs fallidos; trasladar esa garantía al usuario).
5. **Stripe**: copiar el flujo Checkout+webhook con validación server-side del plan (ruta `/api/checkout` de este repo) y prohibir explícitamente en el PRD cualquier endpoint donde el cliente dicte precio/créditos (el anti-patrón de `/api/checkout/stripe`). Decidir packs one-off vs suscripción: este repo demuestra que los packs one-off son triviales de implementar; las suscripciones con créditos mensuales requieren más estado (renovaciones, caducidad).
6. **Seguridad de webhooks**: exigir verificación de firma (Stripe la tiene; para fal.ai, verificar firma/secret del webhook o usar un token secreto en la URL) y idempotencia por `request_id` — ambos ausentes en el webhook MUAPI de este repo.
7. **Selección de modelos de render (fal.ai)**: los 4 modelos de este repo existen en fal.ai. Para UGC parlante 9:16, los candidatos son Veo 3.1 (calidad premium, 8s, audio), Seedance 2.0 (multi-shot, character reference — clave para consistencia de avatar entre variantes, 4–15s) y Happy Horse 1 (barato/rápido para iteración en batch, audio nativo). Grok Imagine aporta duraciones largas (hasta 30s) a bajo coste. El PRD debería especificar un **tier de render** (draft = Happy Horse/Seedance fast; final = Veo 3.1/Seedance estándar).
8. **Límites de producto observables**: 9:16 nativo en los 4 modelos; duraciones cortas (Veo fijo a 8s) implican que anuncios de 20–30s requieren **stitching de escenas** — funcionalidad que ningún OSS analizado resuelve y que nuestro PRD debe contemplar (composición con FFmpeg o modelos multi-shot de Seedance 2).
9. **UX validada por este repo**: (a) coste en créditos visible junto al botón de generar; (b) referencias inline `@image1..7` en el prompt — sintaxis sencilla y entendible que podríamos adoptar para "avatar + producto + escena"; (c) spinner→vídeo con polling de 3s; (d) galería con estado por tarjeta. Todo ello es buena línea base de UX para nuestro studio.
10. **Riesgo de dependencia**: no construir sobre MUAPI (conflicto de interés del autor, menor tracción que fal.ai). fal.ai ofrece los mismos modelos con el mismo patrón async; la abstracción "provider" del PRD debería permitir swap MUAPI/fal/Replicate con una interfaz `submit/status/webhook` común — este repo demuestra que esa interfaz es suficiente.

---

## Fuentes

- Repo analizado (clonado): https://github.com/Anil-matcha/Open-AI-UGC (commit `2a0f8a8`, 2026-06-29)
- Demo: https://open-ai-ugc.vercel.app/
- MUAPI: https://muapi.ai/ · https://muapi.ai/docs/api-reference · https://inferencehub.org/providers/muapi
- Happy Horse 1 (Alibaba): https://muapi.ai/happyhorse-1 · https://wavespeed.ai/blog/posts/what-is-happyhorse-1-0-ai-video-model/ · https://fal.ai/models/alibaba/happy-horse/image-to-video
- fal.ai (equivalencias): https://fal.ai/models/fal-ai/veo3.1 · https://fal.ai/models/bytedance/seedance-2.0/image-to-video · https://fal.ai/learn/tools/seedance-2-0-vs-veo-3-1
- Autor: https://github.com/Anil-matcha · https://in.linkedin.com/in/anilmatcha · https://medium.com/@anilmatcha/openai-sora-2-api-text-to-video-generation-with-audio-exclusive-on-muapi-ai-3223d3623c1d
- Proyectos relacionados del autor: https://github.com/SamurAIGPT/Generative-Media-Skills · https://github.com/Anil-matcha/happyhorse-comfyui · https://github.com/Anil-matcha/seedance2-comfyui
