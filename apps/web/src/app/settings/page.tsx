// Página `/settings` (T0.14, Apéndice E). RSC delgado (architecture.md §1.3): fetch de
// la vista enmascarada vía api-server (cookie de sesión) + lectura de la cookie de
// apariencia → compone el formulario de credenciales/preferencias y los switchers de
// apariencia. La superficie de cuentas conectadas (TikTok/Meta) del PRD §18.1 es F7 —
// aquí solo lo que T0.14 entrega.
//
// Vive en `app/settings/` (fuera de un route group): el grupo `(dashboard)` con la nav
// lateral compartida aún no existe (llega con su tarea). Protegida por `withAuth` en el
// endpoint y por el proxy en la página.
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { SettingsViewSchema } from '@ugc/core/contracts';
import { api } from '@/lib/api-server';
import { APPEARANCE_COOKIE, parseAppearanceCookie } from '@/lib/appearance-cookie';
import { Card } from '@/components/ui/card';
import { SettingsForm } from '@/components/settings/settings-form';
import { AppearanceSettings } from '@/components/settings/appearance-settings';

export const metadata: Metadata = {
  title: 'Ajustes · UGC Factory',
  description: 'Credenciales de API, preferencias y apariencia del design system',
};

// Lee la BD (vía /api/settings) y la cookie en cada carga: dinámica, sin caché.
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [view, cookieStore] = await Promise.all([
    api.get('/api/settings', SettingsViewSchema),
    cookies(),
  ]);
  const appearance = parseAppearanceCookie(cookieStore.get(APPEARANCE_COOKIE)?.value);

  return (
    <main className="mx-auto flex max-w-(--content-max) flex-col gap-10 px-8 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold tracking-h1 text-text">Ajustes</h1>
        <p className="max-w-2xl text-body text-text-2">
          Credenciales de proveedores (cifradas en el servidor), preferencias por defecto y
          apariencia de la interfaz.
        </p>
      </header>

      <Card className="gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 font-semibold text-text">Apariencia</h2>
          <p className="text-small text-text-3">
            Tema, acento y densidad de la interfaz. Se aplican al instante y se recuerdan en este
            navegador.
          </p>
        </div>
        <AppearanceSettings initial={appearance} />
      </Card>

      <Card className="p-6">
        <SettingsForm initialView={view} />
      </Card>
    </main>
  );
}
