#!/usr/bin/env node
// Verifica que TODO spec .spec.ts bajo apps/web/e2e/ está cableado al runner de
// Playwright — que ningún fichero de test quede huérfano, pre-commiteado pero sin
// correr nunca. Determinista y en el gate. Cierra la variante "spec huérfano" del
// patrón e2e-de-fase-degradan-en-silencio (auditoría del journal, 2026-07-23):
// partial-regeneration.spec.ts y normal-generation-composes.spec.ts llegaron a
// estar en el árbol sin proyecto durante días; un spec que no corre es un test
// verde por no existir, justo el patrón que el arnés persigue.
//
//   pnpm e2e:wired:check   falla (exit 1) si algún spec en disco no lo lista Playwright
//
// Fuente de verdad = `playwright test --list` (respeta testMatch/testIgnore y los
// proyectos propios de spend/partial-regeneration/etc.), NO un glob ingenuo: el
// config multi-proyecto asigna specs a proyectos distintos y un diff disco-vs-glob
// daría falsos positivos con exactamente esos specs.

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'apps/web');
const E2E_DIR = join(WEB, 'e2e');

// ── Specs en disco (recursivo; excluye support/ y setup, que no son specs). ──────
function specsOnDisk(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'support' || ent.name === '.auth') continue;
      out.push(...specsOnDisk(full));
    } else if (ent.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

// ── Specs que Playwright REALMENTE corre. "Cableado" = tiene ≥1 test asignado a un
//    proyecto REAL (no solo `setup`), NO simplemente "el fichero aparece en el JSON":
//    --list enumera todo lo que hay bajo testDir, corra o no. La señal correcta es
//    specs[].tests[].projectName (el hallazgo de por qué un spec excluido de chromium
//    y sin proyecto propio quedaba invisible). El comando NO ejecuta tests ni webServer. ─
const IGNORED_PROJECTS = new Set(['setup']); // el setup no "corre" un spec de producto
function specsListedByPlaywright() {
  let raw;
  try {
    raw = execFileSync('pnpm', ['exec', 'playwright', 'test', '--list', '--reporter=json'], {
      cwd: WEB,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PLAYWRIGHT_SKIP_WEBSERVER: '1' },
    });
  } catch (e) {
    // --list puede devolver exit≠0 si hay .only en modo forbidOnly, pero igual emite JSON
    raw = e.stdout?.toString() ?? '';
    if (!raw) {
      console.error('check-e2e-wired: `playwright test --list` no produjo salida:', e.message);
      process.exit(1);
    }
  }
  const json = JSON.parse(raw);
  const wired = new Set(); // ficheros con al menos un test bajo un proyecto real
  const walk = (node, file) => {
    const f = node.file ?? file;
    for (const spec of node.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.projectName && !IGNORED_PROJECTS.has(t.projectName) && (spec.file ?? f)) {
          wired.add((spec.file ?? f).replace(/^e2e\//, ''));
        }
      }
    }
    for (const child of node.suites ?? []) walk(child, f);
  };
  for (const s of json.suites ?? []) walk(s);
  return wired;
}

// Solo specs TRACKEADOS en git: un .spec.ts untracked es trabajo en vuelo que el
// dev-loop cableará antes de commitear (lefthook + gate corren sobre lo staged). El
// invariante que este check protege es "nada COMMITEADO queda sin correr"; enrojecer
// por un fichero que aún no se ha añadido penalizaría a otra tarea por trabajo ajeno.
function trackedSpecs() {
  try {
    // pathspec de DIRECTORIO (no glob `**`, que git no expande igual que la shell) + filtro
    const out = execFileSync('git', ['ls-files', 'e2e'], { cwd: WEB, encoding: 'utf8' });
    return new Set(
      out
        .split('\n')
        .filter((f) => f.endsWith('.spec.ts'))
        .map((f) => f.replace(/^e2e\//, '')),
    );
  } catch {
    return null; // sin git: no filtramos (fail-closed sobre todo el disco)
  }
}

const tracked = trackedSpecs();
const onDisk = specsOnDisk(E2E_DIR)
  .map((f) => relative(E2E_DIR, f))
  .filter((f) => tracked === null || tracked.has(f));
const listed = specsListedByPlaywright();

const orphans = onDisk.filter((f) => !listed.has(f));

if (orphans.length) {
  console.error(
    `check-e2e-wired FALLA: ${orphans.length} spec(s) en disco que Playwright NO corre:`,
  );
  for (const o of orphans) console.error(`  - apps/web/e2e/${o}`);
  console.error(
    '\nUn spec que no corre es un test verde por no existir. Cablea el spec ' +
      '(añádelo a un proyecto de playwright.config.ts, o comprueba su testMatch/testIgnore).',
  );
  process.exit(1);
}

console.log(`check-e2e-wired OK — ${onDisk.length} specs, todos cableados al runner.`);
