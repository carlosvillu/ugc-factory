// Ping de conexión COMPARTIDO por web (route /api/health) y worker (bootstrap).
// Vive en @ugc/db porque es la pieza de conexión a Postgres, justo donde T0.3
// extenderá el pool + Drizzle (architecture.md §1: db implementa la persistencia;
// las apps solo cablean). En T0.2 es lo mínimo: un `SELECT 1` con timeouts
// cortos cuyo ÚNICO resultado observable es un boolean — cualquier fallo de
// conexión se traduce a `false`, nunca se propaga ni tumba la app.
//
// NADA de drizzle/schema/migraciones aquí: eso es T0.3. Un ping no lo necesita.
import { Client } from 'pg';

/**
 * Presupuesto de tiempo del ping. La mitad "trampa" de la Verificación de T0.2
 * es la DEGRADACIÓN: con Postgres caído, `/api/health` debe responder
 * `db:false` RÁPIDO, no colgarse esperando el timeout por defecto del driver.
 *
 * Los tres timeouts acotan tres fases distintas — hacen falta los tres:
 * - `connectionTimeoutMillis`: acota SOLO la fase de CONNECT (handshake TCP+auth).
 * - `query_timeout`: bound CLIENT-side del query (pg/lib/client.js). SIN esto,
 *   un socket que conecta-y-cuelga (Postgres que acepta TCP pero no responde, o
 *   red que cae sin RST) espera al timeout TCP del SO (decenas de segundos), no
 *   a nuestro presupuesto — y `/api/health`/el boot del worker se cuelgan.
 * - `statement_timeout`: SERVER-side; aborta la query en el servidor. Refuerzo,
 *   pero es inútil por sí solo contra un servidor que no responde (nunca la ve).
 */
export const PING_CONNECT_TIMEOUT_MS = 1_500;
export const PING_STATEMENT_TIMEOUT_MS = 1_500;

/**
 * Costura inyectable para tests: abre una conexión, ejecuta `SELECT 1` y la
 * cierra. La implementación real usa `pg.Client`; los tests pasan un doble para
 * fijar el camino de éxito sin un Postgres levantado (db-integration real es
 * T0.3). El contrato es binario: resuelve si el `SELECT 1` fue OK, rechaza en
 * cualquier otro caso.
 */
export type PingRunner = (connectionString: string) => Promise<void>;

/**
 * Runner real (default de `pingDb`): `pg.Client` con timeouts cortos, siempre
 * cerrado en `finally`. Interno — no se exporta: el único consumidor es `pingDb`
 * y los tests inyectan su propio `PingRunner` (o ejercitan este vía `pingDb`).
 */
const pgPingRunner: PingRunner = async (connectionString) => {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: PING_CONNECT_TIMEOUT_MS,
    // CLIENT-side: sin esto, un socket conecta-y-cuelga espera al timeout TCP
    // del SO, no a nuestro presupuesto. Es el que garantiza el `db:false` rápido.
    query_timeout: PING_STATEMENT_TIMEOUT_MS,
    // SERVER-side: refuerzo (aborta la query en el servidor si sí responde).
    statement_timeout: PING_STATEMENT_TIMEOUT_MS,
  });
  await client.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    // Cerrar SIEMPRE: una conexión filtrada mantiene vivo el event loop del
    // worker y agota el pool de Postgres en producción.
    await client.end();
  }
};

export interface PingDbOptions {
  /** Cadena de conexión; en runtime real = `process.env.DATABASE_URL`. */
  connectionString: string | undefined;
  /** Override para tests. Por defecto, el runner real de `pg`. */
  runner?: PingRunner;
}

/**
 * Devuelve `true` si Postgres respondió a un `SELECT 1`, `false` en cualquier
 * otro caso (sin DATABASE_URL, conexión rechazada, timeout, error de query).
 * NUNCA lanza: es el contrato que permite a `/api/health` degradar a
 * `{ok:true, db:false}` sin un 500 y sin tumbar la app.
 */
export async function pingDb(options: PingDbOptions): Promise<boolean> {
  const { connectionString, runner = pgPingRunner } = options;
  if (!connectionString) return false;
  try {
    await runner(connectionString);
    return true;
  } catch {
    return false;
  }
}
