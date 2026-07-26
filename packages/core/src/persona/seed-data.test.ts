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
import { PersonaBodySchema, type PersonaBody } from './contracts';

/** El `voiceId` marca de placeholder (los seeds de ejemplo lo llevan `placeholder-*`): fal lo rechaza con
 *  422, así que una voz así NO puede completar N7b. Lo que hace COMPLETA a una persona es NO tener ninguna
 *  voz placeholder en su `voice_map`. */
function hasOnlyRealVoices(seed: PersonaBody): boolean {
  const voices = Object.values(seed.voiceMap);
  return voices.length > 0 && voices.every((v) => !v.voiceId.startsWith('placeholder'));
}

/** ¿La persona es COMPLETA para arrancar un lote generativo? — imágenes de referencia (N7c/avatar) Y una
 *  voz real que fal acepta (N7b). Es la ANTI-CORRELACIÓN que T5.15 arregla: el seed debe traer ≥1 así. Las
 *  imágenes las materializa el seed desde `referenceImageCount` (PNGs sintéticos ≥2K), así que aquí el
 *  proxy de «tiene imágenes» es `referenceImageCount > 0`. */
function isBatchReady(seed: (typeof PERSONA_SEEDS)[number]): boolean {
  return seed.referenceImageCount > 0 && hasOnlyRealVoices(seed);
}

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

  it('el catálogo tiene 11 personas con nombres únicos (T4.12: 10 placeholder + T5.15: Maya, la completa)', () => {
    // 10 placeholder (T4.12) + 1 COMPLETA no-placeholder (MAYA, T5.15).
    expect(PERSONA_SEEDS.length).toBe(11);
    const names = new Set(PERSONA_SEEDS.map((p) => p.name));
    expect(names.size).toBe(PERSONA_SEEDS.length);
  });

  // ── T5.15: el seed DEBE traer ≥1 persona capaz de completar un lote generativo ─────────────────────
  // El bug de producción era una ANTI-CORRELACIÓN PERFECTA: las que tenían imágenes tenían voz placeholder
  // (fal 422) y la que tenía voz real no tenía imágenes (CP3 500). Este control permanente muerde el gate
  // si el seed vuelve a quedarse sin NINGUNA persona completa.
  it('CONTROL POSITIVO (T5.15): al menos una persona es batch-ready (imágenes + voz REAL que fal acepta)', () => {
    const ready = PERSONA_SEEDS.filter(isBatchReady);
    expect(
      ready.length,
      'el seed no trae NINGUNA persona completa: un usuario recién instalado no puede completar un lote generativo',
    ).toBeGreaterThan(0);
    // La persona completa NO puede llevar el sufijo `(placeholder)` (es dato de catálogo real, no un
    // ejemplo sustituible): si alguien la marcara así, sería que perdimos la persona buena de verdad.
    for (const p of ready) {
      expect(
        p.name.includes('(placeholder)'),
        `«${p.name}» es batch-ready pero está marcada placeholder`,
      ).toBe(false);
    }
  });

  it('CONTROL NEGATIVO (T5.15): vaciarle las imágenes a la persona completa la deja NO batch-ready', () => {
    const ready = PERSONA_SEEDS.find(isBatchReady);
    expect(ready).toBeDefined();
    if (ready === undefined) return;
    // Sin imágenes de referencia (N7c/avatar no puede generar) ⇒ ya no es batch-ready.
    expect(isBatchReady({ ...ready, referenceImageCount: 0 })).toBe(false);
  });

  it('CONTROL NEGATIVO (T5.15): ponerle voz placeholder a la persona completa la deja NO batch-ready', () => {
    const ready = PERSONA_SEEDS.find(isBatchReady);
    expect(ready).toBeDefined();
    if (ready === undefined) return;
    // voiceId placeholder ⇒ fal responde 422 en N7b ⇒ ya no es batch-ready.
    const broken = {
      ...ready,
      voiceMap: { es: { provider: 'elevenlabs' as const, voiceId: 'placeholder-es' } },
    };
    expect(isBatchReady(broken)).toBe(false);
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
