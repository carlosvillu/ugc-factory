// La BD DEL STACK E2E, en un solo sitio (e2e.md §7).
//
// POR QUÉ EXISTE. La plomería de "conectarse a la Postgres que levanta `e2e-stack.ts`" —parsear
// `.runtime.json`, sacar el `databaseUrl`, abrir un pool, cerrarlo— estaba escrita TRES veces
// (`intake-manual.spec.ts`, `spend.spec.ts` y, con T1.11, `brief-editor.spec.ts`), y `queryStack`
// era la MISMA función copiada verbatim en dos de ellas. Es exactamente el fallo que la cabecera
// de `support/canvas.ts` (y la de `support/brief.ts`) existen para evitar: duplicado, el día que
// cambie el contrato del runtime uno de los tres se queda atrás, y el fallo sale como un timeout
// OPACO de Playwright en vez de como "cambió el contrato". `support/runs.ts` ya centralizaba su
// mitad (el `createDb` tipado para SEMBRAR por repo); esto centraliza la otra (el SQL crudo para
// ASEVERAR y limpiar).
//
// QUÉ VA AQUÍ Y QUÉ NO: aquí, el SQL crudo contra el stack —las aserciones que exigen ver la fila
// tal cual está en la BD (la Verificación de T1.11 pide un SELECT, no un endpoint que podría
// estar mintiendo) y los DELETE de limpieza. La siembra TIPADA por repo (`createProject`,
// `recordCost`…) sigue en `support/runs.ts` / en cada spec: son dos cosas distintas.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

/** El runtime que publica `scripts/e2e-stack.ts`: la Postgres (testcontainer) que sirve al stack
 *  levantado por el `webServer` de Playwright. */
const runtime = JSON.parse(
  readFileSync(fileURLToPath(new URL('../.runtime.json', import.meta.url)), 'utf8'),
) as { databaseUrl: string; assetsDir: string };

/** La URL de conexión de la BD del stack, para quien necesite su propio cliente tipado
 *  (`createDb` de @ugc/db) en vez de SQL crudo. */
export const stackDatabaseUrl = runtime.databaseUrl;

/**
 * Una consulta contra la BD del stack, con pool EFÍMERO.
 *
 * El pool se abre y se cierra POR CONSULTA a propósito: un pool de módulo compartido se cerraba
 * DOS veces cuando Playwright reparte los tests de un fichero entre workers ("Called end on pool
 * more than once"). Son un puñado de consultas en toda la suite — el coste es irrelevante y así
 * no hay ciclo de vida que gestionar.
 */
export async function queryStack<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = new Pool({ connectionString: stackDatabaseUrl });
  try {
    const { rows } = await pool.query<T>(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
}
