// LA VERIFICACIÓN DE T3.4, CODIFICADA COMO TEST PERMANENTE (regla de trabajo 8 + skill testing §9):
// la cláusula "introducir un precio falso en el seed hace que lo detecte" es determinista y gratuita,
// así que vive en `pnpm gate` — SIN golpear fal.
//
// PRINCIPIO 9 DE LA SKILL testing (el arnés nunca más cómodo que la realidad, forma (a)): estos
// fixtures son los BYTES REALES del `llms.txt` público de fal, capturados con curl el 2026-07-15
// (`packages/core/test/fixtures/fal-llms/*.txt`) — NO fixtures hechos a mano con el formato que le
// conviene al parser. Por eso el test prueba que el parser sobrevive a los DOS formatos reales de fal
// (`- **Price**: $X per <unit>` estructurado y `will cost $X per <unit>` en prosa) y al caso SIN
// precio. Y el control negativo asserta sobre la SALIDA de `compareModelProfile` —la MISMA función que
// corre en `pnpm fal:verify`— no sobre una reimplementación (forma (d) del principio 9).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ModelCost } from './contracts';
import { compareModelProfile, parseFalPrice } from './fal-catalog-verify';

function fixture(name: string): string {
  return readFileSync(new URL(`../../test/fixtures/fal-llms/${name}`, import.meta.url), 'utf8');
}

describe('parseFalPrice: extrae precio+unidad de los DOS formatos reales del llms.txt de fal', () => {
  it('formato ESTRUCTURADO `- **Price**: $0.0002 per seconds` (kokoro: $0.02/1k chars)', () => {
    const parsed = parseFalPrice(fixture('kokoro.llms.txt'));
    expect(parsed).not.toBeNull();
    expect(parsed?.unit).toBe('1k_chars');
    expect(parsed?.amountCents).toBeCloseTo(2, 6); // $0.02 → 2 céntimos
  });

  it('formato ESTRUCTURADO con unidad `minutes` (veed avatars: $0.35/min)', () => {
    const parsed = parseFalPrice(fixture('veed-avatars.llms.txt'));
    expect(parsed?.unit).toBe('minute');
    expect(parsed?.amountCents).toBeCloseTo(35, 6);
  });

  it('formato ESTRUCTURADO con unidad `seconds` (omnihuman: $0.16/s — el precio REAL de fal)', () => {
    const parsed = parseFalPrice(fixture('omnihuman-v1.5.llms.txt'));
    expect(parsed?.unit).toBe('second');
    expect(parsed?.amountCents).toBeCloseTo(16, 6);
  });

  it('formato PROSA `Your request will cost **$0.08** per image` (nano-banana-2)', () => {
    const parsed = parseFalPrice(fixture('nano-banana-2-edit.llms.txt'));
    expect(parsed?.unit).toBe('image');
    expect(parsed?.amountCents).toBeCloseTo(8, 6);
  });

  it('formato PROSA con importe sub-céntimo `$0.0002 per second` (ace-step)', () => {
    const parsed = parseFalPrice(fixture('ace-step.llms.txt'));
    expect(parsed?.unit).toBe('second');
    expect(parsed?.amountCents).toBeCloseTo(0.02, 6); // $0.0002 → 0.02 céntimos
  });

  it('formato PROSA `$0.2 for videos up to 40 seconds` (latentsync: por vídeo)', () => {
    const parsed = parseFalPrice(fixture('latentsync.llms.txt'));
    expect(parsed?.unit).toBe('video');
    expect(parsed?.amountCents).toBeCloseTo(20, 6); // $0.20 → 20 céntimos
  });

  it('formato PROSA `**$3** per minute` (sync-lipsync v2)', () => {
    const parsed = parseFalPrice(fixture('sync-lipsync-v2.llms.txt'));
    expect(parsed?.unit).toBe('minute');
    expect(parsed?.amountCents).toBeCloseTo(300, 6); // $3 → 300 céntimos
  });

  it('formato UNIDAD-PRIMERO `For every second of video ... charged $0.20` (veo3.1: precio BASE, no el tier 4k)', () => {
    // El texto de Veo tiene $0.20 (base), $0.40 (con audio / 4k sin audio) y $0.60. El parser DEBE
    // devolver el BASE ($0.20/s), que es el que aparece PRIMERO — no el `$0.40 per second` del 4k.
    const parsed = parseFalPrice(fixture('veo3.1.llms.txt'));
    expect(parsed?.unit).toBe('second');
    expect(parsed?.amountCents).toBeCloseTo(20, 6); // $0.20 base, NO $0.40 del tier 4k
  });

  it('página SIN precio reconocible → null (NO crashea: el perfil será `unverifiable`)', () => {
    expect(parseFalPrice('# Some Model\n\n> No pricing line here at all.\n')).toBeNull();
    expect(parseFalPrice('')).toBeNull();
  });
});

describe('compareModelProfile: OK / divergencia / no-verificable (la Verificación de T3.4)', () => {
  const kokoroSeed: Pick<import('./contracts').ModelProfileSeed, 'falEndpoint' | 'cost'> = {
    falEndpoint: 'fal-ai/kokoro',
    cost: { unit: '1k_chars', amountCents: 2 },
  };

  it('CONTROL POSITIVO: el precio del seed COINCIDE con el de fal → `ok`', () => {
    const result = compareModelProfile(kokoroSeed, fixture('kokoro.llms.txt'));
    expect(result.outcome).toBe('ok');
    expect(result.falCost?.amountCents).toBeCloseTo(2, 6);
  });

  it('CONTROL NEGATIVO: un PRECIO FALSO inyectado en el seed → `divergence` (la Verificación literal)', () => {
    // "introducir un precio falso en el seed hace que lo detecte": el seed dice 99 c/1k chars,
    // fal publica 2. La comparación (sobre la MISMA función que corre en `fal:verify`) lo caza.
    const fakePriceSeed = {
      falEndpoint: 'fal-ai/kokoro',
      cost: { unit: '1k_chars', amountCents: 99 } satisfies ModelCost,
    };
    const result = compareModelProfile(fakePriceSeed, fixture('kokoro.llms.txt'));
    expect(result.outcome).toBe('divergence');
    expect(result.detail).toContain('99'); // nombra el precio del seed
    expect(result.detail).toContain('2'); // y el leído de fal
  });

  it('DIVERGENCIA REAL detectada: OmniHuman en §13.1 era $0.14/s, fal publica $0.16/s', () => {
    // El precio VIEJO del PRD (14 c/s) contra el llms.txt real → divergencia. (El seed ya se
    // recalibró a 16; este test demuestra que la herramienta HABRÍA cazado el precio viejo.)
    const stalePrdPrice = {
      falEndpoint: 'fal-ai/bytedance/omnihuman/v1.5',
      cost: { unit: 'second', amountCents: 14 } satisfies ModelCost,
    };
    const result = compareModelProfile(stalePrdPrice, fixture('omnihuman-v1.5.llms.txt'));
    expect(result.outcome).toBe('divergence');
  });

  it('RECONCILIACIÓN DE UNIDAD: seed en /minute vs fal en /second (tiempo↔tiempo) compara bien', () => {
    // Si el seed guardara VEED por segundo ($0.35/min = 0.5833 c/s) y fal lo diera por minuto,
    // un string-compare siempre divergiría. La reconciliación por segundos lo cuadra.
    const perSecondSeed = {
      falEndpoint: 'veed/avatars/text-to-video',
      cost: { unit: 'second', amountCents: 35 / 60 } satisfies ModelCost, // 0.35/min → c/s
    };
    const result = compareModelProfile(perSecondSeed, fixture('veed-avatars.llms.txt'));
    expect(result.outcome).toBe('ok');
  });

  it('el fetch FALLÓ (llmsTxt === null: 404/timeout) → `unverifiable`, NO crash', () => {
    const result = compareModelProfile(kokoroSeed, null);
    expect(result.outcome).toBe('unverifiable');
    expect(result.falCost).toBeNull();
  });

  it('página sin precio → `unverifiable` (se REPORTA, no se traga)', () => {
    const result = compareModelProfile(kokoroSeed, '# X\n\n> nada de precio\n');
    expect(result.outcome).toBe('unverifiable');
  });

  it('unidad INCOMPATIBLE (image vs 1k_chars) → `divergence` (no un OK silencioso)', () => {
    const imageSeed = {
      falEndpoint: 'fal-ai/kokoro',
      cost: { unit: 'image', amountCents: 2 } satisfies ModelCost,
    };
    const result = compareModelProfile(imageSeed, fixture('kokoro.llms.txt'));
    expect(result.outcome).toBe('divergence');
    expect(result.detail).toContain('unidad');
  });
});
