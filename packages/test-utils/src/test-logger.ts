// Logger de TESTS (T1.20): implementa el puerto `Logger` de core sin escribir nada.
//
// Por qué existe: desde T1.20, `makeWithTransaction`/`withDomainTransaction` exigen un `Logger`
// —el rollup del coste se TRAGA sus errores, y sin traza estructurada volvería a dejar la
// columna del dinero mintiendo en silencio (observability.md)—. Las suites de integración
// cablean el MISMO adaptador que producción, así que necesitan un Logger; pero un pino de verdad
// en cada suite solo llenaría de ruido la salida de vitest.
//
// SILENCIOSO PERO NO CIEGO: guarda las llamadas en `entries`, de modo que un test PUEDE afirmar
// que un fallo tragado dejó su traza. Es justo lo que hacía intolerable el `console.warn`
// original: sobre él no se puede afirmar nada. Un fake que no permite aserciones no vale.
import type { Logger } from '@ugc/core';

/** Una llamada al logger, tal cual la recibió. No se exporta fuera del paquete: los tests
 *  afirman sobre `TestLogger.entries`, cuyo tipo se infiere. */
interface LogEntry {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  obj: object;
  msg?: string;
}

export interface TestLogger extends Logger {
  /** Todo lo logueado, incluidos los `child` (comparten el mismo array, como pino comparte
   *  destino con sus hijos). */
  entries: LogEntry[];
}

/** Un `Logger` que no imprime nada y registra lo que se le pide loguear. */
export function makeTestLogger(): TestLogger {
  const entries: LogEntry[] = [];
  const build = (bindings: Record<string, unknown>): TestLogger => {
    const record =
      (level: LogEntry['level']) =>
      (obj: object, msg?: string): void => {
        entries.push({ level, obj: { ...bindings, ...obj }, msg });
      };
    return {
      entries,
      trace: record('trace'),
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      child: (childBindings) => build({ ...bindings, ...childBindings }),
    };
  };
  return build({});
}
