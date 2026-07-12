// Layout del route group `(app)` (T1.13): el chrome global — topbar de navegación —
// COMPARTIDO por todas las páginas autenticadas. `/login` queda FUERA del grupo (vive en
// `app/login/`), y por eso no hereda la nav: enseñar «Inicio · Canvas · …» a quien todavía
// no ha entrado sería enlazar a páginas que el proxy le va a rebotar.
//
// El paréntesis del nombre es lo que hace de esto un route group: NO añade segmento de URL.
// Las páginas siguen sirviéndose en `/`, `/spend`, `/settings`, `/runs/:id`… — ninguna URL
// cambia y ningún spec existente se toca. Los comentarios de `spend/page.tsx` y
// `settings/page.tsx` ya anticipaban este grupo («aún no existe; llega con su tarea»).
//
// Altura: `h-dvh` + columna flex, con el hijo en `min-h-0 flex-1`. El canvas del run
// (`/runs/:id`) es full-bleed y ocupa el alto restante bajo la nav (por eso `run-shell` pasó
// de `h-dvh` a `h-full`: quien fija el viewport es el layout, no la página); las páginas de
// documento (`/spend`, `/settings`, …) hacen scroll dentro de su región.
import type { ReactNode } from 'react';
import { AppNav } from '@/components/nav/app-nav';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      <AppNav />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
