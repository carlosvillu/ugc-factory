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
    'PERSONA DE EJEMPLO — sustitúyeme: edítame desde /personas y sube tus propias imágenes de referencia. ' +
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
    'PERSONA DE EJEMPLO — sustitúyeme: edítame desde /personas y sube tus propias imágenes de referencia. ' +
    'Calm and matter-of-fact, explains rather than sells; the educator role of §10.3. ' +
    'Never claims to be a real customer.',
  wardrobeNotes: 'Plain training tee, no logos; same outfit across CUTs.',
  voiceMap: {
    es: { provider: 'elevenlabs', voiceId: 'placeholder-es-m', label: 'Placeholder ES' },
    en: { provider: 'elevenlabs', voiceId: 'placeholder-en-m', label: 'Placeholder EN' },
  },
  referenceImageCount: 2,
};

/** Las personas que siembra `pnpm seed`. Una `es`, una `en` (§17: el seed cubre es+en). */
export const PERSONA_SEEDS: readonly PersonaSeed[] = [LUCIA, MARCUS];
