// El contrato de la DECISIÓN de un checkpoint (T1.11). Es la FRONTERA del canal: lo que este
// schema acepta es lo que acaba en `checkpoint_decision` (jsonb opaco para la BD), y lo que
// rechaza es un 400 antes de tocarla. Sin este schema el canal sería un jsonb libre, y la basura
// se descubriría en F4 — cuando N7a intente leer la decisión y no entienda lo que hay.
import { describe, expect, it } from 'vitest';
import { CheckpointDecisionSchema } from './checkpoint-decision';

describe('CheckpointDecisionSchema (T1.11)', () => {
  it('acepta las salidas SIN imagen elegida de CP1 (subir fotos / packshot-IA, §7.2 N3)', () => {
    for (const images of ['upload_images', 'ai_packshot'] as const) {
      const parsed = CheckpointDecisionSchema.safeParse({ kind: 'brief', images });
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({ kind: 'brief', images });
    }
  });

  // ── T1.15 · PROMOVER una imagen scrapeada a hero ────────────────────────────────────────
  it('acepta `promote_scraped` CON la imagen elegida (la tercera salida, T1.15)', () => {
    const decision = {
      kind: 'brief',
      images: 'promote_scraped',
      hero_image_url: 'https://es.stayforlong.com/img/hero-banner-hotel.jpg',
    };
    const parsed = CheckpointDecisionSchema.safeParse(decision);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(decision);
  });

  it('RECHAZA `promote_scraped` SIN imagen: N7a no podría ejecutar esa decisión', () => {
    // El invariante vive en el CONTRATO, no en el llamante: una decisión de promover que no dice
    // QUÉ imagen es basura que se descubriría en F4, gastando dinero en fal.ai contra un `null`.
    expect(
      CheckpointDecisionSchema.safeParse({ kind: 'brief', images: 'promote_scraped' }).success,
    ).toBe(false);
  });

  it('RECHAZA una imagen elegida SIN `promote_scraped` (la otra mitad del bicondicional)', () => {
    // Un `ai_packshot` que además trae hero_image_url es un caller confundido: o promueve, o
    // genera. Aceptarlo dejaría a N7a con dos fuentes de verdad contradictorias.
    expect(
      CheckpointDecisionSchema.safeParse({
        kind: 'brief',
        images: 'ai_packshot',
        hero_image_url: 'https://cdn.example.com/x.jpg',
      }).success,
    ).toBe(false);
  });

  it('RECHAZA una `hero_image_url` que no es una URL', () => {
    expect(
      CheckpointDecisionSchema.safeParse({
        kind: 'brief',
        images: 'promote_scraped',
        hero_image_url: 'la-segunda',
      }).success,
    ).toBe(false);
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
