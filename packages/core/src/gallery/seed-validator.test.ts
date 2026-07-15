// Test del VALIDADOR DEL SEED DE GALERÍA (T3.2) — y, sobre todo, EL TEST QUE VALIDA EL SEED REAL.
//
// Corre dentro de `pnpm test` → `pnpm gate`, SIN Docker (es unit puro). Es lo que hace verdadera
// la Entrega "validador integrado en `pnpm gate`" y la Verificación "romper un fixture a
// propósito hace fallar `pnpm gate`": no valida un fixture de juguete, valida `RAW_GALLERY_SEED`
// —los templates que `pnpm seed:gallery` inserta de verdad— de modo que meter un slot
// `{producto.nombre}` en `gallery-seed/prompt-templates.json` pone el gate ROJO.
//
// PRINCIPIO 9 DE LA SKILL testing (el arnés nunca más cómodo que la realidad): los fixtures
// inválidos de aquí son inválidos POR LA RAZÓN REAL — un slot que §10.4 no define, un slug
// repetido de verdad, una key de guard pack que no existe — y cada uno lleva su control
// positivo al lado (el mismo objeto, arreglado, pasa): un test que no has visto fallar no
// sabes si muerde.
import { describe, expect, it } from 'vitest';
import { CANONICAL_SLOTS, extractSlots, isCanonicalSlot } from './canonical-variables';
import { RAW_GALLERY_SEED } from './raw-seed';
import { validateGallerySeed } from './seed-validator';

describe('el seed REAL que siembra `pnpm seed:gallery`', () => {
  it('pasa el validador entero (control positivo del gate)', () => {
    const result = validateGallerySeed(RAW_GALLERY_SEED);
    // Mensaje útil si algún día se rompe: el gate dice EXACTAMENTE qué template está mal.
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('incluye 2-3 templates mínimos de prueba (los usará T3.5)', () => {
    const result = validateGallerySeed(RAW_GALLERY_SEED);
    expect(result.seed).toBeDefined();
    const count = result.seed?.templates.length ?? 0;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(3);
  });

  it('todos los slots del body de cada template REAL son canónicos §10.4', () => {
    // Barrido independiente (red de seguridad), además del que corre `validateGallerySeed`.
    const result = validateGallerySeed(RAW_GALLERY_SEED);
    if (!result.seed) throw new Error('el seed real no valida');
    for (const template of result.seed.templates) {
      const unknown = [...new Set(extractSlots(template.body))].filter((s) => !isCanonicalSlot(s));
      expect(unknown, `template ${template.slug}`).toEqual([]);
    }
  });
});

describe('canonical-variables §10.4', () => {
  it('acepta un slot fijo, uno indexado de beneficio, y rechaza un typo', () => {
    expect(isCanonicalSlot('product.name')).toBe(true);
    expect(isCanonicalSlot('benefit[0]')).toBe(true);
    expect(isCanonicalSlot('benefit[12]')).toBe(true);
    expect(isCanonicalSlot('producto.nombre')).toBe(false); // el typo de la Verificación
    expect(isCanonicalSlot('claim.safe')).toBe(false); // §10.4 lo ELIMINA como variable
    expect(isCanonicalSlot('benefit[0]x')).toBe(false); // patrón anclado: no acepta cola
  });

  it('extrae los tokens interiores del body (sin llaves)', () => {
    expect(extractSlots('a {product.name} b {benefit[0]} c')).toEqual([
      'product.name',
      'benefit[0]',
    ]);
  });

  it('el conjunto canónico NO incluye {claim.safe} (§10.4 lo elimina)', () => {
    expect(CANONICAL_SLOTS).not.toContain('claim.safe');
  });
});

describe('validateGallerySeed: los fixtures INVÁLIDOS que la Verificación nombra', () => {
  // Base VÁLIDA: un template mínimo bien formado. Cada test la ROMPE por UNA razón concreta y
  // comprueba el rojo; el control positivo (la base intacta) va primero.
  function validTemplate(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      slug: 'base-template',
      title: 'Base',
      kind: 'video',
      body: 'UGC style, "{hook.line}", showing {product.name} and {benefit.primary}. "{cta.line}"',
      language: 'es',
      ...over,
    };
  }

  it('control positivo: la base intacta pasa', () => {
    const result = validateGallerySeed({ templates: [validTemplate()], guardPacks: [] });
    expect(result.ok).toBe(true);
  });

  it('SLOT INEXISTENTE {producto.nombre} → rojo con `unknown_slot` que NOMBRA el slot y el slug', () => {
    // El fixture EXACTO de la Verificación: un slot que §10.4 no define. Es lo que ocurriría si
    // alguien escribiera `{producto.nombre}` (typo de idioma) en un template del JSON real.
    const broken = validTemplate({
      slug: 'roto-por-slot',
      body: 'UGC style, "{hook.line}", showing {producto.nombre}. "{cta.line}"',
    });
    const result = validateGallerySeed({ templates: [broken], guardPacks: [] });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'unknown_slot');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('producto.nombre'); // NOMBRA el slot malo
    expect(issue?.where).toBe('roto-por-slot'); // NOMBRA el template (slug)
    expect(result.seed).toBeUndefined(); // nada que insertar: el seed no debe tocar la BD
  });

  it('SLUG DUPLICADO → rojo con `duplicate_slug` (chocaría con `prompt_template_slug_key`)', () => {
    const result = validateGallerySeed({
      templates: [validTemplate({ slug: 'dup' }), validTemplate({ slug: 'dup' })],
      guardPacks: [],
    });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'duplicate_slug');
    expect(issue?.where).toBe('dup');
  });

  it('guardPackKey INEXISTENTE → rojo con `unknown_guard_pack`', () => {
    // Referencia una key que el seed de guard packs no define (en T3.2 no hay guard packs, así
    // que CUALQUIER key es inexistente — el check muerde igual).
    const result = validateGallerySeed({
      templates: [validTemplate({ guardPackKeys: ['guard.vertical.beauty'] })],
      guardPacks: [],
    });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'unknown_guard_pack');
    expect(issue?.message).toContain('guard.vertical.beauty');
  });

  it('guardPackKey que SÍ existe en el seed → pasa (integridad referencial cumplida)', () => {
    const result = validateGallerySeed({
      templates: [validTemplate({ guardPackKeys: ['guard.vertical.beauty'] })],
      guardPacks: [
        { key: 'guard.vertical.beauty', scope: 'vertical', vertical: 'beauty', lines: ['no x'] },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('ENUM inválido (`kind`) → rojo con `schema_invalid`', () => {
    const result = validateGallerySeed({
      templates: [validTemplate({ kind: 'gif' })],
      guardPacks: [],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('schema_invalid');
  });

  it('ENUM inválido (`status`) → rojo con `schema_invalid`', () => {
    const result = validateGallerySeed({
      templates: [validTemplate({ status: 'live' })],
      guardPacks: [],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('schema_invalid');
  });

  it('CAMPO REQUERIDO ausente (`body`) → rojo con `schema_invalid`', () => {
    const { body: _body, ...withoutBody } = validTemplate();
    const result = validateGallerySeed({ templates: [withoutBody], guardPacks: [] });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'schema_invalid');
    expect(issue?.entity).toBe('prompt_template');
  });

  it('guard pack con `scope` inválido → rojo con `schema_invalid`', () => {
    const result = validateGallerySeed({
      templates: [validTemplate()],
      guardPacks: [{ key: 'guard.x', scope: 'nope', lines: [] }],
    });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'schema_invalid');
    expect(issue?.entity).toBe('guard_pack');
  });

  it('guard pack con `key` DUPLICADA → rojo con `duplicate_guard_pack`', () => {
    const result = validateGallerySeed({
      templates: [validTemplate()],
      guardPacks: [
        { key: 'guard.x', scope: 'general', lines: [] },
        { key: 'guard.x', scope: 'general', lines: [] },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('duplicate_guard_pack');
  });

  it('acumula TODOS los problemas de una pasada, no solo el primero', () => {
    const result = validateGallerySeed({
      templates: [
        validTemplate({ slug: 'a', body: 'x {producto.nombre} y {tambien.malo}' }),
        validTemplate({ slug: 'a' }), // duplicado
      ],
      guardPacks: [],
    });
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('unknown_slot');
    expect(codes).toContain('duplicate_slug');
    // Dos slots malos en el mismo body → dos issues de slot.
    expect(codes.filter((c) => c === 'unknown_slot').length).toBeGreaterThanOrEqual(2);
  });
});
