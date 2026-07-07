// Accessor lazy del logger base de web (observability.md §3.2): memoiza
// makeLogger en el primer uso. Importar el módulo no crea logger ni lee env
// (principio 5 de la skill backend: nada en module scope).
import { makeLogger, type Logger } from '@ugc/core/observability';

let rootLogger: Logger | undefined;

export function getRootLogger(): Logger {
  rootLogger ??= makeLogger({ name: 'web', level: process.env.LOG_LEVEL ?? 'info' });
  return rootLogger;
}
