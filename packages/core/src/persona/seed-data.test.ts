// EL TEST QUE VALIDA EL SEED REAL DE PERSONAS (T4.12 Pase B, regla de trabajo 8: toda cláusula
// determinista y gratuita de la Verificación se codifica como control permanente del gate).
//
// Corre dentro de `pnpm test` → `pnpm gate`, SIN Docker (unit puro). El seed de personas
// (`PERSONA_SEEDS`) alimenta CÓDIGO — no un JSON validado por un validador dedicado como la galería —,
// así que sus refinamientos Zod (`ageRange` `^\d{2}-\d{2}$`, `descriptor` ≤160, `personality` ≤600,
// `setting` ≤200, `voiceId` min 1, `gender` enum cerrado) NO los caza NADA en el gate: TypeScript solo
// ve `string`, la BD no impone la regex/longitud, y la integración solo INSERTA. Una persona mal
// autoreada colaría por typecheck + insert y solo reventaría más tarde al parsear con `PersonaSchema`
// — o peor, tras gastar dinero real generando sus referencias IA. Este test lo mueve al gate: romper
// un seed (edad `29-3`, descriptor de 200 chars, voiceId vacío) pone `pnpm gate` ROJO.
//
// Mismo criterio que `gallery/seed-validator.test.ts` y `library/seed-validator.test.ts`: valida el
// seed REAL que `pnpm seed` inserta, no un fixture de juguete (principio 9 de la skill testing).
import { describe, expect, it } from 'vitest';
import { PERSONA_SEEDS } from './seed-data';
import { PersonaBodySchema } from './contracts';

describe('el seed REAL de personas que siembra `pnpm seed` (T4.12)', () => {
  it('cada persona pasa `PersonaBodySchema` (control positivo del gate)', () => {
    for (const seed of PERSONA_SEEDS) {
      const result = PersonaBodySchema.safeParse(seed);
      // Mensaje útil si algún día se rompe: dice EXACTAMENTE qué persona y qué campo está mal.
      expect(result.success, `«${seed.name}»: ${result.error?.message ?? ''}`).toBe(true);
    }
  });

  it('control NEGATIVO: un seed con `ageRange` malformado NO valida (el gate mordería)', () => {
    const [first] = PERSONA_SEEDS;
    expect(first).toBeDefined();
    const broken = { ...first, ageRange: '29-3' };
    expect(PersonaBodySchema.safeParse(broken).success).toBe(false);
  });

  it('control NEGATIVO: un `voiceId` vacío NO valida (placeholders no pueden quedar en blanco)', () => {
    const [first] = PERSONA_SEEDS;
    expect(first).toBeDefined();
    const broken = {
      ...first,
      voiceMap: { es: { provider: 'elevenlabs' as const, voiceId: '' } },
    };
    expect(PersonaBodySchema.safeParse(broken).success).toBe(false);
  });

  it('el catálogo tiene 10 personas con nombres únicos (T4.12: escala de 2 a 10)', () => {
    expect(PERSONA_SEEDS.length).toBe(10);
    const names = new Set(PERSONA_SEEDS.map((p) => p.name));
    expect(names.size).toBe(PERSONA_SEEDS.length);
  });

  it('el catálogo tiene diversidad real: >1 etnia, >1 tramo de edad, incluye `non_binary`', () => {
    const ethnicities = new Set(PERSONA_SEEDS.map((p) => p.ethnicity));
    const ageRanges = new Set(PERSONA_SEEDS.map((p) => p.ageRange));
    const genders = new Set(PERSONA_SEEDS.map((p) => p.gender));
    expect(ethnicities.size).toBeGreaterThan(1);
    expect(ageRanges.size).toBeGreaterThan(1);
    expect(genders.has('non_binary')).toBe(true);
  });
});
