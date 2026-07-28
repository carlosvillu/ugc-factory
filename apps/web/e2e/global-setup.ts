// Guard de frescura del build (T5.22). Lo declara `playwright.config.ts` como
// `globalSetup` ⇒ corre en AMBOS caminos: el stack que arranca Playwright y el stack
// REUSADO (`reuseExistingServer`, el path de T5.23 y de `pnpm exec tsx scripts/e2e-stack.ts`
// a mano). Ese doble alcance es EL punto: el `webServer.command` NO se ejecuta cuando el
// server ya responde, así que un chequeo dentro de `e2e-stack.ts` sería un no-op justo en
// el caso peligroso.
//
// EL FOOTGUN QUE ESTE GUARD CIERRA (principio 9 de la skill testing — «el arnés nunca más
// cómodo que la realidad»): con `next dev`/HMR, reusar un server warm era AUTO-SANADOR
// (editas código → HMR recompila → sirve lo nuevo). Con `next build && next start` (T5.22)
// el server reusado sirve un build CONGELADO: editas un componente, re-corres Playwright
// contra el stack warm → VERDE sobre código que ya no existe. Silencioso-y-verde, peor que
// el flake HMR que esta tarea elimina.
//
// El guard compara el `builtAt` que `e2e-stack.ts` sella tras `next build` contra el mtime
// más reciente de las FUENTES trackeadas que alimentan el bundle de web. Si alguna fuente es
// más nueva que el build, LANZA nombrando el fichero culpable y mandando reconstruir el stack.
//
// NO corre bajo `playwright test --list` (Playwright no ejecuta globalSetup al listar), así
// que `check-e2e-wired.mjs` (que lista con PLAYWRIGHT_SKIP_WEBSERVER=1) no lo dispara.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// apps/web/e2e/ → repo root
const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(E2E_DIR, '..');
const REPO_ROOT = join(WEB_DIR, '..', '..');

// Árboles de FUENTE cuyo código queda CONGELADO al reusar un stack warm — no solo el bundle
// de web. Deliberadamente acotado a `src/` (código) — no `.next` (salida), ni node_modules,
// ni fixtures de test.
//
// El stack e2e NO es un único proceso: son TRES piezas de código, todas congelables:
//   · WEB — el bundle de `next build`. `transpilePackages` (next.config.ts) compila
//     `@ugc/core`/`@ugc/db`/`@ugc/services` DENTRO del build, así que su `src/` es entrada;
//     `packages/db/drizzle` (migraciones) también. Más los configs de web que cambian el output.
//   · WORKER — un PROCESO SEPARADO: `e2e-stack.ts` hace `spawn(tsxBin, [../../worker/src/main.ts])`.
//     Carga `apps/worker/src/**` (executors N7, sweeper, boss) en memoria en ese spawn. Bajo
//     `reuseExistingServer` NUNCA se relanza ⇒ su grafo de módulos queda tan congelado como `.next`.
//     La suite e2e lo ejercita MÁS que al propio bundle de web (todo el sub-DAG de generación).
//   · FAKE de APIs — `packages/test-utils/src/fake-apis.ts` (`startFakeExternalApis`, in-process en
//     `e2e-stack.ts`): el fake HTTP de fal/Anthropic/Firecrawl, incluido el `doomedRequestId` global
//     del que dependen los proyectos spend/partial-regeneration/normal-generation/f5-export. Editarlo
//     tampoco lo relanza el reuse. Se vigila `packages/test-utils/src` entero (el fake vive ahí).
// Cerrar el footgun para web pero no para worker+fake dejaría el agujero justo donde más duele.
const TRACKED_SOURCE_PATHSPECS = [
  // WEB (bundle de next build)
  'apps/web/src',
  'apps/web/next.config.ts',
  'apps/web/postcss.config.mjs',
  'apps/web/tsconfig.json',
  'packages/core/src',
  'packages/db/src',
  'packages/db/drizzle',
  'packages/services/src',
  // WORKER (proceso spawneado, congelado bajo reuse)
  'apps/worker/src',
  // FAKE de APIs (in-process en e2e-stack.ts, congelado bajo reuse)
  'packages/test-utils/src',
];

interface RuntimeStamp {
  mode?: 'built' | 'dev';
  builtAt?: number;
}

/**
 * mtime más reciente (ms epoch) entre las fuentes que alimentan el stack, con el nombre del
 * fichero más nuevo.
 *
 * `git ls-files --cached --others --exclude-standard`: `--cached` incluye lo trackeado y
 * `--others` los ficheros NUEVOS aún sin `git add` (trabajo en vuelo del dev-loop, que
 * escribe un fichero fuente antes de commitear); sin ellos, un componente/executor recién
 * creado sería invisible al guard — se crearía, se reusaría el stack warm, y daría verde
 * sobre código que el build nunca vio (el mismo espíritu con que `check-e2e-wired.mjs` caza
 * specs huérfanos). `--exclude-standard` respeta `.gitignore` ⇒ `.next/` y `next-env.d.ts`
 * (ya gitignored) NO reaparecen como falsos positivos, ni node_modules.
 *
 * Deuda conocida (NO cubierta, NO bloqueante): el BORRADO de un fichero trackeado no dispara
 * el guard (deja de listarse, y el mtime del directorio no se consulta). El caso peligroso —
 * código NUEVO o EDITADO servido congelado — sí queda cubierto.
 */
function newestTrackedSource(): { path: string; mtimeMs: number } | null {
  let listing: string;
  try {
    listing = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...TRACKED_SOURCE_PATHSPECS],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      },
    );
  } catch {
    // Sin git (tarball, CI raro): no podemos comparar de forma fiable → no bloqueamos.
    return null;
  }
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const rel of listing.split('\n')) {
    if (!rel) continue;
    let mtimeMs: number;
    try {
      mtimeMs = statSync(join(REPO_ROOT, rel)).mtimeMs;
    } catch {
      continue; // fichero listado pero borrado en disco: irrelevante para frescura
    }
    if (!newest || mtimeMs > newest.mtimeMs) newest = { path: rel, mtimeMs };
  }
  return newest;
}

export default function globalSetup(): void {
  const runtimePath = join(E2E_DIR, '.runtime.json');
  let stamp: RuntimeStamp;
  try {
    stamp = JSON.parse(readFileSync(runtimePath, 'utf8')) as RuntimeStamp;
  } catch {
    // Sin `.runtime.json` el stack no ha publicado runtime: los propios specs fallarán al
    // leerlo. No es trabajo de este guard duplicar ese error.
    return;
  }

  // Solo el modo build tiene un artefacto congelable. Un stack en modo dev (si se
  // reintrodujera un dual-mode) es auto-sanador y no necesita guard.
  if (stamp.mode !== 'built' || typeof stamp.builtAt !== 'number') return;

  const newest = newestTrackedSource();
  if (!newest) return;

  if (newest.mtimeMs > stamp.builtAt) {
    const built = new Date(stamp.builtAt).toISOString();
    const changed = new Date(newest.mtimeMs).toISOString();
    throw new Error(
      `[e2e frescura del build] El stack reusado sirve un build CONGELADO más viejo que el código.\n` +
        `  build sellado en: ${built}\n` +
        `  fuente más nueva: ${newest.path} (${changed})\n` +
        `Reconstruye el stack antes de correr la suite:\n` +
        `  · si lo arrancaste a mano, mátalo y relanza \`pnpm exec tsx scripts/e2e-stack.ts\` (rehace \`next build\`);\n` +
        `  · o deja que Playwright lo gestione (sin un stack manual en :3100).\n` +
        `Correr Playwright contra un build viejo sería verde sobre código que ya no existe (principio 9).`,
    );
  }
}
