// `GET /api/projects` + `POST /api/projects` (T5.10, §8.1: CRUD mínimo de proyectos).
// La API REST de proyectos, NUEVA en T5.10: el PRD §8.1 nombra el CRUD y las páginas
// `/` y `/projects/[id]`, pero el Apéndice E no listaba las firmas (las cierra esta
// tarea, mismo patrón CRUD `[...]` que gallery/personas). Todo dato del dashboard entra
// por aquí — NADA de server actions ni de lecturas directas a BD desde las páginas
// (architecture.md §3/§4).
//
// GET: la lista de proyectos con su recuento de lotes (para el índice y la sección de
// proyectos del dashboard). Lectura ⇒ sin boss/tx.
// POST: crea un proyecto (nombre + locale/notas opcionales). Muta ⇒ withRoute (+ withAuth).
import { CreateProjectSchema, ProjectListSchema } from '@ugc/core/contracts';
import { createProject, listProjects, batchCountsByProject } from '@ugc/db';
import { withRoute, getDb, getRequestLogger } from '@/server';
import { withAuth } from '@/server/with-auth';
import { serializeProject } from '@/server/project-serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAuth(
  withRoute(async () => {
    const db = getDb();
    const [projects, counts] = await Promise.all([listProjects(db), batchCountsByProject(db)]);
    const withCounts = projects.map((p) => ({
      ...serializeProject(p),
      batchCount: counts.get(p.id)?.batchCount ?? 0,
      activeBatchCount: counts.get(p.id)?.activeBatchCount ?? 0,
    }));
    // Serializar = contrato de core (un drift repo↔contrato revienta aquí, en test).
    return Response.json(ProjectListSchema.parse({ projects: withCounts }));
  }),
);

export const POST = withAuth(
  withRoute(
    async ({ body }) => {
      const created = await createProject(getDb(), {
        name: body.name,
        // Campos opcionales: `undefined` deja el default de la BD (locale 'es').
        ...(body.defaultLocale !== undefined && { defaultLocale: body.defaultLocale }),
        ...(body.notes !== undefined && { notes: body.notes ?? null }),
      });
      getRequestLogger().info({ project_id: created.id }, 'proyecto creado');
      return Response.json(serializeProject(created), { status: 201 });
    },
    { body: CreateProjectSchema },
  ),
);
