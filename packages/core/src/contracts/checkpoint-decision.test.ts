// El contrato de la DECISIÓN de un checkpoint (T1.11). Es la FRONTERA del canal: lo que este
// schema acepta es lo que acaba en `checkpoint_decision` (jsonb opaco para la BD), y lo que
// rechaza es un 400 antes de tocarla. Sin este schema el canal sería un jsonb libre, y la basura
// se descubriría en F4 — cuando N7a intente leer la decisión y no entienda lo que hay.
import { describe, expect, it } from 'vitest';
import type { AdScript } from './ad-script';
import { CheckpointDecisionSchema } from './checkpoint-decision';

/** Un `AdScript` VÁLIDO mínimo (el CONTRATO de core, no la fila de BD) para el `editedScript` de un
 *  veredicto de CP3. Se valida al construirlo implícitamente al pasarlo por el schema de decisión. */
function makeScript(overrides: Partial<AdScript> = {}): AdScript {
  return {
    filenameCode: 'demo-x-es-30s',
    hook: 'Mira esto.',
    cta: 'Enlace abajo.',
    scenes: [
      {
        t: 0,
        seconds: 2,
        segment: 'hook',
        narration: 'Mira esto.',
        visual: 'v',
        camera: 'c',
        emotion: 'e',
      },
      {
        t: 2,
        seconds: 5,
        segment: 'body',
        narration: 'Cuerpo del guion.',
        visual: 'v',
        camera: 'c',
        emotion: 'e',
      },
      {
        t: 7,
        seconds: 2,
        segment: 'cta',
        narration: 'Enlace abajo.',
        visual: 'v',
        camera: 'c',
        emotion: 'e',
      },
    ],
    subtitles: [{ start: 0, end: 2, text: 'Mira esto.' }],
    fullText: 'Mira esto. Cuerpo del guion. Enlace abajo.',
    wordCount: 7,
    estSeconds: 9,
    tone: 'directo',
    language: 'es',
    sharedBodyKey: 'body-key',
    ...overrides,
  };
}

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

  // ── T2.6 · CP3 · GUIONES ────────────────────────────────────────────────────────────────
  describe('CP3 (scripts)', () => {
    it('acepta veredictos por variante SIN edición (aprobar/rechazar el guion tal cual)', () => {
      const decision = {
        kind: 'scripts',
        verdicts: [
          { variantId: 'var_01', approved: true },
          { variantId: 'var_02', approved: false },
        ],
      };
      const parsed = CheckpointDecisionSchema.safeParse(decision);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual(decision);
    });

    it('acepta un veredicto CON `editedScript` (el guion reescrito por el usuario)', () => {
      const parsed = CheckpointDecisionSchema.safeParse({
        kind: 'scripts',
        verdicts: [{ variantId: 'var_01', approved: true, editedScript: makeScript() }],
      });
      expect(parsed.success).toBe(true);
    });

    it('RECHAZA `verdicts` vacío: una decisión de CP3 sin veredictos no significa nada', () => {
      // Sin `.min(1)`, un `verdicts: []` aprobaría el step sin tocar ni una variante — el usuario
      // creería haber decidido y ninguna variante llegaría a `scripted`.
      expect(CheckpointDecisionSchema.safeParse({ kind: 'scripts', verdicts: [] }).success).toBe(
        false,
      );
    });

    it('RECHAZA un `editedScript` que NO es un AdScript válido (guion corrupto)', () => {
      // El `editedScript` es INPUT del cliente: un guion sin escenas o con campos que faltan no
      // puede persistirse como v2. La frontera lo para aquí, no en la BD.
      expect(
        CheckpointDecisionSchema.safeParse({
          kind: 'scripts',
          verdicts: [{ variantId: 'var_01', approved: true, editedScript: { hook: 'x' } }],
        }).success,
      ).toBe(false);
    });

    it('RECHAZA un veredicto sin `variantId` (no se sabe a qué variante aplica)', () => {
      expect(
        CheckpointDecisionSchema.safeParse({ kind: 'scripts', verdicts: [{ approved: true }] })
          .success,
      ).toBe(false);
    });
  });
});
