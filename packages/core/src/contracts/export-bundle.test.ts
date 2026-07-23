// Contrato del EXPORT BUNDLE (T5.7, §9.7 N10 / §15.4). Un caso válido + los CONTROLES NEGATIVOS que
// MUERDEN (principio 9 del arnés): la Verificación de T5.7 exige validar el JSON del bundle contra su
// schema con «caption dentro de límites» — este test codifica esa cláusula como regresión permanente
// (regla de trabajo 8) Y la ejerce en negativo (@ / # / link / 101 chars / 21 chars → parse FALLA).
// Reintroducir el fallo (un caption con @) pone ROJO el control correspondiente: es la prueba de que el
// validador verifica algo, no que «siempre pasa».
import { expect, it } from 'vitest';

import { newUlid } from './ids';
import {
  AdCaptionSchema,
  AD_CAPTION_MAX_LENGTH,
  BrandNameSchema,
  BRAND_NAME_MAX_LENGTH,
  ExportBundleMetadataSchema,
  buildComplianceChecklist,
  deriveBrandName,
  deriveProvisionalCaption,
  type ExportBundleMetadata,
} from './export-bundle';

const valid: ExportBundleMetadata = {
  variant_id: newUlid(),
  filename_code: 'acme-a1-h2-lucia-es-15s',
  ad_caption: 'Vitamina C que se nota en 15 días. Piel radiante sin filtros.',
  brand_name: 'Nuvela',
  hook: 'La vitamina C que sí se nota',
  angle: 'A1 · Antes/después visible',
  duration_seconds: 15,
  objective: 'hook_test',
  platforms: ['tiktok', 'meta'],
  destination: 'both',
  audio_version: 'with_bed',
  audio_source: 'ai_bed',
  aigc: { aigc_disclosure: true, c2pa_signed: true, meta_ai_label: true },
  checklist: buildComplianceChecklist({
    platforms: ['tiktok', 'meta'],
    audioSource: 'ai_bed',
    destination: 'both',
  }),
};

it('el bundle canónico valida contra su schema', () => {
  const parsed = ExportBundleMetadataSchema.safeParse(valid);
  expect(parsed.success).toBe(true);
});

// ── ad_caption: ≤100 chars, SIN @/#/links. Cada control MUERDE por separado (no un happy-path). ──

it('acepta un caption dentro de límites (exactamente 100 chars)', () => {
  const caption = 'a'.repeat(100);
  expect(AdCaptionSchema.safeParse(caption).success).toBe(true);
});

const invalidCaptions: [name: string, caption: string][] = [
  ['caption de 101 chars (supera el tope)', 'a'.repeat(101)],
  ['caption con mención @', 'Prueba nuestra crema @nuvela ya'],
  ['caption con hashtag #', 'Piel radiante #skincare de verdad'],
  ['caption con link https://', 'Compra en https://nuvela.com hoy'],
  ['caption con www.', 'Visita www.nuvela.com para más'],
  ['caption con dominio con TLD (acme.io)', 'Descúbrelo en nuvela.io ahora'],
  ['caption vacío', ''],
];

it.each(invalidCaptions)('RECHAZA %s', (_name, caption) => {
  expect(AdCaptionSchema.safeParse(caption).success).toBe(false);
});

// El caption válido con un carácter ilegal AÑADIDO también cae dentro del schema completo del bundle
// (no solo el sub-schema): garantiza que el borde del bundle también muerde.
it('el bundle RECHAZA un caption con @ (control negativo end-to-end del schema)', () => {
  const bad: unknown = { ...valid, ad_caption: `${valid.ad_caption} @marca` };
  expect(ExportBundleMetadataSchema.safeParse(bad).success).toBe(false);
});

// ── brand_name: ≤20 chars, no vacío. ──

it('acepta un brand_name de exactamente 20 chars', () => {
  expect(BrandNameSchema.safeParse('a'.repeat(20)).success).toBe(true);
});

const invalidBrands: [name: string, brand: string][] = [
  ['brand_name de 21 chars (supera el tope)', 'a'.repeat(21)],
  ['brand_name vacío', ''],
];

it.each(invalidBrands)('RECHAZA %s', (_name, brand) => {
  expect(BrandNameSchema.safeParse(brand).success).toBe(false);
});

it('el bundle RECHAZA un brand_name de 21 chars (control negativo end-to-end)', () => {
  const bad: unknown = { ...valid, brand_name: 'a'.repeat(21) };
  expect(ExportBundleMetadataSchema.safeParse(bad).success).toBe(false);
});

// ── flags AIGC: aigc_disclosure y meta_ai_label son literal(true) — el pipeline es 100% AIGC. ──

it('RECHAZA aigc_disclosure = false (todo export es AIGC)', () => {
  const bad: unknown = { ...valid, aigc: { ...valid.aigc, aigc_disclosure: false } };
  expect(ExportBundleMetadataSchema.safeParse(bad).success).toBe(false);
});

// ── checklist §15.4: los pasos correctos según plataforma + destino + audio_source. ──

it('el checklist incluye el toggle AIGC de TikTok cuando la plataforma es tiktok', () => {
  const items = buildComplianceChecklist({
    platforms: ['tiktok'],
    audioSource: 'ai_bed',
    destination: 'organic',
  });
  expect(items.some((i) => i.id === 'tiktok_aigc_toggle')).toBe(true);
  expect(items.some((i) => i.id === 'tiktok_duplicate_recheck')).toBe(true);
  // Sin Meta en las plataformas, no aparece su paso.
  expect(items.some((i) => i.id === 'meta_ai_info_label')).toBe(false);
});

it('el checklist incluye la etiqueta AI info de Meta cuando la plataforma es meta/instagram', () => {
  const items = buildComplianceChecklist({
    platforms: ['instagram'],
    audioSource: 'own_license',
    destination: 'paid',
  });
  expect(items.some((i) => i.id === 'meta_ai_info_label')).toBe(true);
});

it('el checklist marca el BLOQUEO de audio nativo/trending en un ad pagado (§14)', () => {
  const items = buildComplianceChecklist({
    platforms: ['tiktok'],
    audioSource: 'native_trending',
    destination: 'paid',
  });
  expect(items.some((i) => i.id === 'paid_native_audio_block')).toBe(true);
});

it('el checklist NO marca el bloqueo de audio en un destino orgánico', () => {
  const items = buildComplianceChecklist({
    platforms: ['tiktok'],
    audioSource: 'native_trending',
    destination: 'organic',
  });
  expect(items.some((i) => i.id === 'paid_native_audio_block')).toBe(false);
});

it('el checklist base (AIGC + C2PA) aparece siempre, aun sin plataformas', () => {
  const items = buildComplianceChecklist({
    platforms: [],
    audioSource: 'none',
    destination: 'organic',
  });
  expect(items.some((i) => i.id === 'aigc_disclosure')).toBe(true);
  expect(items.some((i) => i.id === 'c2pa_present')).toBe(true);
});

// ── derivación provisional del caption (regla 6): de un hook «sucio» sale un caption SIEMPRE válido. ──

it('deriveProvisionalCaption produce un caption que SIEMPRE pasa AdCaptionSchema', () => {
  const hooks = [
    'La vitamina C que sí se nota',
    'Sígueme en @nuvela y usa #skincare hoy', // con @ y #
    'Compra en https://nuvela.com y www.nuvela.io', // con links
    'a'.repeat(200), // demasiado largo
    '@#@#', // todo símbolos → placeholder no vacío
  ];
  for (const h of hooks) {
    const caption = deriveProvisionalCaption(h);
    // La prueba REAL: el schema (con sus controles negativos) lo acepta. Si la derivación colara un @,
    // un #, un link o >100 chars, el parse FALLARÍA aquí.
    expect(AdCaptionSchema.safeParse(caption).success).toBe(true);
    expect(caption.length).toBeLessThanOrEqual(AD_CAPTION_MAX_LENGTH);
    expect(caption).not.toContain('@');
    expect(caption).not.toContain('#');
  }
});

it('deriveBrandName trunca a 20 y cae a name cuando brand_name es null', () => {
  expect(deriveBrandName({ brand_name: 'Nuvela', name: 'Serum' })).toBe('Nuvela');
  expect(deriveBrandName({ brand_name: null, name: 'Serum' })).toBe('Serum');
  const long = deriveBrandName({ brand_name: 'a'.repeat(30), name: 'x' });
  expect(long.length).toBeLessThanOrEqual(BRAND_NAME_MAX_LENGTH);
  expect(BrandNameSchema.safeParse(long).success).toBe(true);
});
