// Correlación por request vía AsyncLocalStorage (observability.md §3.2). Cualquier
// capa (repo, servicio, accessor) loguea correlacionada sin prop drilling.
//
// Store-safe: `getRequestId()`/`getRequestLogger()` funcionan aunque no haya store
// activo — el 401 de `withAuth` se emite POR FUERA de `withRoute` (auth compone
// por encima), así que `toErrorResponse` puede llamarse antes de que `withRoute`
// establezca el scope ALS. Sin fallback, ese camino lanzaría sin contexto.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from '@ugc/core/observability';
import { getRootLogger } from './logger';

interface RequestContext {
  log: Logger;
  requestId: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/** El logger correlacionado del request actual, o el root si no hay scope. */
export function getRequestLogger(): Logger {
  return als.getStore()?.log ?? getRootLogger();
}

/** El request_id del scope actual, o `undefined` si no hay store (fuera de withRoute). */
export function getRequestId(): string | undefined {
  return als.getStore()?.requestId;
}
