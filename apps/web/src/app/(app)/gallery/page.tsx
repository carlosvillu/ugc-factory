// Página `/gallery` (T3.8, mockup 5a): la galería de templates de prompt (PRD §10).
//
// RSC delgado (architecture.md §1.3): fetch de la lista facetada vía api-server (que reenvía la
// cookie de sesión) → componer el cliente. Estática al cargar; toda mutación (crear, editar →
// v2, cambiar estado) pasa por la API REST y actualiza el estado del cliente. Sin SSE aquí: la
// galería es una lista curada, no estado vivo de un run.
//
// Vive en el route group `app/(app)/`: hereda el chrome global (la topbar). El paréntesis no
// añade segmento — la URL sigue siendo `/gallery`.
import type { Metadata } from 'next';
import { TemplateListSchema } from '@ugc/core/gallery';
import { api } from '@/lib/api-server';
import { GalleryBrowser } from '@/components/gallery/gallery-browser';

export const metadata: Metadata = {
  title: 'Galería · UGC Factory',
  description:
    'Galería de templates de prompt: navegación facetada, ficha con slots resaltados y guards, editor con validación en vivo y versiones con diff.',
};

// Lee la BD (vía /api/templates) en cada carga: dinámica, sin caché.
export const dynamic = 'force-dynamic';

export default async function GalleryPage() {
  const initial = await api.get('/api/templates', TemplateListSchema);

  return (
    <main className="mx-auto flex max-w-(--content-max) flex-col gap-6 px-8 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold tracking-h1 text-text">Galería de templates</h1>
        <p className="max-w-2xl text-body text-text-2">
          Templates de prompt curados: cada uno lleva un cuerpo con slots canónicos, beats
          temporizados y los guard packs que el compilador inyecta. Filtra por formato, ángulo,
          vertical y estado; edita un template para crear una versión nueva con su diff.
        </p>
      </header>
      <GalleryBrowser initial={initial} />
    </main>
  );
}
