// `GET /api/templates/:id` (la FICHA: template + versiones + guards que aplican) +
// `PATCH /api/templates/:id` (guardar una edición → crea `prompt_version` v2) — T3.8, PRD §10.
//
// La ficha resuelve, con la MISMA función pura que el compilador N6 (`resolveGuardPacks`, §9.5),
// qué guard packs aplican al template según sus facetas — no una lista hardcodeada. El PATCH
// re-valida el body contra la regla de slots §10.4 en la frontera del servidor: el cliente ya la
// aplicó EN VIVO, pero el servidor es la autoridad (un body con un slot inválido es un 400).
import { z } from 'zod';
import { AppError } from '@ugc/core/contracts';
import {
  TemplateEditResultSchema,
  TemplateEditSchema,
  TemplateWithVersionsSchema,
  invalidBodySlots,
  resolveGuardPacks,
} from '@ugc/core/gallery';
import { createTemplateVersion, getTemplateWithVersions, listGuardPacks } from '@ugc/db';
import { getDb, withRoute } from '@/server';
import {
  toAppliedGuardPack,
  toTemplateDetail,
  toTemplateVersion,
} from '@/server/template-response';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: z.string().min(1) });

export const GET = withAuth(
  withRoute(
    async ({ params }) => {
      const found = await getTemplateWithVersions(getDb(), params.id);
      if (!found) throw new AppError('not_found', 'template no encontrado');

      // Los guard packs que aplican (§9.5): se resuelven contra la primera vertical/plataforma
      // declarada del template — el mismo criterio de category+platform del compilador. Un
      // template agnóstico de vertical (verticals: []) solo recibe los general/fidelity.
      const packs = await listGuardPacks(getDb());
      const applied = resolveGuardPacks(
        packs.map((p) => ({
          key: p.key,
          scope: p.scope,
          vertical: p.vertical ?? undefined,
          platform: p.platform ?? undefined,
          lines: p.lines,
        })),
        {
          category: found.template.verticals[0],
          platform: found.template.platforms[0],
        },
      );

      return Response.json(
        TemplateWithVersionsSchema.parse({
          template: toTemplateDetail(found.template),
          versions: found.versions.map(toTemplateVersion),
          appliedGuards: applied.map(toAppliedGuardPack),
        }),
      );
    },
    { params: ParamsSchema },
  ),
);

export const PATCH = withAuth(
  withRoute(
    async ({ params, body }) => {
      // FRONTERA DE SLOTS §10.4: el servidor NO confía en que el cliente ya validó. Un body con
      // un slot no canónico es un `validation_error` con el detalle de cuáles, para que la UI lo
      // ancle. Reusa `invalidBodySlots` (la MISMA regla del editor en vivo y del validador del
      // seed — una sola verdad, sin copias que deriven).
      const invalid = invalidBodySlots(body.body);
      if (invalid.length > 0) {
        throw new AppError('validation_error', 'el body usa slots no canónicos (§10.4)', {
          formErrors: [`Slots inválidos: ${invalid.map((s) => `{${s}}`).join(', ')}`],
          fieldErrors: { body: [`Slots inválidos: ${invalid.map((s) => `{${s}}`).join(', ')}`] },
        });
      }

      const result = await createTemplateVersion(getDb(), params.id, {
        body: body.body,
        beats: body.beats,
        guardPackKeys: body.guardPackKeys,
        changelog: body.changelog,
      });
      if (!result) throw new AppError('not_found', 'template no encontrado');

      // Devuelve el par (v_anterior, v_nueva) para que el cliente renderice el diff sin un
      // segundo GET, más el template ya en su nueva cabeza.
      return Response.json(
        TemplateEditResultSchema.parse({
          template: toTemplateDetail(result.template),
          previous: toTemplateVersion(result.previous),
          created: toTemplateVersion(result.created),
        }),
      );
    },
    { params: ParamsSchema, body: TemplateEditSchema },
  ),
);
