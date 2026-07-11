// Implementación filesystem del puerto `StorageAdapter` de core (architecture.md
// §2, §5): un adaptador de infraestructura, hermano de with-transaction/step-store
// /ensure-queue. Vive en @ugc/db (no en core: core es lógica pura + puertos) y lo
// cablean los composition roots (worker bootstrap: `makeLocalStorageAdapter({ root:
// requireEnv('ASSETS_DIR') })`; web: accessor lazy `getStorage()`).
//
// Seguridad (PRD §19.2 "nunca ruta cruda"): el `key` es SIEMPRE relativo a la raíz
// y NUNCA un path del cliente. `resolveWithinRoot` es la barrera LÉXICA: resuelve
// el path final (normalización de strings, no realpath) y exige que quede
// ESTRICTAMENTE por debajo de la raíz, rechazando con AppError('validation_error')
// las rutas absolutas, los `..` que escapan y el propio root (key vacío, `.`,
// `foo/..`). NO resuelve symlinks: un symlink plantado dentro de la raíz que
// apuntara fuera NO se detecta — queda fuera de alcance porque las keys son de
// CONFIANZA (vienen de `asset.storage_key` en la BD, nunca de input del cliente).
// El endpoint de download sirve esa columna, jamás input directo; el adaptador se
// defiende igual (defensa en profundidad léxica).
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat as fsStat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { AppError } from '@ugc/core/contracts';
import type { StorageAdapter } from '@ugc/core';

export interface LocalStorageOptions {
  /** Raíz absoluta del almacén (env `ASSETS_DIR`, default `/data/assets` en prod). */
  root: string;
}

/**
 * Resuelve `key` bajo `root` y garantiza que designa un fichero ESTRICTAMENTE por
 * debajo de la raíz. Un `key` con `..`, una ruta absoluta, o uno que resuelva al
 * propio root (vacío, `.`, `foo/..`) produce un path que NO empieza por
 * `root + sep` ⇒ AppError. Exigir el prefijo `withSep` (sin excepción para el
 * root mismo) cubre a la vez el escape y el caso "el key ES la raíz": servir el
 * directorio raíz como si fuera un fichero daría un 200 roto (EISDIR tras enviar
 * cabeceras). El separador evita el falso positivo `/data/assets-evil` ⊄
 * `/data/assets`.
 */
function resolveWithinRoot(root: string, key: string): string {
  const rootResolved = path.resolve(root);
  const full = path.resolve(rootResolved, key);
  const withSep = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (!full.startsWith(withSep)) {
    throw new AppError('validation_error', 'storage_key fuera de la raíz de almacenamiento');
  }
  return full;
}

async function toBuffer(data: Uint8Array | ReadableStream<Uint8Array>): Promise<Buffer> {
  if (data instanceof Uint8Array) return Buffer.from(data);
  // Se drena el web ReadableStream (el del DOM) a mano con getReader(): NO se usa
  // `buffer()` de node:stream/consumers porque su firma espera el ReadableStream de
  // Node, y bajo la lib DOM de apps/web el stream del DOM NO le es asignable (falla
  // el typecheck). El bucle manual es agnóstico de esa incompatibilidad DOM↔Node.
  const chunks: Buffer[] = [];
  const reader = data.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** sha256 en hex — el checksum canónico que se persiste en `asset.checksum`. */
function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function makeLocalStorageAdapter(opts: LocalStorageOptions): StorageAdapter {
  const root = path.resolve(opts.root);

  return {
    // El 3er param `opts.mime` del puerto se ignora a propósito: el FS local no
    // guarda metadatos, el mime es de la columna `asset.mime`. Un backend s3 sí lo
    // usaría como Content-Type — por eso vive en el contrato del puerto.
    async put(key, data) {
      const full = resolveWithinRoot(root, key);
      const buf = await toBuffer(data);
      // `mkdir -p`: la raíz (p. ej. /data/assets) y los subdirectorios del key
      // pueden no existir aún — el put es idempotente respecto a la estructura.
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, buf);
      return { bytes: buf.byteLength, checksum: sha256(buf) };
    },

    async get(key) {
      const full = resolveWithinRoot(root, key);
      // Verifica existencia ANTES de crear el stream: un ENOENT tardío dentro del
      // stream es difícil de mapear a un 404 limpio en el endpoint.
      try {
        await fsStat(full);
      } catch {
        throw new AppError('not_found', 'asset no encontrado en el almacén');
      }
      // Node Readable → web ReadableStream: es lo que `new Response(body)` espera
      // (el endpoint de download hace streaming sin cargar el fichero en memoria).
      return Readable.toWeb(createReadStream(full)) as ReadableStream<Uint8Array>;
    },

    async stat(key) {
      const full = resolveWithinRoot(root, key);
      let info;
      try {
        info = await fsStat(full);
      } catch {
        return null;
      }
      if (!info.isFile()) return null;
      // stat recomputa el checksum leyendo el fichero: el puerto promete
      // {bytes, checksum} y el FS no guarda el checksum aparte (la fila `asset` sí).
      const buf = await readFile(full);
      return { bytes: info.size, checksum: sha256(buf) };
    },

    async delete(key) {
      const full = resolveWithinRoot(root, key);
      // Idempotente: borrar algo inexistente no es un error (force).
      await rm(full, { force: true });
    },
  };
}

/** Raíz de assets por defecto en producción (PRD §19.2 / architecture.md §6). En dev y en el
 *  stack E2E se pasa un path escribible del host vía `ASSETS_DIR`. */
const DEFAULT_ASSETS_DIR = '/data/assets';

/**
 * El StorageAdapter local cableado desde el ENTORNO (`ASSETS_DIR`, con el default de
 * producción). UNA sola definición del "dónde viven los assets", compartida por los DOS
 * composition roots: `apps/web` (que sirve `/api/assets/:id/download`) y `apps/worker` (que
 * los escribe desde los executors). Antes cada uno tenía su propia copia del default y de la
 * lectura de env — y si el deploy cambiaba el directorio y solo se tocaba una, el worker
 * escribía los assets donde web no los lee. Un bug silencioso y muy caro de encontrar.
 *
 * Leer `process.env` es CONFIG, no I/O de datos: la construcción del adaptador es
 * precisamente el sitio donde la config se resuelve.
 */
export function makeLocalStorageAdapterFromEnv(): StorageAdapter {
  return makeLocalStorageAdapter({ root: process.env.ASSETS_DIR ?? DEFAULT_ASSETS_DIR });
}
