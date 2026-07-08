import type { HealthStatus } from '@ugc/core/contracts';
import { pingDb } from '@ugc/db';
import { getRootLogger } from '@/server/logger';

// El healthcheck corre en el runtime Node: pino y pg no existen en edge.
export const runtime = 'nodejs';
// El ping consulta Postgres en cada request: nunca se cachea (Next podría
// intentar prerender/cachear una route GET sin params).
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  // Correlación mínima por request (observability.md §3.2). El wrapper withRoute
  // completo (ALS + envelope de errores) llega con la capa API real (T0.4).
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const log = getRootLogger().child({ request_id: requestId, route: '/api/health' });

  // Ping compartido con timeouts cortos (@ugc/db): con Postgres caído devuelve
  // `false` rápido y sin lanzar — la app sigue respondiendo 200 en degradación.
  // El campo `db` es la mitad "trampa" de la Verificación de T0.2.
  const db = await pingDb({ connectionString: process.env.DATABASE_URL });

  // Import cruzado del contrato de core (T0.1): el `satisfies` es el canario de
  // compilación — un cambio de tipo en core rompe web. Sin parse runtime: validar
  // un literal propio es trabajo muerto (el safeParse vive en las fronteras de
  // ENTRADA, api.md).
  const health = { ok: true, db } satisfies HealthStatus;
  log.info({ health }, 'health check');

  return Response.json(health);
}
