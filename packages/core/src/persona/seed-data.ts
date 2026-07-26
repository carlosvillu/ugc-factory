// LAS 2 PERSONAS PLACEHOLDER DEL SEED (T2.0: «seed manual de 2 personas (es/en)»).
//
// ⚠ SON PLACEHOLDERS, Y ESO ES DELIBERADO. La Entrega del planning pedía sembrarlas «con
// imágenes subidas a mano»; la decisión del usuario (2026-07-12) es construir y verificar TODA
// la maquinaria con imágenes SINTÉTICAS y dejar que él suba sus dos caras reales más tarde
// USANDO EL PROPIO CRUD de `/personas` — sin tocar código. Por eso:
//
//   · el nombre lleva el sufijo «(placeholder)» y la personalidad lo dice en la primera línea:
//     el usuario tiene que RECONOCERLAS de un vistazo en la lista y saber que las sustituye;
//   · sus imágenes de referencia las GENERA el seed (PNGs sintéticos ≥2K, `reference-images.ts`)
//     y pasan la MISMA validación de dimensiones que un upload real — no se saltan nada;
//   · NADA de generación IA (fal.ai): eso es F4. Coste de esta tarea: $0.
//
// La `voice_map` sí es real en forma (`{locale: {provider, voiceId}}`, §12) pero sus `voiceId`
// son placeholders declarados: la asignación de voz CON PREVIEW llega en F4 (§11 «asignación de
// voz con preview»), y hasta entonces ningún nodo llama a un TTS con estos ids.
import type { PersonaBody } from './contracts';

/** El sufijo que marca a una persona como sembrada-y-sustituible: va EN EL NOMBRE (que es la
 *  clave natural), así el usuario la reconoce de un vistazo en la lista y sabe que la sustituye. */
const PLACEHOLDER_SUFFIX = '(placeholder)';

/** El aviso administrativo (idéntico en las 10) que abre `personality`: marca la persona como de
 *  ejemplo y le dice al usuario cómo sustituirla. Es un marcador fijo del placeholder, no dato de
 *  catálogo — por eso es una constante y no se copia en cada seed (solo la voz distintiva de cada
 *  persona se escribe a mano tras este prefijo). */
const PLACEHOLDER_PERSONALITY_PREFIX =
  'PERSONA DE EJEMPLO — sustitúyeme: edítame desde /personas y sube tus propias imágenes de referencia. ';

/**
 * Una persona del seed: su cuerpo + cuántas imágenes de referencia sintéticas se le generan.
 * El seed es la fuente de verdad de los METADATOS (mismo criterio que la librería de T2.1:
 * `library.repo.ts`); la BD, de la historia.
 */
export interface PersonaSeed extends PersonaBody {
  /** Nº de imágenes de referencia sintéticas ≥2K que el seed genera y sube por esta persona.
   *  ≥ `REFERENCE_IMAGES_MIN` (§11: «mismo sujeto en 2–3 encuadres»). */
  referenceImageCount: number;
}

/** La persona del mercado ES. */
const LUCIA: PersonaSeed = {
  name: `Lucía ${PLACEHOLDER_SUFFIX}`,
  ageRange: '25-34',
  gender: 'female',
  ethnicity: 'latina',
  style: 'casual',
  descriptor: 'mujer de 29 años, latina, look casual de diario',
  setting: 'baño con luz natural de ventana, encimera con dos o tres productos',
  personality:
    PLACEHOLDER_PERSONALITY_PREFIX +
    'Cercana y directa, habla como una amiga que recomienda algo que de verdad le funcionó. ' +
    'Nunca afirma ser clienta real: presenta el producto como demo estilo creator (§10.3, rol honesto).',
  wardrobeNotes: 'Camiseta lisa de color plano y pelo recogido; misma ropa en todos los CUTs.',
  voiceMap: {
    es: { provider: 'elevenlabs', voiceId: 'placeholder-es', label: 'Placeholder ES' },
    en: { provider: 'elevenlabs', voiceId: 'placeholder-en', label: 'Placeholder EN' },
  },
  referenceImageCount: 2,
};

/** La persona del mercado EN. */
const MARCUS: PersonaSeed = {
  name: `Marcus ${PLACEHOLDER_SUFFIX}`,
  ageRange: '35-44',
  gender: 'male',
  ethnicity: 'black',
  style: 'sporty',
  descriptor: 'man in his late 30s, black, sporty everyday look',
  setting: 'home gym corner with a yoga mat and a window behind',
  personality:
    PLACEHOLDER_PERSONALITY_PREFIX +
    'Calm and matter-of-fact, explains rather than sells; the educator role of §10.3. ' +
    'Never claims to be a real customer.',
  wardrobeNotes: 'Plain training tee, no logos; same outfit across CUTs.',
  voiceMap: {
    es: { provider: 'elevenlabs', voiceId: 'placeholder-es-m', label: 'Placeholder ES' },
    en: { provider: 'elevenlabs', voiceId: 'placeholder-en-m', label: 'Placeholder EN' },
  },
  referenceImageCount: 2,
};

// ────────────────────────────────────────────────────────────────────────────────────────────────
// EL CATÁLOGO DE 10 PERSONAS (T4.12 Pase B: «seed hasta 10–20 Personas (es/en) con curación manual»).
// LUCIA/MARCUS (arriba) fueron el molde de T2.0; las 8 de aquí completan un catálogo UGC creíble:
// diversidad REAL de etnia, edad (18-24 → 55-64), género (incl. `non_binary`) y estilo, balanceado
// es/en (5 es · 5 en). SIGUEN siendo placeholders (`(placeholder)` en el nombre, el usuario las
// sustituye por el CRUD) y su `voice_map` sigue con `voiceId` PLACEHOLDER (la asignación de voz real
// con preview no es parte de la Verificación de T4.12 — §11 la deja a F4).
//
// El `descriptor` es la frase rica de §10.4 que ALIMENTA el prompt del retrato (buildPersonaPortraitPrompt):
// por eso es concreto y visual (edad + etnia + look). El resto de campos (setting/wardrobeNotes) dan al
// identity-lock su escena y su vestuario coherente entre CUTs.

/** Persona ES — creadora de belleza/skincare, joven. */
const NEREA: PersonaSeed = {
  name: `Nerea ${PLACEHOLDER_SUFFIX}`,
  ageRange: '18-24',
  gender: 'female',
  ethnicity: 'white',
  style: 'trendy',
  descriptor: 'mujer de 22 años, blanca, estética trendy de creadora de skincare, piel luminosa',
  setting: 'tocador junto a una ventana grande, luz de día suave, estantería con productos detrás',
  personality:
    PLACEHOLDER_PERSONALITY_PREFIX +
    'Entusiasta y detallista, comparte rutinas paso a paso como con una amiga cercana. ' +
    'Nunca afirma ser clienta real: presenta el producto como demo estilo creator (§10.3, rol honesto).',
  wardrobeNotes:
    'Top básico de tirantes en tono neutro y pelo suelto; mismo look en todos los CUTs.',
  voiceMap: {
    es: { provider: 'elevenlabs', voiceId: 'placeholder-es-nerea', label: 'Placeholder ES' },
    en: { provider: 'elevenlabs', voiceId: 'placeholder-en-nerea', label: 'Placeholder EN' },
  },
  referenceImageCount: 2,
};

/** Persona ES — cocina/hogar, mediana edad. */
const CARMEN: PersonaSeed = {
  name: `Carmen ${PLACEHOLDER_SUFFIX}`,
  ageRange: '45-54',
  gender: 'female',
  ethnicity: 'latina',
  style: 'homey',
  descriptor: 'mujer de 49 años, latina, look hogareño y cálido, sonrisa amable',
  setting: 'cocina luminosa con encimera de madera, plantas en la ventana y utensilios a la vista',
  personality:
    PLACEHOLDER_PERSONALITY_PREFIX +
    'Maternal y práctica, explica con calma trucos que usa a diario en casa. ' +
    'Nunca afirma ser clienta real: presenta el producto como demo estilo creator (§10.3, rol honesto).',
  wardrobeNotes: 'Blusa lisa de manga corta y delantal opcional; mismo conjunto en todos los CUTs.',
  voiceMap: {
    es: { provider: 'elevenlabs', voiceId: 'placeholder-es-carmen', label: 'Placeholder ES' },
    en: { provider: 'elevenlabs', voiceId: 'placeholder-en-carmen', label: 'Placeholder EN' },
  },
  referenceImageCount: 2,
};

/** Persona ES — tech/gadgets, no binaria. */
const ALEX: PersonaSeed = {
  name: `Alex ${PLACEHOLDER_SUFFIX}`,
  ageRange: '25-34',
  gender: 'non_binary',
  ethnicity: 'asian',
  style: 'streetwear',
  descriptor: 'persona andrógina de 27 años, asiática, estética streetwear urbana, pelo corto',
  setting: 'escritorio con setup de tech, luz de neón tenue y una estantería de gadgets al fondo',
  personality:
    PLACEHOLDER_PERSONALITY_PREFIX +
    'Curiosa y directa, desmonta gadgets con criterio y sin postureo. ' +
    'Nunca afirma ser cliente real: presenta el producto como demo estilo creator (§10.3, rol honesto).',
  wardrobeNotes: 'Sudadera oversize lisa sin logos; mismo look en todos los CUTs.',
  voiceMap: {
    es: { provider: 'elevenlabs', voiceId: 'placeholder-es-alex', label: 'Placeholder ES' },
    en: { provider: 'elevenlabs', voiceId: 'placeholder-en-alex', label: 'Placeholder EN' },
  },
  referenceImageCount: 2,
};

/** Persona ES — bienestar/senior, mayor. */
const ROSA: PersonaSeed = {
  name: `Rosa ${PLACEHOLDER_SUFFIX}`,
  ageRange: '55-64',
  gender: 'female',
  ethnicity: 'white',
  style: 'elegant',
  descriptor: 'mujer de 58 años, blanca, estilo elegante y sereno, pelo canoso cuidado',
  setting: 'salón luminoso con sillón junto a una ventana, plantas y luz natural cálida',
  personality:
    PLACEHOLDER_PERSONALITY_PREFIX +
    'Cálida y pausada, habla del bienestar diario con confianza y cercanía. ' +
    'Nunca afirma ser clienta real: presenta el producto como demo estilo creator (§10.3, rol honesto).',
  wardrobeNotes: 'Blusa de tono suave y un pañuelo ligero; mismo conjunto en todos los CUTs.',
  voiceMap: {
    es: { provider: 'elevenlabs', voiceId: 'placeholder-es-rosa', label: 'Placeholder ES' },
    en: { provider: 'elevenlabs', voiceId: 'placeholder-en-rosa', label: 'Placeholder EN' },
  },
  referenceImageCount: 2,
};

/** Persona EN — fitness/nutrition, young adult. */
const PRIYA: PersonaSeed = {
  name: `Priya ${PLACEHOLDER_SUFFIX}`,
  ageRange: '25-34',
  gender: 'female',
  ethnicity: 'south asian',
  style: 'athleisure',
  descriptor: 'woman in her late 20s, south asian, athleisure look, fit and energetic',
  setting: 'bright home studio with a yoga mat, dumbbells and a large window behind',
  personality:
    PLACEHOLDER_PERSONALITY_PREFIX +
    'Upbeat and encouraging, coaches like a friend who wants you to win. ' +
    'Never claims to be a real customer: presents the product as a creator-style demo (§10.3, honest role).',
  wardrobeNotes: 'Plain fitted training top, no logos; same outfit across CUTs.',
  voiceMap: {
    es: { provider: 'elevenlabs', voiceId: 'placeholder-es-priya', label: 'Placeholder ES' },
    en: { provider: 'elevenlabs', voiceId: 'placeholder-en-priya', label: 'Placeholder EN' },
  },
  referenceImageCount: 2,
};

/** Persona EN — home/DIY, middle-aged man. */
const DAVID: PersonaSeed = {
  name: `David ${PLACEHOLDER_SUFFIX}`,
  ageRange: '45-54',
  gender: 'male',
  ethnicity: 'white',
  style: 'rugged',
  descriptor: 'man in his late 40s, white, rugged everyday look, short beard',
  setting: 'garage workshop corner with tools on a pegboard and warm work lighting',
  personality:
    PLACEHOLDER_PERSONALITY_PREFIX +
    'Down-to-earth and hands-on, explains how things work without overselling. ' +
    'Never claims to be a real customer: presents the product as a creator-style demo (§10.3, honest role).',
  wardrobeNotes: 'Plain flannel shirt, sleeves rolled; same outfit across CUTs.',
  voiceMap: {
    es: { provider: 'elevenlabs', voiceId: 'placeholder-es-david', label: 'Placeholder ES' },
    en: { provider: 'elevenlabs', voiceId: 'placeholder-en-david', label: 'Placeholder EN' },
  },
  referenceImageCount: 2,
};

/** Persona EN — fashion/lifestyle, young. */
const CHLOE: PersonaSeed = {
  name: `Chloe ${PLACEHOLDER_SUFFIX}`,
  ageRange: '18-24',
  gender: 'female',
  ethnicity: 'black',
  style: 'chic',
  descriptor: 'woman of 23, black, chic modern fashion look, natural curls',
  setting: 'minimal bedroom with a clothing rack and soft window light',
  personality:
    PLACEHOLDER_PERSONALITY_PREFIX +
    'Warm and stylish, talks fashion like getting ready with a friend. ' +
    'Never claims to be a real customer: presents the product as a creator-style demo (§10.3, honest role).',
  wardrobeNotes: 'Plain fitted top in a neutral tone; same look across CUTs.',
  voiceMap: {
    es: { provider: 'elevenlabs', voiceId: 'placeholder-es-chloe', label: 'Placeholder ES' },
    en: { provider: 'elevenlabs', voiceId: 'placeholder-en-chloe', label: 'Placeholder EN' },
  },
  referenceImageCount: 2,
};

/** Persona EN — outdoors/gear, middle-aged. */
const KENJI: PersonaSeed = {
  name: `Kenji ${PLACEHOLDER_SUFFIX}`,
  ageRange: '35-44',
  gender: 'male',
  ethnicity: 'asian',
  style: 'outdoorsy',
  descriptor: 'man in his late 30s, asian, outdoorsy look, weathered and friendly face',
  setting: 'cabin porch with pine trees behind and soft natural daylight',
  personality:
    PLACEHOLDER_PERSONALITY_PREFIX +
    'Calm and adventurous, reviews gear from real trail experience. ' +
    'Never claims to be a real customer: presents the product as a creator-style demo (§10.3, honest role).',
  wardrobeNotes: 'Plain technical jacket, no logos; same outfit across CUTs.',
  voiceMap: {
    es: { provider: 'elevenlabs', voiceId: 'placeholder-es-kenji', label: 'Placeholder ES' },
    en: { provider: 'elevenlabs', voiceId: 'placeholder-en-kenji', label: 'Placeholder EN' },
  },
  referenceImageCount: 2,
};

// ────────────────────────────────────────────────────────────────────────────────────────────────
// LA PERSONA COMPLETA Y LISTA-PARA-GENERAR (T5.15: «el seed no contiene ninguna Persona capaz de
// completar un lote generativo»).
//
// EL BUG DE PRODUCCIÓN QUE ARREGLA: N7c (avatar) exige `reference_image_ids` y N7b (voz) exige un
// `voiceId` que fal ACEPTE. Las 10 placeholder de arriba tienen imágenes pero su `voiceId` es
// `placeholder-*` (fal lo rechaza con 422): NINGUNA cumple las DOS a la vez, así que un usuario que
// instala el proyecto no puede completar un lote generativo con el seed que trae. Esta persona SÍ
// cumple ambas: imágenes sintéticas ≥2K (como las placeholder) Y un `voice_map` con `voiceId` REALES
// de ElevenLabs que fal acepta.
//
// POR QUÉ NO LLEVA `(placeholder)` EN EL NOMBRE (deliberado): NO es un ejemplo sustituible — es la
// persona que hace que el seed sea funcional de fábrica. Su personalidad NO abre con el aviso
// administrativo del placeholder: no se pide al usuario que la borre. Es dato de catálogo real.
//
// ⚠ REPO PÚBLICO — LOS voiceId NO SON SECRETOS: `Rachel` (en) y `EXAVITQu4vr4xnSDxMaL` (Sarah, es) son
// IDENTIFICADORES PÚBLICOS del catálogo de ElevenLabs, no credenciales — no dan acceso a nada sin una
// API key aparte (esa vive solo en `.env`/`app_setting`, nunca en el árbol). Ambos ya están validados
// contra fal REAL por verifiers anteriores (fal los acepta). El endpoint TTS del tier premium es
// `fal-ai/elevenlabs/tts/eleven-v3` (library/seed-data.ts) → mismo proveedor `elevenlabs`, así que
// `resolveVoiceTriple` acepta este voice_map y N7b resuelve para es y en.
/** La persona COMPLETA del seed: NO-placeholder, con imágenes de referencia Y voces reales de fal. Es la
 *  única del seed con la que un lote premium puede arrancar generación de fábrica (T5.15). */
const MAYA: PersonaSeed = {
  name: 'Maya',
  ageRange: '25-34',
  gender: 'female',
  ethnicity: 'mixed',
  style: 'natural',
  descriptor: 'mujer de 30 años, rasgos mixtos, estética natural y cercana, sonrisa espontánea',
  setting: 'salón luminoso con luz natural de ventana y una estantería sencilla detrás',
  personality:
    'Cercana y honesta, habla como una amiga que recomienda algo que de verdad le funcionó. ' +
    'Nunca afirma ser clienta real: presenta el producto como demo estilo creator (§10.3, rol honesto).',
  wardrobeNotes: 'Camiseta lisa de tono neutro y pelo suelto; mismo look en todos los CUTs.',
  voiceMap: {
    // voiceId REALES de ElevenLabs que fal acepta (validados contra fal real por verifiers anteriores):
    // Sarah para es, Rachel para en. NO son placeholders → N7b resuelve sin 422.
    es: { provider: 'elevenlabs', voiceId: 'EXAVITQu4vr4xnSDxMaL', label: 'ElevenLabs · Sarah' },
    en: { provider: 'elevenlabs', voiceId: 'Rachel', label: 'ElevenLabs · Rachel' },
  },
  referenceImageCount: 3,
};

/**
 * Las personas que siembra `pnpm seed` — el CATÁLOGO: MAYA (T5.15: la única COMPLETA, imágenes + voces
 * reales, con la que un lote premium arranca generación de fábrica) + las 10 placeholder de ejemplo (§17:
 * el seed cubre es+en; T4.12 escaló de 2 a 10 con curación manual). Balance de locale por `descriptor`
 * en las placeholder: 5 es (Lucía, Nerea, Carmen, Alex, Rosa) · 5 en (Marcus, Priya, David, Chloe, Kenji).
 * Diversidad de edad (18-24 → 55-64), género (incl. `non_binary`) y etnia deliberada — un catálogo UGC
 * creíble, no clones. MAYA va PRIMERA: es la que el usuario debe encontrar lista para usar.
 */
export const PERSONA_SEEDS: readonly PersonaSeed[] = [
  MAYA,
  LUCIA,
  MARCUS,
  NEREA,
  CARMEN,
  ALEX,
  ROSA,
  PRIYA,
  DAVID,
  CHLOE,
  KENJI,
];
