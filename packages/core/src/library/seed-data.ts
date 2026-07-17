// LA LIBRERÍA SEMBRADA (T2.1): ~40 hook lines y ~15 CTA lines POR IDIOMA (es/en) + las 3
// recetas del Apéndice B. Es DATO, no lógica: un módulo plano que el validador de seeds
// comprueba en el gate y que `pnpm seed` inserta.
//
// REDACCIÓN PROPIA Y NATIVA POR IDIOMA (§17: "no se traduce: se genera nativo en ese
// idioma, con el registro conversacional UGC correcto"). Las listas es/en NO son
// traducción una de otra: un hook que funciona en inglés ("POV: you finally...") no tiene
// equivalente literal en español, y al revés ("Llevo X años y nadie me lo había dicho").
// Se han escrito por separado, con las muletillas y el ritmo de cada idioma.
//
// PLACEHOLDERS interpolables (§12: `hook_line.text` es interpolable), resueltos por el
// ScriptWriter (T2.4) con datos del brief:
//   {product}  nombre del producto        {benefit}  el beneficio principal
//   {pain}     el dolor del segmento      {category} la categoría/vertical
//
// TECHO DURO: ≤ MAX_HOOK_WORDS (12) palabras EN EL PEOR CASO RENDERIZADO — el validador lo
// comprueba sobre ESTAS listas en cada `pnpm gate`. Ojo: un placeholder NO cuenta como una
// palabra. Cuenta lo que va a ocupar una vez sustituido (`PLACEHOLDER_WORD_BUDGET`: {pain}=6,
// {benefit}=4, {product}=3, {category}=2), porque lo que tiene que caber en los 0–3 s del
// gancho es lo que el espectador OYE, no la plantilla. "Deja de gastar dinero en cosas que no
// arreglan {pain}." son 10 palabras literales y 15 habladas: se rechaza.
import type { CtaLineSeed, HookLineSeed, RecipeSeed } from './contracts';

// ── Hooks — ESPAÑOL (redacción nativa) ──────────────────────────────────────
const HOOKS_ES: HookLineSeed[] = [
  // pain_point
  {
    angle: 'pain_point',
    text: 'Si te pasa {pain}, mira esto.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'pain_point',
    text: 'Años aguantando {pain}. Nadie me avisó.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'pain_point',
    text: 'Deja de pagar por soportar {pain}.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'pain_point',
    text: 'Nadie habla de {pain}. Yo sí.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'pain_point',
    text: 'El problema no eres tú: es cómo te lo han vendido.',
    verticals: [],
    language: 'es',
  },

  // curiosity
  {
    angle: 'curiosity',
    text: 'Nadie te cuenta esto sobre {category}.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'curiosity',
    text: 'Probé {product} treinta días y pasó esto.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'curiosity',
    text: 'Vale, tengo que enseñarte lo que acabo de descubrir.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'curiosity',
    text: 'Esto no debería funcionar tan bien, pero funciona.',
    verticals: [],
    language: 'es',
  },
  { angle: 'curiosity', text: 'Te juro que no me lo esperaba.', verticals: [], language: 'es' },
  {
    angle: 'curiosity',
    text: 'Hay un detalle de {product} que nadie menciona.',
    verticals: [],
    language: 'es',
  },

  // social_proof
  {
    angle: 'social_proof',
    text: 'Me lo recomendó media oficina y ahora entiendo por qué.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'social_proof',
    text: 'Lo pedí porque salía en todos lados. Spoiler: acertaron.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'social_proof',
    text: 'Mi hermana lleva meses usándolo y no se calla.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'social_proof',
    text: 'Se agotó tres veces. Ahora sé el motivo.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'social_proof',
    text: 'Ya éramos muchos usando {product} y yo sin enterarme.',
    verticals: [],
    language: 'es',
  },

  // authority
  {
    angle: 'authority',
    text: 'Trabajo en {category} y esto es lo que uso.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'authority',
    text: 'He probado veinte y solo repito con {product}.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'authority',
    text: 'Después de años en esto, te ahorro la búsqueda.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'authority',
    text: 'Lo primero que miro antes de comprar {category}.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'authority',
    text: 'Esto es lo que de verdad importa en {category}.',
    verticals: [],
    language: 'es',
  },

  // transformation
  {
    angle: 'transformation',
    text: 'Antes {pain}. Ahora ni me acuerdo.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'transformation',
    text: 'Dos semanas con {product} y mira la diferencia.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'transformation',
    text: 'Mi rutina cambió entera por una tontería de nada.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'transformation',
    text: 'Este es el antes. Espera al después.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'transformation',
    text: 'No he cambiado nada más. Solo {product}.',
    verticals: [],
    language: 'es',
  },

  // objection
  {
    angle: 'objection',
    text: 'Pensaba que era otro {category} más. Me equivoqué.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'objection',
    text: 'Vale, es caro. Te cuento si compensa.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'objection',
    text: 'Pensaba que {pain} no tenía solución.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'objection',
    text: 'Lo compré con cero fe y aquí estamos.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'objection',
    text: 'Si te da pereza cambiar, esto tarda un minuto.',
    verticals: [],
    language: 'es',
  },

  // urgency
  {
    angle: 'urgency',
    text: 'Llevas meses con {pain}. Para y mira.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'urgency',
    text: 'Cada día con {pain} es tiempo perdido.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'urgency',
    text: 'Corre, que esto no dura y luego te quejas.',
    verticals: [],
    language: 'es',
  },
  { angle: 'urgency', text: 'No esperes a que {pain} empeore.', verticals: [], language: 'es' },

  // comparison
  {
    angle: 'comparison',
    text: 'Comparé el mío de siempre con {product}. Sin color.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'comparison',
    text: 'Izquierda: lo de toda la vida. Derecha: {product}.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'comparison',
    text: 'Lo barato me costó el doble. Te explico.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'comparison',
    text: 'Pagué tres veces más y funcionaba la mitad.',
    verticals: [],
    language: 'es',
  },
  {
    angle: 'comparison',
    text: 'La diferencia con {product} se nota al primer uso.',
    verticals: [],
    language: 'es',
  },
];

// ── Hooks — ENGLISH (native copy, not a translation of the Spanish list) ─────
const HOOKS_EN: HookLineSeed[] = [
  // pain_point
  {
    angle: 'pain_point',
    text: 'If {pain} is ruining your week: watch.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'pain_point',
    text: 'Nobody warns you about {pain}.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'pain_point',
    text: 'Paying for {category} that ignores {pain}?',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'pain_point',
    text: 'Years of {pain}. Never again.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'pain_point',
    text: "It's not you. The thing you bought is broken.",
    verticals: [],
    language: 'en',
  },

  // curiosity
  {
    angle: 'curiosity',
    text: 'POV: you finally found a {category} that works.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'curiosity',
    text: 'Okay, I need to show you something real quick.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'curiosity',
    text: 'I tested {product} for thirty days. Wild results.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'curiosity',
    text: "This shouldn't work as well as it does.",
    verticals: [],
    language: 'en',
  },
  {
    angle: 'curiosity',
    text: "There's one thing about {product} nobody mentions.",
    verticals: [],
    language: 'en',
  },
  {
    angle: 'curiosity',
    text: 'Not me finding this out at my big age.',
    verticals: [],
    language: 'en',
  },

  // social_proof
  {
    angle: 'social_proof',
    text: 'Three friends told me to get it. They were right.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'social_proof',
    text: 'It sold out twice. Now I get why.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'social_proof',
    text: 'My whole group chat uses {product} now.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'social_proof',
    text: 'Everyone kept posting about it. So I caved.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'social_proof',
    text: 'I was the last person to try {product}.',
    verticals: [],
    language: 'en',
  },

  // authority
  {
    angle: 'authority',
    text: 'I work in {category}. This is what I use.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'authority',
    text: "I've tried twenty of these. Only one stayed.",
    verticals: [],
    language: 'en',
  },
  {
    angle: 'authority',
    text: "Here's what I check before buying any {category}.",
    verticals: [],
    language: 'en',
  },
  {
    angle: 'authority',
    text: 'Save yourself the research. I already did it.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'authority',
    text: 'This is the part of {category} that actually matters.',
    verticals: [],
    language: 'en',
  },

  // transformation
  {
    angle: 'transformation',
    text: 'Two weeks with {product}. Look at that difference.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'transformation',
    text: 'Before: {pain}. After: nothing.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'transformation',
    text: 'I changed one thing. That one thing was {product}.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'transformation',
    text: "That's the before. Wait for the after.",
    verticals: [],
    language: 'en',
  },
  {
    angle: 'transformation',
    text: 'My entire routine got easier because of this.',
    verticals: [],
    language: 'en',
  },

  // objection
  {
    angle: 'objection',
    text: 'I thought it was overpriced. Let me explain.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'objection',
    text: 'I bought it expecting nothing. And then, this.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'objection',
    text: 'I assumed {pain} was permanent. Nope.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'objection',
    text: 'Yes, it costs more. Here is what you get.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'objection',
    text: 'If switching sounds like effort, it takes one minute.',
    verticals: [],
    language: 'en',
  },

  // urgency
  {
    angle: 'urgency',
    text: 'Every week you wait, {pain} costs more.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'urgency',
    text: "Don't wait for {pain} to worsen.",
    verticals: [],
    language: 'en',
  },
  {
    angle: 'urgency',
    text: 'This restocks slowly and I am not exaggerating.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'urgency',
    text: 'Been putting this off? Stop. Watch the next clip.',
    verticals: [],
    language: 'en',
  },

  // comparison
  {
    angle: 'comparison',
    text: 'Left: what I used before. Right: {product}.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'comparison',
    text: 'I compared them side by side. It was not close.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'comparison',
    text: 'The cheap one cost me double. Here is why.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'comparison',
    text: 'I paid triple elsewhere for half the result.',
    verticals: [],
    language: 'en',
  },
  {
    angle: 'comparison',
    text: 'You feel the difference the first time you use it.',
    verticals: [],
    language: 'en',
  },
];

// ── CTAs — ESPAÑOL ──────────────────────────────────────────────────────────
// `objective` = el objetivo del lote (§12): hook_test (solo enganchar y retener),
// conversion (empujar a comprar), story (cerrar la narrativa e invitar a seguir).
const CTAS_ES: CtaLineSeed[] = [
  { objective: 'hook_test', text: 'Guárdalo, que luego no lo encuentras.', language: 'es' },
  { objective: 'hook_test', text: 'Quédate, que lo bueno viene ahora.', language: 'es' },
  { objective: 'hook_test', text: 'Comenta "info" y te cuento.', language: 'es' },
  { objective: 'hook_test', text: 'Dime si te ha pasado. Estoy leyendo.', language: 'es' },
  { objective: 'hook_test', text: 'Sígueme si quieres la segunda parte.', language: 'es' },

  { objective: 'conversion', text: 'Tienes el enlace de {product} en la bio.', language: 'es' },
  { objective: 'conversion', text: 'Pruébalo hoy y me cuentas.', language: 'es' },
  { objective: 'conversion', text: 'Está en la bio. No me lo agradezcas todavía.', language: 'es' },
  { objective: 'conversion', text: 'Corre, que se agota otra vez.', language: 'es' },
  { objective: 'conversion', text: 'Enlace en la bio y a disfrutarlo.', language: 'es' },
  { objective: 'conversion', text: 'Hazte un favor: {product}, enlace arriba.', language: 'es' },

  { objective: 'story', text: 'Y así acabó mi historia con {pain}.', language: 'es' },
  { objective: 'story', text: 'Te lo cuento entero en el siguiente vídeo.', language: 'es' },
  { objective: 'story', text: 'Ojalá alguien me hubiera contado esto antes.', language: 'es' },
  { objective: 'story', text: 'Ahora ya lo sabes. Haz lo que quieras con ello.', language: 'es' },
];

// ── CTAs — ENGLISH ──────────────────────────────────────────────────────────
const CTAS_EN: CtaLineSeed[] = [
  { objective: 'hook_test', text: 'Save this before it gets lost in your feed.', language: 'en' },
  { objective: 'hook_test', text: 'Stick around, the good part is next.', language: 'en' },
  { objective: 'hook_test', text: 'Comment "info" and I will send it.', language: 'en' },
  { objective: 'hook_test', text: 'Tell me if this happens to you too.', language: 'en' },
  { objective: 'hook_test', text: 'Follow for part two.', language: 'en' },

  { objective: 'conversion', text: 'Link to {product} is in my bio.', language: 'en' },
  { objective: 'conversion', text: 'Grab it before it sells out again.', language: 'en' },
  { objective: 'conversion', text: 'Try it and come back to tell me.', language: 'en' },
  { objective: 'conversion', text: "It's in the bio. Don't thank me yet.", language: 'en' },
  { objective: 'conversion', text: 'Do yourself a favor. Link up top.', language: 'en' },
  { objective: 'conversion', text: 'One tap in my bio and it is yours.', language: 'en' },

  { objective: 'story', text: 'And that is how {pain} stopped being my problem.', language: 'en' },
  { objective: 'story', text: 'Full story in the next video.', language: 'en' },
  { objective: 'story', text: 'I wish someone had told me this sooner.', language: 'en' },
  { objective: 'story', text: 'Now you know. Do what you want with it.', language: 'en' },
];

export const HOOK_LINE_SEEDS: HookLineSeed[] = [...HOOKS_ES, ...HOOKS_EN];
export const CTA_LINE_SEEDS: CtaLineSeed[] = [...CTAS_ES, ...CTAS_EN];

// ── Recetas por tier — APÉNDICE B, VERBATIM ─────────────────────────────────
//
// Los modelos son las columnas del Apéndice B (Avatar / B-roll / Voz / Shots) y los costes
// son los RANGOS del "COGS 30 s" de la misma tabla — que §16.1 confirma con los mismos
// números (verificados contra research/01 y research/07). En CÉNTIMOS ENTEROS:
//
//   Test      $0,3–1,7  →   30–170
//   Standard  $1,8–5    →  180–500
//   Premium   $9–13     →  900–1300
//
// El consumidor es el estimador de coste de T2.2, cuya Verificación exige cuadrar con el
// Apéndice B ±10 % — por eso se guarda la horquilla, no un punto medio (ver contracts.ts).
//
// ── RECALIBRACIÓN T3.4 (2026-07-15) ─────────────────────────────────────────
// T3.4 verificó los precios de los `model_profile` contra el `llms.txt` público de fal y recableó
// las etiquetas de texto libre de los steps a los `falEndpoint` REALES del catálogo
// (`gallery-seed/model-profiles.json`) donde el endpoint está confirmado. Las HORQUILLAS de coste
// (min/max) NO cambian: son el COGS de 30 s del Apéndice B (§16.1), un RANGO que refleja cuánto
// b-roll lleva la receta, NO la suma de un modelo por unidad. Los dos precios que SÍ derivaron
// respecto a §13.1 —OmniHuman $0,14→$0,16/s y ace-step ~$0,005→$0,0002/s— quedan MUY dentro de las
// horquillas del Apéndice B, así que el rango del tier sigue correcto y la invariante de T2.2
// (±10 % vs Apéndice B) se mantiene. Los b-roll cuyo endpoint fal NO se pudo resolver (Wan 2.6,
// Kling v3, Seedance 2.0 — 404 en fal el 2026-07-15) siguen como ETIQUETA: deuda `[verificar]` de
// §13.1 l.600 que se cierra en su integración de F4, no aquí (no se inventa un endpoint que
// rompería la clave natural de `model_profile`). `model` guarda ahora el `falEndpoint` cuando existe.
export const RECIPE_SEEDS: RecipeSeed[] = [
  {
    tier: 'test',
    steps: [
      { component: 'avatar', model: 'veed/avatars/text-to-video' },
      { component: 'broll', model: 'Grok Imagine / Wan 2.6 Flash [endpoint pendiente F4]' },
      { component: 'voice', model: 'fal-ai/kokoro' },
      { component: 'shots', model: 'fal-ai/bytedance/seedream/v4.5/edit' },
    ],
    estCost30sMinCents: 30,
    estCost30sMaxCents: 170,
    notes:
      'Apéndice B — hook-testing masivo y borradores. COGS 30 s: $0,3–1,7. Endpoints recableados en T3.4 (broll pendiente F4).',
  },
  {
    tier: 'standard',
    steps: [
      { component: 'avatar', model: 'fal-ai/kling-video/ai-avatar/v2/standard' },
      {
        component: 'broll',
        model: 'Kling v3 Std / Wan 2.6 (+ R2V Seedance) [endpoint pendiente F4]',
      },
      { component: 'voice', model: 'fal-ai/elevenlabs/tts/turbo-v2.5' },
      { component: 'shots', model: 'fal-ai/nano-banana-2/edit' },
    ],
    estCost30sMinCents: 180,
    estCost30sMaxCents: 500,
    notes:
      'Apéndice B — producción por defecto. COGS 30 s: $1,8–5. Endpoints recableados en T3.4 (broll pendiente F4).',
  },
  {
    tier: 'premium',
    steps: [
      { component: 'avatar', model: 'fal-ai/bytedance/omnihuman/v1.5' },
      { component: 'broll', model: 'fal-ai/veo3.1/image-to-video' },
      { component: 'voice', model: 'fal-ai/elevenlabs/tts/eleven-v3' },
      { component: 'shots', model: 'fal-ai/nano-banana-pro/edit' },
    ],
    estCost30sMinCents: 900,
    estCost30sMaxCents: 1300,
    notes:
      'Apéndice B — ganadores y campañas de presupuesto alto. COGS 30 s: $9–13. Endpoints recableados en T3.4.',
  },
];

/** La librería completa que `pnpm seed` inserta y que el gate valida. */
export const SEED_LIBRARY = {
  hooks: HOOK_LINE_SEEDS,
  ctas: CTA_LINE_SEEDS,
  recipes: RECIPE_SEEDS,
};
