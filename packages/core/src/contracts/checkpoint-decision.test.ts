// El contrato de la DECISIÓN de un checkpoint (T1.11). Es la FRONTERA del canal: lo que este
// schema acepta es lo que acaba en `checkpoint_decision` (jsonb opaco para la BD), y lo que
// rechaza es un 400 antes de tocarla. Sin este schema el canal sería un jsonb libre, y la basura
// se descubriría en F4 — cuando N7a intente leer la decisión y no entienda lo que hay.
import { describe, expect, it } from 'vitest';
import { CheckpointDecisionSchema } from './checkpoint-decision';

describe('CheckpointDecisionSchema (T1.11)', () => {
  it('acepta las DOS salidas de CP1 (subir fotos / packshot-IA, §7.2 N3)', () => {
    for (const images of ['upload_images', 'ai_packshot'] as const) {
      const parsed = CheckpointDecisionSchema.safeParse({ kind: 'brief', images });
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({ kind: 'brief', images });
    }
  });

  it('rechaza un valor FUERA del enum (la decisión es tipada, no texto libre)', () => {
    expect(
      CheckpointDecisionSchema.safeParse({ kind: 'brief', images: 'lo_que_sea' }).success,
    ).toBe(false);
  });

  it('rechaza un `kind` de un checkpoint que TODAVÍA no existe (CP2/CP3/CP4)', () => {
    // La unión discriminada es la frontera de validación: CP2 entrará añadiendo SU miembro aquí
    // —no relajando esto a `unknown`—. Hasta entonces, su decisión es un caller confundido.
    expect(CheckpointDecisionSchema.safeParse({ kind: 'matrix', generate: ['v1'] }).success).toBe(
      false,
    );
  });

  it('rechaza una decisión SIN `kind` (nadie sabría qué checkpoint la tomó)', () => {
    expect(CheckpointDecisionSchema.safeParse({ images: 'ai_packshot' }).success).toBe(false);
  });
});
