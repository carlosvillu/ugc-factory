// Suite del contrato RawContent (unit-core.md §3): fixture válido + mutaciones
// inválidas, con foco en el bicondicional de modo (manual sin URL, url con URL).
import { makeRawContent } from '@ugc/test-utils';
import { describe, expect, it } from 'vitest';

import { RawContentSchema, type RawContent } from './raw-content';
import { N1OutputSchema } from './step-outputs';

describe('RawContentSchema', () => {
  it('el fixture canónico (modo url, shopify con precio) valida', () => {
    expect(RawContentSchema.safeParse(makeRawContent()).success).toBe(true);
  });

  it('modo manual (source manual, url null, platform manual, sin fast path) valida', () => {
    const manual = makeRawContent({
      source: 'manual',
      url: null,
      platform: 'manual',
      markdown: 'Texto pegado por el usuario sobre el producto.',
      images: [],
      branding: null,
      product: null,
      screenshotRef: null,
    });
    expect(RawContentSchema.safeParse(manual).success).toBe(true);
  });

  const invalid: [name: string, mutate: (r: RawContent) => unknown][] = [
    [
      'manual con url no-null',
      (r) => ({ ...r, source: 'manual', url: 'https://x.com', platform: 'manual' }),
    ],
    [
      'manual con platform ≠ manual',
      (r) => ({ ...r, source: 'manual', url: null, platform: 'shopify' }),
    ],
    ['url con url null', (r) => ({ ...r, source: 'url', url: null })],
    ['url con platform manual', (r) => ({ ...r, source: 'url', platform: 'manual' })],
    ['source fuera del enum', (r) => ({ ...r, source: 'ftp' })],
    ['platform fuera del enum', (r) => ({ ...r, platform: 'magento' })],
    ['markdown ausente', (r) => ({ ...r, markdown: undefined })],
    ['images no es array', (r) => ({ ...r, images: 'x' })],
  ];

  it.each(invalid)('rechaza: %s', (_name, mutate) => {
    expect(RawContentSchema.safeParse(mutate(makeRawContent())).success).toBe(false);
  });
});

// ── T2.7 · `urlFinal` ────────────────────────────────────────────────────────
describe('RawContent.urlFinal (T2.7 — la URL que la web sirvió de verdad)', () => {
  it('acepta las DOS URLs (pedida + servida) en modo url', () => {
    const raw = makeRawContent({
      url: 'https://glow.example/products/serum',
      urlFinal: 'https://glow.example/',
    });
    expect(RawContentSchema.safeParse(raw).success).toBe(true);
  });

  it('AUSENTE valida: las filas de `url_analysis` ANTERIORES a T2.7 no lo tienen (sin migración)', () => {
    // `raw_content` es jsonb OPACO en BD y N1 lo relee con `RawContentSchema.parse` en cada
    // análisis manual/reuso: un campo REQUERIDO habría roto TODAS las filas viejas. Este test
    // es el guard de esa decisión — el jsonb histórico (sin `urlFinal`) tiene que seguir
    // pasando el parse, hoy y cuando alguien toque el contrato dentro de seis meses.
    const legacy = { ...makeRawContent() } as Record<string, unknown>;
    delete legacy.urlFinal;
    expect(RawContentSchema.safeParse(legacy).success).toBe(true);
  });

  it('modo manual: un `urlFinal` no-null se RECHAZA (sin red no hay redirección que registrar)', () => {
    const manual = {
      ...makeRawContent({ source: 'manual', url: null, platform: 'manual' }),
      urlFinal: 'https://glow.example/',
    };
    expect(RawContentSchema.safeParse(manual).success).toBe(false);
  });

  it('SOBREVIVE al artefacto de N1 (`N1OutputSchema`): es lo que llega a N3 y al aviso de CP1', () => {
    // EL BOUNDARY QUE SILENCIARÍA LA FEATURE ENTERA: el RawContent viaja a N3 dentro del
    // `output_refs` de N1 (jsonb) y se RE-PARSEA con `N1OutputSchema`. Si ese schema declarase
    // un subconjunto propio del RawContent en vez de reutilizar `RawContentSchema`, Zod
    // STRIPPEARÍA `urlFinal` en silencio: el validador nunca vería la redirección, CP1 nunca
    // avisaría, y toda la suite seguiría verde. Este assert clava la reutilización.
    const parsed = N1OutputSchema.parse({
      analysisId: '01J0000000000000000000000A',
      projectId: '01J0000000000000000000000B',
      raw: makeRawContent({
        url: 'https://glow.example/products/serum',
        urlFinal: 'https://glow.example/',
      }),
    });
    expect(parsed.raw.urlFinal).toBe('https://glow.example/');
  });
});
