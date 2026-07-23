// Página `/library` (T5.7, mockup 4c `docs/mockups/library.html`): la BIBLIOTECA de vídeos terminados —
// las variantes aprobadas con su preview (safe zones conmutables), su linaje completo (hook line,
// template@version, persona, máster) y la descarga del bundle (MP4 + metadatos de compliance).
//
// RSC delgado (architecture.md §1.3, patrón `/gallery`): fetch de la lista aprobada vía api-server (que
// reenvía la cookie de sesión) → componer el cliente. La lista es estática al cargar; seleccionar una
// variante pide su linaje por REST y descargar es un `<a href>` directo al bundle. Sin SSE: la biblioteca
// es un resultado curado, no estado vivo de un run.
//
// Vive en el route group `app/(app)/`: hereda el chrome global (la topbar). La URL es `/library`.
import type { Metadata } from 'next';
import { LibraryListSchema } from '@ugc/core/contracts';
import { api } from '@/lib/api-server';
import { LibraryBrowser } from '@/components/library/library-browser';

export const metadata: Metadata = {
  title: 'Biblioteca · UGC Factory',
  description:
    'Los vídeos terminados: preview con safe zones, linaje completo (hook, template, persona, máster) y descarga del bundle (MP4 + metadatos de compliance).',
};

// Lee la BD (vía /api/library) en cada carga: dinámica, sin caché.
export const dynamic = 'force-dynamic';

export default async function LibraryPage() {
  const initial = await api.get('/api/library', LibraryListSchema);

  return (
    <main className="mx-auto flex max-w-(--content-max) flex-col gap-6 px-8 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold tracking-h1 text-text">Biblioteca de vídeos</h1>
        <p className="max-w-2xl text-body text-text-2">
          Las variantes aprobadas y listas para publicar: filtra por objetivo, idioma y plataforma,
          abre una para ver su preview con las safe zones, su linaje completo (del máster hasta el
          hook line y el template) y descarga el bundle con sus metadatos de compliance.
        </p>
      </header>
      <LibraryBrowser initial={initial.variants} />
    </main>
  );
}
