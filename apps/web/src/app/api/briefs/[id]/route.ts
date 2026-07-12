// `GET /api/briefs/:id` + `PATCH /api/briefs/:id` (T1.10b, Apéndice E: "Leer/editar
// ProductBrief (fuera de run activo)").
//
// ES EL CAMINO STANDALONE, y su diferencia con CP1 es LA razón de que exista:
//
//   - CP1 (dentro de un run) edita el brief a través del CHECKPOINT: `POST /api/steps/:id/edit`
//     → `editStep` (T0.8) → aprueba el step, invalida el sub-grafo aguas abajo y audita el diff
//     IA-vs-humano. El brief nuevo (v2) es un EFECTO de esa edición del step.
//   - AQUÍ NO HAY STEP. El usuario abre un brief ya aprobado, semanas después, sin run activo:
//     no hay nada que aprobar, nada aguas abajo que invalidar, ninguna máquina de estados que
//     tocar. Es un BUMP PURO de `product_brief.version` sobre el mismo `url_analysis_id` (v3).
//
// Meter esto por `editStep` sería un error de categoría (no existe el step); y hacer que CP1
// pase por aquí perdería la invalidación del sub-grafo. Son dos caminos porque son dos cosas —
// y comparten LO ÚNICO que deben compartir: `createBriefVersion`, el bump atómico del repo.
import { z } from 'zod';
import { AppError, ProductBriefSchema, UlidSchema } from '@ugc/core/contracts';
import { createBriefVersion, getBrief, type ProductBriefRow } from '@ugc/db';
import { withRoute, getDb, getRequestLogger } from '@/server';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

/**
 * Body del PATCH: el ProductBrief COMPLETO (Apéndice A), no un patch parcial.
 *
 * Es un PATCH sobre el RECURSO "brief de este producto" (cuya representación actual es la
 * última versión), no un merge de campos sueltos: el editor de CP1 tiene el brief entero en la
 * mano y lo manda entero. Un merge parcial obligaría a definir la semántica de borrado de cada
 * campo anidado (¿`benefits: []` vacía la lista o no la toca?) — complejidad sin cliente.
 *
 * Se VALIDA contra `ProductBriefSchema`: la BD guarda `data` como jsonb opaco, así que ESTA es
 * la única frontera que impide persistir un brief con forma inválida (5–10 ángulos, 2–3 hooks,
 * el bicondicional source_url⟺manual…). Sin ella, la UI podría guardar basura que reventaría
 * tres nodos más abajo, en F2.
 */
const PatchBodySchema = z.object({ brief: ProductBriefSchema });

/** Serializa una fila `product_brief` a JSON (las fechas van en ISO; `data` es el brief). */
function toResponse(row: ProductBriefRow): Record<string, unknown> {
  return {
    id: row.id,
    urlAnalysisId: row.urlAnalysisId,
    version: row.version,
    editedByUser: row.editedByUser,
    language: row.language,
    status: row.status,
    brief: row.data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const GET = withAuth(
  withRoute(
    async ({ params }) => {
      const row = await getBrief(getDb(), params.id);
      if (row === undefined) throw new AppError('not_found', 'brief no encontrado');
      return Response.json(toResponse(row));
    },
    { params: ParamsSchema },
  ),
);

/**
 * PATCH: crea la SIGUIENTE versión del brief (v3+) sobre el MISMO `url_analysis_id`.
 *
 * NO hace UPDATE in-place de la fila `:id`: el versionado es la garantía de que el linaje
 * IA→humano no se pierde (§19.1 mide cuánto corrige el humano a la IA; sobrescribir borraría
 * la evidencia). El `:id` de la URL identifica QUÉ brief se está editando —de él sale el
 * `url_analysis_id` sobre el que se versiona—, no la fila que se sobrescribe.
 *
 * La versión nueva nace `approved` + `edited_by_user:true`: la escribió el humano y la edición
 * standalone es, por definición, deliberada (no hay checkpoint que la apruebe después).
 */
export const PATCH = withAuth(
  withRoute(
    async ({ params, body }) => {
      const db = getDb();
      const current = await getBrief(db, params.id);
      if (current === undefined) throw new AppError('not_found', 'brief no encontrado');

      const next = await createBriefVersion(db, {
        urlAnalysisId: current.urlAnalysisId,
        data: body.brief,
        // El idioma es del ANÁLISIS, no de la edición: se hereda (editar un beneficio no
        // cambia el idioma en el que se analizó el producto).
        language: current.language,
        editedByUser: true,
        status: 'approved',
      });

      getRequestLogger().info(
        {
          brief_id: next.id,
          previous_brief_id: current.id,
          url_analysis_id: current.urlAnalysisId,
          version: next.version,
        },
        'brief editado fuera de run: versión nueva',
      );
      return Response.json(toResponse(next));
    },
    { params: ParamsSchema, body: PatchBodySchema },
  ),
);
