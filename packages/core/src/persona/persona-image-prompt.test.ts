// Tests PUROS del prompt de imágenes de referencia (T4.12 pase B). Sin red, sin sharp: prompt in →
// string out. Verifican que el retrato base incorpora el casting de la persona y que los encuadres
// describen SOLO la composición (nunca re-describen al sujeto — eso rompería el identity lock).
import { describe, expect, it } from 'vitest';
import {
  buildPersonaPortraitPrompt,
  REFERENCE_FRAMINGS,
  type PersonaPortraitInput,
} from './persona-image-prompt';
import { REFERENCE_IMAGES_MIN } from './contracts';

const LUCIA: PersonaPortraitInput = {
  descriptor: 'mujer de 29 años, latina, look casual de diario',
  ethnicity: 'latina',
  gender: 'female',
  ageRange: '25-34',
  style: 'casual',
  setting: 'baño con luz natural de ventana, encimera con dos o tres productos',
  wardrobeNotes: 'Camiseta lisa de color plano y pelo recogido; misma ropa en todos los CUTs.',
};

describe('buildPersonaPortraitPrompt', () => {
  it('es determinista: mismo input → mismo prompt', () => {
    expect(buildPersonaPortraitPrompt(LUCIA)).toBe(buildPersonaPortraitPrompt(LUCIA));
  });

  it('incorpora el casting del §11: descriptor, etnia, rango de edad, estilo, escenario', () => {
    const prompt = buildPersonaPortraitPrompt(LUCIA);
    expect(prompt).toContain('mujer de 29 años, latina, look casual de diario');
    expect(prompt).toContain('latina ethnicity');
    expect(prompt).toContain('25 to 34 years old');
    expect(prompt).toContain('casual style');
    expect(prompt).toContain('baño con luz natural');
  });

  it('traduce el género al sustantivo del casting', () => {
    expect(buildPersonaPortraitPrompt({ ...LUCIA, gender: 'female' })).toContain('woman');
    expect(buildPersonaPortraitPrompt({ ...LUCIA, gender: 'male' })).toContain('man');
    expect(buildPersonaPortraitPrompt({ ...LUCIA, gender: 'non_binary' })).toContain('person');
  });

  it('incluye el vestuario cuando la persona lo fija, y lo omite cuando no', () => {
    expect(buildPersonaPortraitPrompt(LUCIA)).toContain('Wearing:');
    const noWardrobe = buildPersonaPortraitPrompt({ ...LUCIA, wardrobeNotes: null });
    expect(noWardrobe).not.toContain('Wearing:');
    expect(buildPersonaPortraitPrompt({ ...LUCIA, wardrobeNotes: '   ' })).not.toContain(
      'Wearing:',
    );
  });

  it('excluye texto/logos/otras personas (una referencia es de UN sujeto)', () => {
    const prompt = buildPersonaPortraitPrompt(LUCIA);
    expect(prompt).toContain('No text');
    expect(prompt).toContain('no other people');
  });

  it('recorta campos muy largos sin reventar', () => {
    const long = 'a'.repeat(500);
    const prompt = buildPersonaPortraitPrompt({ ...LUCIA, descriptor: long });
    expect(prompt).toContain('…');
    expect(prompt).not.toContain('a'.repeat(500));
  });
});

describe('REFERENCE_FRAMINGS', () => {
  it('tiene 2–3 encuadres, coherente con REFERENCE_IMAGES_MIN', () => {
    expect(REFERENCE_FRAMINGS.length).toBeGreaterThanOrEqual(REFERENCE_IMAGES_MIN);
    expect(REFERENCE_FRAMINGS.length).toBeLessThanOrEqual(3);
  });

  it('cada encuadre describe SOLO la composición manteniendo la identidad (no re-describe la cara)', () => {
    for (const framing of REFERENCE_FRAMINGS) {
      expect(framing.prompt).toContain('Same person');
      expect(framing.id).toBeTruthy();
      // No cuela demografía concreta (etnia/edad) que re-caracterizaría al sujeto.
      expect(framing.prompt.toLowerCase()).not.toContain('years old');
    }
  });

  it('los ids son únicos (curación/logs los referencian)', () => {
    const ids = REFERENCE_FRAMINGS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
