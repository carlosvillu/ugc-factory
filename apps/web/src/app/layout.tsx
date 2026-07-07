import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'UGC Factory',
  description: 'Plataforma personal de generación de anuncios UGC con IA',
};

// Geist / Geist Mono self-hosted via the `geist` package (no CDN). Their
// .variable class names expose --font-geist-sans / --font-geist-mono, which
// globals.css maps to --font-sans / --font-mono in @theme inline. This closes
// the ⚠ fonts note in docs/design-system/readme.md §Fonts.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
