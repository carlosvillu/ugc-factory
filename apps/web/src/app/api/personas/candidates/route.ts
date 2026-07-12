// `GET /api/personas/candidates?avatar_hint=…` — T2.0 (PRD §11 «Recomendación»: «en N4, el
// `avatar_hint` de cada segmento de audiencia del brief sugiere personas compatibles»).
//
// El CONSUMIDOR real es el compositor de matriz de T2.2 (que compone «ángulos × hooks × personas
// …» y necesita saber QUÉ personas propone para cada segmento). Nace aquí, en T2.0, porque es la
// tarea que crea las personas y su Verificación lo exige literalmente («el endpoint de candidatas
// devuelve la persona correcta para un `avatar_hint` compatible y ninguna para uno incompatible»).
//
// EL HANDLER ES UN PASSTHROUGH (api.md §1): la REGLA de matching es lógica pura y vive en
// `@ugc/core/persona` (`matchPersonas`), donde se testea sin BD y donde T2.2 la reutilizará.
// Aquí solo se lee la librería y se serializa — cero lógica de negocio.
//
// RUTA ESTÁTICA junto a `[id]`: en el App Router un segmento literal (`candidates`) gana siempre
// al dinámico, así que `/api/personas/candidates` NUNCA se confunde con `/api/personas/:id`
// (que además exige un ULID y rechazaría «candidates» con un 400).
import { z } from 'zod';
import { AppError } from '@ugc/core/contracts';
import { matchPersonas, PersonaCandidateListSchema } from '@ugc/core/persona';
import { listPersonas } from '@ugc/db';
import { getDb, withRoute } from '@/server';
import { toPersonaResponse } from '@/server/persona-response';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El query param, validado como todo lo demás. Un hint vacío es 400: pedir candidatas «para
 *  nada» no significa nada, y devolver la librería entera sería una respuesta que miente. */
const QuerySchema = z.object({ avatar_hint: z.string().min(1) });

export const GET = withAuth(
  withRoute(async ({ req }) => {
    const url = new URL(req.url);
    const { avatar_hint: avatarHint } = parseQuery(url.searchParams);

    const personas = (await listPersonas(getDb())).map(toPersonaResponse);
    const candidates = matchPersonas(personas, avatarHint);

    return Response.json(PersonaCandidateListSchema.parse({ candidates }));
  }),
);

/** `safeParse` sobre la ENTRADA (api.md §1: nunca `.parse` a pelo sobre input del cliente): un
 *  query param ausente es un 400 tipado, no un 500 con stack trace. */
function parseQuery(params: URLSearchParams): z.infer<typeof QuerySchema> {
  const result = QuerySchema.safeParse({ avatar_hint: params.get('avatar_hint') ?? undefined });
  if (!result.success) {
    throw new AppError('validation_error', 'falta el parámetro `avatar_hint`', {
      formErrors: ['Indica un `avatar_hint` (la pista de avatar del segmento del brief)'],
      fieldErrors: {},
    });
  }
  return result.data;
}
