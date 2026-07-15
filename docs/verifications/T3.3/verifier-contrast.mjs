// VERIFIER (T3.3) — contraste anti-Cliprise INDEPENDIENTE (no reusa el script del implementer).
//
// Diferencias con el del implementer, para no heredar un corpus débil:
//   - Ingiere TODOS los ficheros de texto de ambos repos (README, CHANGELOG, y .github/*),
//     no solo README+CHANGELOG.
//   - Extrae las líneas contrastadas parseando el JSON FINAL sembrado (todas las lines[]).
//   - Reporta a varios N (4,5,6,7,8) para poder auditar solapes cortos genéricos vs copia.
//
// Método: normaliza ambos lados (lowercase, sin puntuación, whitespace colapsado) → tokeniza →
// desliza n-gramas de longitud N sobre cada línea sembrada → busca cada n-grama en el corpus.
//
// Uso: node verifier-contrast.mjs <REPO_DIR> <GUARD_PACKS_JSON>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_DIR = process.argv[2];
const GUARD_PACKS = process.argv[3];
if (!REPO_DIR || !GUARD_PACKS) {
  console.error('uso: node verifier-contrast.mjs <REPO_DIR> <GUARD_PACKS_JSON>');
  process.exit(2);
}

const normalize = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

// Recorre recursivamente ambos repos y toma TODO fichero de texto (excluye .git y binarios).
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(md|markdown|txt|json|ya?ml)$/i.test(name)) acc.push(full);
  }
  return acc;
}

const repos = [
  join(REPO_DIR, 'awesome-ai-ugc-video-prompts'),
  join(REPO_DIR, 'awesome-ai-video-ads-prompts'),
];
const files = repos.flatMap((r) => walk(r));
console.log(`# ficheros del corpus Cliprise (${files.length}):`);
for (const f of files) console.log(`#   ${f.replace(REPO_DIR + '/', '')}`);
const corpus = files.map((f) => readFileSync(f, 'utf8')).join('\n');
const corpusTokens = normalize(corpus);

// Líneas REALMENTE sembradas: todas las lines[] de todos los packs del JSON final.
const packs = JSON.parse(readFileSync(GUARD_PACKS, 'utf8'));
const lines = [];
for (const pack of packs) for (const line of pack.lines ?? []) lines.push({ key: pack.key, text: line });

console.log(`# corpus: ${corpusTokens.length} palabras`);
console.log(`# líneas sembradas: ${lines.length} (de ${packs.length} packs)`);
console.log('');

function ngramSet(tokens, N) {
  const s = new Set();
  for (let i = 0; i + N <= tokens.length; i++) s.add(tokens.slice(i, i + N).join(' '));
  return s;
}

for (const N of [8, 7, 6, 5, 4]) {
  const corpusNgrams = ngramSet(corpusTokens, N);
  const matches = [];
  for (const { key, text } of lines) {
    const tokens = normalize(text);
    for (let i = 0; i + N <= tokens.length; i++) {
      const gram = tokens.slice(i, i + N).join(' ');
      if (corpusNgrams.has(gram)) matches.push({ key, gram, text });
    }
  }
  console.log(`## N=${N}: ${matches.length} coincidencia(s)`);
  for (const m of matches) {
    console.log(`  MATCH [${m.key}] "${m.gram}"`);
    console.log(`    en línea: "${m.text}"`);
  }
  console.log('');
}
