// `GET /api/spend` (T0.12, Apéndice E): el resumen del ledger de gasto que la página
// `/spend` pinta. Lectura estática server-computed (NO SSE): totales por día, por
// proveedor, gasto total, presupuesto vigente y la alerta (over-limit) — todo
// calculado en `getSpendSummary` (repo de db, sumas en SQL en céntimos enteros).
//
// Handler fino (api.md §1): delega en el repo y serializa con el contrato Zod de
// core (`SpendSummarySchema`) — el MISMO que valida la página. `withAuth` por fuera:
// no está en la allowlist, así que sin sesión es 401 antes de tocar la BD.
import { SpendSummarySchema } from '@ugc/core/contracts';
import { getSpendSummary } from '@ugc/db';
import { withRoute, getDb } from '@/server';
import { withAuth } from '@/server/with-auth';

// pg vive en el runtime Node, no en edge.
export const runtime = 'nodejs';
// Lee la BD en cada request (gasto vivo): jamás se cachea.
export const dynamic = 'force-dynamic';

export const GET = withAuth(
  withRoute(async () => {
    const summary = await getSpendSummary(getDb());
    // Serializar = contrato de core (drift repo↔contrato revienta aquí en test).
    return Response.json(SpendSummarySchema.parse(summary));
  }),
);
