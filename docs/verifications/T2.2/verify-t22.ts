// VERIFICACIÓN INDEPENDIENTE DE T2.2 (escrita por el verifier, NO por el implementer).
// Brief REAL: el ProductBrief que T1.8 generó con Sonnet para allbirds.com
// (docs/verifications/T1.8/briefs.json, results[0].brief) — no un brief de juguete.
// Recetas REALES: RECIPE_SEEDS de packages/core/src/library/seed-data.ts (Apéndice B).
import { readFileSync } from 'node:fs';
import { composeMatrix, estimateBatchCost, DURATION_PRESETS } from '../../../packages/core/src/strategy/index';
import type { PlannablePersona } from '../../../packages/core/src/strategy/index';
import { RECIPE_SEEDS } from '../../../packages/core/src/library/index';
import { ProductBriefSchema } from '../../../packages/core/src/contracts/index';
import { BatchPlanSchema } from '../../../packages/core/src/contracts/index';
import { matchPersonas } from '../../../packages/core/src/persona/index';

const H = (s: string) => console.log('\n' + '='.repeat(90) + '\n' + s + '\n' + '='.repeat(90));
let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? '  OK  ' : '  FAIL'} | ${label}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
}

// ── 0. EL BRIEF REAL (T1.8, Sonnet, allbirds.com) ─────────────────────────────────────────
const raw = JSON.parse(
  readFileSync('docs/verifications/T1.8/briefs.json', 'utf8'),
) as { results: { label: string; brief: unknown }[] };
const brief = ProductBriefSchema.parse(raw.results[0]!.brief); // valida que es un brief REAL

H('0. BRIEF REAL (T1.8 · Sonnet · allbirds.com)');
console.log('producto      :', brief.product.name);
console.log('idioma        :', brief.meta.language, '| source:', brief.meta.source_url);
console.log('ángulos       :', brief.angles.length);
brief.angles.forEach((a, i) =>
  console.log(`  [${i}] ${a.name} (fw=${a.framework}, hook_examples=${a.hook_examples.length})`),
);
const hint = brief.audience.segments[0]!.avatar_hint;
console.log('avatar_hint[0]:', JSON.stringify(hint));
check('el brief tiene ≥2 ángulos con hook_examples', brief.angles.length >= 2 && brief.angles.every((a) => a.hook_examples.length > 0));
check('el brief tiene avatar_hint en segments[0]', hint.length > 0);

// ── PERSONAS que CASAN DE VERDAD con el hint (si no casan, la verificación sería vacua) ────
// hint: "Hombre de unos 32 años, energía tranquila y natural, en una calle urbana o entrando
//        a una cafetería antes de ir a la oficina"
const personaA: PlannablePersona = {
  id: 'prs-alvaro',
  name: 'Álvaro',
  gender: 'male',
  ethnicity: 'latino',
  style: 'urbana casual natural',   // 'urbana' y 'natural' están en el hint
  descriptor: 'energia tranquila, camina por la calle hacia la oficina', // tranquila/calle/oficina
  ageRange: '25-34',                // solapa con "32 años"
};
const personaB: PlannablePersona = {
  id: 'prs-marc',
  name: 'Marc',
  gender: 'male',
  ethnicity: 'caucasico',
  style: 'urbana minimalista',      // 'urbana'
  descriptor: 'tono natural, en una cafeteria', // natural/cafeteria
  ageRange: '30-39',                // solapa con "32 años"
};

const scoredOne = matchPersonas([personaA], hint);
const scoredTwo = matchPersonas([personaA, personaB], hint);
H('0b. PRE-CONDICIÓN: las personas CASAN de verdad con el avatar_hint (T2.0 matchPersonas)');
scoredTwo.forEach((s) =>
  console.log(`  ${s.persona.name}: score=${s.score} matched=[${s.matched.join(', ')}]`),
);
check('personaA es candidata REAL (score > 0)', scoredOne.length === 1, `candidatas=${scoredOne.length}`);
check('personaA + personaB son AMBAS candidatas REALES', scoredTwo.length === 2, `candidatas=${scoredTwo.length}`);

const recipeFor = (tier: 'test' | 'standard' | 'premium') =>
  RECIPE_SEEDS.find((r) => r.tier === tier)!;

// ═════════════════════════════════════════════════════════════════════════════════════════
// 1. LA VERIFICACIÓN LITERAL: 2 ángulos × 3 hooks × 1 persona × es+en → 12 variantes
// ═════════════════════════════════════════════════════════════════════════════════════════
H('1. LA MATRIZ DE LA VERIFICACIÓN: 2 ángulos × 3 hooks × 1 persona × (es+en), conversion');

for (const tier of ['test', 'standard', 'premium'] as const) {
  const plan = composeMatrix({
    brief,
    angleIndices: [0, 1],
    hooksPerAngle: 3,
    personas: [personaA],       // 1 PERSONA
    languages: ['es', 'en'],    // es + en
    objective: 'conversion',    // preset §8.4 → 30 s (el ancla del Apéndice B)
    tier,
  });
  BatchPlanSchema.parse(plan); // el plan valida contra su propio contrato Zod

  const recipe = recipeFor(tier);
  const est = estimateBatchCost(plan, recipe);

  if (tier === 'test') {
    console.log('\n-- LAS 12 VARIANTES (tier test; la matriz es idéntica en los 3 tiers) --');
    plan.variants.forEach((v, i) =>
      console.log(
        `  ${String(i + 1).padStart(2)}. ${v.filenameCode}\n      ángulo=${v.angleIndex} lang=${v.language} persona=${v.personaName ?? 'null'} hook="${v.hook.text.slice(0, 48)}…" (${v.hook.source})`,
      ),
    );
    console.log('\n  personaSelection:', plan.personaSelection, '| sharedBodyAndCta:', plan.sharedBodyAndCta, '| duración:', plan.durationTargetSeconds, 's');
    check('EXACTAMENTE 12 variantes (2×3×2)', plan.variants.length === 12, `n=${plan.variants.length}`);
    check('las 12 llevan la persona compatible asignada', plan.variants.every((v) => v.personaName === 'Álvaro'));
    check('personaSelection = matched', plan.personaSelection === 'matched');
    check('12 filenameCode ÚNICOS', new Set(plan.variants.map((v) => v.filenameCode)).size === 12);
    check('2 ángulos distintos', new Set(plan.variants.map((v) => v.angleIndex)).size === 2);
    check('2 idiomas distintos (es, en)', new Set(plan.variants.map((v) => v.language)).size === 2);
    check('3 hooks por (ángulo, idioma)', [0, 1].every((a) => ['es', 'en'].every((l) => plan.variants.filter((v) => v.angleIndex === a && v.language === l).length === 3)));
    check('duración = 30 s (preset conversion §8.4)', plan.durationTargetSeconds === 30 && DURATION_PRESETS.conversion.targetSeconds === 30);
  }

  // ── EL COSTE DESGLOSADO ────────────────────────────────────────────────────────────────
  console.log(`\n-- COSTE · tier=${tier} · receta Apéndice B = [${recipe.estCost30sMinCents}, ${recipe.estCost30sMaxCents}] ¢/30 s --`);
  console.log(`  lineItems: ${est.lineItems.length}`);
  if (tier === 'test') {
    est.lineItems.forEach((li) =>
      console.log(
        `    ${li.segment.padEnd(4)} ${li.seconds}s  min=${li.cost.minCents}¢ max=${li.cost.maxCents}¢  key=${li.segmentKey}  variants=[${li.variantFilenameCodes.length}]`,
      ),
    );
  }
  console.log(`  standaloneVariant : min=${est.standaloneVariant.minCents}¢  max=${est.standaloneVariant.maxCents}¢`);
  console.log(`  TOTAL DEL LOTE    : min=${est.total.minCents}¢ ($${(est.total.minCents / 100).toFixed(2)})  max=${est.total.maxCents}¢ ($${(est.total.maxCents / 100).toFixed(2)})`);

  // (3) coste DESGLOSADO: hay lineItems, no solo un total
  check(`[${tier}] hay desglose (lineItems)`, est.lineItems.length > 0, `${est.lineItems.length} partidas`);
  check(`[${tier}] 36 partidas = 12 variantes × 3 segmentos (conversion NO comparte nada)`, est.lineItems.length === 36, `n=${est.lineItems.length}`);

  // (4a) Σ lineItems == total, AL CÉNTIMO
  const sumLiMin = est.lineItems.reduce((s, li) => s + li.cost.minCents, 0);
  const sumLiMax = est.lineItems.reduce((s, li) => s + li.cost.maxCents, 0);
  check(`[${tier}] Σ lineItems == total (min)`, sumLiMin === est.total.minCents, `${sumLiMin} vs ${est.total.minCents}`);
  check(`[${tier}] Σ lineItems == total (max)`, sumLiMax === est.total.maxCents, `${sumLiMax} vs ${est.total.maxCents}`);

  // (4b) Σ perVariant == total, AL CÉNTIMO
  const pv = Object.values(est.perVariant);
  const sumPvMin = pv.reduce((s, c) => s + c.minCents, 0);
  const sumPvMax = pv.reduce((s, c) => s + c.maxCents, 0);
  check(`[${tier}] perVariant tiene las 12 variantes`, pv.length === 12, `n=${pv.length}`);
  check(`[${tier}] Σ perVariant == total (min)`, sumPvMin === est.total.minCents, `${sumPvMin} vs ${est.total.minCents}`);
  check(`[${tier}] Σ perVariant == total (max)`, sumPvMax === est.total.maxCents, `${sumPvMax} vs ${est.total.maxCents}`);

  // (4c) LA CUENTA A MANO CONTRA EL APÉNDICE B (±10 %)
  // El lote es 12 anuncios de 30 s SIN NADA COMPARTIDO (conversion) → 12 × la horquilla de 30 s.
  const handMin = 12 * recipe.estCost30sMinCents;
  const handMax = 12 * recipe.estCost30sMaxCents;
  const devMin = Math.abs(est.total.minCents - handMin) / handMin;
  const devMax = Math.abs(est.total.maxCents - handMax) / handMax;
  console.log(`  CUENTA A MANO (Apéndice B): 12 × [${recipe.estCost30sMinCents}, ${recipe.estCost30sMaxCents}]¢ = [${handMin}, ${handMax}]¢ = [$${(handMin / 100).toFixed(2)}, $${(handMax / 100).toFixed(2)}]`);
  console.log(`  DESVÍO: min ${(devMin * 100).toFixed(4)} %  ·  max ${(devMax * 100).toFixed(4)} %`);
  check(`[${tier}] total.min cuadra a mano con el Apéndice B (±10 %)`, devMin <= 0.1, `desvío ${(devMin * 100).toFixed(4)} %`);
  check(`[${tier}] total.max cuadra a mano con el Apéndice B (±10 %)`, devMax <= 0.1, `desvío ${(devMax * 100).toFixed(4)} %`);
  // El ancla: a 30 s el estimador reproduce EXACTAMENTE la receta.
  check(`[${tier}] a 30 s standaloneVariant == receta EXACTA (el ancla)`, est.standaloneVariant.minCents === recipe.estCost30sMinCents && est.standaloneVariant.maxCents === recipe.estCost30sMaxCents);
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// 2. LA ECONOMÍA HOOK×BODY×CTA (§16.1) — y el BUG DE DINERO de las 2 personas
// ═════════════════════════════════════════════════════════════════════════════════════════
H('2. hook_test: body/CTA COMPARTIDOS → 5 generaciones, no 9 (§16.1)');

function hookTestPlan(personas: PlannablePersona[]) {
  return composeMatrix({
    brief,
    angleIndices: [0],
    hooksPerAngle: 3,
    personas,
    languages: ['es'],
    objective: 'hook_test',
    tier: 'test',
  });
}

for (const [label, personas, expectedCandidates] of [
  ['1 PERSONA', [personaA], 1],
  ['2 PERSONAS compatibles (EL BUG DE DINERO: rotación rompía el compartido → 7)', [personaA, personaB], 2],
] as const) {
  const plan = hookTestPlan([...personas]);
  const est = estimateBatchCost(plan, recipeFor('test'));
  const cands = matchPersonas([...personas], hint).length;
  console.log(`\n-- ${label} --`);
  console.log(`  candidatas REALES de matchPersonas: ${cands} (esperado ${expectedCandidates})`);
  console.log(`  variantes: ${plan.variants.length} | personas asignadas: ${JSON.stringify([...new Set(plan.variants.map((v) => v.personaName))])}`);
  console.log(`  GENERACIONES (lineItems): ${est.lineItems.length}`);
  est.lineItems.forEach((li) => console.log(`    ${li.segment.padEnd(4)} key=${li.segmentKey.padEnd(30)} compartida por ${li.variantFilenameCodes.length} variante(s)  min=${li.cost.minCents}¢ max=${li.cost.maxCents}¢`));
  console.log(`  TOTAL: min=${est.total.minCents}¢ max=${est.total.maxCents}¢`);

  check(`[${label}] la precondición se cumple: ${expectedCandidates} candidata(s) REAL(es)`, cands === expectedCandidates, `candidatas=${cands}`);
  check(`[${label}] 3 variantes (3 hooks)`, plan.variants.length === 3);
  check(`[${label}] 5 GENERACIONES (1 body + 1 cta + 3 hooks), NO 9 NI 7`, est.lineItems.length === 5, `n=${est.lineItems.length}`);
  check(`[${label}] hay 1 sola partida de body, compartida por las 3`, est.lineItems.filter((li) => li.segment === 'body').length === 1 && est.lineItems.find((li) => li.segment === 'body')!.variantFilenameCodes.length === 3);
  check(`[${label}] hay 1 sola partida de cta, compartida por las 3`, est.lineItems.filter((li) => li.segment === 'cta').length === 1 && est.lineItems.find((li) => li.segment === 'cta')!.variantFilenameCodes.length === 3);
  check(`[${label}] hay 3 partidas de hook (el hook NUNCA se comparte)`, est.lineItems.filter((li) => li.segment === 'hook').length === 3);
  const sMin = est.lineItems.reduce((s, li) => s + li.cost.minCents, 0);
  const sPvMin = Object.values(est.perVariant).reduce((s, c) => s + c.minCents, 0);
  check(`[${label}] Σ lineItems == Σ perVariant == total`, sMin === est.total.minCents && sPvMin === est.total.minCents);
}

// El contraste: en conversion NADA se comparte (cada variante lleva sus 3 segmentos propios).
H('2b. conversion: NADA se comparte — cada variante lleva sus 3 generaciones');
const convPlan = composeMatrix({
  brief, angleIndices: [0], hooksPerAngle: 3, personas: [personaA],
  languages: ['es'], objective: 'conversion', tier: 'test',
});
const convEst = estimateBatchCost(convPlan, recipeFor('test'));
console.log(`  3 variantes conversion → lineItems = ${convEst.lineItems.length} (esperado 9: 3×3)`);
check('conversion: 9 partidas para 3 variantes (ninguna compartida)', convEst.lineItems.length === 9, `n=${convEst.lineItems.length}`);
check('conversion: ninguna partida se comparte', convEst.lineItems.every((li) => li.variantFilenameCodes.length === 1));

// ═════════════════════════════════════════════════════════════════════════════════════════
// 3. LOS OTROS DOS BUGS QUE NO DEBEN VOLVER
// ═════════════════════════════════════════════════════════════════════════════════════════
H('3. REGRESIONES: duración fuera del preset (cobraba de MENOS) y plan vacío en silencio');

// 3a. Un plan con 90 s debe LANZAR, no cobrarse como 30 s.
const plan30 = composeMatrix({
  brief, angleIndices: [0], hooksPerAngle: 1, personas: [personaA],
  languages: ['es'], objective: 'conversion', tier: 'standard',
});
const corrupted90 = { ...plan30, durationTargetSeconds: 90 };
let threw90 = false;
let msg90 = '';
try {
  const bad = estimateBatchCost(corrupted90, recipeFor('standard'));
  console.log(`  ¡NO LANZÓ! devolvió total=${JSON.stringify(bad.total)} (¿lo cobró como 30 s?)`);
} catch (e) {
  threw90 = true;
  msg90 = (e as Error).message;
  console.log(`  LANZA: "${msg90}"`);
}
check('un plan de 90 s LANZA (ya no se cobra como 30 s)', threw90);
// y el coste que habría cobrado de menos:
const est30 = estimateBatchCost(plan30, recipeFor('standard'));
console.log(`  (a 30 s ese mismo plan costaría min=${est30.total.minCents}¢ — cobrar eso por 90 s sería cobrar 1/3)`);

// 3b. composeMatrix SIN angleIndices NI angleCount → todos los ángulos, no un plan VACÍO.
const allAngles = composeMatrix({
  brief, hooksPerAngle: 3, personas: [personaA],
  languages: ['es'], objective: 'conversion', tier: 'test',
});
console.log(`\n  composeMatrix sin angleIndices ni angleCount → ${allAngles.variants.length} variantes, ángulos: ${JSON.stringify([...new Set(allAngles.variants.map((v) => v.angleIndex))])}`);
check('sin selección de ángulos NO devuelve plan vacío', allAngles.variants.length > 0);
check(`compone TODOS los ángulos del brief (${brief.angles.length})`, new Set(allAngles.variants.map((v) => v.angleIndex)).size === brief.angles.length);
check('y las variantes son brief.angles × 3 hooks × 1 idioma', allAngles.variants.length === brief.angles.length * 3);
BatchPlanSchema.parse(allAngles);

// 3c. receta de otro tier → LANZA
let threwTier = false;
try {
  estimateBatchCost(plan30, recipeFor('test')); // plan standard + receta test
} catch (e) {
  threwTier = true;
  console.log(`\n  receta de tier equivocado LANZA: "${(e as Error).message}"`);
}
check('estimar un lote standard con la receta test LANZA', threwTier);

// ═════════════════════════════════════════════════════════════════════════════════════════
H(failures === 0 ? `RESULTADO: TODAS LAS COMPROBACIONES OK (0 fallos)` : `RESULTADO: ${failures} FALLO(S)`);
process.exit(failures === 0 ? 0 : 1);
