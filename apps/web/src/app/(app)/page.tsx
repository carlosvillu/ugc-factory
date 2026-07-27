// Home `/` — el DASHBOARD real (T5.10, mockup 2a `docs/mockups/dashboard.html`). Sustituye
// la home mínima de T1.13 (que a propósito no pintaba KPIs «para no inventar ceros»): ahora
// que existen lotes, variantes y gasto real, el dashboard los muestra derivados del estado.
//
// RSC delgado (architecture.md §1.3): fetch del resumen vía api-server (cookie de sesión) →
// componer la vista. Todo dato entra por la API REST (`GET /api/dashboard`), nunca por la BD
// directa (architecture.md §3/§4).
//
// El h1 «UGC Factory» se conserva DENTRO de la vista (navigation.spec.ts lo exige como ancla
// de la home); el saludo del mockup es un h2 subordinado. `metadata.title` sigue siendo
// «Inicio · …» y la URL sigue siendo `/` — el nav y `navigation.spec.ts` esperan «Inicio».
import type { Metadata } from 'next';
import { DashboardSummarySchema } from '@ugc/core/contracts';
import { api } from '@/lib/api-server';
import { DashboardView } from '@/components/dashboard/dashboard-view';

export const metadata: Metadata = {
  title: 'Inicio · UGC Factory',
  description: 'Dashboard: lotes activos, gasto del mes, presupuesto y lo que requiere atención',
};

// Lee la BD (vía /api/dashboard) en cada carga: dinámica, sin caché.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const summary = await api.get('/api/dashboard', DashboardSummarySchema);
  return <DashboardView summary={summary} />;
}
