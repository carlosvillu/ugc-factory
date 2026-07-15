// Test del lookup de guard packs §9.5 (T3.3). El caso EXACTO de la Verificación (beauty + tiktok →
// los 4 packs, ni uno más) más los negativos que blindan la regla: general+fidelity SIEMPRE, una
// category sin vertical no añade pack, una plataforma desconocida no añade pack, y ni el lookup ni
// el seed real dejan colar un vertical/plataforma ajeno.
//
// Corre sobre el SEED REAL (`RAW_GALLERY_SEED` validado), no un fixture de juguete: así "romper el
// seed → gate rojo" también vale para el lookup. Guard packs: función pura, todas las reglas ×
// (1 caso que incluye + 1 frontera que excluye) — criterio de exhaustividad de unit-core.md §11.
import { describe, expect, it } from 'vitest';
import { resolveGuardPacks, type GuardLookupContext } from './guard-lookup';
import { validateGallerySeed } from './seed-validator';
import { RAW_GALLERY_SEED } from './raw-seed';
import type { GuardPackSeed } from './contracts';

// El seed real, validado y parseado — la misma frontera que `pnpm seed:gallery` inserta.
const seed = (() => {
  const result = validateGallerySeed(RAW_GALLERY_SEED);
  if (!result.ok || !result.seed) {
    throw new Error(`el seed real no valida: no se puede testear el lookup`);
  }
  return result.seed;
})();
const PACKS = seed.guardPacks;

const keysOf = (packs: GuardPackSeed[]): string[] => packs.map((p) => p.key).sort();
const lookup = (ctx: GuardLookupContext): string[] => keysOf(resolveGuardPacks(PACKS, ctx));

// Los packs que scope general/fidelity aportan SIEMPRE — derivados del seed, no hardcodeados, para
// que añadir un pack general nuevo no desincronice el test con la regla "scope, no key".
const ALWAYS_KEYS = PACKS.filter((p) => p.scope === 'general' || p.scope === 'fidelity')
  .map((p) => p.key)
  .sort();

describe('resolveGuardPacks — la regla de lookup §9.5', () => {
  it('el caso EXACTO de la Verificación: beauty + tiktok → EXACTAMENTE {general, fidelity, vertical.beauty, platform.tiktok}, ni uno más', () => {
    const got = lookup({ category: 'beauty', platform: 'tiktok' });
    // Los CUATRO keys LITERALES que la Verificación enumera — igualdad de conjunto, no "los del
    // seed + los que casan". Si un pack always-on de más se colara, esto muerde (mirror del check
    // del verifier, que hace set-equality contra estos cuatro nombres).
    expect(got).toEqual(
      ['guard.general', 'guard.fidelity', 'guard.vertical.beauty', 'guard.platform.tiktok'].sort(),
    );
    // Y, coherente con lo anterior, el set derivado del seed coincide (general+fidelity = los 2 always).
    expect(got).toEqual([...ALWAYS_KEYS, 'guard.vertical.beauty', 'guard.platform.tiktok'].sort());
    // Explícitamente: NINGÚN otro vertical ni otra plataforma.
    expect(got).not.toContain('guard.vertical.finance');
    expect(got).not.toContain('guard.platform.reels');
    expect(got.filter((k) => k.startsWith('guard.vertical.'))).toEqual(['guard.vertical.beauty']);
    expect(got.filter((k) => k.startsWith('guard.platform.'))).toEqual(['guard.platform.tiktok']);
  });

  it('general y fidelity SIEMPRE presentes — incluso sin category ni platform', () => {
    const got = lookup({});
    expect(got).toEqual(ALWAYS_KEYS);
    expect(got).toContain('guard.general');
    expect(got).toContain('guard.fidelity');
  });

  it('category que NO casa ningún vertical → sin pack vertical, no falla', () => {
    const got = lookup({ category: 'aerospace', platform: 'tiktok' });
    expect(got.filter((k) => k.startsWith('guard.vertical.'))).toEqual([]);
    expect(got).toEqual([...ALWAYS_KEYS, 'guard.platform.tiktok'].sort());
  });

  it('plataforma desconocida → sin pack platform, no falla', () => {
    const got = lookup({ category: 'beauty', platform: 'myspace' });
    expect(got.filter((k) => k.startsWith('guard.platform.'))).toEqual([]);
    expect(got).toEqual([...ALWAYS_KEYS, 'guard.vertical.beauty'].sort());
  });

  it('match normalizado: category con mayúsculas y espacios casa el vertical', () => {
    const got = lookup({ category: '  Beauty  ', platform: '  TikTok  ' });
    expect(got).toEqual([...ALWAYS_KEYS, 'guard.vertical.beauty', 'guard.platform.tiktok'].sort());
  });

  it('reels es una plataforma alcanzable: finance + reels → vertical.finance + platform.reels', () => {
    const got = lookup({ category: 'finance', platform: 'reels' });
    expect(got).toEqual([...ALWAYS_KEYS, 'guard.vertical.finance', 'guard.platform.reels'].sort());
  });

  it('cada vertical sembrado es resoluble por su nombre', () => {
    for (const pack of PACKS.filter((p) => p.scope === 'vertical')) {
      const got = resolveGuardPacks(PACKS, { category: pack.vertical });
      expect(got.map((p) => p.key)).toContain(pack.key);
    }
  });

  it('orden estable: general/fidelity primero, luego vertical, luego platform', () => {
    const got = resolveGuardPacks(PACKS, { category: 'beauty', platform: 'tiktok' }).map(
      (p) => p.scope,
    );
    // ningún vertical/platform aparece antes de un general/fidelity
    const lastAlways = got.lastIndexOf('fidelity');
    const firstScoped = got.findIndex((s) => s === 'vertical' || s === 'platform');
    expect(lastAlways).toBeLessThan(firstScoped);
  });
});
