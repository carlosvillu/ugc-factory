import type { Metadata } from 'next';
import { AppearanceSwitchers } from '@/components/design-system/appearance-switchers';
import { FoundationSpecimens } from '@/components/design-system/foundation-specimens';

export const metadata: Metadata = {
  title: 'Design system · UGC Factory',
  description:
    'Fundaciones del design system: colores, tipografía, spacing, radios, sombras, glifos',
};

// Showcase of the design-system foundations. Server component: the specimens
// are static and read straight from the token classes; only the switcher bar
// is a client leaf ('use client'), which mutates data-theme/accent/density on
// <html> so the whole page re-themes live off the tokens.
export default function DesignSystemPage() {
  return (
    <main className="mx-auto flex max-w-(--content-max) flex-col gap-10 px-8 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold tracking-h1 text-text">Design system</h1>
        <p className="max-w-2xl text-body text-text-2">
          Fundaciones de UGC Factory volcadas desde el espejo de Claude Design. Cambia tema, acento
          y densidad con los controles; todo reacciona desde los tokens.
        </p>
      </header>

      <AppearanceSwitchers />

      <FoundationSpecimens />
    </main>
  );
}
