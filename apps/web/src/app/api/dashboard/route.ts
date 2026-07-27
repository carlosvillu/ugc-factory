// `GET /api/dashboard` (T5.10, §8.1): los agregados que pinta el dashboard `/` — gasto
// del mes, lotes activos, presupuesto, «requiere atención» y variantes aprobadas del
// mes. TODO server-computed en una carga (getDashboardSummary), derivado de datos reales
// (ledger, ad_batch/ad_variant, step_run) — nada de ceros falsos.
//
// Endpoint de AGREGACIÓN nuevo (T5.10). El Apéndice E no lo listaba explícitamente;
// existe porque la mezcla de fuentes (ledger + lotes + checkpoints) no se compone
// honestamente desde los endpoints sueltos sin varios round-trips y N+1. Anotado como
// desviación del Apéndice E (regla 6) en el informe de la tarea.
import { DashboardSummarySchema } from '@ugc/core/contracts';
import { getDashboardSummary } from '@ugc/db';
import { withRoute, getDb } from '@/server';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAuth(
  withRoute(async () => {
    const summary = await getDashboardSummary(getDb());
    return Response.json(DashboardSummarySchema.parse(summary));
  }),
);
