import { describe, expect, it } from 'vitest';
import { computeContentHash } from './content-hash';

describe('computeContentHash (§9.6 dedupe)', () => {
  const base = {
    resolvedPrompt: 'A serum bottle on marble',
    modelProfileId: 'mp_flux2dev',
    inputs: { image_size: 'square_hd', num_images: 1 },
  };

  it('es DETERMINISTA: la misma entrada da el mismo hash (sha256 de 64 hex)', () => {
    const a = computeContentHash(base);
    const b = computeContentHash({ ...base, inputs: { ...base.inputs } });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('NO depende del orden de las claves de inputs (objeto reordenado → mismo hash)', () => {
    const a = computeContentHash(base);
    const b = computeContentHash({
      ...base,
      inputs: { num_images: 1, image_size: 'square_hd' }, // orden invertido
    });
    expect(a).toBe(b);
  });

  // LEY, no punto fijo (principio 9.f de testing): se prueba que hashes DISTINTOS salen de
  // entradas distintas, en CADA uno de los tres campos — no basta "mismo→mismo".
  it('cambiar el prompt cambia el hash', () => {
    expect(computeContentHash(base)).not.toBe(
      computeContentHash({ ...base, resolvedPrompt: 'A different prompt' }),
    );
  });

  it('cambiar el model_profile_id cambia el hash', () => {
    expect(computeContentHash(base)).not.toBe(
      computeContentHash({ ...base, modelProfileId: 'mp_other' }),
    );
  });

  it('cambiar un input cambia el hash', () => {
    expect(computeContentHash(base)).not.toBe(
      computeContentHash({ ...base, inputs: { image_size: 'landscape_16_9', num_images: 1 } }),
    );
  });
});
