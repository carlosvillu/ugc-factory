// `/projects` (T5.10, §8.1): el índice de proyectos con su CRUD mínimo. RSC delgado
// (architecture.md §1.3): fetch de la lista vía api-server → componer el gestor cliente.
// El CRUD (crear/editar/archivar) se muta por API REST desde el componente cliente.
import type { Metadata } from 'next';
import { ProjectListSchema } from '@ugc/core/contracts';
import { api } from '@/lib/api-server';
import { ProjectsManager } from '@/components/dashboard/projects-manager';

export const metadata: Metadata = {
  title: 'Proyectos · UGC Factory',
  description: 'Los productos/campañas: crea, edita y archiva proyectos',
};

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const { projects } = await api.get('/api/projects', ProjectListSchema);
  return (
    <main className="mx-auto flex max-w-(--content-max) flex-col gap-6 px-8 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold tracking-h1 text-text">Proyectos</h1>
        <p className="max-w-2xl text-body text-text-2">
          Un proyecto agrupa los briefs, lotes y variantes de un producto o campaña.
        </p>
      </header>
      <ProjectsManager initialProjects={projects} />
    </main>
  );
}
