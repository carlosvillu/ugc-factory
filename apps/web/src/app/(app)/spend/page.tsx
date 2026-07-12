// Página `/spend` (T0.12, mockup 8a): panel de gasto v1. RSC delgado
// (architecture.md §1.3): fetch del resumen vía api-server (cookie de sesión) →
// componer el panel. Estático al cargar (NO SSE): el gasto es server-computed en
// cada carga (sumas + alerta over-limit), no en vivo.
//
// Vive en el route group `app/(app)/` (T1.13): hereda el chrome global (la topbar de
// navegación del mockup del dashboard). El paréntesis no añade segmento: la URL sigue
// siendo `/spend`. El panel COMPLETO (vistas por proyecto/lote/tier, freno, email,
// umbrales-%) es T7.7 — esto es solo el esqueleto.
import type { Metadata } from 'next';
import { SpendSummarySchema } from '@ugc/core/contracts';
import { api } from '@/lib/api-server';
import { SpendPanel } from '@/components/spend/spend-panel';

export const metadata: Metadata = {
  title: 'Gasto · UGC Factory',
  description: 'Ledger de gasto: totales por día y proveedor, presupuesto y alertas',
};

// Lee la BD (vía /api/spend) en cada carga: dinámica, sin caché.
export const dynamic = 'force-dynamic';

export default async function SpendPage() {
  const summary = await api.get('/api/spend', SpendSummarySchema);

  return (
    <main className="mx-auto flex max-w-(--content-max) flex-col gap-6 px-8 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold tracking-h1 text-text">Gasto</h1>
        <p className="max-w-2xl text-body text-text-2">
          Presupuesto mensual y ledger de gasto por proveedor y día.
        </p>
      </header>
      <SpendPanel summary={summary} />
    </main>
  );
}
