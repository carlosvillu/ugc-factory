// GUARD DE HIGIENE — dos riesgos distintos que degradan el arnés bajo Colima (2026-07-26 / 2026-07-29).
//
// ── RIESGO 1: WORKERS HUÉRFANOS QUE PUEDEN GASTAR DINERO REAL (2026-07-26) ──────────────────
// Medido dos veces en sesiones reales: un `pnpm dev` mal cerrado deja vivo el worker de
// `apps/worker` (tsx watch src/main.ts). Ese proceso SIGUE comiendo de la cola de pg-boss, y si el
// entorno con el que arrancó NO llevaba `FAL_BASE_URL` apuntando a un fake, un job N7 que tome pega a
// **fal REAL y cobra**. El 2026-07-25 había 3 huérfanos así; el 2026-07-26, otros 2. Ninguno llegó a
// gastar por suerte, no por diseño. Este es el tier `--strict`: un verifier lo corre ANTES de un run
// de GASTO, donde un worker ajeno no es molestia sino riesgo de dinero → exit 1.
//
// ── RIESGO 2: CONTENEDORES POSTGRES:16 HUÉRFANOS QUE SATURAN LA MÁQUINA (2026-07-29) ────────
// Bajo Colima, Testcontainers OBLIGA `TESTCONTAINERS_RYUK_DISABLED=true` (Ryuk quiere bind-mount del
// socket, que Colima no soporta). Sin Ryuk, NADIE limpia los contenedores de test: el 2026-07-29
// había **51 contenedores `postgres:16` vivos** (algunos de 22h) saturando CPU/mem. Eso mató 6 gates
// por duración (timeout del entorno) Y puso rojo el test de dedup sensible a timing
// (`generate-concurrent-dedup`) — un falso positivo de regresión. `docker rm -f` de los 51 → gate
// verde y dedup determinista (2509/2509).
//
// POR QUÉ ESTE RIESGO VA EN TIER DE AVISO Y **NUNCA** EN `--strict`: `--strict` es lo que el verifier
// corre antes de un run de GASTO. Si los contenedores fueran condición de exit 1 en `--strict`, un run
// de gasto legítimo se bloquearía porque alguien tiene un stack de dev levantado A PROPÓSITO (los
// contenedores de un `pnpm dev`/`test:e2e` en curso son normales, no un riesgo de dinero). Por eso los
// contenedores SOLO avisan (exit 0), o se limpian con opt-in explícito `--clean-containers`. `--strict`
// sigue siendo SOLO sobre workers que comen de la cola.
//
// POR QUÉ UN GUARD Y NO UNA NOTA EN EL JOURNAL: la regla «mata los huérfanos antes de gastar/gate»
// llevaba varios incidentes escrita en prosa. El patrón de la auditoría del journal (2026-07-23) es que
// una regla que se repite se convierte en comprobación mecánica o no se cumple.
//
// NO intenta leer el entorno del worker: en macOS `ps -E` no lo expone de forma fiable, así que un
// worker ajeno se trata SIEMPRE como no contenido (la lectura segura cuando hay dinero de por medio).
//
// FLAGS:
//   (sin flags)          avisa de workers y contenedores; exit 0 salvo error.
//   --strict             exit 1 si hay CUALQUIER worker vivo (SOLO workers, nunca contenedores).
//   --clean-containers   `docker rm -f` de los contenedores pg huérfanos detectados (opt-in explícito).
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// ── Workers ──────────────────────────────────────────────────────────────────────────────────
/** PIDs de los workers vivos del proyecto. `pgrep -f` casa contra la línea de comando completa. */
function findWorkers() {
  try {
    const out = execFileSync('pgrep', ['-f', 'src/main.ts'], { encoding: 'utf8' });
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return []; // pgrep sale 1 cuando no hay coincidencias: es el caso bueno.
  }
}

// ── Contenedores pg huérfanos ──────────────────────────────────────────────────────────────────
// El socket de Docker bajo Colima. NO exige que el llamador exporte DOCKER_HOST: si está en el
// entorno se respeta, si no cae al socket por defecto de Colima, y si tampoco existe deja que docker
// use su default. Un guard NUNCA debe ser una forma nueva de que el gate muera: si el daemon no
// responde, avisa y sigue (fail-open), no rompe.
function colimaSocketHost() {
  if (process.env.DOCKER_HOST) return process.env.DOCKER_HOST;
  return `unix://${process.env.HOME}/.colima/default/docker.sock`;
}

// Contenedores de INFRAESTRUCTURA DELIBERADA de larga vida que NUNCA son huérfanos, aunque su imagen
// sea postgres:16. `ugc-postgres-dev` es el Postgres de DESARROLLO (docker-compose.dev.yml, con
// `container_name` explícito) donde vive la BD dev con el gasto real acumulado. Un `docker rm -f`
// suyo reinicia la BD de desarrollo y mata conexiones — "el arnés destruye trabajo del usuario". La
// defensa PRIMARIA es el filtro por etiqueta `org.testcontainers=true` (solo la ponen los
// testcontainers, MEDIDO 2026-07-29: el testcontainer la lleva, ugc-postgres-dev NO — solo tiene
// `com.docker.compose.*`). Esta lista es defensa EN PROFUNDIDAD por si una versión de testcontainers
// omitiera la etiqueta.
const NEVER_ORPHAN_NAMES = new Set(['ugc-postgres-dev']);

/**
 * Parsea la salida de `docker ps --filter … --format '{{.ID}}\t{{.Names}}'` a una lista de IDs.
 * PURA (testeable con un fixture) — no toca Docker. Descarta defensivamente cualquier fila cuyo nombre
 * sea infraestructura deliberada (NEVER_ORPHAN_NAMES), belt-and-suspenders sobre el filtro por label.
 */
export function parseContainerIds(dockerPsStdout) {
  return dockerPsStdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [id, name = ''] = l.split('\t').map((s) => s.trim());
      return { id, name };
    })
    .filter(({ id, name }) => id && !NEVER_ORPHAN_NAMES.has(name))
    .map(({ id }) => id);
}

/**
 * IDs de contenedores TESTCONTAINERS `postgres:16` huérfanos. Devuelve `{ reachable, ids }`: si el
 * daemon no responde, `reachable=false` e `ids=[]` (fail-open — el guard no rompe por un Docker caído).
 *
 * DISCRIMINADOR (correctness, code-review 2026-07-29): filtra por `label=org.testcontainers=true`
 * ADEMÁS de `ancestor=postgres:16`, de modo que el Postgres de desarrollo (`ugc-postgres-dev`, de
 * docker-compose, SIN esa etiqueta) queda EXCLUIDO del conteo y de `--clean-containers`. Sin este
 * filtro, un `--clean-containers` haría `docker rm -f ugc-postgres-dev` → reinicia la BD dev.
 *
 * Exportada para que gate-phases.mjs use EL MISMO discriminador en su higiene pre-flight (una sola
 * fuente de verdad del filtro — sin dos copias que puedan divergir).
 */
export function findOrphanPgContainers(env = process.env) {
  try {
    const out = execFileSync(
      'docker',
      [
        'ps',
        '--filter',
        'label=org.testcontainers=true',
        '--filter',
        'ancestor=postgres:16',
        '--format',
        '{{.ID}}\t{{.Names}}',
      ],
      { encoding: 'utf8', env: { ...env, DOCKER_HOST: colimaSocketHost() } },
    );
    return { reachable: true, ids: parseContainerIds(out) };
  } catch {
    // daemon inalcanzable, docker no instalado, socket muerto: no es un fallo del guard.
    return { reachable: false, ids: [] };
  }
}

// FAIL-OPEN (correctness, code-review 2026-07-29): borra UNO A UNO tolerando fallos individuales y
// devuelve cuántos se eliminaron DE VERDAD. Un `docker rm -f id1 id2` en bloque LANZA si un id ya no
// existe (un testcontainer que terminó solo entre el snapshot y el rm — rutinario cuando un `pnpm test`
// concurrente está acabando, justo el contexto de este guard). Sin try/catch, esa excepción MATARÍA el
// proceso — precisamente lo que la cabecera prohíbe ("un guard NUNCA debe ser una forma nueva de que el
// gate muera"). Un contenedor que ya no está NO es un error: se ignora y se cuenta lo realmente borrado.
// `dockerRm` es inyectable en tests (default = docker real).
export function removeContainers(
  ids,
  dockerRm = (id) =>
    execFileSync('docker', ['rm', '-f', id], {
      encoding: 'utf8',
      env: { ...process.env, DOCKER_HOST: colimaSocketHost() },
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
) {
  let removed = 0;
  for (const id of ids) {
    try {
      dockerRm(id);
      removed++;
    } catch {
      // el contenedor ya no existe (terminó solo) u otro fallo puntual: fail-open, seguimos.
    }
  }
  return removed;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────
function runCli(argv) {
  const strict = argv.includes('--strict');
  const clean = argv.includes('--clean-containers');

  // 1) Contenedores pg (tier de AVISO — NUNCA participa del exit de --strict).
  const containers = findOrphanPgContainers();
  if (!containers.reachable) {
    console.log(
      'check-orphan-workers: Docker no responde — no se cuentan contenedores pg (fail-open).',
    );
  } else if (containers.ids.length === 0) {
    console.log('check-orphan-workers: 0 contenedores postgres:16 huérfanos ✓');
  } else {
    console.error(
      `check-orphan-workers: ${containers.ids.length} contenedor(es) postgres:16 vivo(s) — ` +
        'bajo Colima (Ryuk off) NADIE los limpia y saturan CPU/mem, matando gates por duración\n' +
        '  y poniendo rojo el test de dedup sensible a timing. Si no hay un stack levantado a propósito:\n' +
        `    docker rm -f ${containers.ids.join(' ')}\n` +
        '  o vuelve a correr este guard con  --clean-containers  (opt-in).',
    );
    if (clean) {
      const removed = removeContainers(containers.ids);
      console.log(
        `check-orphan-workers: --clean-containers → ${removed}/${containers.ids.length} contenedor(es) eliminado(s)` +
          (removed < containers.ids.length
            ? ' (el resto ya no existía — fail-open, no es error).'
            : '.'),
      );
    }
  }

  // 2) Workers (tier de --strict — el que puede GASTAR DINERO).
  const pids = findWorkers();
  if (pids.length === 0) {
    console.log('check-orphan-workers: sin workers vivos ✓');
    return 0;
  }

  console.error(
    `check-orphan-workers: ${pids.length} worker(s) VIVO(s) (pids ${pids.join(', ')}).\n` +
      '  Un worker que quedó de un `pnpm dev` mal cerrado sigue comiendo de la cola de pg-boss, y si\n' +
      '  arrancó sin FAL_BASE_URL, un job N7 que tome PEGA A FAL REAL Y COBRA.\n' +
      '  Si no es tuyo y estás a punto de gastar:  pkill -f "src/main.ts"',
  );

  return strict ? 1 : 0;
}

// Guard de CLI: solo ejecuta (y sale) cuando se invoca directamente, NO al importarse desde un test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runCli(process.argv.slice(2)));
}
