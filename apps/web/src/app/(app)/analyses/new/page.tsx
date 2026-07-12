// Página `/analyses/new` (N0): intake del análisis, en sus DOS modos (T1.10a). RSC
// delgado que resuelve el proyecto por defecto (mono-usuario, la gestión de proyectos
// es tarea posterior) y monta el selector de modo cliente:
//   - «Desde URL» (por defecto, el camino principal): arranca el run del DAG
//     N1→N2→N3 (`POST /api/runs`) y navega al canvas en vivo `/runs/:id`.
//   - «Texto libre» (T1.6): crea el análisis manual (`POST /api/analyses`, con su
//     caché §7.4) y arranca el mismo DAG sobre él.
//
// NO hay mockup vinculante para el intake (a diferencia de runs/spend): se sigue el
// design system (tokens + primitivas) y las convenciones de forms.md.
import type { Metadata } from 'next';
import { ensureDefaultProject } from '@ugc/db';
import { getDb } from '@/server';
import { IntakeTabs } from '@/components/intake/intake-tabs';

export const metadata: Metadata = {
  title: 'Nuevo análisis · UGC Factory',
  description: 'Intake del análisis: desde la URL del producto o describiéndolo con tus palabras',
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
          Pega la URL del producto y se extraerá todo lo necesario. Si no tienes URL, descríbelo con
          tus palabras.
        </p>
      </header>
      <IntakeTabs projectId={project.id} />
    </main>
  );
}
