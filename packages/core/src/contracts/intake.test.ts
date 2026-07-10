// Suite del contrato ManualIntakeConfig (unit-core.md §3): fixture válido +
// mutaciones dirigidas. El mismo schema valida en cliente (RHF) y servidor, así que
// estas reglas son las que el formulario y el handler comparten.
import { describe, expect, it } from 'vitest';

import { ManualIntakeConfigSchema, MANUAL_FREE_TEXT_MIN, MANUAL_IMAGE_REFS_MAX } from './intake';

const valid = () => ({
  source: 'manual' as const,
  projectId: '01J000000000000000000PROJ0',
  freeText: 'Un sérum hidratante con ácido hialurónico para piel sensible que hidrata 24 horas.',
  imageRefs: [{ url: '/api/assets/01J000000000000000000ASSET/download', alt: 'packshot' }],
});

describe('ManualIntakeConfigSchema', () => {
  it('el fixture canónico (texto + una imagen) valida', () => {
    expect(ManualIntakeConfigSchema.safeParse(valid()).success).toBe(true);
  });

  it('sin imágenes valida y aplica default []', () => {
    const { imageRefs: _omit, ...noImages } = valid();
    const parsed = ManualIntakeConfigSchema.parse(noImages);
    expect(parsed.imageRefs).toEqual([]);
  });

  it('recorta (trim) el texto antes de validar la longitud mínima', () => {
    const padded = `   ${'x'.repeat(MANUAL_FREE_TEXT_MIN)}   `;
    const parsed = ManualIntakeConfigSchema.parse({ ...valid(), freeText: padded });
    expect(parsed.freeText).toBe('x'.repeat(MANUAL_FREE_TEXT_MIN));
  });

  it('texto por debajo del mínimo se rechaza', () => {
    const short = 'x'.repeat(MANUAL_FREE_TEXT_MIN - 1);
    expect(ManualIntakeConfigSchema.safeParse({ ...valid(), freeText: short }).success).toBe(false);
  });

  it('un texto de solo espacios se rechaza (min tras trim)', () => {
    expect(ManualIntakeConfigSchema.safeParse({ ...valid(), freeText: '     ' }).success).toBe(
      false,
    );
  });

  it('source distinto de manual se rechaza (T1.6 solo texto libre)', () => {
    expect(ManualIntakeConfigSchema.safeParse({ ...valid(), source: 'url' }).success).toBe(false);
  });

  it('projectId vacío se rechaza (FK NOT NULL en url_analysis)', () => {
    expect(ManualIntakeConfigSchema.safeParse({ ...valid(), projectId: '' }).success).toBe(false);
  });

  it(`más de ${String(MANUAL_IMAGE_REFS_MAX)} imágenes se rechaza`, () => {
    const many = Array.from({ length: MANUAL_IMAGE_REFS_MAX + 1 }, (_u, i) => ({
      url: `/api/assets/img-${String(i)}/download`,
    }));
    expect(ManualIntakeConfigSchema.safeParse({ ...valid(), imageRefs: many }).success).toBe(false);
  });
});
