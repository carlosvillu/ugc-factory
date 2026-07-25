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

  // T5.12 (SUPERSEDE al contrato original de T3.5, que aquí exigía `no_candidates` para una vertical
  // desconocida): ese contrato era EL BUG. `product.category` es texto libre del LLM (§12) y una
  // etiqueta fuera del enum del seed mataba el lote entero en N6. Ninguna aserción se ha eliminado:
  // se re-apunta al contrato nuevo (degradar, marcado) y `no_candidates` sigue asertado abajo para las
  // facetas que NO son texto de LLM (kind, hookAngle).
  it('un vertical sin template (automotive) → DEGRADA a un template marcando la faceta relajada', () => {
    const res = selectTemplate(templates, {
      vertical: 'automotive',
      hookAngle: 'pain_point',
      platform: 'tiktok',
    });
    expect(res.error).toBeUndefined();
    expect(res.template).toBeDefined();
    expect(res.relaxedFacet).toBe('vertical');
    expect(res.unmatchedValue).toBe('automotive');
  });

  it('un kind distinto (image) no case ningún template de vídeo', () => {
    const res = selectTemplate(templates, { vertical: 'beauty', kind: 'image' });
    expect(res.error).toBe('no_candidates');
  });

  it('un hookAngle desconocido SIGUE muriendo en no_candidates (no es texto de LLM, no se relaja)', () => {
    const res = selectTemplate(templates, {
      vertical: 'beauty',
      hookAngle: 'no_such_angle',
      platform: 'tiktok',
    });
    if (res.error === undefined) throw new Error('esperaba no_candidates');
    expect(res.error).toBe('no_candidates');
    expect(res.message).toContain('no_such_angle');
  });
});

// T5.12 · EL DEFECTO DE PRODUCCIÓN. La MISMA URL de CeraVe dio `beauty` el 2026-07-24 y
// `Cuidado de la piel` el 2026-07-25: el análisis emite la category como TEXTO LIBRE, en cualquier
// idioma. El determinismo NO puede vivir en que el LLM acierte la etiqueta — vive aquí, en el
// consumidor. Los valores de estos tests son los que el LLM emitió DE VERDAD, no inventados cómodos.
describe('selectTemplate — category libre del LLM (T5.12: degradación, no muerte)', () => {
  const REAL_FREE_CATEGORIES = [
    'Cuidado de la piel',
    'Cuidado bucal',
    'Skin care',
    'Higiene bucal',
  ];

  for (const vertical of REAL_FREE_CATEGORIES) {
    it(`"${vertical}" encuentra template (degradado y MARCADO), no no_candidates`, () => {
      const res = selectTemplate(templates, {
        vertical,
        hookAngle: 'pain_point',
        platform: 'tiktok',
      });
      expect(res.error).toBeUndefined();
      expect(res.template?.slug).toBeTruthy();
      // La degradación es OBSERVABLE: quien consuma esto puede loguear la etiqueta no reconocida.
      expect(res.relaxedFacet).toBe('vertical');
      expect(res.unmatchedValue).toBe(vertical);
    });
  }

  it('el resultado degradado es DETERMINISTA: mismo ganador con el catálogo barajado', () => {
    const ctx = { vertical: 'Cuidado bucal', hookAngle: 'pain_point', platform: 'tiktok' };
    const shuffled = [...templates].reverse();
    const a = selectTemplate(templates, ctx);
    const b = selectTemplate(shuffled, ctx);
    expect(a.template?.slug).toBeTruthy();
    expect(b.template?.slug).toBe(a.template?.slug);
  });

  it('la degradación NO se activa cuando la vertical SÍ casa: nada de relaxedFacet', () => {
    const res = selectTemplate(templates, {
      vertical: 'beauty',
      hookAngle: 'pain_point',
      platform: 'tiktok',
      format: 'grwm',
    });
    expect(res.template?.slug).toBe('grwm-beauty-pain-point');
    expect(res.relaxedFacet).toBeUndefined();
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

  // T5.12 supersede el contrato T3.5 de esta línea (ver el bloque de arriba): una vertical desconocida
  // ya no mata el lote; degrada MARCADA. Lo que sigue asertándose —y es lo que importa aquí— es que el
  // template degradado no puede llevar compliance de OTRA vertical en el body (backstop honesto).
  it('una vertical DESCONOCIDA (automotive) degrada a un backstop SIN compliance ajena', () => {
    // La plataforma se fija a propósito: TODOS los templates del seed restringen `platforms`, así que
    // un contexto sin plataforma no tiene candidatos ni relajando la vertical (y eso es correcto: lo
    // que T5.12 arregla es la vertical libre, no la ausencia de plataforma).
    const res = selectTemplate(templates, {
      hookAngle: 'pain_point',
      vertical: 'automotive',
      platform: 'tiktok',
    });
    expect(res.relaxedFacet).toBe('vertical');
    const tpl = res.template;
    if (tpl === undefined) throw new Error('esperaba un template degradado');
    // Un ganador DEGRADADO nunca puede llevar compliance de una vertical en el body: la vertical del
    // brief no casó con ninguna, así que cualquier compliance del cuerpo sería ajena por definición.
    expect(/Compliance guard pack \(/i.test(tpl.body)).toBe(false);
  });
});
