import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { expectGolden } from './golden';

// El directorio lleva un espacio a propósito: es el caso que rompía la
// convención anterior (`new URL(...).pathname` percent-encodea → ENOENT).
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'golden con espacio-'));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('expectGolden', () => {
  it('pasa cuando el contenido coincide, aceptando un file URL con espacios en el path', async () => {
    const golden = path.join(dir, 'caso.txt');
    await writeFile(golden, 'contenido exacto', 'utf8');
    await expectGolden('contenido exacto', pathToFileURL(golden));
  });

  it('falla con diff cuando el contenido difiere', async () => {
    const golden = path.join(dir, 'difiere.txt');
    await writeFile(golden, 'esperado', 'utf8');
    await expect(expectGolden('otra cosa', golden)).rejects.toThrow();
  });

  it("golden ausente → error accionable 'Genera con UPDATE_GOLDEN=1'", async () => {
    const golden = path.join(dir, 'no-existe.txt');
    await expect(expectGolden('lo que sea', golden)).rejects.toThrow(
      /Golden ausente:.*UPDATE_GOLDEN=1/,
    );
  });

  it('un error de I/O que NO es ENOENT se relanza tal cual, no disfrazado de golden ausente', async () => {
    const golden = path.join(dir, 'soy-un-directorio');
    await mkdir(golden);
    // Leer un directorio como fichero → EISDIR: debe salir el error original.
    await expect(expectGolden('x', golden)).rejects.toThrow(/EISDIR/);
    await expect(expectGolden('x', golden)).rejects.not.toThrow(/Golden ausente/);
  });

  it('UPDATE_GOLDEN=1 regenera el fichero (también vía URL) y el assert pasa', async () => {
    vi.stubEnv('UPDATE_GOLDEN', '1');
    const golden = path.join(dir, 'regenerado', 'nuevo.txt');
    await expectGolden('contenido nuevo', pathToFileURL(golden));
    expect(await readFile(golden, 'utf8')).toBe('contenido nuevo');
  });
});
