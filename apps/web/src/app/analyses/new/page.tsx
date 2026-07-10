// Página `/analyses/new` (T1.6, N0): intake por TEXTO LIBRE. RSC delgado que resuelve
// el proyecto por defecto (mono-usuario, la gestión de proyectos es tarea posterior)
// y monta el formulario cliente. El submit va a `POST /api/analyses` (short-circuit
// manual, sin scraping) y navega al análisis creado/reutilizado.
//
// NO hay mockup vinculante para el intake (a diferencia de runs/spend): se sigue el
// design system (tokens) y las convenciones de forms.md, sin reviewer de mockup.
import type { Metadata } from 'next';
import { ensureDefaultProject } from '@ugc/db';
import { getDb } from '@/server';
import { IntakeForm } from '@/components/intake/intake-form';

export const metadata: Metadata = {
  title: 'Nuevo análisis · UGC Factory',
  description: 'Intake por texto libre: describe el producto y sube imágenes de referencia',
};

// Resuelve el proyecto por defecto en cada carga (puede crearlo): dinámica, sin caché.
export const dynamic = 'force-dynamic';

export default async function NewAnalysisPage() {
  const project = await ensureDefaultProject(getDb());

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold tracking-h1 text-text">Nuevo análisis</h1>
        <p className="text-body text-text-2">
          Describe el producto con tus palabras y, si quieres, añade imágenes de referencia. No hace
          falta una URL.
        </p>
      </header>
      <IntakeForm projectId={project.id} />
    </main>
  );
}
