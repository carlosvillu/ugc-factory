// Guard permanente de T1.13: EL STACK E2E NO PUEDE VOLVER A PONERSE LA MULETA.
//
// Contexto (y por qué este test raro existe): la base del fetch de servidor estaba clavada
// a `http://localhost:3000`, así que las páginas RSC (`/spend`, `/settings`, `/runs/:id`)
// reventaban con 500 en cuanto el web servía en otro puerto. El bug sobrevivió a toda F0 y
// F1 porque el stack E2E fijaba `INTERNAL_API_URL` al puerto del stack: con esa env puesta,
// la base salía correcta POR DECRETO DEL STACK, no por el código — el entorno de test más
// cómodo que la realidad, y el test que debía cazar el fallo era el que lo tapaba.
//
// T1.13 quita la muleta (el stack fija `PORT=3100`, y la base se DERIVA de ahí) y este test
// se asegura de que nadie la vuelva a poner "para arreglar" un spec rojo: si `e2e-stack.ts`
// vuelve a asignar `INTERNAL_API_URL`, `pnpm gate` se pone rojo con la explicación delante.
//
// Es un test sobre el TEXTO del script a propósito: la propiedad que hay que blindar es del
// entorno del OTRO proceso (el que Playwright arranca), invisible desde el proceso de los
// specs. Determinista y gratis ⇒ vive en el gate (regla de trabajo 8 del planning).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Localizar el script sin depender del cwd: `pnpm --filter @ugc/web test` corre desde
// `apps/web`, pero `pnpm gate` (el runner de la raíz) corre desde el repo. Y
// `import.meta.url` no vale: bajo vitest+jsdom no es una URL `file:` y `fileURLToPath`
// revienta. Se prueban las dos anclas y se falla RUIDOSAMENTE si no aparece — un guard
// que no encuentra su objetivo debe romperse, no pasar en verde por vacío.
const CANDIDATES = ['scripts/e2e-stack.ts', 'apps/web/scripts/e2e-stack.ts'].map((p) =>
  path.join(process.cwd(), p),
);
const stackPath = CANDIDATES.find((p) => existsSync(p));
if (stackPath === undefined) {
  throw new Error(`No se encuentra e2e-stack.ts (probado: ${CANDIDATES.join(', ')})`);
}
const STACK = readFileSync(stackPath, 'utf8');

describe('honestidad del stack E2E (T1.13)', () => {
  it('NO fija INTERNAL_API_URL: la base del RSC debe derivarse del PORT real, como en producción', () => {
    // Solo se mira el CÓDIGO, no los comentarios (que sí nombran la env para explicar por
    // qué no está). Se quitan los DOS tipos: los de línea (`//…`) y los de BLOQUE
    // (`/* … */`). Filtrar solo `//` dejaba un falso positivo esperando: quien documentara
    // la env en un comentario de bloque pondría este guard rojo acusando de reponer una
    // muleta que nadie repuso — y un guard que grita en falso acaba siendo el que alguien
    // desactiva. Justo este no puede desactivarse.
    const code = STACK.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toContain('INTERNAL_API_URL');
  });

  it('sirve en un puerto distinto del 3000 (si no, no reproduce la condición del bug)', () => {
    const port = /const PORT = (\d+);/.exec(STACK)?.[1];
    expect(port).toBeDefined();
    expect(port).not.toBe('3000');
  });
});
