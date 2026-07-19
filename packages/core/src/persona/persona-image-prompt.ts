// Constructor del PROMPT de las IMÁGENES DE REFERENCIA de una Persona (T4.12 pase B, §11 identity
// lock). Lógica PURA: de los campos de la persona → el prompt text-to-image del RETRATO BASE, y los
// SUFIJOS de encuadre que cada imagen de referencia añade. Vive en core (browser-safe, sin sharp ni
// red): se testea sin levantar nada, y ni siquiera necesita `persona/server` (no toca ficheros).
//
// EL MECANISMO DE IDENTITY LOCK (decidido y validado con probes de fal real, ver el journal 2026-07-19):
//   1. Un RETRATO BASE con FLUX.2 t2i (`buildPersonaPortraitPrompt`): la cara del sujeto, descrita a
//      partir de la demografía de la persona (descriptor/ethnicity/gender/ageRange/style/setting/
//      wardrobeNotes). Es INTERMEDIO — se sube a fal storage y se usa como `image_urls[0]` de NB2; NO
//      se persiste como reference_image.
//   2. Cada ENCUADRE con `fal-ai/nano-banana-2/edit` pasándole `image_urls:[retratoBase]` y un prompt
//      que describe SOLO el nuevo encuadre (`REFERENCE_FRAMINGS`): NB2 mantiene la identidad de la
//      referencia; NO se re-describe la cara (hacerlo la cambiaría). Cada salida NB2 (≥2K) SÍ se
//      persiste como reference_image de la persona.
//
// POR QUÉ NO EL COMPILADOR N6. El compilador de guiones (§10.4) resuelve `{persona.descriptor}` etc.
// dentro del prompt de un CUT concreto; aquí el objetivo es OTRO — un retrato de estudio del sujeto,
// aislado, sin escena de anuncio. Molde a copiar: `generation/packshot-prompt.ts` (buildPackshotPrompt,
// con `trimForPrompt`).
import { trimForPrompt } from '../generation/prompt-text';
import type { PersonaGender } from './contracts';

/** El subconjunto ESTRUCTURAL de una persona que el prompt necesita (no se acopla a `@ugc/db` ni al
 *  contrato completo `Persona`: el compositor y el servicio alimentan formas de dato distintas, igual
 *  que `MatchablePersona`). Son los campos de casting del §11 que describen al sujeto. */
export interface PersonaPortraitInput {
  descriptor: string;
  ethnicity: string;
  gender: PersonaGender;
  ageRange: string;
  style: string;
  setting: string;
  wardrobeNotes?: string | null;
}

/** Etiqueta legible del género para el casting del prompt (los valores del enum van al texto: son
 *  parte del contrato del prompt, no texto libre). */
const GENDER_WORD: Readonly<Record<PersonaGender, string>> = {
  female: 'woman',
  male: 'man',
  non_binary: 'person',
};

/**
 * UN ENCUADRE de referencia: su `id` estable (entra en logs/tests, NO en el prompt) y el `prompt` de
 * SOLO-framing que NB2 recibe. El prompt describe la POSE/COMPOSICIÓN, nunca la cara (esa la carga la
 * referencia base): re-describir al sujeto rompería el identity lock.
 *
 * Coherente con `REFERENCE_IMAGES_MIN=2` (§11 «mismo sujeto en 2–3 encuadres»): hay 3 encuadres, y una
 * persona «activa» necesita al menos 2 reference-images IA.
 */
export interface ReferenceFraming {
  id: 'frontal_headshot' | 'three_quarter_portrait' | 'full_body';
  /** El sufijo de prompt de SOLO-framing que va a NB2 (la cara la carga la referencia). */
  prompt: string;
}

/**
 * Los 2–3 encuadres del identity lock (§11). Cada uno describe SOLO la composición/pose — no la
 * identidad (NB2 la mantiene de la referencia base). El orden es el de curación: el frontal headshot
 * es el retrato principal (el grande del mockup 6c).
 */
export const REFERENCE_FRAMINGS: readonly ReferenceFraming[] = [
  {
    id: 'frontal_headshot',
    prompt:
      'Same person, front-facing headshot looking directly at the camera, head and shoulders framing, ' +
      'neutral studio background, soft even lighting, sharp focus on the face, natural relaxed expression.',
  },
  {
    id: 'three_quarter_portrait',
    prompt:
      'Same person, three-quarter turned portrait looking slightly away from the camera, upper-body ' +
      'framing, neutral studio background, soft directional lighting, natural pose.',
  },
  {
    id: 'full_body',
    prompt:
      'Same person, full-body standing shot facing the camera, feet to head visible, neutral studio ' +
      'background, soft even lighting, natural standing pose.',
  },
];

/**
 * Construye el prompt del RETRATO BASE de una persona (FLUX.2 t2i). Compone la identidad del sujeto
 * (demografía + estilo + escenario + vestuario) en un retrato de estudio, 9:16 vertical, SIN texto ni
 * logos. Determinista: mismo input → mismo prompt.
 *
 * IMPORTANTE: este es el prompt del BASE (la cara). Los ENCUADRES los describe `REFERENCE_FRAMINGS`,
 * que NO re-describe al sujeto — NB2 lo mantiene de la referencia.
 */
export function buildPersonaPortraitPrompt(persona: PersonaPortraitInput): string {
  const genderWord = GENDER_WORD[persona.gender];

  // Núcleo: quién es el sujeto. El `descriptor` es la frase redactada de §10.4 (no se concatena a
  // partir de campos: el prompt es redacción). Se refuerza con demografía estructurada por si el
  // descriptor la omite.
  const subject = [
    `Photorealistic studio portrait of a synthetic ${genderWord}`,
    trimForPrompt(persona.descriptor, 160),
    `${persona.ageRange.replace('-', ' to ')} years old`,
    `${trimForPrompt(persona.ethnicity, 60)} ethnicity`,
    `${trimForPrompt(persona.style, 60)} style`,
  ]
    .filter((s) => s.length > 0)
    .join(', ');

  // Vestuario (opcional): continuidad entre CUTs (§11 wardrobe continuity). Si la persona no lo fija,
  // se omite.
  const wardrobe =
    persona.wardrobeNotes && persona.wardrobeNotes.trim().length > 0
      ? ` Wearing: ${trimForPrompt(persona.wardrobeNotes, 160)}.`
      : '';

  // Escenario: el ancla cotidiana de la persona (§10.4 setting), como fondo suave — el retrato es del
  // SUJETO, el escenario solo lo contextualiza sin robar foco.
  const setting = ` Context: ${trimForPrompt(persona.setting, 160)}, softly out of focus.`;

  // Estilo de retrato de referencia: lo que lo hace un IDENTITY LOCK y no una escena. Fijo.
  const studio =
    ' Clean identity reference portrait, single subject centered, consistent facial features, ' +
    'realistic skin texture, high detail, 9:16 vertical composition.';

  // Exclusiones: nada de texto/logos ni varias personas (la referencia es de UN sujeto).
  const negatives = ' No text, no watermark, no logo, no other people, no collage.';

  return `${subject}.${wardrobe}${setting}${studio}${negatives}`;
}
