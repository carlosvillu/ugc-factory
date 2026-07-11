// VERIFIER T1.9 — cláusulas 1 y 2 de la Verificación, contra el validador REAL de core y con
// los briefs REALES de Sonnet 5 que dejó el verifier de T1.8 (docs/verifications/T1.8/*.json).
// Script del VERIFIER (no del implementer): no reutiliza sus factories ni sus fixtures.
//
// Coste: $0 — cero llamadas a LLM/red. `validateBrief` es puro.
//
// El dato REAL que ancla todo (docs/verifications/T1.8/dry-ingest.txt, scrape real de Firecrawl):
//   N1 (fast path) ugmonk -> product = {"price":"69","currency":"USD"}
//   N3 (Sonnet 5)  ugmonk -> pricing.price = "69", currency = "USD"
//   N1 (fast path) allbirds -> product = null   (sin precio)
//   N3 (Sonnet 5)  allbirds -> pricing.price = null
import { readFileSync } from 'node:fs';
// Import RELATIVO al código fuente REAL de core (igual que el driver del verifier de T1.8):
// verifico el módulo del diff, no un build ni un doble.
import { validateBrief } from '../../../packages/core/src/analyze/brief-validator';
import type { ProductBrief } from '../../../packages/core/src/contracts/product-brief';
import type { RawContent } from '../../../packages/core/src/contracts/raw-content';

const T18 = 'docs/verifications/T1.8';
let failures = 0;

function check(label: string, cond: boolean, detail: string): void {
  if (!cond) failures += 1;
  console.log(`${cond ? 'OK  ' : 'FAIL'} | ${label} | ${detail}`);
}

function loadReal(file: string, label: string): ProductBrief {
  const doc = JSON.parse(readFileSync(`${T18}/${file}`, 'utf8')) as {
    results: { label: string; brief: ProductBrief }[];
  };
  const hit = doc.results.find((r) => r.label.includes(label));
  if (!hit) throw new Error(`no encuentro '${label}' en ${file}`);
  return hit.brief;
}

/** RawContent MÍNIMO con el precio del fast path. El formato del precio lo elijo YO según lo
 *  que emite el código REAL de N1 (firecrawl.ts mapProduct = String(amount); coerce.ts
 *  priceToString = el string tal cual de la tienda), NUNCA el fixture del implementer. */
function rawWithPrice(url: string, price: string | null, currency: string | null): RawContent {
  return {
    url,
    source: 'url',
    fetched_at: '2026-07-11T19:24:58.596Z',
    provider: 'firecrawl',
    markdown: '# real',
    images: [],
    branding: null,
    product: price === null && currency === null ? null : { title: null, price, currency },
  } as unknown as RawContent;
}

// El brief REAL de ugmonk (Sonnet 5): pricing.price = "69", hero + 10 imágenes reales.
const ugmonk = loadReal('briefs-c3-stage1.json', 'ugmonk');
// El brief REAL de allbirds (Sonnet 5): pricing.price = null.
const allbirds = loadReal('briefs-c3-stage1.json', 'allbirds');

console.log('=== ENTRADA REAL (de T1.8, salida auténtica de Sonnet 5) ===');
console.log('ugmonk   N3 pricing.price =', JSON.stringify(ugmonk.pricing.price));
console.log('ugmonk   N3 currency      =', JSON.stringify(ugmonk.pricing.currency));
console.log('ugmonk   N3 hero          =', ugmonk.assets.hero_image_url?.slice(0, 60), '...');
console.log('allbirds N3 pricing.price =', JSON.stringify(allbirds.pricing.price));
console.log();

// ── CLÁUSULA 1a — NO FALSO POSITIVO: mismo VALOR, formatos DISTINTOS ────────────────────────
// Este es el fallo que mordió dos veces. Los dos idiomas del precio con el MISMO valor.
console.log('=== C1a · MISMO valor en distinto formato ⇒ NO debe haber warning ===');
const noFpCases: { name: string; n1: string; n1cur: string | null; n3: string }[] = [
  // El caso REAL de ugmonk: N1 String(69) = "69", N3 de Sonnet = "69".
  { name: 'REAL ugmonk: N1 "69" vs N3 "69"', n1: '69', n1cur: 'USD', n3: '69' },
  // Firecrawl String(34.9) vs el LLM formateando a es-ES. El caso del AVISO CRÍTICO.
  { name: 'N1 "34.9" (String(amount)) vs N3 "34,90 €"', n1: '34.9', n1cur: 'EUR', n3: '34,90 €' },
  { name: 'N1 "34.90" vs N3 "€34.90"', n1: '34.90', n1cur: 'EUR', n3: '€34.90' },
  // coerce.ts priceToString pasa el string de la tienda TAL CUAL: una tienda ES emite "29,99".
  { name: 'N1 "29,99" (coerce, tienda ES) vs N3 "29,99 €"', n1: '29,99', n1cur: 'EUR', n3: '29,99 €' },
  { name: 'N1 "1234.56" vs N3 "1.234,56 €"', n1: '1234.56', n1cur: 'EUR', n3: '1.234,56 €' },
  { name: 'N1 "69" vs N3 "$69.00"', n1: '69', n1cur: 'USD', n3: '$69.00' },
];
for (const c of noFpCases) {
  const brief: ProductBrief = {
    ...ugmonk,
    pricing: { ...ugmonk.pricing, price: c.n3 },
  };
  const res = validateBrief(brief, {
    profile: 'url',
    rawContent: rawWithPrice('https://ugmonk.com/products/analog-starter-kit', c.n1, c.n1cur),
  });
  const mismatches = res.warnings.filter((w) => w.code === 'price_mismatch');
  check(
    `C1a ${c.name}`,
    mismatches.length === 0 && res.brief.pricing.price === c.n3,
    `warnings=${JSON.stringify(mismatches)} price_final=${JSON.stringify(res.brief.pricing.price)}`,
  );
}
console.log();

// ── CLÁUSULA 1b — DISCREPANCIA REAL: warning tipado + GANA EL FAST PATH ─────────────────────
console.log('=== C1b · valores DISTINTOS ⇒ warning tipado Y gana el precio del fast path ===');
const mismatchCases: { name: string; n1: string; n1cur: string | null; n3: string; expect: number }[] = [
  // Precio real de ugmonk (69) contra una alucinación del LLM (49).
  { name: 'REAL ugmonk N1 "69" vs N3 alucinado "49 $"', n1: '69', n1cur: 'USD', n3: '49 $', expect: 69 },
  { name: 'N1 "79.90" vs N3 "34,90 €" (otra variante)', n1: '79.90', n1cur: 'EUR', n3: '34,90 €', expect: 79.9 },
  { name: 'N1 "29,99" (tienda ES) vs N3 "39,99 €"', n1: '29,99', n1cur: 'EUR', n3: '39,99 €', expect: 29.99 },
];
for (const c of mismatchCases) {
  const brief: ProductBrief = { ...ugmonk, pricing: { ...ugmonk.pricing, price: c.n3 } };
  const res = validateBrief(brief, {
    profile: 'url',
    rawContent: rawWithPrice('https://ugmonk.com/products/analog-starter-kit', c.n1, c.n1cur),
  });
  const w = res.warnings.filter((x) => x.code === 'price_mismatch');
  const finalPrice = res.brief.pricing.price;
  // "Gana el precio del fast path" = el VALOR del brief corregido es el de N1.
  const finalValue = Number(String(finalPrice).replace(/[^\d.,-]/g, '').replace(',', '.'));
  const typed =
    w.length === 1 &&
    w[0]?.code === 'price_mismatch' &&
    (w[0] as { synthesized: string }).synthesized === c.n3;
  check(
    `C1b ${c.name}`,
    typed && finalValue === c.expect && res.ok === true,
    `warning=${JSON.stringify(w[0])} price_final=${JSON.stringify(finalPrice)} valor=${finalValue} ok=${res.ok}`,
  );
}
console.log();

// ── C1c — el caso REAL allbirds: N1 sin precio (product=null) ⇒ ningún warning, nada que cruzar
console.log('=== C1c · REAL allbirds: N1 sin precio (product=null) y N3 null ⇒ sin warning ===');
{
  const res = validateBrief(allbirds, {
    profile: 'url',
    rawContent: rawWithPrice('https://www.allbirds.com/products/mens-tree-runners', null, null),
  });
  const pm = res.warnings.filter((w) => w.code === 'price_mismatch');
  check(
    'C1c allbirds sin fast path ⇒ sin price_mismatch',
    pm.length === 0 && res.brief.pricing.price === null,
    `warnings=${JSON.stringify(res.warnings.map((w) => w.code))} price=${JSON.stringify(res.brief.pricing.price)}`,
  );
}
console.log();

// ── CLÁUSULA 2 — modo MANUAL sin hero image ────────────────────────────────────────────────
console.log('=== C2 · manual SIN hero ⇒ needs_user_decision:missing_hero_image, brief VÁLIDO, NO falla ===');
{
  // Brief REAL de Sonnet, en escenario manual: sin imágenes y sin hero (texto libre sin fotos).
  const manualBrief: ProductBrief = {
    ...ugmonk,
    assets: { ...ugmonk.assets, hero_image_url: null, images: [] },
    // sin imágenes, los suggested_assets de los ángulos ya no pertenecen al set
  };
  let threw: unknown = null;
  let res: ReturnType<typeof validateBrief> | null = null;
  try {
    res = validateBrief(manualBrief, { profile: 'manual', rawContent: null });
  } catch (e) {
    threw = e;
  }
  check('C2 el paso NO falla (no lanza)', threw === null, `threw=${String(threw)}`);
  const w = res?.warnings.find(
    (x) => x.code === 'needs_user_decision' && x.reason === 'missing_hero_image',
  );
  check(
    'C2 warning TIPADO needs_user_decision:missing_hero_image en la SALIDA',
    w !== undefined,
    JSON.stringify(w ?? res?.warnings.map((x) => x.code)),
  );
  check('C2 el brief queda VÁLIDO (ok === true)', res?.ok === true, `ok=${String(res?.ok)}`);
  check(
    'C2 no se emite el bloqueante missing_hero_image en perfil manual',
    !res?.warnings.some((x) => x.code === 'missing_hero_image'),
    JSON.stringify(res?.warnings.map((x) => x.code)),
  );

  // CONTRASTE (que el warning tipado no sea vacuamente cierto): el MISMO brief en perfil `url`.
  const resUrl = validateBrief(manualBrief, { profile: 'url', rawContent: null });
  check(
    'C2-contraste: el MISMO brief sin hero en perfil url ⇒ missing_hero_image y ok=false',
    resUrl.ok === false && resUrl.warnings.some((x) => x.code === 'missing_hero_image'),
    `ok=${resUrl.ok} codes=${JSON.stringify(resUrl.warnings.map((x) => x.code))}`,
  );
}
console.log();

// ── PUREZA — la entrada NO se muta (invariante que AFIRMA el implementer) ────────────────────
console.log('=== PUREZA · la entrada no se muta (caso que toca TODAS las ramas de corrección) ===');
{
  const dirty: ProductBrief = {
    ...ugmonk,
    pricing: { ...ugmonk.pricing, price: '49 $' }, // ⇒ price_mismatch (N1 dirá 69)
    assets: {
      ...ugmonk.assets,
      hero_image_url: 'https://ugmonk.com/ALUCINADA-no-esta-en-images.jpg', // ⇒ hero alucinado
    },
    angles: ugmonk.angles.map((a, i) =>
      i === 0
        ? {
            ...a,
            suggested_assets: [
              ...(a.suggested_assets ?? []),
              'https://ugmonk.com/ASSET-FANTASMA.jpg', // ⇒ pruned_suggested_asset
            ],
            hook_examples: [
              ...a.hook_examples,
              'un hook deliberadamente larguisimo con muchas mas de doce palabras para disparar el aviso',
            ],
          }
        : a,
    ),
  };
  const snapshot = structuredClone(dirty);
  const res = validateBrief(dirty, {
    profile: 'url',
    rawContent: rawWithPrice('https://ugmonk.com/products/analog-starter-kit', '69', 'USD'),
  });
  check(
    'PUREZA la entrada es deep-equal a su clon previo (sin mutación)',
    JSON.stringify(dirty) === JSON.stringify(snapshot),
    'comparado structuredClone antes vs objeto después',
  );
  check(
    'PUREZA se dispararon las 3 ramas de corrección (el caso NO es un no-op)',
    res.warnings.some((w) => w.code === 'price_mismatch') &&
      res.warnings.some((w) => w.code === 'pruned_suggested_asset') &&
      res.warnings.some((w) => w.code === 'hook_too_long'),
    JSON.stringify(res.warnings.map((w) => w.code)),
  );
  check(
    'PUREZA hero ALUCINADO se poda a null en la COPIA (y sigue en la entrada)',
    res.brief.assets.hero_image_url === null &&
      dirty.assets.hero_image_url === 'https://ugmonk.com/ALUCINADA-no-esta-en-images.jpg',
    `copia=${String(res.brief.assets.hero_image_url)} entrada=${String(dirty.assets.hero_image_url)}`,
  );
  console.log('  warnings emitidos:', JSON.stringify(res.warnings.map((w) => w.code)));
}

console.log();
console.log(failures === 0 ? '=== TODO OK (0 fallos) ===' : `=== ${failures} FALLO(S) ===`);
process.exit(failures === 0 ? 0 : 1);
