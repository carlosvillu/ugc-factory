// VALIDADOR DE SEEDS (T2.1). Función PURA, determinista y gratuita: recibe la librería
// que `pnpm seed` va a insertar (hooks + CTAs + recetas) y devuelve los problemas
// ENCONTRADOS, con el índice y el dato exactos. Sin red, sin BD, sin LLM.
//
// Vive en el GATE (`pnpm gate` → `pnpm test` → el test unitario de este módulo valida el
// seed REAL, no un fixture de juguete): una librería con un hook sin ángulo, un hook de 13
// palabras o una receta sin coste NO puede llegar a la BD ni sobrevivir a un commit.
//
// Los checks que la Verificación de T2.1 nombra explícitamente:
//   - hook SIN ÁNGULO            → `hook_missing_angle`
//   - hook de MÁS DE 12 palabras → `hook_too_long` (reusa MAX_HOOK_WORDS de T1.9: una sola
//                                   definición del techo en todo el sistema)
//   - receta SIN COSTE           → `recipe_missing_cost`
//
// El contrato de PLANTILLA (placeholders conocidos) es de la LÍNEA INTERPOLABLE, no del hook:
// vive en `validateTemplate` y lo llaman las dos ramas, porque las CTAs también se sustituyen
// (§12). Ver el comentario de esa función: tenerlo solo en hooks dejó a las CTAs sin red
// durante el primer pase de T2.1.
//
// EL TECHO SE MIDE SOBRE EL HOOK RENDERIZADO, NO SOBRE LA PLANTILLA (corrección del pase de
// review de T2.1). `'Deja de gastar dinero en cosas que no arreglan {pain}.'` son 10 palabras
// literales pero 15 en el peor caso renderizado — y lo que tiene que caber en los 0–3 s del
// anuncio es lo que el espectador OYE, no la plantilla. Por eso se cuenta con
// `countRenderedWords` (literal + presupuesto de cada placeholder, `placeholders.ts`), que es
// el mismo mapa que el renderizador de T2.4 debe respetar al sustituir.
//
// Matiz que importa (§ brief de T2.1): el techo es DURO para la librería —estas líneas las
// escribe una persona, son plantillas curadas— mientras que para los hooks que GENERA el LLM
// (BriefValidator, T1.9) es solo un warning y se cuenta LITERAL (esos hooks no llevan
// placeholders). Una constante, dos formas de contar, cada una honesta con lo que mide.
import { MAX_HOOK_WORDS } from '../analyze/brief-validator';
import { KNOWN_PLACEHOLDERS, countRenderedWords, findPlaceholders } from './placeholders';
import {
  CtaLineSeedSchema,
  HookLineSeedSchema,
  RecipeSeedSchema,
  RecipeTierSchema,
  type CtaLineSeed,
  type HookLineSeed,
  type RecipeSeed,
} from './contracts';

export type SeedIssueCode =
  /** El objeto no cumple el contrato Zod (campo ausente, enum inválido, coste ≤ 0 o rango invertido…). */
  | 'schema_invalid'
  /** El hook no declara ángulo (el compositor de matriz elige hooks POR ángulo). */
  | 'hook_missing_angle'
  /** El hook supera MAX_HOOK_WORDS palabras EN SU PEOR CASO RENDERIZADO (ver placeholders.ts). */
  | 'hook_too_long'
  /** La plantilla (de hook O de CTA) lleva un `{placeholder}` que el renderizador no sabe resolver. */
  | 'unknown_placeholder'
  /** La receta no declara coste estimado usable. */
  | 'recipe_missing_cost'
  /** Falta (o sobra) una receta: el Apéndice B define EXACTAMENTE 3 tiers. */
  | 'recipe_tier_coverage'
  /** Dos líneas idénticas en el mismo idioma (chocarían con el UNIQUE de la BD). */
  | 'duplicate_line';

export interface SeedIssue {
  code: SeedIssueCode;
  /** `hook_line` | `cta_line` | `recipe`. */
  entity: 'hook_line' | 'cta_line' | 'recipe';
  /** Índice dentro de su colección (o el tier, para recetas): dónde mirar. */
  where: string;
  message: string;
}

export interface SeedLibrary {
  hooks: HookLineSeed[];
  ctas: CtaLineSeed[];
  recipes: RecipeSeed[];
}

/** Entrada SIN TIPAR a propósito: el validador es la frontera. Un seed que viene de un
 *  fichero de datos (o de un fixture del test) puede tener cualquier forma; el trabajo del
 *  validador es precisamente decidir si la tiene o no. */
export interface RawSeedLibrary {
  hooks: unknown[];
  ctas: unknown[];
  recipes: unknown[];
}

export interface ValidateSeedsResult {
  ok: boolean;
  issues: SeedIssue[];
  /** La librería YA PARSEADA (solo cuando `ok`): lo que el seed script puede insertar. */
  library?: SeedLibrary;
}

function firstZodMessage(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  if (!issue) return 'inválido';
  const path = issue.path.map(String).join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * El contrato de PLANTILLA, común a las DOS líneas interpolables de la librería (§12: tanto
 * `hook_line.text` como `cta_line.text` se sustituyen con valores del ProductBrief).
 *
 * Vive aquí, y no dentro del bucle de hooks, por una razón que costó un bug: un placeholder
 * que el renderizador no sabe resolver llega LITERAL al anuncio ("Pruébalo y olvídate de
 * {problema}"), y eso no es una propiedad del hook — es una propiedad de la plantilla. Cuando
 * el chequeo vivía solo en la rama de hooks, las CTAs (que llevan 46 placeholders en la
 * librería sembrada) quedaban sin red: el TEST barría las dos, pero el VALIDADOR —el que
 * `pnpm seed` llama de verdad antes de escribir— solo miraba una. El gate protegía una puerta
 * por la que el dato no entraba.
 *
 * `maxWords` es opcional a propósito: el techo de 12 palabras es del HOOK (tiene que caber en
 * los 0–3 s del gancho); una CTA no lo tiene. Lo que las dos comparten es el vocabulario de
 * placeholders, no el techo.
 */
function validateTemplate(
  text: string,
  entity: 'hook_line' | 'cta_line',
  where: string,
  maxWords?: number,
): SeedIssue[] {
  const unknown = findPlaceholders(text).filter((p) => !KNOWN_PLACEHOLDERS.includes(p));
  if (unknown.length > 0) {
    // Se rechaza ANTES de contar: sin presupuesto conocido no se puede acotar el peor caso.
    return [
      {
        code: 'unknown_placeholder',
        entity,
        where,
        message: `placeholder desconocido ${unknown.join(', ')} (conocidos: ${KNOWN_PLACEHOLDERS.join(', ')}): "${text}"`,
      },
    ];
  }

  // EL TECHO, sobre el PEOR CASO RENDERIZADO (no sobre la plantilla): literal + el presupuesto
  // de palabras de cada placeholder. Duro aquí (plantilla curada); warning y conteo literal en
  // el BriefValidator (hook generado por el LLM, sin placeholders).
  if (maxWords !== undefined) {
    const words = countRenderedWords(text);
    if (words > maxWords) {
      return [
        {
          code: 'hook_too_long',
          entity,
          where,
          message: `hook de ${String(words)} palabras renderizadas en el peor caso (máx ${String(maxWords)}): "${text}"`,
        },
      ];
    }
  }
  return [];
}

/**
 * Valida la librería completa. NO lanza: devuelve todos los problemas de una pasada (una
 * librería con tres hooks malos los reporta los tres — arreglarlos de uno en uno sería
 * tortura). El llamante (el test del gate, el script de seed) decide qué hacer con `ok`.
 */
export function validateSeeds(raw: RawSeedLibrary): ValidateSeedsResult {
  const issues: SeedIssue[] = [];
  const hooks: HookLineSeed[] = [];
  const ctas: CtaLineSeed[] = [];
  const recipes: RecipeSeed[] = [];

  // ── Hooks ──────────────────────────────────────────────────────────────────
  raw.hooks.forEach((candidate, index) => {
    const parsed = HookLineSeedSchema.safeParse(candidate);
    if (!parsed.success) {
      // El ángulo ausente/ilegal es un caso NOMBRADO por la Verificación: se reporta con
      // su propio código, no ahogado en un `schema_invalid` genérico.
      const angle = (candidate as { angle?: unknown } | null)?.angle;
      const angleBroken = parsed.error.issues.some((i) => i.path[0] === 'angle');
      issues.push({
        code: angleBroken ? 'hook_missing_angle' : 'schema_invalid',
        entity: 'hook_line',
        where: `hooks[${String(index)}]`,
        message: angleBroken
          ? `hook sin ángulo válido (recibido: ${JSON.stringify(angle)})`
          : firstZodMessage(parsed.error),
      });
      return;
    }
    const hook = parsed.data;

    // El contrato de plantilla + EL TECHO (que es del hook: 0–3 s de gancho).
    const templateIssues = validateTemplate(
      hook.text,
      'hook_line',
      `hooks[${String(index)}]`,
      MAX_HOOK_WORDS,
    );
    if (templateIssues.length > 0) {
      issues.push(...templateIssues);
      return;
    }
    hooks.push(hook);
  });

  // ── CTAs ───────────────────────────────────────────────────────────────────
  raw.ctas.forEach((candidate, index) => {
    const parsed = CtaLineSeedSchema.safeParse(candidate);
    if (!parsed.success) {
      issues.push({
        code: 'schema_invalid',
        entity: 'cta_line',
        where: `ctas[${String(index)}]`,
        message: firstZodMessage(parsed.error),
      });
      return;
    }
    const cta = parsed.data;

    // El MISMO contrato de plantilla que el hook (las CTAs sembradas llevan {product}/{pain}),
    // pero SIN techo: una CTA no tiene que caber en los 0–3 s del gancho.
    const templateIssues = validateTemplate(cta.text, 'cta_line', `ctas[${String(index)}]`);
    if (templateIssues.length > 0) {
      issues.push(...templateIssues);
      return;
    }
    ctas.push(cta);
  });

  // ── Duplicados (la BD tiene UNIQUE (language, text) en ambas librerías: un duplicado
  //    aquí haría que el seed insertara N-1 filas en silencio vía ON CONFLICT DO NOTHING).
  issues.push(...findDuplicates(hooks, 'hook_line', 'hooks'));
  issues.push(...findDuplicates(ctas, 'cta_line', 'ctas'));

  // ── Recetas ────────────────────────────────────────────────────────────────
  raw.recipes.forEach((candidate, index) => {
    const parsed = RecipeSeedSchema.safeParse(candidate);
    if (!parsed.success) {
      // "Receta sin coste" es el otro caso NOMBRADO por la Verificación: coste ausente,
      // null, 0 o negativo — todo lo que hace inservible la receta para el estimador de
      // T2.2 — se reporta como `recipe_missing_cost`, no como `schema_invalid` genérico.
      const costBroken = parsed.error.issues.some(
        (i) => i.path[0] === 'estCost30sMinCents' || i.path[0] === 'estCost30sMaxCents',
      );
      const tier = (candidate as { tier?: unknown } | null)?.tier;
      issues.push({
        code: costBroken ? 'recipe_missing_cost' : 'schema_invalid',
        entity: 'recipe',
        where: typeof tier === 'string' ? tier : `recipes[${String(index)}]`,
        message: firstZodMessage(parsed.error),
      });
      return;
    }
    recipes.push(parsed.data);
  });

  // COBERTURA: el Apéndice B define EXACTAMENTE tres recetas, una por tier. Ni menos (el
  // estimador de T2.2 no podría cotizar un lote de ese tier) ni repetidas (la PK de
  // `recipe` es el tier: la segunda pisaría a la primera en el upsert, en silencio).
  const seen = new Set<string>();
  for (const r of recipes) {
    if (seen.has(r.tier)) {
      issues.push({
        code: 'recipe_tier_coverage',
        entity: 'recipe',
        where: r.tier,
        message: `receta duplicada para el tier "${r.tier}"`,
      });
    }
    seen.add(r.tier);
  }
  for (const tier of RecipeTierSchema.options) {
    if (!seen.has(tier)) {
      issues.push({
        code: 'recipe_tier_coverage',
        entity: 'recipe',
        where: tier,
        message: `falta la receta del tier "${tier}" (Apéndice B define los 3)`,
      });
    }
  }

  const ok = issues.length === 0;
  return ok ? { ok, issues, library: { hooks, ctas, recipes } } : { ok, issues };
}

function findDuplicates(
  lines: { language: string; text: string }[],
  entity: 'hook_line' | 'cta_line',
  label: string,
): SeedIssue[] {
  const seen = new Map<string, number>();
  const issues: SeedIssue[] = [];
  lines.forEach((line, index) => {
    const key = `${line.language}::${line.text}`;
    const first = seen.get(key);
    if (first !== undefined) {
      issues.push({
        code: 'duplicate_line',
        entity,
        where: `${label}[${String(index)}]`,
        message: `duplicado de ${label}[${String(first)}] (${line.language}): "${line.text}"`,
      });
      return;
    }
    seen.set(key, index);
  });
  return issues;
}

/** Formatea los problemas para un fallo ruidoso (lo usa `pnpm seed` antes de tocar la BD). */
export function formatSeedIssues(issues: SeedIssue[]): string {
  return issues.map((i) => `  [${i.code}] ${i.entity} ${i.where} — ${i.message}`).join('\n');
}
