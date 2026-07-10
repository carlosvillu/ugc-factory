// Página del canvas del run (architecture.md §2.2): RSC delgado — fetch del objeto
// RUN por REST → provider → shell. Los STEPS NO se pre-cargan aquí: llegan por SSE
// (el primer frame `snapshot` los puebla en cuanto `useRunEvents` conecta). Split
// server/client: la página (server) solo compone; la frontera client la pone el
// wrapper `RunStoreProvider`/`RunShell` (`'use client'`). PROHIBIDO
// `dynamic(...,{ssr:false})` en un RSC (Next 16 lo rechaza).
import { notFound } from 'next/navigation';
import { UlidSchema } from '@ugc/core/contracts';
import { ApiError, RunResponseSchema } from '@/lib/api-client';
import { api } from '@/lib/api-server';
import { RunStoreProvider } from '@/stores/run-store';
import { RunShell } from '@/components/run-canvas/run-shell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RunPageProps {
  params: Promise<{ id: string }>;
}

export default async function RunPage({ params }: RunPageProps) {
  const { id } = await params;

  // Un id que no es un ULID válido es un 404 (recurso inexistente), no un 500: sin
  // esta guarda `GET /api/runs/:id` devolvería 400 validation_error (su ParamsSchema
  // valida ULID) y la página caería a error.tsx en vez de a notFound().
  if (!UlidSchema.safeParse(id).success) notFound();

  let run;
  try {
    run = await api.get(`/api/runs/${id}`, RunResponseSchema);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e; // el resto lo captura error.tsx
  }

  // El store se siembra con el objeto run (autopilot/kind/status/id); `steps` arranca
  // vacío y el SSE lo puebla. `RunResponse` es estructuralmente el `RunView` que el
  // store espera (mismos campos escalares).
  return (
    <RunStoreProvider initial={{ run }}>
      <RunShell runId={id} />
    </RunStoreProvider>
  );
}
