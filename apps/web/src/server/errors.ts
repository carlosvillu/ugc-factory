// Mapeo AppError→envelope HTTP en UN solo sitio (api.md §2). Todo error de la capa
// API sale por aquí: envelope único `{code, message, details?, request_id}`, nunca
// un throw sin formato. El 500 es SIEMPRE opaco (el mensaje interno puede contener
// rutas, SQL o keys) — el detalle va al log, no al cliente.
import { ZodError } from 'zod';
import { AppError, type ErrorEnvelope } from '@ugc/core/contracts';
import { getRequestId, getRequestLogger } from './request-context';

export function toErrorResponse(err: unknown): Response {
  const request_id = getRequestId(); // del scope ALS si existe; undefined fuera de withRoute

  if (err instanceof AppError) {
    return Response.json(
      {
        code: err.code,
        message: err.message,
        details: err.details,
        request_id,
      } satisfies ErrorEnvelope,
      { status: err.status },
    );
  }

  // Cualquier otra cosa es un 500 opaco (el mensaje interno puede llevar rutas, SQL
  // o keys). Un ZodError crudo aquí NO es culpa del cliente: la ENTRADA ya llega
  // convertida a AppError por withRoute (parseOrThrow), así que un Zod suelto es
  // drift de SALIDA o de datos internos — bug nuestro. Solo cambia el evento de log.
  const event = err instanceof ZodError ? 'zod_contract_drift' : 'unhandled_route_error';
  getRequestLogger().error({ err, request_id }, event);
  return Response.json(
    { code: 'internal', message: 'error interno', request_id } satisfies ErrorEnvelope,
    { status: 500 },
  );
}
