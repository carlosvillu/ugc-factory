import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import {
  APPEARANCE_COOKIE,
  appearanceDataAttrs,
  parseAppearanceCookie,
} from '@/lib/appearance-cookie';
import './globals.css';

export const metadata: Metadata = {
  title: 'UGC Factory',
  description: 'Plataforma personal de generación de anuncios UGC con IA',
};

// Geist / Geist Mono self-hosted via the `geist` package (no CDN). Their
// .variable class names expose --font-geist-sans / --font-geist-mono, which
// globals.css maps to --font-sans / --font-mono in @theme inline. This closes
// the ⚠ fonts note in docs/design-system/readme.md §Fonts.
// La apariencia (tema/acento/densidad) persiste en la cookie `ugc_appearance` y se
// estampa en `<html>` EN EL SERVIDOR (T0.14): los data-* llegan en el primer HTML, así
// el reload aplica la preferencia SIN flash de dark/indigo/balanced. Los defaults NO se
// estampan (coinciden con `:root` de globals.css) — SSR-clean, sin mismatch de
// hidratación (mismo criterio que apply-appearance.ts).
export default async function RootLayout({ children }: { children: ReactNode }) {
  const appearance = parseAppearanceCookie((await cookies()).get(APPEARANCE_COOKIE)?.value);
  return (
    <html
      lang="es"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      {...appearanceDataAttrs(appearance)}
    >
      <body>{children}</body>
    </html>
  );
}
