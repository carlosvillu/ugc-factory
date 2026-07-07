// Golden files (testing/references/unit-core.md §2): comparación carácter a
// carácter contra un fichero versionado. Regeneración SOLO con UPDATE_GOLDEN=1
// y el diff se revisa a mano antes de commitear.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

// goldenPath: relativo al fichero de test — el caller pasa directamente
// new URL('./golden/caso.txt', import.meta.url) (o un path absoluto ya
// resuelto con fileURLToPath). JAMÁS `.pathname`: percent-encodea espacios y
// caracteres no-ASCII (repo bajo "Mi Repo/" → ENOENT, y con UPDATE_GOLDEN=1
// escribe un árbol duplicado con '%20' literal).
export async function expectGolden(actual: string, goldenPath: string | URL): Promise<void> {
  const golden = typeof goldenPath === 'string' ? goldenPath : fileURLToPath(goldenPath);
  if (process.env.UPDATE_GOLDEN === '1') {
    await mkdir(path.dirname(golden), { recursive: true });
    await writeFile(golden, actual, 'utf8');
  }
  let expected: string;
  try {
    expected = await readFile(golden, 'utf8');
  } catch (error) {
    // Solo el golden ausente se traduce a la instrucción de regenerar; cualquier
    // otro fallo de I/O (EACCES, EISDIR…) debe salir tal cual, no disfrazado.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Golden ausente: ${golden}. Genera con UPDATE_GOLDEN=1 y revisa el diff.`);
    }
    throw error;
  }
  expect(actual).toBe(expected); // toBe: comparación carácter a carácter, sin normalizar
}
