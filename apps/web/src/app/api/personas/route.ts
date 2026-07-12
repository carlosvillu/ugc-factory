// `GET /api/personas` (la librería) + `POST /api/personas` (crear) — T2.0, PRD §11.
//
// Handler FINO (api.md §1): parsear → validar con el contrato de core → delegar en el repo →
// serializar con el MISMO schema que valida el api-client del navegador. Sin lógica de negocio:
// la única regla no-trivial de esta tarea (la recomendación por `avatar_hint`) es pura y vive en
// `@ugc/core/persona`; el endpoint que la usa es un passthrough (ver `candidates/route.ts`).
import { AppError } from '@ugc/core/contracts';
import { PersonaBodySchema, PersonaListSchema } from '@ugc/core/persona';
import { createPersona, listPersonas } from '@ugc/db';
import { getDb, withRoute } from '@/server';
import { toPersonaResponse } from '@/server/persona-response';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAuth(
  withRoute(async () => {
    const rows = await listPersonas(getDb());
    return Response.json(PersonaListSchema.parse({ personas: rows.map(toPersonaResponse) }));
  }),
);

export const POST = withAuth(
  withRoute(
    async ({ body }) => {
      try {
        const row = await createPersona(getDb(), body);
        return Response.json(toPersonaResponse(row), { status: 201 });
      } catch (err) {
        // El UNIQUE de `name` es la clave natural de la persona (y lo que hace idempotente al
        // seed). Un choque NO es un 500: es el usuario intentando crear una persona que ya
        // existe. Se traduce a un `validation_error` ANCLADO AL CAMPO `name`, para que el
        // formulario lo pinte donde el usuario puede arreglarlo (forms.md §3).
        if (isUniqueViolation(err)) {
          throw new AppError('validation_error', 'ya existe una persona con ese nombre', {
            formErrors: [],
            fieldErrors: { name: ['Ya existe una persona con ese nombre'] },
          });
        }
        throw err;
      }
    },
    { body: PersonaBodySchema },
  ),
);

/** SQLSTATE 23505 (unique_violation). El error de pg viaja en `cause` del DrizzleQueryError —
 *  mismo patrón que los tests de integración de db. */
function isUniqueViolation(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } }).cause;
  return cause?.code === '23505';
}
