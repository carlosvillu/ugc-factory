// Timeouts por tipo de nodo (T0.9): cuánto tiempo puede estar un step en
// `running` antes de que el sweeper lo lleve a `expired` (§7.1). Lógica PURA de
// core: sin BD, sin reloj — recibe el `now` y devuelve el instante de expiración.
// Los EFECTOS (fijar `timeout_at` en el UPDATE del `start`, barrer los colgados)
// viven en transition.ts y en el sweep de db/worker.
//
// Frontera de core (SKILL.md backend, principio 1): este fichero NUNCA importa
// drizzle ni pg-boss.
import { z } from 'zod';

/**
 * Duración por defecto de un step (ms) según su `node_key`. El mapa es para los
 * node_keys REALES de F4/F5 (generación fal, render FFmpeg), que afinarán sus
 * valores cuando existan; un `node_key` sin entrada usa `DEFAULT_TIMEOUT_MS`.
 *
 * OJO con la demo: los node_keys del DAG de demo son `demo.sleep.N0/.N1/.N2`
 * (sufijados por nodo para no colisionar el singletonKey), así que NO casan con
 * las entradas `demo.sleep`/`demo.fail`/`demo.hang` de abajo — esos steps caen al
 * `DEFAULT_TIMEOUT_MS` salvo que lleven el override `config.timeout_ms` (que es
 * como la Verificación de T0.9 fuerza su timeout, NO vía el mapa). Las entradas
 * `demo.*` de hoy son ILUSTRATIVAS: solo aplican si un step usa ESE node_key
 * exacto (p. ej. el test del sweeper, que sí crea un step con node_key `demo.hang`).
 *
 * El mapa es DATO, no ramas: añadir un nodo real es una entrada aquí, y su test lo
 * fija. Se resuelve por igualdad exacta del `node_key`.
 */
export const TIMEOUT_BY_NODE_MS: Readonly<Record<string, number>> = {
  // Entradas ILUSTRATIVAS de demo: solo casan con un step cuyo node_key sea
  // EXACTAMENTE `demo.sleep`/`demo.fail`/`demo.hang` (no los del DAG de demo, que
  // van sufijados `.N0/.N1/.N2` y caen al default). La Verificación de T0.9 NO
  // depende de estos valores — fuerza el timeout vía `config.timeout_ms`.
  'demo.sleep': 60_000,
  'demo.fail': 60_000,
  'demo.hang': 60_000,
};

/**
 * Default cuando el `node_key` no está en el mapa. 15 min: holgado para un nodo
 * de IA típico, pero un techo duro real para que nada quede colgado para siempre.
 */
export const DEFAULT_TIMEOUT_MS = 15 * 60_000;

/**
 * Esquema del override de timeout per-step: `config.timeout_ms`. Si el step lleva
 * este campo en su `config` (jsonb opaco de `step_run`), GANA sobre el mapa por
 * node_key. Es lo que permite a la Verificación de T0.9 forzar un timeout de 10 s
 * en un step de demo sin tocar el mapa de producción. Se valida con `safeParse`:
 * una `config` sin el campo, o con un valor no numérico, cae al mapa.
 */
const TimeoutOverrideSchema = z.object({
  timeout_ms: z.number().int().positive(),
});

/**
 * Duración de timeout (ms) para un step. Precedencia:
 *   1. `config.timeout_ms` si está presente y es un entero positivo (override).
 *   2. `TIMEOUT_BY_NODE_MS[nodeKey]` si el nodo tiene entrada.
 *   3. `DEFAULT_TIMEOUT_MS`.
 * PURA: mismo input → mismo output, sin efectos.
 */
export function timeoutMsFor(nodeKey: string, config: unknown): number {
  const override = TimeoutOverrideSchema.safeParse(config);
  if (override.success) return override.data.timeout_ms;
  return TIMEOUT_BY_NODE_MS[nodeKey] ?? DEFAULT_TIMEOUT_MS;
}

/**
 * Instante de expiración de un step que ARRANCA (queued→running): `now + timeout`.
 * El `now` lo inyecta el llamante (`transition()` usa `new Date()` — el `now()`
 * de la app, coherente con el reloj del sistema; el sweeper compara `timeout_at`
 * contra el `now()` de Postgres, y ambos relojes son el del mismo host en el
 * despliegue self-hosted). PURA respecto a `now`.
 */
export function timeoutAtFor(nodeKey: string, config: unknown, now: Date): Date {
  return new Date(now.getTime() + timeoutMsFor(nodeKey, config));
}
