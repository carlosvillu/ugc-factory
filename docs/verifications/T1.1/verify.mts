// Verificador INDEPENDIENTE del verifier (NO es la suite del implementer).
// Importa los schemas y el espejo de @ugc/core y comprueba, con MIS PROPIOS
// valores mutados, las dos cláusulas de la Verificación de T1.1.
// Se ejecuta con: pnpm --filter @ugc/core exec tsx <ruta> (resuelve el workspace).
import Ajv2020 from 'ajv/dist/2020';
import { makeBrief } from '@ugc/test-utils';
import { ProductBriefSchema, RawContentSchema } from '@ugc/core/contracts';
import { productBriefJsonSchema } from '@ugc/core/contracts';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass++;
    console.log(`  OK   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}

console.log('== CLÁUSULA 1: fixtures válidos/inválidos (mis propios valores) ==');

// (a) brief válido → success true
const valid = makeBrief();
check('brief canónico válido → success true', ProductBriefSchema.safeParse(valid).success === true);

// (b) sin ángulos → false
check(
  'angles: [] (sin ángulos) → false',
  ProductBriefSchema.safeParse({ ...valid, angles: [] }).success === false,
);

// (c) 4 y 11 ángulos → ambos false (rango 5-10). Uso MIS propios ángulos.
const oneAngle = valid.angles[0];
check(
  '4 ángulos (< 5) → false',
  ProductBriefSchema.safeParse({ ...valid, angles: Array(4).fill(oneAngle) }).success === false,
);
check(
  '11 ángulos (> 10) → false',
  ProductBriefSchema.safeParse({ ...valid, angles: Array(11).fill(oneAngle) }).success === false,
);
// límites que SÍ deben pasar (5 y 10) — confirma que el rango no está desplazado
check(
  '5 ángulos (límite inferior) → true',
  ProductBriefSchema.safeParse({ ...valid, angles: Array(5).fill(oneAngle) }).success === true,
);
check(
  '10 ángulos (límite superior) → true',
  ProductBriefSchema.safeParse({ ...valid, angles: Array(10).fill(oneAngle) }).success === true,
);

// (d) platform=manual CON source_url no-null → false (bicondicional)
check(
  'platform=manual + source_url="https://otro.example.org" → false',
  ProductBriefSchema.safeParse({
    ...valid,
    meta: { ...valid.meta, platform: 'manual', source_url: 'https://otro.example.org' },
  }).success === false,
);
// y el caso manual VÁLIDO (source_url null) → true
check(
  'platform=manual + source_url=null → true',
  ProductBriefSchema.safeParse({
    ...valid,
    meta: { ...valid.meta, platform: 'manual', source_url: null },
  }).success === true,
);

// (e) platform=shopify con source_url null → false (otra dirección del bicondicional)
check(
  'platform=shopify + source_url=null → false',
  ProductBriefSchema.safeParse({
    ...valid,
    meta: { ...valid.meta, platform: 'shopify', source_url: null },
  }).success === false,
);

// Comprobación de que NO es un falso verde por STRIP de Zod (clave extra):
// una clave extra NO debe cambiar el veredicto de un brief válido (Zod hace strip).
// Lo verifico para asegurarme de que ningún inválido de arriba "funciona" por accidente.
check(
  'clave extra en brief válido → sigue true (Zod hace strip, no rechaza)',
  ProductBriefSchema.safeParse({ ...valid, __extra__: 123 }).success === true,
);

// Cláusula extra nombrada: "URL en modo manual" también sobre RawContent
check(
  'RawContent source=manual + url no-null → false',
  RawContentSchema.safeParse({
    source: 'manual',
    url: 'https://otro.example.org',
    platform: 'manual',
    markdown: 'texto pegado',
    images: [],
  }).success === false,
);
check(
  'RawContent source=manual + url=null + platform=manual → true',
  RawContentSchema.safeParse({
    source: 'manual',
    url: null,
    platform: 'manual',
    markdown: 'texto pegado',
    images: [],
  }).success === true,
);

console.log('\n== CLÁUSULA 2: espejo JSON Schema draft 2020-12 ==');

// El validador draft 2020-12. strict:true = si el espejo tuviera keywords inválidos
// o inconsistentes, compile lanzaría.
const AjvCtor = (Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020;
const ajv = new AjvCtor({ strict: true });
let compiled = false;
try {
  const validate = ajv.compile(productBriefJsonSchema);
  compiled = typeof validate === 'function';
} catch (e) {
  console.log('  compile lanzó:', (e as Error).message);
}
check('Ajv2020.compile(espejo) compila sin lanzar (es draft 2020-12 válido)', compiled);
check(
  '$schema === draft 2020-12',
  (productBriefJsonSchema as Record<string, unknown>).$schema ===
    'https://json-schema.org/draft/2020-12/schema',
);

// Recorre TODOS los nodos del espejo y comprueba:
//  - additionalProperties:false en todo type:object
//  - ausencia TOTAL de minItems/maxItems/minimum/maximum/etc.
const IGNORED = [
  'minItems',
  'maxItems',
  'minContains',
  'maxContains',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
];
const offenders: string[] = [];
let objectNodes = 0;
let objectsMissingAP = 0;
function walk(node: unknown): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(walk);
    return;
  }
  const n = node as Record<string, unknown>;
  if (n.type === 'object') {
    objectNodes++;
    if (n.additionalProperties !== false) objectsMissingAP++;
  }
  for (const k of Object.keys(n)) {
    if (IGNORED.includes(k)) offenders.push(k);
  }
  Object.values(n).forEach(walk);
}
walk(productBriefJsonSchema);

console.log(`  (nodos type:object: ${String(objectNodes)}; keywords prohibidos hallados: ${offenders.length ? offenders.join(',') : 'ninguno'})`);
check('hay al menos un nodo type:object', objectNodes > 0);
check('TODO type:object lleva additionalProperties:false', objectsMissingAP === 0);
check(
  'NINGÚN nodo lleva minItems/maxItems/minimum/maximum/... (el espejo no miente)',
  offenders.length === 0,
);

// Prueba semántica del reparto: 11 ángulos PASAN el espejo (Anthropic no frena) pero Zod los rechaza.
const validate = ajv.compile(productBriefJsonSchema);
const inflated = { ...valid, angles: Array(11).fill(oneAngle) };
check(
  'divergencia: 11 ángulos PASAN el espejo (Anthropic no frena cardinalidad)',
  validate(inflated) === true,
);
check(
  'divergencia: los mismos 11 ángulos los RECHAZA Zod',
  ProductBriefSchema.safeParse(inflated).success === false,
);

console.log(`\n== RESUMEN: ${String(pass)} OK / ${String(fail)} FAIL ==`);
if (fail > 0) process.exit(1);
