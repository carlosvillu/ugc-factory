// RESOLUCIÓN DE VARIABLES CANÓNICAS §10.4 (T3.5, N6). Función PURA, determinista y gratuita:
// dado un slot canónico (`product.name`, `benefit[0]`, `hook.line`…) y las fuentes de datos de
// una variante (brief / persona / guion / contexto de campaña), devuelve el VALOR con el que el
// compilador lo sustituye — o un `unresolved` que NOMBRA el slot y su fuente esperada.
//
// POR QUÉ VIVE APARTE DEL COMPILADOR. El mapa slot→fuente es el corazón de §10.4 y la parte más
// propensa a error del sistema (un slot resuelto contra el campo equivocado degrada calidad y
// quema presupuesto de fal en silencio). Aislarlo lo hace testeable caso a caso y deja al
// ensamblador (`compile-prompt.ts`) libre de aritmética de fuentes.
//
// ⚠ TRES TRAMPAS VERIFICADAS CONTRA EL CÓDIGO — el mapa es EXPLÍCITO, no adivinado:
//   1. `rebuttal` → `ProductBrief.objections[n].counter` (el campo real es `counter`, NO
//      `rebuttal`: product-brief.ts:145). Un typo aquí reintroduce un bug silencioso.
//   2. `hook.line`/`cta.line` → `AdScript.hook`/`AdScript.cta` (YA en idioma destino, T2.4 pagó
//      la deuda de traducción). NUNCA de `PlannedHook.text`/brief (semilla pre-traducción): usar
//      la fuente equivocada reintroduce el bug de T2.2/T2.4 que hay tests live protegiendo.
//   3. `platform`/`aspect` NO viven en `PlannedVariant` (batch-plan.ts solo tiene
//      language+durationTargetSeconds): entran por el `CompileContext` explícito (la fuente en
//      producción es `ad_variant.platform_targets`, que el executor N6 pasa).
import { BENEFIT_INDEXED_SLOT, isCanonicalSlot } from './canonical-variables';
import type { ProductBrief } from '../contracts/product-brief';
import type { AdScript } from '../contracts/ad-script';
import type { Persona } from '../persona/contracts';

/**
 * El contexto de CAMPAÑA que el compilador recibe explícitamente — los datos §10.4 que NO viven
 * en el brief, la persona ni el guion. La fuente en producción es la fila `ad_variant`
 * (`platform_targets`, `duration_target`); en test/CLI se pasan a mano. `aspect` es opcional: si
 * falta, deriva de la plataforma / del `defaultAspect` del template (ver `compile-prompt.ts`).
 */
export interface CampaignContext {
  /** Plataforma destino de la variante (`tiktok` | `instagram` | `reels`…). Fuente: `ad_variant.platform_targets[0]`. */
  platform: string;
  /** Relación de aspecto (`9:16`…). Fuente: derivada de la plataforma o del `defaultAspect` del template. */
  aspect?: string;
  /** Duración objetivo en segundos. Fuente: `PlannedVariant.durationTargetSeconds` / `ad_variant.duration_target`. */
  durationSeconds: number;
}

/**
 * Las FUENTES de datos que el resolvedor lee para una variante. Un subconjunto puede faltar
 * (p.ej. compilar solo con brief+persona sin guion todavía): cada slot declara su fuente y un
 * slot cuya fuente no está presente resuelve a `unresolved` con el mensaje adecuado.
 */
export interface VariableSources {
  brief: ProductBrief;
  persona: Persona;
  /** El guion de la variante (T2.4): la única fuente legítima de `hook.line`/`cta.line`. */
  script?: AdScript;
  campaign: CampaignContext;
}

/** La FUENTE lógica esperada de un slot — lo que el error accionable nombra ("de qué fuente"). */
export type SlotSource =
  | 'ProductBrief'
  | 'Persona'
  | 'AdScript'
  | 'CampaignContext'
  | 'ProductBrief.assets'
  | 'Persona.referenceImageIds';

/** Resolución de UN slot: o un valor, o un fallo que nombra el slot y su fuente. */
export type SlotResolution =
  | { resolved: true; value: string }
  | { resolved: false; slot: string; source: SlotSource; message: string };

function ok(value: string): SlotResolution {
  return { resolved: true, value };
}

function fail(slot: string, source: SlotSource, detail: string): SlotResolution {
  return {
    resolved: false,
    slot,
    source,
    message: `El slot {${slot}} no se pudo resolver: ${detail} (fuente esperada: ${source}).`,
  };
}

/** Índice de un slot indexado `benefit[n]` → n. Devuelve null si el token no encaja el patrón. */
function benefitIndex(slot: string): number | null {
  if (!BENEFIT_INDEXED_SLOT.test(slot)) return null;
  const match = /\[(\d+)\]/.exec(slot);
  return match ? Number(match[1]) : null;
}

/**
 * Resuelve un slot canónico §10.4 contra las fuentes. NO lanza: devuelve `SlotResolution`. Un
 * slot desconocido (no canónico) es `unresolved` con fuente genérica — pero el seed-validator ya
 * garantiza que ningún `body` sembrado lleve uno, así que en la práctica solo llega aquí lo
 * canónico. El mapa slot→fuente es EXPLÍCITO (un `switch`), no una tabla derivada: cada línea es
 * una decisión §10.4 auditada contra los contratos.
 */
export function resolveSlot(slot: string, sources: VariableSources): SlotResolution {
  const { brief, persona, script, campaign } = sources;

  // Slots indexados de beneficio: `benefit[0]`, `benefit[1]`…
  const idx = benefitIndex(slot);
  if (idx !== null) {
    const benefit = brief.benefits[idx];
    if (benefit === undefined) {
      return fail(slot, 'ProductBrief', `no hay benefits[${String(idx)}] en el brief`);
    }
    return ok(benefit.benefit);
  }

  switch (slot) {
    // ── brief.product ──────────────────────────────────────────────────────────
    case 'product.name':
      return ok(brief.product.name);
    case 'product.category':
      return ok(brief.product.category);
    case 'product.hero_image': {
      const hero = brief.assets.hero_image_url;
      if (hero === null) return fail(slot, 'ProductBrief.assets', 'hero_image_url es null');
      return ok(hero);
    }

    // ── brief.benefits (el primario) ─────────────────────────────────────────────
    case 'benefit.primary': {
      const primary = brief.benefits[0];
      if (primary === undefined) return fail(slot, 'ProductBrief', 'el brief no tiene benefits');
      return ok(primary.benefit);
    }

    // ── brief.pain_points ────────────────────────────────────────────────────────
    case 'pain_point': {
      const pain = brief.pain_points[0];
      if (pain === undefined) return fail(slot, 'ProductBrief', 'el brief no tiene pain_points');
      return ok(pain.pain);
    }

    // ── brief.objections (⚠ rebuttal → counter) ──────────────────────────────────
    case 'objection': {
      const objection = brief.objections[0];
      if (objection === undefined)
        return fail(slot, 'ProductBrief', 'el brief no tiene objections');
      return ok(objection.objection);
    }
    case 'rebuttal': {
      // TRAMPA §10.4: el rebuttal es el campo `counter` del contrato (NO `rebuttal`).
      const objection = brief.objections[0];
      if (objection === undefined)
        return fail(slot, 'ProductBrief', 'el brief no tiene objections');
      return ok(objection.counter);
    }

    // ── audiencia / Persona ──────────────────────────────────────────────────────
    case 'persona.age_range':
      return ok(persona.ageRange);
    case 'persona.descriptor':
      return ok(persona.descriptor);
    case 'persona.setting':
      return ok(persona.setting);
    case 'setting':
      // `setting` suelto = `Persona.setting` (una sola verdad, §10.4).
      return ok(persona.setting);
    case 'avatar.ref': {
      const ref = persona.referenceImageIds[0];
      if (ref === undefined) {
        return fail(
          slot,
          'Persona.referenceImageIds',
          'la persona no tiene imágenes de referencia',
        );
      }
      return ok(ref);
    }

    // ── hook_line × ángulo / cta_line × objetivo (⚠ de AdScript, NO del brief) ────
    case 'hook.line': {
      if (script === undefined) {
        return fail(slot, 'AdScript', 'no se pasó el guion (AdScript) de la variante');
      }
      return ok(script.hook);
    }
    case 'cta.line': {
      if (script === undefined) {
        return fail(slot, 'AdScript', 'no se pasó el guion (AdScript) de la variante');
      }
      return ok(script.cta);
    }

    // ── campaña: BatchPlan/variante + contexto explícito ─────────────────────────
    case 'platform':
      return ok(campaign.platform);
    case 'aspect': {
      const aspect = campaign.aspect;
      if (aspect === undefined || aspect === '') {
        return fail(slot, 'CampaignContext', 'no se resolvió el aspect (ni contexto ni template)');
      }
      return ok(aspect);
    }
    case 'duration':
      return ok(String(campaign.durationSeconds));

    default:
      // Un slot que NO es canónico §10.4: no debería llegar (el seed-validator lo rechaza), pero
      // si un template no sembrado lo tuviera, se reporta como irresoluble en vez de romper.
      return fail(
        slot,
        'ProductBrief',
        isCanonicalSlot(slot)
          ? 'slot canónico no cableado (bug del compilador)'
          : 'no es un slot canónico §10.4',
      );
  }
}
