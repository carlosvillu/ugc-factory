// `GET /api/projects/:id` + `PATCH /api/projects/:id` (T5.10, §8.1). La fuente REST de
// la vista de proyecto `/projects/[id]` (briefs + lotes + métricas) y su edición.
//
// GET: el detalle del proyecto (404 si no existe). Lectura ⇒ sin boss/tx.
// PATCH: edita el proyecto — nombre/locale/notas y `status` (archivar/reactivar). El
//   ARCHIVAR es el "delete" de CRUD mínimo (schema/project: `archived` = "retirado sin
//   borrarlo"); NO se hace DELETE físico, que cascadearía url_analysis → product_brief →
//   ad_batch → ad_variant y borraría anuncios reales. `:id` = ULID.
import { z } from 'zod';
import {
  AppError,
  ProjectDetailSchema,
  UlidSchema,
  UpdateProjectSchema,
} from '@ugc/core/contracts';
import { getProject, getProjectDetail, updateProject } from '@ugc/db';
import { withRoute, getDb, getRequestLogger } from '@/server';
import { withAuth } from '@/server/with-auth';
import { serializeProject } from '@/server/project-serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const GET = withAuth(
  withRoute(
    async ({ params }) => {
      const db = getDb();
      // En paralelo: `getProjectDetail` no depende de `getProject`, solo del id. Si el
      // proyecto no existe, el detalle sale vacío y el 404 de abajo lo descarta igual.
      const [project, detail] = await Promise.all([
        getProject(db, params.id),
        getProjectDetail(db, params.id),
      ]);
      if (project === undefined) throw new AppError('not_found', 'proyecto no encontrado');
      return Response.json(
        ProjectDetailSchema.parse({ project: serializeProject(project), ...detail }),
      );
    },
    { params: ParamsSchema },
  ),
);

export const PATCH = withAuth(
  withRoute(
    async ({ params, body }) => {
      const updated = await updateProject(getDb(), params.id, {
        name: body.name,
        defaultLocale: body.defaultLocale,
        status: body.status,
        // `notes` es `.nullish()`: `undefined` = no tocar, `null` = limpiar. El guard es
        // LOAD-BEARING — sin él `notes ?? null` convertiría el "no tocar" (undefined) en un
        // "limpiar" (null) por error. Drizzle (mapUpdateSet) descarta las claves undefined,
        // así que los otros campos van directos.
        ...(body.notes !== undefined && { notes: body.notes ?? null }),
      });
      if (updated === undefined) throw new AppError('not_found', 'proyecto no encontrado');
      getRequestLogger().info({ project_id: params.id }, 'proyecto actualizado');
      return Response.json(serializeProject(updated));
    },
    { params: ParamsSchema, body: UpdateProjectSchema },
  ),
);
