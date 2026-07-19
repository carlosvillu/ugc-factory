// El contrato del ARTEFACTO de N5 (T2.6): lo que el executor deja en `step_run.output_refs` y lo que
// CP3 discrimina para abrir su panel. Es LIGERO a propósito (refs, no guiones completos): la verdad
// vive en las filas `ad_script`, que el panel relee por REST. Aquí se fija que el artefacto acepta la
// forma ligera y rechaza que alguien meta un guion completo inline (drift silencioso).
import { describe, expect, it } from 'vitest';
import { newUlid } from './ids';
import { N5OutputSchema, N7aOutputSchema } from './step-outputs';

const BATCH = newUlid();
const VALID: unknown = {
  batchId: BATCH,
  scriptRefs: [
    { variantId: newUlid(), scriptId: newUlid(), filenameCode: 'x-a-es-30s', blocked: false },
    { variantId: newUlid(), scriptId: newUlid(), filenameCode: 'x-b-es-30s', blocked: true },
  ],
  status: 'scripted',
  warnings: [],
};

describe('N5OutputSchema (T2.6)', () => {
  it('acepta el artefacto LIGERO: batchId + refs de guion + status + warnings', () => {
    const parsed = N5OutputSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.scriptRefs).toHaveLength(2);
    expect(parsed.data?.scriptRefs[1]?.blocked).toBe(true);
  });

  it('acepta un lote SIN guiones (todos los grupos fallaron): refs vacías', () => {
    // El status del writer puede ser `refused`/`parse_error` con cero guiones — el artefacto sigue
    // siendo válido (el executor decide después si eso mata el step).
    expect(
      N5OutputSchema.safeParse({
        batchId: BATCH,
        scriptRefs: [],
        status: 'refused',
        warnings: ['x'],
      }).success,
    ).toBe(true);
  });

  it('RECHAZA un batchId ausente (sin él el panel no sabe a qué lote pedir los guiones)', () => {
    const { batchId: _drop, ...rest } = VALID as Record<string, unknown>;
    expect(N5OutputSchema.safeParse(rest).success).toBe(false);
  });

  it('RECHAZA una ref sin `blocked` (control negativo: el excerpt necesita saber si hay bloqueo)', () => {
    expect(
      N5OutputSchema.safeParse({
        batchId: BATCH,
        scriptRefs: [{ variantId: newUlid(), scriptId: newUlid(), filenameCode: 'x' }],
        status: 'scripted',
        warnings: [],
      }).success,
    ).toBe(false);
  });
});

describe('N7aOutputSchema (T4.4 + T4.4b): unión discriminada por ruta', () => {
  const shot = () => ({ generationId: newUlid(), assetId: newUlid(), costCents: 1 });

  it('ai_packshot acepta syntheticProduct:true (T4.4)', () => {
    const parsed = N7aOutputSchema.safeParse({
      route: 'ai_packshot',
      syntheticProduct: true,
      shots: [shot(), shot()],
    });
    expect(parsed.success).toBe(true);
  });

  it('upload_images / promote_scraped aceptan syntheticProduct:false (T4.4b: producto real)', () => {
    for (const route of ['upload_images', 'promote_scraped'] as const) {
      expect(
        N7aOutputSchema.safeParse({ route, syntheticProduct: false, shots: [shot()] }).success,
      ).toBe(true);
    }
  });

  // CONTROL NEGATIVO: el flag de procedencia acompaña a la ruta por CONSTRUCCIÓN. Un shot desde
  // referencias reales NO puede declararse `syntheticProduct:true` (mentiría sobre la procedencia), ni
  // un ai_packshot declararse `false`.
  it('RECHAZA promote_scraped con syntheticProduct:true (procedencia incoherente con la ruta)', () => {
    expect(
      N7aOutputSchema.safeParse({
        route: 'promote_scraped',
        syntheticProduct: true,
        shots: [shot()],
      }).success,
    ).toBe(false);
  });

  it('RECHAZA ai_packshot con syntheticProduct:false', () => {
    expect(
      N7aOutputSchema.safeParse({ route: 'ai_packshot', syntheticProduct: false, shots: [shot()] })
        .success,
    ).toBe(false);
  });

  it('RECHAZA una ruta desconocida', () => {
    expect(
      N7aOutputSchema.safeParse({ route: 'teleport', syntheticProduct: false, shots: [] }).success,
    ).toBe(false);
  });
});
