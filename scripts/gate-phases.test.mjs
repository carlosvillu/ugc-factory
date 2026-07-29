// Unit tests del runner gate:phases (T5.25). Testean la lógica PURA: parseo de fases desde el `gate`,
// mapa de entorno por fase (el corazón Colima), y agregación del veredicto. El control negativo del
// AGREGADO vive aquí (no necesita correr las 9 fases reales): una fase que falla → FAIL + no-verde; una
// fase que NUNCA corrió → PENDING + no-verde; una fase corrida sobre otro árbol → STALE + no-verde. Ese
// último es el bug de T5.19 (split manual suelta fases en silencio), y es el que un runner ingenuo se
// come.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseGatePhases,
  readGatePhasesFromPackageJson,
  envForPhase,
  aggregate,
  treeState,
  PHASE_ENV_KIND,
} from './gate-phases.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('parseGatePhases — fuente de verdad = el script `gate`', () => {
  it('extrae la secuencia ordenada de scripts pnpm del gate real de package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const phases = readGatePhasesFromPackageJson(pkg);
    // Las 9 fases conocidas HOY, en orden. Si alguien añade una 10.ª al `gate`, este test se pone
    // ROJO y le obliga a darle un mapa de entorno en PHASE_ENV_KIND — en vez de heredar un default
    // en silencio. Eso es exactamente lo que la tarea persigue: nada se cuela sin declararse.
    expect(phases).toEqual([
      'lint',
      'typecheck',
      'format:check',
      'knip',
      'readme:status:check',
      'check:contrast',
      'e2e:wired:check',
      'test',
      'test:e2e:phases',
    ]);
  });

  it('todas las fases del gate tienen un mapa de entorno declarado (ninguna cae a un default silencioso)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    for (const phase of readGatePhasesFromPackageJson(pkg)) {
      // Object.hasOwn: la fase DEBE estar declarada en PHASE_ENV_KIND. Si una fase nueva del gate
      // no está, este assert se pone rojo y obliga a darle un env (en vez de heredar 'none' en silencio).
      expect(Object.hasOwn(PHASE_ENV_KIND, phase)).toBe(true);
    }
  });

  it('parsea `pnpm run <x>` además de `pnpm <x>`', () => {
    expect(parseGatePhases('pnpm lint && pnpm run typecheck')).toEqual(['lint', 'typecheck']);
  });

  it('lanza si un segmento del gate no es parseable (no lo traga en silencio)', () => {
    expect(() => parseGatePhases('pnpm lint && echo hola')).toThrow();
  });
});

describe('envForPhase — la doble combinación de Colima (romperla rompe una fase)', () => {
  const SOCK = 'unix:///home/u/.colima/default/docker.sock';

  it("'colima-export' EXPORTA DOCKER_HOST + RYUK off (Testcontainers de `pnpm test` lo necesita)", () => {
    const env = envForPhase('colima-export', { PATH: '/x' }, SOCK);
    expect(env.DOCKER_HOST).toBe(SOCK);
    expect(env.TESTCONTAINERS_RYUK_DISABLED).toBe('true');
  });

  it("'ryuk-only' NUNCA lleva DOCKER_HOST (exportarlo mata el webServer de Playwright bajo Colima)", () => {
    // Incluso si DOCKER_HOST venía heredado, la fase e2e lo BORRA.
    const env = envForPhase('ryuk-only', { PATH: '/x', DOCKER_HOST: SOCK }, SOCK);
    expect(env.DOCKER_HOST).toBeUndefined();
    expect(env.TESTCONTAINERS_RYUK_DISABLED).toBe('true');
  });

  it("'none' no añade ni borra nada de Docker (fases estáticas)", () => {
    const env = envForPhase('none', { PATH: '/x', DOCKER_HOST: 'heredado' }, SOCK);
    expect(env.DOCKER_HOST).toBe('heredado');
    expect(env.TESTCONTAINERS_RYUK_DISABLED).toBeUndefined();
  });

  it('la fase `test` es colima-export y la fase e2e es ryuk-only (el mapeo real, no uno inventado)', () => {
    expect(PHASE_ENV_KIND.test).toBe('colima-export');
    expect(PHASE_ENV_KIND['test:e2e:phases']).toBe('ryuk-only');
  });
});

describe('aggregate — el veredicto no puede saltarse ni tragarse una fase', () => {
  const PHASES = ['lint', 'test', 'test:e2e:phases'];
  // La frescura se decide SOLO por treeHash (hash de contenido: HEAD+diff+untracked). `sha` es
  // informativo para el reporte. Un booleano `dirty` sería inerte durante una tarea (árbol siempre
  // dirty); el hash cambia con CADA edición, por eso una fase corrida antes de editar vuelve STALE.
  const TREE = { sha: 'abc123', treeHash: 'HASH_ACTUAL' };
  const pass = (treeHash = 'HASH_ACTUAL') => ({ status: 'PASS', sha: 'abc123', treeHash });

  it('verde SOLO cuando TODAS las fases son PASS sobre el árbol actual', () => {
    const state = { lint: pass(), test: pass(), 'test:e2e:phases': pass() };
    const agg = aggregate(PHASES, state, TREE);
    expect(agg.green).toBe(true);
    expect(agg.rows.every((r) => r.status === 'PASS')).toBe(true);
  });

  // CONTROL NEGATIVO 1: una fase que FALLA aparece como FAIL y el agregado NO es verde.
  it('una fase FAIL enrojece el agregado (no se traga)', () => {
    const state = {
      lint: pass(),
      test: { status: 'FAIL', sha: 'abc123', treeHash: 'HASH_ACTUAL' },
      'test:e2e:phases': pass(),
    };
    const agg = aggregate(PHASES, state, TREE);
    expect(agg.green).toBe(false);
    expect(agg.rows.find((r) => r.name === 'test').status).toBe('FAIL');
  });

  // CONTROL NEGATIVO 2 (el bug de T5.19): una fase que NUNCA corrió aparece PENDING y enrojece —
  // exactamente lo que el split manual del gate se saltó en silencio.
  it('una fase que nunca corrió aparece PENDING y enrojece (imposible saltarla en silencio)', () => {
    const state = { lint: pass(), test: pass() /* 'test:e2e:phases' ausente: se saltó */ };
    const agg = aggregate(PHASES, state, TREE);
    expect(agg.green).toBe(false);
    expect(agg.rows.find((r) => r.name === 'test:e2e:phases').status).toBe('PENDING');
  });

  // CONTROL NEGATIVO 3: una fase verde pero corrida sobre OTRO estado del árbol (treeHash distinto) es
  // STALE, no PASS — impide "fase 1 verde en código viejo + fase 9 verde en código nuevo, agregado PASS".
  it('una fase PASS sobre otro treeHash es STALE y enrojece (no un falso verde por árbol mixto)', () => {
    const state = { lint: pass('HASH_VIEJO'), test: pass(), 'test:e2e:phases': pass() };
    const agg = aggregate(PHASES, state, TREE);
    expect(agg.green).toBe(false);
    expect(agg.rows.find((r) => r.name === 'lint').status).toBe('STALE');
  });

  // El caso que un booleano `dirty` NO cazaría: mismo SHA, el árbol cambió (edición durante la tarea).
  // Todas las fases corridas antes de la edición vuelven STALE.
  it('editar el árbol (mismo SHA, distinto treeHash) vuelve STALE toda fase corrida antes', () => {
    const state = { lint: pass(), test: pass(), 'test:e2e:phases': pass() };
    const agg = aggregate(PHASES, state, { sha: 'abc123', treeHash: 'HASH_TRAS_EDITAR' });
    expect(agg.green).toBe(false);
    expect(agg.rows.every((r) => r.status === 'STALE')).toBe(true);
  });
});

describe('treeState — git inalcanzable NO puede fingir un verde (fail-loud, no centinela)', () => {
  // CONTROL NEGATIVO del falso-verde: si git falla, un centinela `'no-git'` sería comparable consigo
  // mismo entre invocaciones → aggregate vería 'no-git'==='no-git' → NADA STALE → agregado VERDE sin
  // verificar el árbol (el bug de T5.19). El fix hace que treeState LANCE. Aquí lo probamos inyectando
  // un `gitRun` que lanza — treeState DEBE propagar, NO devolver un objeto.
  it('LANZA si git no responde (no devuelve {treeHash:"no-git"})', () => {
    const throwingGit = () => {
      throw new Error('ENOBUFS / no .git');
    };
    expect(() => treeState(throwingGit)).toThrow(/gate:phases requiere git/);
  });

  // La consecuencia que el centinela habría permitido: dos treeState() fallidos NO deben cuadrar entre
  // sí. Como ahora lanzan, es imposible construir un estado "no-git"==="no-git" que salga verde.
  it('un runner que lanza impide del todo obtener un treeHash comparable (imposible falso-verde)', () => {
    const throwingGit = () => {
      throw new Error('git down');
    };
    let a, b;
    expect(() => (a = treeState(throwingGit))).toThrow();
    expect(() => (b = treeState(throwingGit))).toThrow();
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
  });

  it('con un gitRun sano computa un treeHash determinista (mismo input → mismo hash)', () => {
    const fakeGit = (args) => {
      if (args[0] === 'rev-parse') return 'deadbeef\n';
      if (args[0] === 'diff') return 'diff --git a b\n+x\n';
      if (args[0] === 'ls-files') return 'foo.txt\n';
      return '';
    };
    const readFake = (f) => `contenido de ${f}`; // createHash.update acepta strings
    const t1 = treeState(fakeGit, readFake);
    const t2 = treeState(fakeGit, readFake);
    expect(t1.treeHash).toBe(t2.treeHash);
    expect(t1.sha).toBe('deadbeef');
    // y un cambio en el contenido de un untracked cambia el hash (la propiedad que da frescura).
    const t3 = treeState(fakeGit, (f) => `OTRO contenido de ${f}`);
    expect(t3.treeHash).not.toBe(t1.treeHash);
  });
});
