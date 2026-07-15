// LOOKUP DE GUARD PACKS (§9.5, T3.3). Función PURA, determinista y gratuita: dado el conjunto de
// guard packs sembrados (§10.1) y el contexto de una variante — la `category` del brief y la
// plataforma de destino — devuelve el SUBCONJUNTO que el compilador de prompts (T3.5) inyectará.
//
// La regla es la del PRD §9.5 l.390, LITERAL:
//   «`scope=vertical` se resuelve contra `product.category` del brief; `scope=platform` contra la
//    plataforma destino de la variante; `general` y `fidelity` siempre.»
//
// Se resuelve por SCOPE, no por keys hardcodeadas: incluir "todos los packs con scope general o
// fidelity" (no solo `guard.general`/`guard.fidelity`) mantiene la regla correcta si mañana
// aparece un segundo pack general (p.ej. `guard.compliance`, scope `general`). Un vertical/platform
// que no casa NO añade pack y NO falla (la category es texto libre del brief, §12; puede no tener
// un pack dedicado).
import type { GuardPackSeed } from './contracts';

/** El contexto de resolución: la category del brief y la plataforma destino de la variante. */
export interface GuardLookupContext {
  /** `product.category` del brief (texto libre §12). Casa contra `guardPack.vertical` normalizado. */
  category?: string;
  /** Plataforma DESTINO de la variante (tiktok | reels, §PRD l.337). Casa contra `guardPack.platform`. */
  platform?: string;
}

/**
 * Normaliza un identificador de faceta (category / vertical / platform) para el match: minúsculas +
 * trim. Un match EXACTO normalizado — sin sinónimos ni mapa: los verticales del seed
 * (beauty/finance/health/apps/food/fashion) casan 1:1 con las `category` que el brief usa (§10.4,
 * golden del compilador). Si un brief trae una category sin pack, no se incluye vertical (no falla).
 */
function normalizeFacet(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resuelve los guard packs aplicables a una variante (§9.5). NO lanza. Devuelve, en ORDEN ESTABLE
 * (general → fidelity → vertical → platform, y dentro de cada scope el orden del seed):
 *   - SIEMPRE todos los packs con `scope` general o fidelity;
 *   - el/los pack(s) `vertical` cuyo `vertical` === `category` normalizada (0..n; el seed garantiza 1);
 *   - el/los pack(s) `platform` cuyo `platform` === `platform` destino normalizada (0..n; el seed garantiza 1).
 *
 * Para el caso de la Verificación (category `beauty` + platform `tiktok`) sobre el seed real
 * devuelve EXACTAMENTE {guard.general, guard.fidelity, guard.vertical.beauty, guard.platform.tiktok}
 * — el único general, el único fidelity, el vertical de beauty y el platform de tiktok, y NINGÚN
 * otro vertical ni otra plataforma.
 */
export function resolveGuardPacks(
  packs: readonly GuardPackSeed[],
  ctx: GuardLookupContext,
): GuardPackSeed[] {
  const category = ctx.category !== undefined ? normalizeFacet(ctx.category) : undefined;
  const platform = ctx.platform !== undefined ? normalizeFacet(ctx.platform) : undefined;

  const always = packs.filter((p) => p.scope === 'general' || p.scope === 'fidelity');
  const verticals =
    category === undefined
      ? []
      : packs.filter(
          (p) =>
            p.scope === 'vertical' &&
            p.vertical !== undefined &&
            normalizeFacet(p.vertical) === category,
        );
  const platforms =
    platform === undefined
      ? []
      : packs.filter(
          (p) =>
            p.scope === 'platform' &&
            p.platform !== undefined &&
            normalizeFacet(p.platform) === platform,
        );

  return [...always, ...verticals, ...platforms];
}
