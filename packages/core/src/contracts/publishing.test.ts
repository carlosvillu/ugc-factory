// Contrato de PUBLICACIÓN (T6.2, §15.4/§14/§preámbulo F6). Codifica como REGRESIÓN PERMANENTE (regla de
// trabajo 8) las dos cláusulas DETERMINISTAS de la Verificación, cada una con su CONTROL NEGATIVO que muerde
// (principio 9 del arnés):
//   1. la regla Spark: `native_trending` BLOQUEA Spark con explicación; un bed IA lo PERMITE. El control
//      negativo del planning («revertir la regla Spark → Spark se ofrece para native_trending → ROJO») se
//      ejerce aquí: si `sparkEligibility('native_trending').allowed` volviera `true`, este test da rojo.
//   2. la pausa de CP5: con CP5 activado, `start` PAUSA en `waiting_confirmation` y solo `confirm` reanuda a
//      `confirmed`. El control negativo del planning («revertir el flag de pausa de CP5 → el flujo no se
//      detiene → ROJO»): si la rama de pausa desapareciera (start→confirmed directo), este test da rojo.
import { describe, expect, it } from 'vitest';

import {
  SPARK_BLOCK_REASON,
  buildPublishingState,
  nextPublishState,
  sparkEligibility,
} from './publishing';

// ── 1. La regla Spark (§14 pt 2) ──────────────────────────────────────────────────────────────────────────
describe('sparkEligibility (§14 pt 2)', () => {
  it('BLOQUEA Spark para native_trending CON explicación', () => {
    const r = sparkEligibility('native_trending');
    expect(r.allowed).toBe(false);
    // La Verificación exige «bloquea la opción Spark CON explicación»: la razón no es opcional aquí.
    expect(r.reason).toBe(SPARK_BLOCK_REASON);
    expect(r.reason).toMatch(/licencia|comercial/i);
  });

  it('PERMITE Spark para un bed IA (§14: bed royalty-free, admisible en ads)', () => {
    const r = sparkEligibility('ai_bed');
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('PERMITE Spark para licencia propia y para none (no es trending nativo)', () => {
    expect(sparkEligibility('own_license').allowed).toBe(true);
    expect(sparkEligibility('none').allowed).toBe(true);
  });

  it('CONTROL NEGATIVO: la regla keya SOLO en native_trending — ningún otro valor bloquea', () => {
    // Si alguien ampliara el bloqueo a otro audio_source, este test lo cazaría: SOLO native_trending es
    // el que no está licenciado para uso comercial (§14). El control negativo del planning (revertir la
    // comparación) rompe el `expect(false)` de arriba.
    const blocked = (['none', 'ai_bed', 'own_license', 'native_trending'] as const).filter(
      (s) => !sparkEligibility(s).allowed,
    );
    expect(blocked).toEqual(['native_trending']);
  });
});

// ── 2. La máquina de estados de CP5 (§preámbulo F6 / §268) ─────────────────────────────────────────────────
describe('nextPublishState — CP5 pausa/reanudación', () => {
  it('con CP5 ACTIVADO, start PAUSA en waiting_confirmation (no llega a confirmed)', () => {
    const s = nextPublishState({ cp5Enabled: true, current: 'ready', action: 'start' });
    expect(s).toBe('waiting_confirmation');
  });

  it('desde waiting_confirmation, SOLO confirm reanuda a confirmed', () => {
    expect(
      nextPublishState({ cp5Enabled: true, current: 'waiting_confirmation', action: 'confirm' }),
    ).toBe('confirmed');
    // Reiniciar (start) sobre un flujo ya pausado es no-op: NO salta la confirmación.
    expect(
      nextPublishState({ cp5Enabled: true, current: 'waiting_confirmation', action: 'start' }),
    ).toBe('waiting_confirmation');
  });

  it('con CP5 DESACTIVADO, start va directo a confirmed (sin pausa)', () => {
    const s = nextPublishState({ cp5Enabled: false, current: 'ready', action: 'start' });
    expect(s).toBe('confirmed');
  });

  it('reopen vuelve a ready desde cualquier estado', () => {
    expect(nextPublishState({ cp5Enabled: true, current: 'confirmed', action: 'reopen' })).toBe(
      'ready',
    );
    expect(
      nextPublishState({ cp5Enabled: true, current: 'waiting_confirmation', action: 'reopen' }),
    ).toBe('ready');
  });

  it('CONTROL NEGATIVO: con CP5 on, el flujo se DETIENE — start!=confirmed', () => {
    // El control negativo del planning: «revertir el flag de pausa de CP5 → el flujo NO se detiene». Si la
    // rama `cp5Enabled` de `start` desapareciera (start→confirmed siempre), este assert da ROJO: con CP5
    // activado, iniciar NO puede llegar a confirmed sin pasar por la confirmación.
    const started = nextPublishState({ cp5Enabled: true, current: 'ready', action: 'start' });
    expect(started).not.toBe('confirmed');
    expect(started).toBe('waiting_confirmation');
  });
});

// ── 3. El ensamblado del estado de publicación ─────────────────────────────────────────────────────────────
describe('buildPublishingState', () => {
  it('fusiona las marcas persistidas con el checklist §15.4 (done por id)', () => {
    const state = buildPublishingState({
      platforms: ['tiktok'],
      audioSource: 'ai_bed',
      destination: 'organic',
      marks: { aigc_disclosure: true },
      cp5Enabled: false,
      flowState: 'ready',
    });
    const aigc = state.checklist.find((i) => i.id === 'aigc_disclosure');
    const c2pa = state.checklist.find((i) => i.id === 'c2pa_present');
    expect(aigc?.done).toBe(true);
    expect(c2pa?.done).toBe(false);
    // El aviso de RESET al duplicar campañas (§15.4) aparece para TikTok (reusa el ítem del bundle).
    expect(state.checklist.some((i) => i.id === 'tiktok_duplicate_recheck')).toBe(true);
  });

  it('la elegibilidad de Spark sale del audio_source de la VARIANTE (no del bundle degradado)', () => {
    const trending = buildPublishingState({
      platforms: ['tiktok'],
      audioSource: 'native_trending',
      destination: 'organic',
      marks: {},
      cp5Enabled: false,
      flowState: 'ready',
    });
    expect(trending.spark.allowed).toBe(false);
    const bed = buildPublishingState({
      platforms: ['tiktok'],
      audioSource: 'ai_bed',
      destination: 'organic',
      marks: {},
      cp5Enabled: false,
      flowState: 'ready',
    });
    expect(bed.spark.allowed).toBe(true);
  });

  it('una marca huérfana (id que ya no aplica) NO resucita un ítem', () => {
    // `meta_ai_info_label` solo aplica con plataforma meta; una marca vieja no lo mete si ya no hay meta.
    const state = buildPublishingState({
      platforms: ['tiktok'],
      audioSource: 'ai_bed',
      destination: 'organic',
      marks: { meta_ai_info_label: true },
      cp5Enabled: false,
      flowState: 'ready',
    });
    expect(state.checklist.some((i) => i.id === 'meta_ai_info_label')).toBe(false);
  });
});
