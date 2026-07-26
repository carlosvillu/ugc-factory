// GUARD DE HIGIENE — workers huérfanos que pueden GASTAR DINERO REAL (2026-07-26).
//
// EL RIESGO, medido dos veces en sesiones reales: un `pnpm dev` mal cerrado deja vivo el worker de
// `apps/worker` (tsx watch src/main.ts). Ese proceso SIGUE comiendo de la cola de pg-boss, y si el
// entorno con el que arrancó NO llevaba `FAL_BASE_URL` apuntando a un fake, un job N7 que tome pega a
// **fal REAL y cobra**. El 2026-07-25 había 3 huérfanos así; el 2026-07-26, otros 2. Ninguno llegó a
// gastar por suerte, no por diseño.
//
// POR QUÉ UN GUARD Y NO UNA NOTA EN EL JOURNAL: la regla «mata los huérfanos antes de gastar» llevaba
// dos incidentes escrita en prosa. El patrón de la auditoría del journal (2026-07-23) es que una regla
// que se repite se convierte en comprobación mecánica o no se cumple.
//
// QUÉ HACE: detecta procesos worker vivos y AVISA (exit 0 por defecto — no rompe el gate de quien está
// desarrollando con el stack levantado a propósito). Con `--strict` sale con código 1: eso es lo que
// debe usar un verifier ANTES de un run que gasta, donde un worker ajeno no es una molestia sino un
// riesgo de dinero.
//
// NO intenta leer el entorno del proceso: en macOS `ps -E` no lo expone de forma fiable, así que un
// worker ajeno se trata SIEMPRE como no contenido (la lectura segura cuando hay dinero de por medio).
import { execFileSync } from 'node:child_process';

const strict = process.argv.includes('--strict');

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

const pids = findWorkers();

if (pids.length === 0) {
  console.log('check-orphan-workers: sin workers vivos ✓');
  process.exit(0);
}

console.error(
  `check-orphan-workers: ${pids.length} worker(s) VIVO(s) (pids ${pids.join(', ')}).\n` +
    '  Un worker que quedó de un `pnpm dev` mal cerrado sigue comiendo de la cola de pg-boss, y si\n' +
    '  arrancó sin FAL_BASE_URL, un job N7 que tome PEGA A FAL REAL Y COBRA.\n' +
    '  Si no es tuyo y estás a punto de gastar:  pkill -f "src/main.ts"',
);

process.exit(strict ? 1 : 0);
