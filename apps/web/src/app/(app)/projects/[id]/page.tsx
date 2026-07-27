// `/projects/[id]` (T5.10, §8.1): la vista de un proyecto — briefs, lotes, variantes y
// métricas. RSC delgado (architecture.md §1.3): fetch del detalle vía api-server → componer
// la vista. `notFound()` si el proyecto no existe (404 del endpoint). `:id` = ULID.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProjectDetailSchema } from '@ugc/core/contracts';
import { ApiError } from '@/lib/api-client';
import { api } from '@/lib/api-server';
import { ProjectDetailView } from '@/components/dashboard/project-detail-view';

export const metadata: Metadata = {
  title: 'Proyecto · UGC Factory',
  description: 'Briefs, lotes, variantes y métricas del proyecto',
};

export const dynamic = 'force-dynamic';

interface ProjectPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { id } = await params;

  let detail;
  try {
    detail = await api.get(`/api/projects/${id}`, ProjectDetailSchema);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e; // el resto lo captura error.tsx
  }

  return <ProjectDetailView detail={detail} />;
}
