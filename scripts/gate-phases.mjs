// GATE POR FASES — `pnpm gate` monolítico no cabe en el timeout del entorno (T5.25, 2026-07-29).
//
// EL DEFECTO: `pnpm gate` encadena 9 fases en un solo proceso. Las dos últimas (`test` = 2509 tests +
// Testcontainers, y `test:e2e:phases` = `next build && next start` + el sub-DAG N7 de f4) juntas
// exceden el timeout del entorno del arnés → la corrida muere `killed` SIN veredicto. Al cerrar T5.19
// el gate murió 6+ veces así.
//
// EL SEGUNDO DEFECTO (más sutil): el workaround manual —correr las fases a mano— SUELTA FASES EN
// SILENCIO. Al cerrar T5.19 se corrieron 7 de las 9 leyendo exit codes a ojo; `check:contrast` y
// `e2e:wired:check` se saltaron sin que nadie lo notara. Un split manual del gate es un test verde por
// no existir (principio 9 de la skill testing: el arnés nunca más cómodo que la realidad).
//
// LA SOLUCIÓN: un runner RESUMIBLE. Cada fase se corre en su PROPIA invocación (que sí cabe en el
// timeout), persistiendo su resultado en un fichero de estado gitignored. Un `--report` final emite el
// VEREDICTO AGREGADO y —esto es el corazón— sale ≠0 si CUALQUIER fase falló, quedó PENDIENTE, o corrió
// sobre un ÁRBOL DE GIT DISTINTO. Es IMPOSIBLE saltarse una fase sin que el reporte lo diga: una fase
// que nunca corrió aparece como PENDING y enrojece el agregado. Eso es exactamente el bug de T5.19,
// codificado en el runner que lo cierra.
//
// FUENTE DE VERDAD DE LAS FASES: el propio script `gate` de package.json (parseado en runtime). Si
// alguien añade una 10.ª fase al gate, este runner la ve automáticamente (y un unit test lo obliga a
// tener un mapa de entorno, en vez de heredar un default en silencio).
//
// HIGIENE DE DOCKER (CRÍTICO — aquí Docker es COLIMA, no Docker Desktop): hay DOS combinaciones y usar
// la equivocada rompe la fase.
//   - `pnpm test` (unit+integration): necesita DOCKER_HOST al socket de Colima + RYUK off, EXPORTADOS.
//   - `test:e2e:phases` (Playwright webServer): RYUK off pero SIN exportar DOCKER_HOST — si se exporta,
//     Ryuk intenta bind-mount del socket de Colima y el webServer muere con `operation not supported`.
// Por eso el env se aplica POR FASE, nunca global. Un runner que exportara DOCKER_HOST global rompería
// la fase e2e — ese es el error que este diseño evita por construcción.
//
// USO:
//   pnpm gate:phases            corre TODAS las fases pendientes en secuencia y emite el agregado.
//                               (cada fase es un subproceso independiente; si el entorno mata la
//                                invocación en una fase pesada, re-lanzar retoma desde ahí — el estado
//                                de las fases ya verdes persiste.)
//   pnpm gate:phases --next     corre SOLO la siguiente fase pendiente (para trocear a mano bajo un
//                               timeout muy ajustado) y sale.
//   pnpm gate:phases --only X   corre SOLO la fase X (re-corre aunque estuviera verde).
//   pnpm gate:phases --report   NO corre nada; imprime el agregado y sale ≠0 si algo no está verde.
//   pnpm gate:phases --reset    borra el estado (empieza de cero).
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { findOrphanPgContainers } from './check-orphan-workers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = join(ROOT, '.gate-phases-state.json');

// ── Parseo de las fases desde el script `gate` (fuente de verdad) ────────────────────────────────
/**
 * Extrae la lista ORDENADA de scripts pnpm que encadena el `gate`. PURA (recibe el string del script).
 * `gate` es `pnpm lint && pnpm typecheck && … && pnpm test:e2e:phases`; devolvemos ['lint', …].
 */
export function parseGatePhases(gateScript) {
  return gateScript
    .split('&&')
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const m = seg.match(/^pnpm\s+(?:run\s+)?(\S+)/);
      if (!m) throw new Error(`gate-phases: no sé parsear el segmento del gate: "${seg}"`);
      return m[1];
    });
}

export function readGatePhasesFromPackageJson(pkgJson) {
  const gate = pkgJson?.scripts?.gate;
  if (typeof gate !== 'string')
    throw new Error('gate-phases: no hay script `gate` en package.json');
  return parseGatePhases(gate);
}

// ── Mapa de entorno por fase (el corazón: Colima difiere entre `pnpm test` y Playwright) ──────────
// Cada fase declara qué env EXTRA necesita sobre el heredado. Deliberadamente explícito y por-fase:
//  - 'colima-export'  → DOCKER_HOST al socket de Colima + RYUK off, EXPORTADOS (Testcontainers vía docker).
//  - 'ryuk-only'      → RYUK off pero SIN DOCKER_HOST (Playwright webServer; exportarlo lo mata).
//  - 'none'           → nada extra (fases estáticas: no tocan Docker).
export const PHASE_ENV_KIND = {
  lint: 'none',
  typecheck: 'none',
  'format:check': 'none',
  knip: 'none',
  'readme:status:check': 'none',
  'check:contrast': 'none',
  'e2e:wired:check': 'ryuk-only', // arranca playwright --list; RYUK off por si roza Testcontainers, sin DOCKER_HOST
  test: 'colima-export',
  'test:e2e:phases': 'ryuk-only',
};

function colimaSocketHost() {
  if (process.env.DOCKER_HOST) return process.env.DOCKER_HOST;
  return `unix://${process.env.HOME}/.colima/default/docker.sock`;
}

/**
 * Env EFECTIVO para una fase. PURA respecto al `kind` (recibe base + kind + socket) para poder
 * testear que 'ryuk-only' NUNCA lleva DOCKER_HOST y 'colima-export' SÍ. Una fase desconocida cae a
 * 'none' (default), pero SIEMPRE corre y se reporta — nunca se salta (fail-loud > fail-silent).
 */
export function envForPhase(kind, base, socketHost) {
  const env = { ...base };
  if (kind === 'colima-export') {
    env.DOCKER_HOST = socketHost;
    env.TESTCONTAINERS_RYUK_DISABLED = 'true';
  } else if (kind === 'ryuk-only') {
    delete env.DOCKER_HOST; // CRÍTICO: exportarlo mata el webServer de Playwright bajo Colima.
    env.TESTCONTAINERS_RYUK_DISABLED = 'true';
  }
  return env;
}

// ── Estado del árbol (para cazar el "fase X sobre código viejo") ──────────────────────────────────
// CRÍTICO: durante una tarea del dev-loop el árbol está SIEMPRE dirty. Un flag booleano `dirty` sería
// INERTE justo ahí: fase lint sobre {sha, dirty:true} → editas 3 ficheros → sigue {sha, dirty:true} →
// se cuenta PASS sobre código que no vio. Por eso el árbol se identifica con un HASH DE CONTENIDO
// (HEAD + el diff vs HEAD + los untracked): cualquier edición cambia el hash y vuelve STALE lo que se
// corrió antes. Devuelve `{ sha, treeHash }` — `sha` es solo informativo para el reporte; la
// comparación de frescura es SIEMPRE sobre `treeHash`.
// FAIL-LOUD si git no responde (correctness, code-review 2026-07-29): NO devolver un centinela
// comparable consigo mismo (`'no-git'`). Si toda la corrida grabara `treeHash:'no-git'` Y el reporte
// también, `aggregate` vería `'no-git' === 'no-git'` → NADA STALE → agregado VERDE sin haber verificado
// el árbol real = el falso-verde de T5.19 que este runner existe para MATAR. Un runner de frescura que
// no puede leer el árbol no puede fingir que lo verificó: lanza. (Coherente con "fail-loud > fail-silent"
// de la cabecera.)
// El runner de git por defecto (inyectable en tests para simular git inalcanzable). maxBuffer alto en
// TODAS las llamadas — un `git ls-files -o` grande (un node_modules sin ignore, muchos artefactos)
// reventaría el default ~1MB → catch → falso-verde.
function defaultGitRun(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// Exportada para testear el FAIL-LOUD: un `gitRun` que lanza DEBE hacer que treeState lance (no devolver
// un centinela). `readUntrackedFile` se inyecta solo en tests.
export function treeState(
  gitRun = defaultGitRun,
  readUntrackedFile = (f) => readFileSync(join(ROOT, f)),
) {
  let sha, diff, untrackedRaw;
  try {
    sha = gitRun(['rev-parse', 'HEAD']).trim();
    diff = gitRun(['diff', 'HEAD']);
    untrackedRaw = gitRun(['ls-files', '-o', '--exclude-standard']);
  } catch (e) {
    throw new Error(
      'gate:phases requiere git para el anclaje de frescura del árbol (no puede leer HEAD/diff/untracked). ' +
        'Sin git NO se puede garantizar que las fases corrieran sobre el mismo árbol → se aborta antes que ' +
        `fingir un verde no verificado. Causa: ${e.message}`,
    );
  }
  // Contenido de los untracked (nombre + bytes) — un fichero nuevo cambia el árbol aunque el diff no lo vea.
  const untracked = untrackedRaw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const h = createHash('sha256');
  h.update(sha);
  h.update('\0diff\0');
  h.update(diff);
  for (const f of untracked) {
    h.update('\0u\0');
    h.update(f);
    try {
      h.update(readUntrackedFile(f));
    } catch {
      // fichero que desapareció entre el ls-files y el read: lo ignoramos (el hash refleja el resto).
    }
  }
  return { sha, treeHash: h.digest('hex') };
}

// ── Persistencia del estado ───────────────────────────────────────────────────────────────────
function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

// ── Agregación del veredicto (PURA — recibe fases + estado + árbol actual) ─────────────────────────
/**
 * Construye el reporte agregado. Una fase puede estar: PASS, FAIL, PENDING (nunca corrió) o STALE
 * (corrió sobre otro SHA/dirty distinto del actual). El agregado es verde SOLO si TODAS son PASS
 * sobre el árbol actual. STALE y PENDING cuentan como no-verde: eso hace imposible que una fase
 * saltada (o corrida sobre código viejo) se cuele como verde.
 */
export function aggregate(phases, state, currentTree) {
  const rows = phases.map((name) => {
    const rec = state[name];
    if (!rec) return { name, status: 'PENDING' };
    const stale = rec.treeHash !== currentTree.treeHash;
    if (rec.status === 'PASS' && stale) return { name, status: 'STALE', ranAt: rec.sha };
    return { name, status: rec.status, ranAt: rec.sha };
  });
  const green = rows.every((r) => r.status === 'PASS');
  return { rows, green };
}

function formatReport(agg, hygiene, currentTree) {
  const glyph = { PASS: '✓', FAIL: '✗', PENDING: '·', STALE: '⟲' };
  const lines = ['', '─── gate:phases · veredicto agregado ───────────────────────────'];
  lines.push(
    `  árbol actual: ${currentTree.sha.slice(0, 12)} (hash ${currentTree.treeHash.slice(0, 8)})`,
  );
  if (hygiene) lines.push(`  higiene: ${hygiene}`);
  lines.push('');
  for (const r of agg.rows) {
    let suffix = '';
    switch (r.status) {
      case 'STALE':
        suffix = `  ← corrió sobre otro estado del árbol (${String(r.ranAt).slice(0, 12)}+cambios), no el actual`;
        break;
      case 'PENDING':
        suffix = '  ← NO ha corrido';
        break;
    }
    lines.push(`  ${glyph[r.status] ?? '?'} ${r.status.padEnd(8)} ${r.name}${suffix}`);
  }
  lines.push('');
  lines.push(
    agg.green
      ? `  RESULTADO: PASS — las ${agg.rows.length} fases verdes sobre el árbol actual ✓`
      : '  RESULTADO: FAIL — hay fases no verdes (ver arriba). El agregado NO se salta ninguna.',
  );
  lines.push('────────────────────────────────────────────────────────────────');
  return lines.join('\n');
}

// ── Higiene pre-flight (contenedores pg huérfanos — warn-only, NUNCA un FAIL del gate) ────────────
function hygieneLine() {
  // Reutiliza EL MISMO discriminador que el guard (label=org.testcontainers=true + ancestor), para que
  // ugc-postgres-dev NUNCA se cuente aquí. Una sola fuente de verdad del filtro — sin copia que derive.
  const { reachable, ids } = findOrphanPgContainers();
  if (!reachable) return 'Docker no responde — no se cuentan contenedores (fail-open).';
  if (ids.length === 0) return '0 contenedores testcontainers postgres:16 huérfanos ✓';
  return (
    `⚠ ${ids.length} testcontainer(s) postgres:16 vivo(s) — pueden saturar y matar el gate. ` +
    'Si no hay una corrida de tests en curso:  pnpm check:orphan-workers --clean-containers  (opt-in).'
  );
}

// ── Ejecución de una fase (subproceso; NO en este proceso, para aislar env y timeout) ─────────────
function runPhase(name, socketHost) {
  const kind = PHASE_ENV_KIND[name] ?? 'none';
  const env = envForPhase(kind, process.env, socketHost);
  // CRÍTICO: el hash del árbol se captura ANTES de correr la fase, no después. Una fase que MUTA el
  // árbol (p.ej. `next build` reescribe apps/web/tsconfig.json) haría, si se midiera después, que su
  // propio treeHash fuera el POST y el de todas las fases anteriores el PRE → todo lo previo STALE y el
  // verde inalcanzable. Anclando al PRE, todas las fases de una misma corrida comparten hash y el verde
  // es alcanzable. (La mutación de `next build` se excluye del hash — ver treeState.)
  const tree = treeState();
  console.log(`\n▶ fase ${name}  (env: ${kind})`);
  const res = spawnSync('pnpm', [name], { cwd: ROOT, stdio: 'inherit', env });
  const passed = res.status === 0;
  const state = loadState();
  state[name] = {
    status: passed ? 'PASS' : 'FAIL',
    sha: tree.sha,
    treeHash: tree.treeHash,
    at: new Date().toISOString(),
  };
  saveState(state);
  console.log(passed ? `✓ fase ${name} PASS` : `✗ fase ${name} FAIL (exit ${res.status})`);
  return passed;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────
// SEMÁNTICA DE EXIT: `--only X` y `--next` corren su fase y luego imprimen el AGREGADO — su exit
// refleja el agregado COMPLETO (0 solo si las 9 están verdes sobre este árbol), NO solo la fase que
// acaban de correr. Es deliberado: no se puede declarar verde desde una sola fase. Un verifier que lea
// el exit de `--only lint` verá ≠0 aunque lint pase, porque faltan las otras 8 — eso es correcto, no un
// bug. El único exit-0 legítimo es el de `--report`/run-completo con las 9 en PASS.
function runCli(argv) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const phases = readGatePhasesFromPackageJson(pkg);
  const socketHost = colimaSocketHost();

  if (argv.includes('--reset')) {
    if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
    console.log('gate:phases: estado borrado.');
    return 0;
  }

  const printReport = (hygiene) => {
    const tree = treeState();
    const agg = aggregate(phases, loadState(), tree);
    console.log(formatReport(agg, hygiene, tree));
    return agg.green ? 0 : 1;
  };

  if (argv.includes('--report')) {
    return printReport(hygieneLine());
  }

  const onlyIdx = argv.indexOf('--only');
  if (onlyIdx !== -1) {
    const name = argv[onlyIdx + 1];
    if (!phases.includes(name)) {
      console.error(`gate:phases: "${name}" no es una fase del gate. Fases: ${phases.join(', ')}`);
      return 2;
    }
    runPhase(name, socketHost);
    return printReport(null);
  }

  // Higiene pre-flight ANTES de la primera fase (warn-only).
  const hygiene = hygieneLine();
  console.log(`gate:phases · higiene pre-flight: ${hygiene}`);

  // Fase(s) a correr: las que NO están PASS sobre el árbol actual. Se deriva del MISMO `aggregate` que
  // emite el reporte (PENDING/FAIL/STALE ≠ PASS → pendiente), para que runner y reporte nunca diverjan:
  // si mañana cambia la regla de frescura, ambos la heredan de una sola fuente.
  const { rows: pendingRows } = aggregate(phases, loadState(), treeState());
  const pending = pendingRows.filter((r) => r.status !== 'PASS').map((r) => r.name);

  if (pending.length === 0) {
    console.log('gate:phases: todas las fases ya verdes sobre este árbol.');
    return printReport(hygiene);
  }

  const nextOnly = argv.includes('--next');
  const toRun = nextOnly ? [pending[0]] : pending;

  for (const name of toRun) {
    const passed = runPhase(name, socketHost);
    if (!passed) {
      // Una fase roja para el runner: no tiene sentido correr las siguientes sobre árbol roto.
      console.error(`gate:phases: fase ${name} FALLÓ — parando. Arréglala y vuelve a lanzar.`);
      return printReport(hygiene);
    }
  }

  return printReport(hygiene);
}

// Guard de CLI: solo ejecuta al invocarse directamente, NO al importarse desde un test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runCli(process.argv.slice(2)));
}
