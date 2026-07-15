import { describe, expect, it } from 'vitest';
import { validateGallerySeed, RAW_GALLERY_SEED } from './index';
import type { PromptTemplateSeed } from './contracts';
import { selectTemplate } from './select-template';

function seededTemplates(): PromptTemplateSeed[] {
  const validation = validateGallerySeed(RAW_GALLERY_SEED);
  if (!validation.ok || !validation.seed) throw new Error('el seed de galería no valida');
  return validation.seed.templates;
}

const templates = seededTemplates();

describe('selectTemplate — filtro por facetas §9.3', () => {
  it('elige grwm-beauty-pain-point para beauty/pain_point/tiktok/grwm', () => {
    const res = selectTemplate(templates, {
      vertical: 'beauty',
      hookAngle: 'pain_point',
      platform: 'tiktok',
      format: 'grwm',
    });
    expect(res.template?.slug).toBe('grwm-beauty-pain-point');
  });

  it('elige unboxing-saas-authority para saas/authority/instagram/unboxing', () => {
    const res = selectTemplate(templates, {
      vertical: 'saas',
      hookAngle: 'authority',
      platform: 'instagram',
      format: 'unboxing',
    });
    expect(res.template?.slug).toBe('unboxing-saas-authority');
  });

  it('un vertical sin template → no_candidates con las facetas buscadas', () => {
    const res = selectTemplate(templates, { vertical: 'automotive', platform: 'tiktok' });
    if (res.error === undefined) throw new Error('esperaba no_candidates');
    expect(res.error).toBe('no_candidates');
    expect(res.message).toContain('automotive');
  });

  it('un kind distinto (image) no case ningún template de vídeo', () => {
    const res = selectTemplate(templates, { vertical: 'beauty', kind: 'image' });
    expect(res.error).toBe('no_candidates');
  });
});

describe('selectTemplate — determinismo del scoring (perf vacío + desempate por slug)', () => {
  it('con perf vacío no penaliza ni lanza: elige un candidato válido', () => {
    const res = selectTemplate(templates, {
      vertical: 'beauty',
      hookAngle: 'pain_point',
      platform: 'tiktok',
      format: 'grwm',
    });
    expect(res.template).toBeDefined();
  });

  // Base agnóstica: TODAS las facetas vacías (el `grwm` del seed restringe format/hookAngle, que
  // el contexto de estos tests no fija). Sobre ella se añade solo la faceta bajo prueba.
  const bare = (slug: string, extra: Partial<PromptTemplateSeed> = {}): PromptTemplateSeed => ({
    ...templates[0]!,
    slug,
    formats: [],
    hookAngles: [],
    verticals: [],
    platforms: [],
    ...extra,
  });

  it('desempate estable: dos templates con el mismo score → el de slug menor', () => {
    const a = bare('zzz-beauty', { verticals: ['beauty'] });
    const b = bare('aaa-beauty', { verticals: ['beauty'] });
    const res1 = selectTemplate([a, b], { vertical: 'beauty' });
    const res2 = selectTemplate([b, a], { vertical: 'beauty' });
    // El orden de ENTRADA no cambia el ganador: siempre el slug menor.
    expect(res1.template?.slug).toBe('aaa-beauty');
    expect(res2.template?.slug).toBe('aaa-beauty');
  });

  it('mayor especificidad gana: un template que casa vertical+platform supera al agnóstico', () => {
    const specific = bare('specific', { verticals: ['beauty'], platforms: ['tiktok'] });
    const agnostic = bare('aaa-agnostic');
    const res = selectTemplate([agnostic, specific], { vertical: 'beauty', platform: 'tiktok' });
    expect(res.template?.slug).toBe('specific');
  });
});
