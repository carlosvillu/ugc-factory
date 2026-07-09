// `withAuth` (api.md §1, §6): defensa en profundidad — el handler se protege a sí
// mismo aunque proxy.ts proteja las páginas. Compone POR FUERA de withRoute (un
// 401 no debe ni parsear el body). Es la barrera REAL de la API; el proxy es solo
// UX. Por eso withAuth no es opcional en ninguna ruta no exenta (allowlist §6).
//
// El 401 es testeable a nivel handler pasando (o no) el header `cookie`
// (testing/api.md §2.5). `toErrorResponse` es store-safe: aquí no hay scope ALS
// aún (withAuth va por fuera de withRoute).
import { AppError } from '@ugc/core/contracts';
import { requireSession } from './session';
import { toErrorResponse } from './errors';

export function withAuth<A extends unknown[]>(
  handler: (req: Request, ...rest: A) => Promise<Response>,
): (req: Request, ...rest: A) => Promise<Response> {
  return async (req: Request, ...rest: A): Promise<Response> => {
    if (!requireSession(req)) {
      return toErrorResponse(new AppError('unauthorized', 'sesión requerida'));
    }
    return handler(req, ...rest);
  };
}
