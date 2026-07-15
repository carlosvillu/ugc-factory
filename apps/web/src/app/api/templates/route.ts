// `GET /api/templates` (lista facetada de `/gallery`) + `POST /api/templates` (nuevo template) —
// T3.8, PRD §10.
//
// Handler FINO (api.md §1): parsear query → delegar en el repo de galería → serializar con el
// MISMO schema que re-valida el api-client. La búsqueda facetada la sirve el GIN de T3.1 (`@>`);
// aquí solo se traduce el querystring a un `TemplateFilter`.
//
// EL QUERYSTRING de facetas es multi-valor por faceta separado por comas (`?formats=grwm,pov`):
// `withRoute` normaliza el querystring con `Object.fromEntries`, que colapsa claves repetidas —
// así que se codifican como CSV en UNA clave, y el schema las trocea. Vacío ⇒ sin filtro de esa
// faceta.
import { z } from 'zod';
import {
  PromptStatusSchema,
  PromptTemplateSeedSchema,
  TemplateListSchema,
} from '@ugc/core/gallery';
import { createTemplate, listTemplates } from '@ugc/db';
import { AppError } from '@ugc/core/contracts';
import { getDb, withRoute } from '@/server';
import { toTemplateSummary } from '@/server/template-response';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Trocea un CSV de faceta (`grwm,pov`) en la lista de valores; vacío/ausente ⇒ undefined. */
const csvFacet = z
  .string()
  .optional()
  .transform((s) =>
    s
      ? s
          .split(',')
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : undefined,
  );

/** El querystring de la lista facetada. Cada faceta es un CSV opcional; `status` es un enum §10.2. */
const TemplateQuerySchema = z.object({
  formats: csvFacet,
  hookAngles: csvFacet,
  verticals: csvFacet,
  platforms: csvFacet,
  aesthetics: csvFacet,
  status: PromptStatusSchema.optional(),
});

export const GET = withAuth(
  withRoute(
    async ({ query }) => {
      const result = await listTemplates(getDb(), {
        formats: query.formats,
        hookAngles: query.hookAngles,
        verticals: query.verticals,
        platforms: query.platforms,
        aesthetics: query.aesthetics,
        status: query.status,
      });
      return Response.json(
        TemplateListSchema.parse({
          templates: result.templates.map(toTemplateSummary),
          facets: result.facets,
          statusCounts: result.statusCounts,
          total: result.total,
        }),
      );
    },
    { query: TemplateQuerySchema },
  ),
);

export const POST = withAuth(
  withRoute(
    async ({ body }) => {
      try {
        const row = await createTemplate(getDb(), body);
        return Response.json(toTemplateSummary(row), { status: 201 });
      } catch (err) {
        // El UNIQUE de `slug` es la clave natural del template (idempotencia del seed §10.2). Un
        // choque NO es un 500: es el usuario creando un template con un slug ya existente. Se
        // traduce a un `validation_error` anclado al campo `slug` (forms.md §3).
        if (isUniqueViolation(err)) {
          throw new AppError('validation_error', 'ya existe un template con ese slug', {
            formErrors: [],
            fieldErrors: { slug: ['Ya existe un template con ese slug'] },
          });
        }
        throw err;
      }
    },
    // El body de creación es el shape autoral del template (§10.1). El validador del seed ya
    // rechaza slots §10.4 inexistentes en el body; aquí se reusa el MISMO contrato Zod.
    { body: PromptTemplateSeedSchema },
  ),
);

/** SQLSTATE 23505 (unique_violation) — el error de pg viaja en `cause` del DrizzleQueryError. */
function isUniqueViolation(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } }).cause;
  return cause?.code === '23505';
}
