// Página `/personas` (T2.0, mockup 6c): la librería de avatares (PRD §11).
//
// RSC delgado (architecture.md §1.3): fetch de la librería vía api-server (que reenvía la cookie
// de sesión) → componer el cliente. Estática al cargar: la librería no es estado vivo (no hay
// SSE aquí), y toda mutación pasa por la API REST y actualiza el estado del cliente.
//
// Vive en el route group `app/(app)/`: hereda el chrome global (la topbar del mockup 2a). El
// paréntesis no añade segmento — la URL sigue siendo `/personas`.
import type { Metadata } from 'next';
import { PersonaListSchema } from '@ugc/core/persona';
import { api } from '@/lib/api-server';
import { PersonasLibrary } from '@/components/personas/personas-library';

export const metadata: Metadata = {
  title: 'Personas · UGC Factory',
  description: 'Librería de avatares sintéticos: demografía, personalidad, voz e identity lock',
};

// Lee la BD (vía /api/personas) en cada carga: dinámica, sin caché.
export const dynamic = 'force-dynamic';

export default async function PersonasPage() {
  const { personas } = await api.get('/api/personas', PersonaListSchema);

  return (
    <main className="mx-auto flex max-w-(--content-max) flex-col gap-6 px-8 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold tracking-h1 text-text">Personas</h1>
        <p className="max-w-2xl text-body text-text-2">
          Avatares sintéticos reutilizables entre lotes. Su demografía y personalidad se inyectan en
          el casting del prompt; sus imágenes de referencia (2K o más) son el identity lock que
          mantiene la misma cara entre escenas.
        </p>
      </header>
      <PersonasLibrary initialPersonas={personas} />
    </main>
  );
}
