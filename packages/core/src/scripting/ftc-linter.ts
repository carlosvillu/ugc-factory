// EL LINTER FTC (N5, §15.2, T2.5): una FUNCIÓN PURA STANDALONE que audita un `AdScript` ya generado
// y devuelve los `GuardrailFlag[]` que lo bloquean (vacío = limpio). $0, sin red, determinista.
//
// POR QUÉ STANDALONE Y NO DENTRO DEL `write()` DEL SCRIPTWRITER (decisión de arquitectura del
// advisor): la razón NO está en T2.5, está en T2.6 (CP3), que RE-LINTEA al guardar una edición del
// usuario SIN regenerar el guion. Si el linter viviera dentro del writer, T2.6 no podría reusarlo.
// Aquí es una pieza pura, gratis y testeable, que CP3 llamará igual que la llama la verificación
// live de esta tarea. El writer/servicio NO lo invoca (eso acoplaría compliance a la generación y
// tocaría el contrato de T2.4): los flags surgen como el RETORNO de `lintScript`.
//
// EL PROMPT PIDE, EL LINTER OBLIGA (patrón `budgetViolation` de T2.4): §15.1 del system prompt PIDE
// roles honestos y reformulación en tercera persona; este linter OBLIGA y flaggea con explicación +
// sugerencia. Lo BLANDO («¿suena a tercera persona?») es juicio humano; lo DURO («¿aparece el claim
// X / el patrón "I bought this"?») es lo que este código dictamina.
//
// ═══ EL TRAP DE IDIOMA — LA DECISIÓN QUE DECIDE SI LA VERIFICACIÓN VERIFICA ALGO REAL ═══════════
//
// `banned_or_risky_claims` viene del brief en `brief.meta.language` (normalmente `es`). Los guiones
// salen en `variant.language` (`script.language`, puede ser `en`). Los tres detectores cruzan
// idiomas de forma DISTINTA, y aquí se DECLARA cómo (no se finge que un substring cross-idioma
// funciona — ese es el anti-patrón «el arnés más cómodo que la realidad» de la skill testing):
//
//   1. CLAIMS PROHIBIDOS (`banned_claim`): es TEXTO del brief. El match por substring SOLO tiene
//      sentido cuando `script.language === briefLanguage`. Cuando difieren, NO se intenta: un claim
//      español («cura el acné») no aparece VERBATIM en un guion inglés, y buscarlo por substring no
//      encontraría nada — o peor, daría una falsa sensación de cobertura. LIMITACIÓN DECLARADA: un
//      claim TRADUCIDO a otro idioma no se caza por texto (haría falta traducción/embeddings, fuera
//      de v1). Se detecta el caso REAL y frecuente: guion y claims en el MISMO idioma (lo normal —
//      la mayoría de los lotes son monolingües en el idioma del análisis).
//
//   2. PRIMERA PERSONA DE COMPRA (`first_person_purchase`) y 3. FOUNDER (`founder_first_person`):
//      son patrones del IDIOMA DESTINO (`script.language`), NO del brief. Un guion en `en` con «I
//      bought this» es una violación aunque los claims del brief estén en `es`. Los patrones están
//      indexados por idioma (`es` y `en` hoy, los dos que el proyecto usa). Idioma sin patrones →
//      no se detecta (limitación declarada: el detector es honesto sobre lo que no cubre, no
//      inventa una detección que no tiene).
import type { AdScript } from '../contracts/ad-script';
import type { GuardrailFlag, GuardrailRule } from '../contracts/guardrail-flag';

/** Opciones del linter. `bannedClaims` y `briefLanguage` salen del BRIEF; `script.language` (el
 *  idioma destino) lo lee el linter del propio guion — ver el trap de idioma en la cabecera. */
export interface LintScriptOptions {
  /** `brief.brand.banned_or_risky_claims` (§15.2). Cada uno es un claim en `briefLanguage`. */
  bannedClaims: readonly string[];
  /** `brief.meta.language`: el idioma EN EL QUE están los `bannedClaims`. NO es el del guion. */
  briefLanguage: string;
}

/**
 * Normaliza para comparar texto de forma robusta: minúsculas, sin acentos (NFD + strip de
 * diacríticos), espacios colapsados. Así «Cura El Acné» y «cura el acne» matchean el mismo claim.
 * Determinista y puro.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * SOLO SE AUDITA LO HABLADO (§15.2: «sobre guiones y hooks»). El `visual`/`camera`/`emotion` los lee
 * un generador de vídeo, no son claims publicitarios hablados. Se auditan hook, cta y la narración
 * de cada escena. `fullText` es la concatenación de todo lo hablado (ya la calcula N5), así que
 * cubre hook+body+cta; se añaden `hook` y `cta` por si un caller construye un `AdScript` a mano con
 * un `fullText` desincronizado (defensa barata).
 */
function spokenTextOf(script: AdScript): string {
  return [
    script.fullText,
    script.hook,
    script.cta,
    ...script.scenes.map((scene) => scene.narration),
  ].join('\n');
}

/**
 * PATRONES POR IDIOMA DESTINO. Cada uno es un RegExp anclado en el SUJETO en primera persona (no en
 * el verbo suelto): «I built this» dispara, pero «The maker built this» NO (es la reformulación
 * educator correcta — no puede dar falso positivo). Case-insensitive y unicode.
 *
 * Se aplican sobre el texto ORIGINAL (no normalizado): las fronteras de palabra `\b` y los apóstrofos
 * («I'm») importan, y quitar acentos rompería patrones como «compré».
 */
interface LanguagePatterns {
  firstPersonPurchase: readonly RegExp[];
  founderFirstPerson: readonly RegExp[];
}

const PATTERNS_BY_LANGUAGE: Readonly<Record<string, LanguagePatterns>> = {
  en: {
    firstPersonPurchase: [
      // «I bought / I purchased / I got this / I ordered» — compra en primera persona.
      /\bi\s+(bought|purchased|ordered)\b/i,
      /\bi\s+got\s+(this|these|it|mine)\b/i,
      // «I've been using this for…», «I tried this and…»: experiencia personal de cliente.
      /\bi(?:'ve| have)\s+been\s+using\b/i,
      /\bi\s+tried\s+(this|it|these)\b/i,
      /\bi\s+use\s+(this|it|these)\b/i,
      // «this changed my life», «it saved my skin»: resultado personal reclamado.
      /\b(changed|saved|transformed)\s+my\b/i,
    ],
    founderFirstPerson: [
      // «I'm the founder», «I am the maker/creator/owner».
      /\bi(?:'m| am)\s+the\s+(founder|maker|creator|owner|ceo)\b/i,
      // «I founded / I built / I created / I started this (company/brand/product)».
      /\bi\s+(founded|built|created|started|made)\s+(this|it|the)\b/i,
      // «my company / my brand / my product»: posesión en primera persona del negocio.
      /\bmy\s+(company|brand|product|business)\b/i,
    ],
  },
  es: {
    firstPersonPurchase: [
      // «me lo compré», «lo compré», «me compré esto». Sin `\b` final: la é rompe el word-boundary
      // ASCII de JS (é no es «word char»), así que se cierra con límite explícito o fin.
      /\b(?:me\s+lo\s+)?compr[ée](?![a-z])/i,
      /\blo\s+ped[íi](?![a-z])/i,
      // «llevo usándolo», «llevo años usando», «llevo 3 meses usándolo», «llevo dos semanas usando».
      // 0..3 palabras (cuantificador opcional: número, «dos meses», «mucho tiempo») entre «llevo» y
      // el verbo `usar`; lazy + tope de 3 evita saltar a un «uso» lejano de una frase benigna («llevo
      // el producto en el bolso y no lo uso»). Stem `us` + a/á/o/e/é cubre usa/usá(ndolo)/uso/usé.
      /\bllevo\s+(?:\S+\s+){0,3}?us[aáoeé]/i,
      /\blo\s+prob[ée](?![a-z])/i,
      /\blo\s+uso(?![a-z])/i,
      // «me cambió la vida», «me salvó la piel»: resultado personal reclamado.
      /\bme\s+(?:cambi[óo]|salv[óo]|transform[óo])(?![a-z])/i,
    ],
    founderFirstPerson: [
      // «soy el fundador/creador/dueño/dueña».
      /\bsoy\s+(?:el|la)\s+(?:fundador|fundadora|creador|creadora|due[ñn][oa]|ceo)\b/i,
      // «yo fundé / yo creé / yo monté esta empresa/marca».
      /\byo\s+(?:fund[ée]|cre[ée]|mont[ée]|hice)(?![a-z])/i,
      /\b(?:fund[ée]|cre[ée]|mont[ée])\s+est[ae]\s+(?:empresa|marca|negocio|producto)\b/i,
      // «mi empresa / mi marca / mi negocio».
      /\bmi\s+(?:empresa|marca|negocio|producto)\b/i,
    ],
  },
};

/**
 * TODA la política POR REGLA vive en esta tabla de datos (indexada por `GuardrailRule`), no cableada
 * en la lógica de emisión: `blocking` (¿impide aprobar?), `explanation` (POR QUÉ es un problema de
 * compliance, §15.2 «con explicación») y `suggestion` (la alternativa compliant, §15.2 «y
 * sugerencia»). Las sugerencias son DETERMINISTAS (plantilla, NO LLM): mantienen el linter
 * puro/gratis/testeable. El prompt PIDE reformular; el linter OBLIGA con esta alternativa.
 *
 * Que `blocking` viva AQUÍ y no como literal en el push es deliberado (altitud): el día que exista
 * una regla de solo-aviso (`blocking: false`) se añade editando esta tabla, sin tocar el mecanismo —
 * el mismo estándar que ya rige idiomas, explicaciones y sugerencias.
 */
const POLICY_BY_RULE: Readonly<
  Record<GuardrailRule, { blocking: boolean; explanation: string; suggestion: string }>
> = {
  banned_claim: {
    blocking: true,
    explanation:
      'Contiene un claim de la lista de riesgo del brief (salud/finanzas/resultados garantizados): dispara rechazo de anuncios en TikTok/Meta y riesgo regulatorio FTC.',
    suggestion:
      'Elimina o atenúa la afirmación: describe qué hace el producto de forma verificable («ayuda a…», «está formulado para…») sin prometer un resultado garantizado ni un efecto médico/financiero.',
  },
  first_person_purchase: {
    blocking: true,
    explanation:
      'El avatar es un creator-style demonstrator, nunca un cliente real: afirmar experiencia personal de compra («I bought this») es un testimonio fabricado que la FTC prohíbe.',
    suggestion:
      'Reescribe como creator-style demo: presenta el producto sin afirmar experiencia personal de compra. Di «This does X» / «Esto hace X» en vez de «I bought this and…» / «me lo compré y…».',
  },
  founder_first_person: {
    blocking: true,
    explanation:
      'El avatar es sintético y NO es el fundador: afirmar en primera persona serlo es una identidad falsa. El origen founder se cuenta en tercera persona estilo educator.',
    suggestion:
      'Reformula en TERCERA persona estilo educator: el avatar es un creador, no el fundador. Di «the maker built this because…» / «quien lo creó lo hizo porque…» en vez de la afirmación en primera persona.',
  },
};

/** Construye un `GuardrailFlag` a partir de la regla y el fragmento que lo disparó: la política
 *  (bloqueo, explicación, sugerencia) sale de `POLICY_BY_RULE`; el `excerpt` lo aporta el caller
 *  (el claim crudo, o el contexto recortado de un match de regex). */
function makeFlag(rule: GuardrailRule, excerpt: string): GuardrailFlag {
  return { rule, excerpt, ...POLICY_BY_RULE[rule] };
}

/** Recorta un fragmento alrededor del match para el `excerpt` del flag (contexto legible en CP3). */
function excerptAround(text: string, index: number, matchLength: number): string {
  const radius = 24;
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + matchLength + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

/**
 * Audita un guion contra las tres reglas de §15.1/§15.2 y devuelve los flags bloqueantes. PURO.
 *
 * Vacío ⇒ limpio (equivale a «ok»: `flags.length === 0`). El orden es estable: primero el claim
 * prohibido (el diagnóstico más grave), luego compra, luego founder.
 */
export function lintScript(script: AdScript, options: LintScriptOptions): GuardrailFlag[] {
  const flags: GuardrailFlag[] = [];
  const spoken = spokenTextOf(script);

  // ── 1. CLAIMS PROHIBIDOS — solo si guion y claims comparten idioma (ver el trap en la cabecera).
  if (script.language === options.briefLanguage) {
    const normalizedSpoken = normalize(spoken);
    for (const claim of options.bannedClaims) {
      const normalizedClaim = normalize(claim);
      if (normalizedClaim.length === 0) continue;
      if (normalizedSpoken.includes(normalizedClaim)) {
        flags.push(makeFlag('banned_claim', claim));
      }
    }
  }

  // ── 2 y 3. PRIMERA PERSONA DE COMPRA y FOUNDER — patrones del IDIOMA DESTINO del guion.
  const patterns = PATTERNS_BY_LANGUAGE[script.language];
  if (patterns) {
    for (const [rule, regexes] of [
      ['first_person_purchase', patterns.firstPersonPurchase],
      ['founder_first_person', patterns.founderFirstPerson],
    ] as const satisfies readonly (readonly [GuardrailRule, readonly RegExp[]])[]) {
      for (const regex of regexes) {
        const match = regex.exec(spoken);
        if (match) {
          flags.push(makeFlag(rule, excerptAround(spoken, match.index, match[0].length)));
          break; // un flag por regla basta: CP3 muestra el diagnóstico, no cada coincidencia.
        }
      }
    }
  }

  return flags;
}
