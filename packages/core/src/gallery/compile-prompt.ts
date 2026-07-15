// EL COMPILADOR DE PROMPTS §9.3/§10.4 (N6, T3.5). Función PURA, determinista y GRATIS ("sin LLM",
// §9.3): ensambla el `resolvedPrompt` que cada modelo de fal recibe, a partir de un template de
// galería + las fuentes de datos de la variante (brief / persona / guion / campaña). Cada carácter
// de su salida va a un modelo de PAGO, así que se testea con golden files carácter a carácter.
//
// EL ENSAMBLAJE, EN ORDEN ESTABLE (el orden ES contrato: los goldens lo fijan):
//   (1) `template.body` con los slots §10.4 interpolados (variable-sources.ts);
//   (2) FIDELITY GUARD LITERAL del compilador — la frase "no deformation, drift, or artifacts" +
//       preservación de label/producto + "stable identity". ⚠ Es un literal HARDCODEADO AQUÍ, NO
//       del seed: el pack `guard.fidelity` del seed tiene OTRA redacción, y la Verificación exige
//       que `grep "no deformation"` del CLI lo encuentre. Lo EMITE el compilador.
//   (3) GUARD PACKS resueltos por §9.5 (general→fidelity→vertical→platform) vía `resolveGuardPacks`;
//   (4) ANTI-ESTILO UGC literal del compilador ("no cinematic grading, no beauty filters") —
//       garantizado aquí, sin depender de que cada template lo escriba;
//   (5) BEATS interpolados (sus `dialogue` llevan `{hook.line}`/`{cta.line}`).
//
// VALIDACIÓN DE RESOLUCIÓN COMPLETA (patrón seed-validator, NO lanza): la salida es
// `{ ok: true, ... } | { ok: false, issues }`. Un slot requerido irresoluble → `unresolved_slot`
// que NOMBRA el slot y su fuente ("persona.setting ← Persona") — el "error accionable" de §Verif.
//
// POR ESCENA: el motor compila UNA escena (opcional): N7 (F4) genera 1 clip por escena (§13.1 N7d),
// así que `compilePrompt` acepta una `AdScene` y adapta beats/dialogue a esa escena.
import { extractSlots } from './canonical-variables';
import type { GuardPackSeed, PromptTemplateSeed } from './contracts';
import { resolveGuardPacks } from './guard-lookup';
import { resolveSlot, type SlotResolution, type VariableSources } from './variable-sources';
import type { AdScene } from '../contracts/ad-script';

/**
 * FIDELITY GUARD del compilador (literal HARDCODEADO). Contiene la frase EXACTA que la
 * Verificación busca con `grep "no deformation"`, más la preservación de identidad/label. NO sale
 * del seed (`guard.fidelity` tiene otra redacción): el compilador la GARANTIZA para todo prompt.
 */
export const COMPILER_FIDELITY_GUARD =
  'Fidelity: preserve the product label, geometry and colour exactly, and hold a stable identity for the creator across every cut — no deformation, drift, or artifacts.';

/**
 * ANTI-ESTILO UGC del compilador (literal HARDCODEADO). Garantiza el look "phone-shot, no
 * post" sin depender de que cada template lo escriba en su `body`.
 */
export const COMPILER_ANTI_STYLE =
  'Anti-style: no cinematic grading, no beauty filters, no studio polish — it must read as a raw smartphone capture.';

/** Etiquetas de sección del prompt ensamblado. Constantes para que los goldens no dependan de
 *  literales dispersos y un cambio de rótulo sea una sola edición revisable en el diff. */
const GUARD_PACKS_HEADER = 'Guard rails:';

/** Un problema de compilación (patrón `GallerySeedIssue`): tipado, con slot y fuente cuando aplica. */
export interface CompileIssue {
  code: 'unresolved_slot' | 'missing_asset_slot' | 'no_template_candidate';
  /** El slot exacto (`persona.setting`), cuando el issue es de un slot. */
  slot?: string;
  /** La fuente esperada del slot (`Persona`), cuando aplica — el "de qué fuente" del error. */
  source?: string;
  message: string;
}

/** La salida ESTRUCTURADA del compilador (T4.11/N7 necesitan estructura, no solo el string). */
export interface CompiledPrompt {
  resolvedPrompt: string;
  /** Los beats con su `dialogue` ya interpolado (los consume N7 para el timing del clip). */
  resolvedBeats: {
    tStart: number;
    tEnd: number;
    action: string;
    dialogue: string;
    camera: string;
  }[];
  templateSlug: string;
  /** La versión/estado del template usado (auditoría en canvas T4.11). */
  templateStatus: string;
  /** Las KEYS de guard pack efectivamente inyectadas, en orden (auditoría). */
  guardPackKeysUsed: string[];
}

export type CompileResult =
  { ok: true; result: CompiledPrompt } | { ok: false; issues: CompileIssue[] };

/** Las entradas del compilador. `guardPacks` es el seed COMPLETO de guard packs (§10.1); el
 *  compilador resuelve el subconjunto §9.5 él mismo (category del brief + plataforma). `scene`
 *  opcional: compilar por escena (N7) en vez de la variante entera. */
export interface CompileInput {
  template: PromptTemplateSeed;
  sources: VariableSources;
  guardPacks: readonly GuardPackSeed[];
  /** Si se pasa, se compila SOLO esta escena (su narración manda el hook/cta del dialogue). */
  scene?: AdScene;
}

/**
 * Interpola los slots `{...}` de un texto contra las fuentes. Devuelve el texto resuelto y la lista
 * de fallos (para acumular todos los issues de una pasada, como el seed-validator). Un slot que
 * falla se deja como `{slot}` en el texto parcial (nunca se emite un prompt con `ok:true` si hubo
 * fallos: la validación de resolución completa lo bloquea antes).
 */
function interpolate(
  text: string,
  sources: VariableSources,
): { text: string; failures: Extract<SlotResolution, { resolved: false }>[] } {
  const failures: Extract<SlotResolution, { resolved: false }>[] = [];
  const resolved = text.replace(/\{([^}]+)\}/g, (_match, slot: string) => {
    const res = resolveSlot(slot, sources);
    if (res.resolved) return res.value;
    failures.push(res);
    return `{${slot}}`;
  });
  return { text: resolved, failures };
}

/** Renderiza un guard pack como una línea con viñetas estables (orden del seed dentro del pack). */
function renderGuardPack(pack: GuardPackSeed): string {
  return pack.lines.map((line) => `- ${line}`).join('\n');
}

/**
 * COMPILA el prompt de una variante (o de una escena). NO lanza. Valida resolución completa: si
 * algún slot requerido no resuelve, devuelve `ok:false` con los `CompileIssue` que nombran slot y
 * fuente. Solo con TODOS los slots resueltos emite el `resolvedPrompt`.
 */
export function compilePrompt(input: CompileInput): CompileResult {
  const { template, sources, guardPacks, scene } = input;
  const issues: CompileIssue[] = [];

  // (1) El body interpolado. Si se compila por escena, el body sigue siendo el del template (el
  // "cómo se ve" global), pero el dialogue de los beats se acota a la escena (abajo).
  const bodyResult = interpolate(template.body, sources);
  for (const f of bodyResult.failures) {
    issues.push({ code: 'unresolved_slot', slot: f.slot, source: f.source, message: f.message });
  }

  // (5) Beats interpolados. Por escena, se filtran a los beats que solapan la ventana [t, t+dur);
  // si no hay `scene`, se compilan todos (la variante entera).
  const beatsToRender = scene
    ? template.beats.filter((b) => b.tStart < scene.t + scene.seconds && b.tEnd > scene.t)
    : template.beats;
  const resolvedBeats = beatsToRender.map((beat) => {
    const dialogue = interpolate(beat.dialogue, sources);
    for (const f of dialogue.failures) {
      issues.push({ code: 'unresolved_slot', slot: f.slot, source: f.source, message: f.message });
    }
    return {
      tStart: beat.tStart,
      tEnd: beat.tEnd,
      action: beat.action,
      dialogue: dialogue.text,
      camera: beat.camera,
    };
  });

  // Si hubo cualquier slot irresoluble, NO se emite prompt: se devuelven TODOS los issues de una
  // pasada (patrón seed-validator), dedup por slot para no repetir el mismo fallo N veces.
  if (issues.length > 0) {
    const seen = new Set<string>();
    const deduped = issues.filter((i) => {
      const key = `${i.code}:${i.slot ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ok: false, issues: deduped };
  }

  // (3) Guard packs §9.5, resueltos por category del brief + plataforma de campaña. `resolveGuardPacks`
  // devuelve orden estable (general→fidelity→vertical→platform).
  const packs = resolveGuardPacks(guardPacks, {
    category: sources.brief.product.category,
    platform: sources.campaign.platform,
  });
  const guardPackKeysUsed = packs.map((p) => p.key);
  const guardPacksBlock =
    packs.length > 0 ? `${GUARD_PACKS_HEADER}\n${packs.map(renderGuardPack).join('\n')}` : '';

  // Ensamblaje final, orden estable (1)(2)(3)(4)(5). Cada sección separada por doble salto de línea.
  const beatsBlock =
    resolvedBeats.length > 0
      ? `Beats:\n${resolvedBeats
          .map(
            (b) =>
              `- [${String(b.tStart)}-${String(b.tEnd)}s] ${b.action}` +
              (b.dialogue !== '' ? ` — "${b.dialogue}"` : '') +
              ` (${b.camera})`,
          )
          .join('\n')}`
      : '';

  const sections = [
    bodyResult.text,
    COMPILER_FIDELITY_GUARD,
    guardPacksBlock,
    COMPILER_ANTI_STYLE,
    beatsBlock,
  ].filter((s) => s !== '');

  const resolvedPrompt = sections.join('\n\n');

  return {
    ok: true,
    result: {
      resolvedPrompt,
      resolvedBeats,
      templateSlug: template.slug,
      templateStatus: template.status,
      guardPackKeysUsed,
    },
  };
}

/**
 * Utilidad para diagnóstico/tests: los slots §10.4 que un `body` declara. Reexporta `extractSlots`
 * bajo un nombre de dominio para que el CLI/los tests no importen del vocabulario a bajo nivel.
 */
export function templateSlots(body: string): string[] {
  return extractSlots(body);
}
