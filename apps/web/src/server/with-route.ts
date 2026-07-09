// `withRoute` (api.md §1): un route handler hace exactamente cuatro cosas —
// parsear → validar → delegar en core → serializar. Este HOF factoriza la
// repetición: establece el scope ALS con `request_id`, lee JSON + safeParse en la
// frontera de ENTRADA, y mapea cualquier throw a envelope vía `toErrorResponse`.
//
// `JSON.parse`/`schema.parse` a pelo sobre la entrada está PROHIBIDO: un body
// malformado es un 400 tipado, no un 500 con stack. La SALIDA sí se serializa con
// `Schema.parse` en el handler (un fallo ahí es drift servidor↔contrato).
import { z } from 'zod';
import { AppError } from '@ugc/core/contracts';
import { getRootLogger } from './logger';
import { runWithRequestContext } from './request-context';
import { toErrorResponse } from './errors';

interface Ctx {
  params: Promise<Record<string, string>>; // params asíncrono en Next 16
}

export function withRoute<B = undefined, P = Record<string, string>>(
  handler: (input: { req: Request; body: B; params: P }) => Promise<Response>,
  schemas: { body?: z.ZodType<B>; params?: z.ZodType<P> } = {},
): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
    const log = getRootLogger().child({ request_id: requestId });
    return runWithRequestContext({ log, requestId }, async () => {
      try {
        const raw = await ctx.params;
        const params = (schemas.params ? parseOrThrow(schemas.params, raw) : raw) as P;
        const body = (
          schemas.body ? parseOrThrow(schemas.body, await readJson(req)) : undefined
        ) as B;
        return await handler({ req, body, params });
      } catch (err) {
        return toErrorResponse(err);
      }
    });
  };
}

/** safeParse de una frontera de entrada → `validation_error` 400 con details Zod.
 *  Interno por ahora; el webhook de fal (§5, T4.2) lo promoverá a export cuando lo
 *  consuma (knip veta el export anticipado sin consumidor). */
function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new AppError('validation_error', 'payload inválido', z.flattenError(r.error));
  }
  return r.data;
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError('validation_error', 'el body no es JSON');
  }
}
