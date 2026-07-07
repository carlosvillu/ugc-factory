import type { HealthStatus } from '@ugc/core/contracts';
import { getRootLogger } from '@/server/logger';

// El healthcheck corre en el runtime Node: pino no existe en edge.
export const runtime = 'nodejs';

export function GET(request: Request): Response {
  // Correlación mínima por request (observability.md §3.2). El wrapper withRoute
  // completo (ALS + envelope de errores) llega con la capa API real (T0.4).
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const log = getRootLogger().child({ request_id: requestId, route: '/api/health' });

  // Import cruzado del contrato de core (T0.1): el `satisfies` es el canario de
  // compilación — un cambio de tipo en core rompe web. Sin parse runtime: validar
  // un literal propio es trabajo muerto (el safeParse vive en las fronteras de
  // ENTRADA, api.md). El campo `db` llega en T0.2 — no se anticipa.
  const health = { ok: true } satisfies HealthStatus;
  log.info({ health }, 'health check ok');

  return Response.json(health);
}
