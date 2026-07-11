// `GET/PATCH /api/settings` (Apéndice E, T0.14): credenciales cifradas at-rest +
// preferencias. Handler fino (api.md §1): parsea → delega en el servicio → serializa con
// el contrato de core (`SettingsViewSchema`, el MISMO que valida la página /settings).
//
// GET devuelve la vista ENMASCARADA (nunca una key en claro — forms.md §6): el servicio
// descifra cada blob solo para derivar `last4`. PATCH cifra las keys presentes y las
// persiste (write-only: una key ausente no toca la credencial guardada). `withAuth` por
// fuera: no está en la allowlist, así que sin sesión es 401 antes de tocar la BD.
import { SettingsViewSchema, SettingsPatchSchema } from '@ugc/core/contracts';
import { withRoute, getDb, getSecretsKey } from '@/server';
import { withAuth } from '@/server/with-auth';
import { getSettingsView, applySettingsPatch } from '@/server/settings';

// pg + node:crypto viven en el runtime Node, no en edge.
export const runtime = 'nodejs';
// Lee/muta la BD en cada request (credenciales vivas): jamás se cachea.
export const dynamic = 'force-dynamic';

export const GET = withAuth(
  withRoute(async () => {
    const view = await getSettingsView(getDb(), getSecretsKey());
    // Serializar = contrato de core (drift servicio↔contrato revienta aquí en test).
    return Response.json(SettingsViewSchema.parse(view));
  }),
);

export const PATCH = withAuth(
  withRoute(
    async ({ body }) => {
      const view = await applySettingsPatch(getDb(), getSecretsKey(), body);
      return Response.json(SettingsViewSchema.parse(view));
    },
    { body: SettingsPatchSchema },
  ),
);
