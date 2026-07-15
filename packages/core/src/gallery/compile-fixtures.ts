// FIXTURES del compilador de prompts (T3.5), compartidos por sus tests unitarios, los golden files
// y el CLI. Viven en `src` (no en test-utils) porque el CLI de `pnpm compile:prompt` los importa
// para compilar "una variante real" sin BD: son datos de DEMO deterministas, no factories de test.
//
// ⚠ Construidos a mano (no vía `makeBrief`, que hace shallow-merge y rompería sub-objetos) para
// controlar EXACTAMENTE las facetas que la Verificación exige: category `beauty` (única vertical
// con guard pack sembrado) + ≥2 benefits (el template unboxing usa `{benefit[1]}`).
import type { ProductBrief } from '../contracts/product-brief';
import type { AdScript } from '../contracts/ad-script';
import type { Persona } from '../persona/contracts';

/** Brief de DEMO en el vertical `beauty` (guard pack sembrado) con 2 benefits y 1 objection. */
export const DEMO_BEAUTY_BRIEF: ProductBrief = {
  meta: {
    source_url: 'https://tienda.example.com/products/serum',
    platform: 'shopify',
    language: 'es',
    extracted_at: '2026-07-15T12:00:00.000Z',
    extraction_confidence: 'high',
    warnings: [],
  },
  product: {
    name: 'GlowSerum 24h',
    brand_name: 'Aurora',
    category: 'beauty',
    subcategory: 'hidratación',
    one_liner: 'El sérum que hidrata 24 horas y se nota al despertar',
    description: 'Sérum con ácido hialurónico para piel sensible.',
    features: [
      { feature: 'Ácido hialurónico', evidence: 'con ácido hialurónico de bajo peso molecular' },
    ],
    how_it_works: 'Se aplica por la noche sobre la piel limpia.',
    variants: ['30ml'],
  },
  benefits: [
    {
      benefit: 'hidrata 24 horas sin sensación grasa',
      linked_feature: 'Ácido hialurónico',
      emotional_outcome: 'te ves descansada',
      type: 'functional',
    },
    {
      benefit: 'reduce la tirantez desde el primer uso',
      linked_feature: 'Ácido hialurónico',
      emotional_outcome: 'piel cómoda',
      type: 'functional',
    },
  ],
  audience: {
    primary_segment: 'Mujeres 25-40 con piel sensible',
    segments: [
      {
        name: 'Piel sensible',
        demographics: 'Mujeres 25-40, urbanas',
        psychographics: 'Buscan ingredientes seguros y probados',
        awareness_level: 'problem_aware',
        usage_context: 'Rutina de noche',
        avatar_hint: 'Creadora 30 años, estilo natural, baño luminoso',
      },
    ],
    not_for: 'Pieles muy grasas que buscan matificar',
  },
  pain_points: [
    {
      pain: 'la piel tira después de lavarla',
      severity: 'high',
      current_alternative: 'Cremas genéricas',
      evidence: null,
    },
  ],
  objections: [
    {
      objection: 'es caro',
      type: 'price',
      counter: 'dura 3 meses, sale a menos que un café',
      counter_source: 'inferred',
    },
  ],
  social_proof: {
    rating: 4.7,
    review_count: 1240,
    quotes: [{ quote: 'Mi piel cambió en una semana', author: 'Ana G.' }],
    badges: ['Visto en Vogue'],
    stats: ['+50.000 clientes'],
  },
  brand: {
    tone_of_voice: 'cercana y experta',
    recommended_ad_tone: 'authentic',
    visual_style: {
      palette: ['#F5E9E2', '#3A3A3A'],
      typography: 'serif elegante',
      aesthetic: 'premium minimal',
      photography_style: 'lifestyle luminoso',
    },
    banned_or_risky_claims: ['cura el acné'],
  },
  pricing: {
    price: '34,90 €',
    currency: 'EUR',
    compare_at_price: '44,90 €',
    active_offer: '10% primera compra',
    guarantee: '30 días',
    shipping: 'Gratis desde 30€',
    positioning: 'premium',
  },
  assets: {
    hero_image_url: 'https://cdn.example.com/glowserum-hero.jpg',
    images: [
      {
        url: 'https://cdn.example.com/glowserum-hero.jpg',
        kind: 'packshot',
        has_overlay_text: false,
        background: 'clean',
        video_suitability: 'hero',
      },
    ],
    video_urls: [],
  },
  angles: Array.from({ length: 5 }, (_unused, i) => ({
    name: `Ángulo ${String(i + 1)}`,
    framework: 'pain_point' as const,
    target_segment: 'Mujeres 25-40 con piel sensible',
    awareness_level: 'problem_aware' as const,
    hook_examples: [
      'POV: llevas años probando cremas que no hacen nada',
      'Y si el problema no era tu piel',
    ],
    key_message: 'Hidratación real que se nota al despertar',
    objection_addressed: null,
    social_proof_used: null,
    cta: 'Pruébalo 30 días sin riesgo',
    suggested_tone: 'authentic' as const,
    suggested_assets: [],
  })),
};

/** Persona de DEMO (identity lock con 2 imágenes de referencia). */
export const DEMO_PERSONA: Persona = {
  name: 'Lucía',
  ageRange: '25-34',
  gender: 'female',
  ethnicity: 'latina',
  style: 'casual',
  descriptor: 'mujer de 29 años, latina, look casual de diario',
  setting: 'baño con luz natural de ventana, encimera con dos o tres productos',
  personality: 'Cercana y directa, presenta el producto como demo estilo creator.',
  wardrobeNotes: 'Camiseta lisa y pelo recogido; misma ropa en todos los CUTs.',
  voiceMap: { es: { provider: 'elevenlabs', voiceId: 'demo-es', label: 'Demo ES' } },
  id: '01JXDEMOPERSONA0000000000',
  referenceImageIds: ['01JXDEMOREFIMG0000000001', '01JXDEMOREFIMG0000000002'],
  createdAt: '2026-07-15T12:00:00.000Z',
  updatedAt: '2026-07-15T12:00:00.000Z',
};

/** Guion de DEMO (hook/cta YA en idioma destino: la fuente correcta de `{hook.line}`/`{cta.line}`). */
export const DEMO_SCRIPT: AdScript = {
  filenameCode: 'demo-beauty-a1-es-22s',
  hook: 'Si tu piel tira al despertar, esto es para ti',
  cta: 'Pruébalo 30 días sin riesgo, enlace en la bio',
  scenes: [
    {
      t: 0,
      seconds: 3,
      segment: 'hook',
      narration: 'Si tu piel tira al despertar, esto es para ti',
      visual: 'primer plano a cámara',
      camera: 'fija, brazo extendido',
      emotion: 'cercana',
    },
    {
      t: 3,
      seconds: 15,
      segment: 'body',
      narration: 'Me lo aplico por la noche y por la mañana la piel está hidratada',
      visual: 'aplicación del producto',
      camera: 'handheld',
      emotion: 'convencida',
    },
    {
      t: 18,
      seconds: 4,
      segment: 'cta',
      narration: 'Pruébalo 30 días sin riesgo, enlace en la bio',
      visual: 'plano del producto',
      camera: 'fija',
      emotion: 'invitación',
    },
  ],
  subtitles: [
    { start: 0, end: 3, text: 'Si tu piel tira al despertar, esto es para ti' },
    { start: 3, end: 18, text: 'Me lo aplico por la noche y por la mañana la piel está hidratada' },
    { start: 18, end: 22, text: 'Pruébalo 30 días sin riesgo, enlace en la bio' },
  ],
  fullText:
    'Si tu piel tira al despertar, esto es para ti. Me lo aplico por la noche y por la mañana la piel está hidratada. Pruébalo 30 días sin riesgo, enlace en la bio.',
  wordCount: 30,
  estSeconds: 22,
  tone: 'cercano',
  language: 'es',
  sharedBodyKey: 'demo-beauty-a1-body',
};
