// GUARD PERMANENTE: NINGÚN MÓDULO DE CLIENTE PUEDE ARRASTRAR UN BINARIO NATIVO DE NODE.
//
// EL BUG QUE ESTE TEST IMPIDE QUE VUELVA (T2.0, cazado por `pnpm test:e2e`):
//
// El barrel `@ugc/core/persona` re-exportaba `makeSyntheticReferenceImage` y
// `validateReferenceImage`, que importan **sharp** (binario nativo). Ese barrel lo importa
// `apps/web/src/lib/api-client.ts` —un módulo de CLIENTE— para sus contratos Zod. Resultado:
// Turbopack seguía la cadena `api-client → @ugc/core/persona → reference-image → sharp →
// detect-libc → require('child_process')` al construir el bundle del NAVEGADOR, no encontraba
// `child_process` (no existe en el browser) y **la app entera dejaba de compilar**: `/analyses/new`
// devolvía 500 y con ella se cayeron 28 specs de E2E que no tenían NADA que ver con personas.
//
// POR QUÉ NINGUNA OTRA CAPA LO CAZÓ — y es la lección: `pnpm test` (unit + integración) corre en
// NODE. En Node, importar sharp funciona perfectamente. Los 1042 tests estaban VERDES con la app
// rota. El único test que compila la aplicación DE VERDAD PARA UN NAVEGADOR es el E2E, y por eso
// fue el único que lo vio. Es principio 9 de la skill testing en estado puro: **el arnés (Node)
// era más cómodo que la realidad (el bundler del navegador)**.
//
// Este guard es la red BARATA que cierra el hueco: corre en `pnpm gate` (segundos, sin navegador)
// y falla en cuanto un módulo de cliente vuelve a alcanzar una dependencia solo-Node. No sustituye
// al E2E; lo adelanta.
//
// CÓMO FUNCIONA: recorre el grafo de imports estáticos partiendo de los módulos que SÍ acaban en
// el bundle del navegador (`api-client.ts` y **todos** los componentes `'use client'`, que se
// DESCUBREN solos), y comprueba que ninguno alcanza un módulo prohibido. Es análisis de texto
// sobre el árbol de ficheros — no ejecuta nada, no necesita bundler.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Anclaje sin `import.meta.url`: bajo vitest+jsdom NO es una URL `file:` y `fileURLToPath`
// revienta (mismo pitfall —y misma solución— que `e2e-stack-honesty.test.ts`, T1.13). El cwd
// varía: `pnpm --filter @ugc/web test` corre desde `apps/web`; `pnpm gate` desde la raíz. Se
// prueban las dos anclas y se falla RUIDOSAMENTE si no aparece: un guard que no encuentra su
// objetivo debe romperse, no pasar en verde por vacío.
function resolveWebSrc(): string {
  const candidates = ['src', 'apps/web/src'].map((p) => path.join(process.cwd(), p));
  const found = candidates.find((p) => existsSync(path.join(p, 'lib/api-client.ts')));
  if (found === undefined) {
    throw new Error(
      `client-bundle-honesty: no encuentro apps/web/src (probé: ${candidates.join(', ')})`,
    );
  }
  return found;
}

const WEB_SRC = resolveWebSrc();
const REPO = path.resolve(WEB_SRC, '../../..');

/**
 * Paquetes que NO pueden aparecer en el grafo del cliente. `sharp` es el que nos mordió (binario
 * nativo + `child_process`); los otros son de la misma familia (Node puro, sin equivalente en el
 * navegador) y los tenemos en el monorepo. Añadir uno aquí es gratis y previene el mismo día
 * perdido.
 *
 * Se comparan por IGUALDAD o por PREFIJO DE SUBPATH (`pg` casa con `pg` y con `pg/lib/x`, pero
 * NO con `pgx`). El matcher original hacía además un `startsWith(pkg)` a pelo, que daba
 * `forbidden = true` para cualquier paquete browser-safe que EMPEZARA por uno de estos nombres
 * (`pgx`, `sharp-utils`, `@ugc/dbx`): un rojo del gate sin causa, y el instinto ante un rojo sin
 * causa es relajar el matcher — justo el guard que no se debe tocar.
 */
const NODE_ONLY_PACKAGES = ['sharp', 'pg', 'pg-boss', 'drizzle-orm', 'pino', '@ugc/db'];

/**
 * Los ESQUEMAS de módulo que solo existen en Node. Van aparte de la lista de arriba **porque son
 * prefijos, no nombres**: `node:fs` no es «el paquete `node:`», es el esquema `node:` + un
 * builtin. Si se mezclan en la misma lista, quitar el `startsWith` suelto (que era el bug de
 * arriba) apagaría de paso la detección de TODOS los `node:*` sin que nadie se enterara — el test
 * `un import de node:fs SIGUE cazándose` de abajo existe exactamente para impedirlo.
 */
const NODE_ONLY_SCHEMES = ['node:'];

/** Subpaths de `@ugc/core` que son solo-Node por construcción (usan sharp/SDKs). Importarlos
 *  desde cliente es el mismo bug con otra cara. */
const NODE_ONLY_CORE_SUBPATHS = ['@ugc/core/persona/server', '@ugc/core/analyze'];

/** ¿Este especificador de import es una dependencia solo-Node? */
function isNodeOnly(spec: string): boolean {
  if (NODE_ONLY_CORE_SUBPATHS.includes(spec)) return true;
  if (NODE_ONLY_SCHEMES.some((scheme) => spec.startsWith(scheme))) return true;
  return NODE_ONLY_PACKAGES.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`));
}

/** Todos los ficheros `.ts`/`.tsx` bajo un directorio, recursivamente. */
function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

/**
 * LOS PUNTOS DE ENTRADA DEL BUNDLE DEL NAVEGADOR, DESCUBIERTOS — no listados a mano.
 *
 * Un módulo acaba en el navegador si (a) lleva la directiva `'use client'`, o (b) lo importa —
 * transitivamente — alguno que la lleve. Así que las RAÍCES del grafo de cliente son todos los
 * `'use client'` de la app, y se buscan con un grep de la directiva: si mañana alguien añade un
 * componente de cliente nuevo, entra solo en el guard. Se añade `lib/api-client.ts` aunque no
 * lleve la directiva (es una librería, la importan los clientes) porque es el nodo CRÍTICO: lo
 * usa todo componente que hable con la API, y por eso su contaminación tumbó 28 specs de F0.
 *
 * ⚠ POR QUÉ NO BASTABA CON `api-client.ts` (hallazgo del code-review de T2.0): el comentario de
 * la cabecera prometía «y los componentes `'use client'`» pero la lista tenía UNA entrada. Los
 * tres componentes de personas quedaban cubiertos DE CASUALIDAD (importan el mismo barrel que
 * `api-client`), pero un componente de cliente que importara un módulo solo-Node **sin pasar por
 * `api-client`** reintroducía EXACTAMENTE el bug de T2.0 con el guard en verde. Un guard que
 * nació porque el arnés era más cómodo que la realidad no puede permitirse mentir en su propio
 * comentario: o hace lo que dice, o se recorta lo que dice — nunca al revés.
 */
function clientEntries(): string[] {
  const roots = walkSourceFiles(WEB_SRC).filter((file) =>
    /^\s*(['"])use client\1/.test(readFileSync(file, 'utf8')),
  );
  const apiClient = path.join(WEB_SRC, 'lib/api-client.ts');
  return [apiClient, ...roots.filter((f) => f !== apiClient)].sort();
}

/**
 * Los especificadores de módulo de un fichero TS/TSX. Tres reglas, y las tres tienen cicatriz:
 *
 * 1. **CUENTA EL `export … from`, no solo el `import`.** Es EL MECANISMO DEL BUG: un barrel no
 *    «importa» sharp, lo RE-EXPORTA (`export { makeSyntheticReferenceImage } from
 *    './reference-image'`), y el bundler sigue esa arista igual que la de un import. La primera
 *    versión de este guard solo miraba `import`, y al reinyectar el bug para el control negativo
 *    **siguió en verde**. Un guard que no se pone rojo cuando el bug vuelve no es un guard: es
 *    decoración.
 *
 * 2. **NO CUENTA los imports de SOLO TIPO** (`import type … from`, `export type … from`): TS los
 *    borra al compilar, no existe arista en el bundle, y un `import type { PersonaRow } from
 *    '@ugc/db'` en un componente de cliente es legal. No afloja nada frente al bug que
 *    perseguimos —aquel era un re-export de VALORES—, que se sigue contando. Ojo al matiz: solo
 *    el `type` PEGADO a la palabra clave. Un `import { type X }` SÍ cuenta (es un import de valor
 *    con un miembro de tipo: la arista del módulo existe).
 *
 * 3. **NO SE SALE DE LA SENTENCIA.** La cláusula intermedia se recorre con `[^;'"]*?`, que puede
 *    cruzar saltos de línea (los barrels multilínea son la norma en este repo) pero NUNCA un `;`
 *    ni una comilla. El patrón anterior (`[^'"]*?`, sin el `;`) no tenía más freno que la primera
 *    comilla del fichero: en `export function X() { … return <div className="flex gap-6">`, el
 *    `export` de la línea 1 se enganchaba a la className de la línea 92 y el guard creía que
 *    `'flex flex-wrap items-end gap-6'` era un módulo (y luego reventaba al intentar leerlo como
 *    fichero). No producía falsos negativos, pero un guard que malinterpreta lo que lee no merece
 *    que se confíe en él — y menos este, que nació de un descuido idéntico.
 *
 * De ahí las DOS pasadas: la de las sentencias con `from` (import y export), y la del import de
 * EFECTO SECUNDARIO (`import './globals.css'`), que no lleva cláusula ni `from`. No existe la
 * forma `export '…'`, así que la segunda pasada es solo para `import`.
 */
/** Cache del PARSEO, no del recorrido. Las 32 entradas de cliente convergen en los mismos hubs
 *  (`api-client.ts`, `components/ui/*`, los barrels de core): sin esto se releen y re-parsean los
 *  mismos ~90 ficheros cientos de veces. El `seen` de cada recorrido sigue siendo suyo (cada
 *  entrada necesita SU camino); lo que se comparte es el contenido, que no cambia a mitad de la
 *  corrida — `importsOf` es una función pura de él. */
const IMPORTS_CACHE = new Map<string, string[]>();

function importsOf(file: string): string[] {
  const cached = IMPORTS_CACHE.get(file);
  if (cached) return cached;

  const src = readFileSync(file, 'utf8');
  const specs: string[] = [];

  // 1) Con `from`: `import … from '…'` y `export … from '…'` (el re-export: EL MECANISMO DEL BUG).
  //    La cláusula intermedia (`{ a, b }`, `* as x`, `X`) puede ser multilínea, pero `[^;'"]*?`
  //    NUNCA cruza un `;` — así no se escapa al cuerpo del fichero.
  //    El grupo 2 captura el `type` PEGADO a la palabra clave: `import type …` se borra al
  //    compilar (no es arista del bundle) y se descarta. Un `import { type X }` NO lleva ese
  //    grupo: es un import de valor con un miembro de tipo, y su arista de módulo SÍ existe.
  const withFrom = /\b(?:import|export)(\s+type)?\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
  for (let m = withFrom.exec(src); m !== null; m = withFrom.exec(src)) {
    if (m[1] !== undefined) continue; // `import type` / `export type`: erasable
    if (m[2]) specs.push(m[2]);
  }

  // 2) Import de EFECTO SECUNDARIO (`import './globals.css'`): sin cláusula y sin `from`. No
  //    existe la forma `export '…'`, por eso este patrón es solo para `import`.
  const sideEffect = /\bimport\s*['"]([^'"]+)['"]/g;
  for (let m = sideEffect.exec(src); m !== null; m = sideEffect.exec(src)) {
    if (m[1]) specs.push(m[1]);
  }

  IMPORTS_CACHE.set(file, specs);
  return specs;
}

/** Resuelve un import a un fichero del repo, o `null` si es externo/no resoluble. */
function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(WEB_SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else if (spec.startsWith('@ugc/core/')) {
    // El exports map de core: subpath → src/<sub>/index.ts (o el fichero, para `persona/server`).
    const sub = spec.slice('@ugc/core/'.length);
    const asFile = path.join(REPO, 'packages/core/src', `${sub}.ts`);
    if (existsSync(asFile)) return asFile;
    base = path.join(REPO, 'packages/core/src', sub, 'index');
  } else if (spec === '@ugc/core') {
    base = path.join(REPO, 'packages/core/src/index');
  } else return null; // dependencia externa: la comprueba el chequeo de NODE_ONLY, no se recorre

  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const candidate = `${base}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  // Solo un FICHERO es un módulo. El `existsSync(base)` a secas que había aquí devolvía también
  // DIRECTORIOS (`@/components/ui` existe como carpeta) y `readFileSync` reventaba con EISDIR en
  // cuanto el guard miró más allá de `api-client.ts`. Un import que no resuelve a fichero es una
  // dependencia externa o un alias que este resolvedor no conoce: se ignora (ya se ha comprobado
  // contra la lista de prohibidos ANTES de intentar resolverlo).
  return existsSync(base) && statSync(base).isFile() ? base : null;
}

/** Recorre el grafo desde `entry` y devuelve el primer camino que alcanza algo prohibido. */
function findNodeOnlyPath(entry: string): string[] | null {
  const seen = new Set<string>();
  const stack: { file: string; path: string[] }[] = [{ file: entry, path: [entry] }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    if (seen.has(current.file)) continue;
    seen.add(current.file);

    for (const spec of importsOf(current.file)) {
      if (isNodeOnly(spec)) return [...current.path, spec];

      const resolved = resolveLocal(spec, current.file);
      if (resolved) stack.push({ file: resolved, path: [...current.path, resolved] });
    }
  }
  return null;
}

const CLIENT_ENTRIES = clientEntries();

describe('honestidad del bundle de cliente (T2.0: el bug de sharp)', () => {
  it('el guard vigila TODOS los módulos de cliente, no una lista escrita a mano', () => {
    // Si el descubrimiento se rompe (cambia la estructura de carpetas, se mueve la directiva…),
    // `clientEntries()` devolvería una lista corta y el `it.each` de abajo pasaría en verde por
    // VACÍO — el peor modo de fallo de un guard. Se ancla en los ficheros que sabemos que son de
    // cliente: los tres de personas (el bug de T2.0 salió de ahí) y `api-client`.
    const rel = CLIENT_ENTRIES.map((f) => path.relative(WEB_SRC, f));
    expect(rel).toContain('lib/api-client.ts');
    expect(rel).toContain('components/personas/persona-detail.tsx');
    expect(rel).toContain('components/personas/persona-form.tsx');
    expect(rel).toContain('components/personas/personas-library.tsx');
    expect(rel.length).toBeGreaterThan(10); // hay decenas de `'use client'` en la app
  });

  // SI ESTE TEST SE PONE ROJO: el diff te enseña el CAMINO de imports completo, de la entrada de
  // cliente hasta la dependencia solo-Node. Córtalo moviendo lo solo-Node a un subpath de
  // SERVIDOR (el patrón ya existe: `@ugc/core/persona/server`, `@ugc/core/analyze`), que solo
  // importen route handlers y scripts. NO lo silencies: el bundler del navegador va a fallar
  // igual, y cuando falle tumbará TODAS las páginas de la app, no solo la tuya.
  it.each(CLIENT_ENTRIES.map((f) => [path.relative(WEB_SRC, f), f] as const))(
    '%s no alcanza ninguna dependencia solo-Node por su grafo de imports',
    (_label, file) => {
      const offending = findNodeOnlyPath(file);

      // Cuando falla, lo que importa es el CAMINO exacto que hay que cortar: se asserta sobre él
      // (no sobre un booleano), así el diff del fallo lo imprime entero. `expect(v, msg)` de dos
      // argumentos lo veta la regla `vitest/valid-expect` del proyecto, así que el mensaje va
      // aquí, en el propio valor comparado.
      const asPath = offending?.map((p) => p.replace(REPO, '.')).join(' → ');
      expect(asPath ?? 'sin dependencias solo-Node en el grafo').toBe(
        'sin dependencias solo-Node en el grafo',
      );
    },
  );

  it('el guard DETECTA de verdad un camino prohibido (control del propio guard)', () => {
    // Sin esto, el test de arriba pasaría igual si `findNodeOnlyPath` estuviera roto y devolviera
    // siempre null. Se le da un fichero que SÍ importa sharp (el generador del seed) y se exige
    // que lo encuentre. Es el control negativo, escrito como test permanente.
    const seedFile = path.join(REPO, 'packages/core/src/persona/reference-image.ts');
    const found = findNodeOnlyPath(seedFile);
    expect(found).not.toBeNull();
    expect(found?.at(-1)).toBe('sharp');
  });

  describe('el matcher: ni se le escapa lo prohibido ni muerde a un inocente', () => {
    it('caza los builtins de Node por su ESQUEMA (`node:fs`), no por su nombre', () => {
      // `node:` es un PREFIJO, no un paquete: ninguna comparación por igualdad ni por `pkg/` lo
      // caza. Si alguien fusiona los esquemas con la lista de paquetes y simplifica el matcher,
      // la detección de TODOS los `node:*` se apaga en silencio. Este test lo impide.
      expect(isNodeOnly('node:fs')).toBe(true);
      expect(isNodeOnly('node:child_process')).toBe(true);
    });

    it('caza el paquete y sus subpaths (`sharp`, `drizzle-orm/pg-core`)', () => {
      expect(isNodeOnly('sharp')).toBe(true);
      expect(isNodeOnly('drizzle-orm/pg-core')).toBe(true);
      expect(isNodeOnly('@ugc/core/persona/server')).toBe(true);
      expect(isNodeOnly('@ugc/core/analyze')).toBe(true);
    });

    it('NO caza a un paquete que solo COMPARTE PREFIJO con uno prohibido', () => {
      // El matcher original hacía `spec.startsWith(pkg)` a pelo: `pgx` casaba con `pg`, y
      // `@ugc/dbx` con `@ugc/db`. Un rojo del gate sin causa real es peor que inútil — empuja a
      // relajar el guard. El límite es el separador `/` (o la igualdad exacta).
      expect(isNodeOnly('pgx')).toBe(false);
      expect(isNodeOnly('sharp-utils')).toBe(false);
      expect(isNodeOnly('@ugc/dbx')).toBe(false);
      // Y lo que de verdad importa: los módulos browser-safe que la app usa a diario.
      expect(isNodeOnly('@ugc/core/persona')).toBe(false);
      expect(isNodeOnly('@ugc/core/contracts')).toBe(false);
      expect(isNodeOnly('react')).toBe(false);
    });

    it('un import de SOLO TIPO no es una arista del bundle (se borra al compilar)', () => {
      // Fichero REAL del repo (no un fixture de mentira): `server/persona-response.ts` importa
      // `import type { PersonaRow } from '@ugc/db'` y, como valor, el contrato de core. TS borra
      // el primero al compilar: no hay arista, no viaja al navegador. Si el guard lo contara,
      // cualquier componente de cliente que tipara una fila daría un rojo falso — y el bug real
      // que perseguimos era un re-export de VALORES, que sí se sigue contando.
      const specs = importsOf(path.join(WEB_SRC, 'server/persona-response.ts'));
      expect(specs).toContain('@ugc/core/persona'); // import de valor: cuenta
      expect(specs).not.toContain('@ugc/db'); // `import type { … }`: NO cuenta
    });

    it('una className de Tailwind NO es un import (el parser no se sale de la sentencia)', () => {
      // Bug REAL de este guard, encontrado al ampliar las entradas: con el patrón anterior, el
      // `export` de `export function AppearanceSwitchers() {` se enganchaba —cruzando 90 líneas
      // sin comillas— a la PRIMERA cadena del JSX, y el guard creía que
      // `'flex flex-wrap items-end gap-6'` era un especificador de módulo (y luego reventaba al
      // intentar leerlo como fichero). No causaba falsos negativos, pero un guard que
      // malinterpreta lo que lee no merece que se confíe en él.
      const specs = importsOf(path.join(WEB_SRC, 'components/settings/appearance-settings.tsx'));
      expect(specs).toContain('react');
      expect(specs.filter((s) => s.includes(' '))).toEqual([]); // ningún "módulo" con espacios
    });
  });
});
