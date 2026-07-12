// Home `/` (T1.13). ALCANCE DELIBERADAMENTE MÍNIMO: que la app sea NAVEGABLE. Hasta ahora
// esto era literalmente un `<h1>UGC Factory</h1>` y la única forma de llegar a cualquier
// página era escribir su URL a mano.
//
// El mockup vinculante (`docs/mockups/dashboard.html`, variante 2a) dibuja además KPIs del
// mes, «Lotes activos» con su progreso y un panel «Requiere atención» + presupuesto. NADA
// de eso se construye aquí, a propósito: es superficie de F2+ (no hay lotes, ni variantes
// aprobadas, ni coste medio por variante que enseñar todavía) y el dashboard completo tiene
// su propia tarea en el planning (T5.10). Inventar esos KPIs hoy sería pintar ceros o datos
// falsos. Lo que SÍ se toma del mockup —su chrome: la topbar de navegación— vive en el
// layout del grupo `(app)`.
//
// Queda entonces la puerta de entrada: el saludo y los accesos a lo que HOY existe. Los
// destinos NO se declaran aquí: salen de `lib/routes.ts`, la MISMA lista que pinta la nav
// (`homeEntries()` filtra los que aún no tienen página). Así, los destinos deshabilitados no
// pueden colarse como tarjetas muertas por descuido: lo impide el tipo, no un comentario.
import type { Metadata } from 'next';
import Link from 'next/link';
import { homeEntries } from '@/lib/routes';
import { Card, CardBody, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Inicio · UGC Factory',
  description: 'Punto de entrada: nuevo análisis, gasto, ajustes y design system',
};

export default function HomePage() {
  const entries = homeEntries();

  return (
    <main className="mx-auto flex max-w-(--content-max) flex-col gap-8 px-8 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold tracking-h1 text-text">UGC Factory</h1>
        <p className="max-w-2xl text-body text-text-2">
          Empieza por un análisis de producto: de ahí sale el brief, y del brief los anuncios.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-mono font-semibold text-text-2">Ir a</h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {entries.map((entry) => (
            <li key={entry.href}>
              {/* El link ENVUELVE la Card: la tarjeta entera es el área de click, y el
                  accessible name del link es su título + su descripción (un «ver más» suelto
                  no diría a dónde lleva). El foco se pinta sobre el link. */}
              <Link
                href={entry.href}
                data-slot="home-entry"
                className="block h-full rounded-lg focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Card className="h-full transition-colors hover:border-border-strong">
                  <CardBody className="flex flex-col gap-2">
                    {/* La nav nombra ÁREAS («Canvas»); una tarjeta invita a una ACCIÓN
                        («Nuevo análisis»). De ahí el `cardTitle` opcional. */}
                    <CardTitle>{entry.cardTitle ?? entry.label}</CardTitle>
                    <p className="text-mono text-text-3">{entry.description}</p>
                  </CardBody>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
