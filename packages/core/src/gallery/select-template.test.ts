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

// GUARD PERMANENTE (T3.7): un template BACKSTOP declara varias verticales pero NO debe atar su
// cuerpo/slug/tags a UNA sola — el compilador N6 inyecta la compliance por `brief.category` en
// compilación, no el body. Este bloque bloquea la regresión que hizo FALLAR la verificación:
// backstops con forma de una vertical (p.ej. "finance") ganando queries de otra (p.ej. "beauty").
describe('honestidad de los backstops (§10.3 punto 14 por inyección, no por body)', () => {
  const VERTICALS = [
    'beauty',
    'education',
    'fashion',
    'finance',
    'fitness',
    'food',
    'home',
    'pets',
    'saas',
  ] as const;
  const backstops = templates.filter((t) => t.verticals.length > 1);

  it('hay backstops multi-vertical sembrados', () => {
    expect(backstops.length).toBeGreaterThan(0);
  });

  it('ningún backstop nombra una vertical en slug/title/freeTags ni lleva compliance en el body', () => {
    const offenders: string[] = [];
    for (const t of backstops) {
      // El body incluye el anti-cue de estilo "no beauty filters": no es una vertical, se excluye.
      const bodyNeutral = t.body.replace(/no beauty filters/gi, '');
      const identity = `${t.slug} ${t.title} ${t.freeTags.join(' ')}`.toLowerCase();
      const bodyLc = bodyNeutral.toLowerCase();
      for (const v of VERTICALS) {
        const re = new RegExp(`\\b${v}\\b`);
        if (re.test(identity)) offenders.push(`${t.slug}: slug/title/tags nombra "${v}"`);
        if (re.test(bodyLc)) offenders.push(`${t.slug}: body menciona "${v}"`);
      }
      if (/Compliance guard pack \(/i.test(t.body)) {
        offenders.push(`${t.slug}: body lleva frase de compliance hardcodeada`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('cobertura RELEVANTE §9.3: cada ángulo×vertical×plataforma gana un candidato con la vertical pedida y sin compliance ajena', () => {
    const angles = Array.from(new Set(backstops.flatMap((t) => t.hookAngles)));
    const platforms = ['tiktok', 'instagram', 'reels'] as const;
    const irrelevant: string[] = [];
    for (const hookAngle of angles) {
      for (const vertical of VERTICALS) {
        for (const platform of platforms) {
          const res = selectTemplate(templates, { hookAngle, vertical, platform });
          if (res.error) {
            irrelevant.push(`${hookAngle}/${vertical}/${platform} -> no_candidates`);
            continue;
          }
          const tpl = res.template;
          if (!tpl.verticals.map((x) => x.toLowerCase()).includes(vertical)) {
            irrelevant.push(`${hookAngle}/${vertical}/${platform} -> ${tpl.slug} sin la vertical`);
          }
          // Un backstop (multi-vertical) NUNCA debe ganar con compliance de UNA vertical en el body;
          // un template single-vertical ganando SU vertical sí puede llevarla (es honesto).
          if (tpl.verticals.length > 1 && /Compliance guard pack \(/i.test(tpl.body)) {
            irrelevant.push(
              `${hookAngle}/${vertical}/${platform} -> backstop ${tpl.slug} con compliance ajena`,
            );
          }
        }
      }
    }
    expect(irrelevant).toEqual([]);
  });

  it('una vertical DESCONOCIDA (automotive) sigue dando no_candidates (contrato T3.5)', () => {
    const res = selectTemplate(templates, { hookAngle: 'pain_point', vertical: 'automotive' });
    expect(res.error).toBe('no_candidates');
  });
});
