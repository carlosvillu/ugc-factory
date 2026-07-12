'use client';

// Navegación global (T1.13). Hasta ahora la app SOLO era navegable escribiendo las URLs a
// mano: la home era un `<h1>` suelto y ninguna página enlazaba con otra.
//
// EL LAYOUT SALE DEL MOCKUP VINCULANTE `docs/mockups/dashboard.html` (variante 2a, skill
// frontend §4b): topbar HORIZONTAL — marca a la izquierda, `<nav>` con los 6 destinos pegado
// a ella, y a la derecha el hueco de cuenta/config. NO es un rail lateral (el CSS
// `.railitem` del mockup pertenece a otra variante y está muerto en la 2a).
//
// El DS NO tiene primitiva de navegación (solo `Tabs`, que es para paneles), así que el
// `<header>/<nav>` semántico a mano es el camino correcto: no hay primitiva que saltarse.
//
// QUÉ destinos hay y CÓMO se resuelve el activo NO viven aquí: son `lib/routes.ts`, la
// fuente de verdad que este fichero comparte con la home. Aquí solo se PINTA.
//
// Es client component por una sola razón: `usePathname()`. No hay más estado.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { DESTINATIONS, UTILITIES, isCurrentPage, isHighlighted } from '@/lib/routes';

const ITEM =
  'rounded-md border border-transparent px-3 py-1.75 text-mono font-medium transition-colors';

interface NavLinkProps {
  href: string;
  label: string;
  /** `aria-current="page"`: SOLO en igualdad exacta. Lo resuelve el call site. */
  current: boolean;
  /** Señal VISUAL de «estás por aquí» (puede ser cierta SIN ser la página actual). */
  highlighted: boolean;
}

/**
 * Un destino navegable de la topbar. Recibe `current` y `highlighted` YA RESUELTOS: son dos
 * preguntas distintas (ver `lib/routes.ts`) y contestarlas es cosa del llamante — este
 * componente solo pinta el resultado. En las UTILIDADES ambas coinciden (una utilidad no
 * tiene «área» que resaltar), y eso queda explícito en su call site, que es donde se ve.
 */
function NavLink({ href, label, current, highlighted }: NavLinkProps) {
  return (
    <Link
      href={href}
      data-slot="app-nav-item"
      aria-current={current ? 'page' : undefined}
      data-highlighted={highlighted ? 'true' : undefined}
      className={cn(
        ITEM,
        'text-text-3 hover:text-text focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none',
        highlighted && 'border-border-2 bg-surface-3 font-semibold text-text',
      )}
    >
      {label}
    </Link>
  );
}

export function AppNav() {
  const pathname = usePathname();

  return (
    <header
      data-slot="app-nav"
      className="flex shrink-0 items-center justify-between gap-6 border-b border-border bg-surface px-5 py-2.75"
    >
      <div className="flex items-center gap-5.5">
        {/* Marca: cuadro de acento con el glifo interior del mockup. Enlaza a la home — la
            «forma de volver» desde cualquier página, incluida la del canvas. El glifo va con
            `bg-text-on-accent` (el mockup hardcodea `#fff`, que se rompería con el acento
            ámbar): el token es la traducción CORRECTA del mockup, no una desviación. */}
        <Link
          href="/"
          data-slot="app-nav-brand"
          className="flex items-center gap-2.25 rounded-md text-mono font-semibold text-text focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-sm bg-accent"
          >
            <span className="size-2.25 rounded-sm bg-text-on-accent" />
          </span>
          UGC Factory
        </Link>

        <nav aria-label="Navegación principal">
          <ul className="flex items-center gap-0.75">
            {DESTINATIONS.map((dest) => (
              <li key={dest.label}>
                {dest.href === null ? (
                  // Deshabilitado: `aria-disabled` + FUERA del orden de tabulación. No es un
                  // <a> sin href (perdería el rol de link) ni un <button> muerto: es un
                  // <span> con rol de link anunciado como deshabilitado. Se queda INLINE y
                  // NO entra en `NavLink`: es otro elemento, otro rol y otro contrato de
                  // a11y — fundirlos sería fingir que son la misma cosa.
                  //
                  // EL MOTIVO VIAJA EN EL NOMBRE ACCESIBLE (`aria-label`), no solo en el
                  // `title`: el `title` solo aparece con hover del RATÓN, así que quien
                  // navega con teclado o lector oiría «Biblioteca, enlace, deshabilitado»
                  // sin saber por qué ni cuándo llega. (Tampoco vale la primitiva Tooltip
                  // del DS: se dispara con hover Y FOCO, y un elemento no tabulable jamás
                  // recibe foco.)
                  <span
                    role="link"
                    aria-disabled="true"
                    aria-label={`${dest.label} · ${dest.pending ?? 'aún no disponible'}`}
                    data-slot="app-nav-item"
                    data-disabled="true"
                    title={dest.pending}
                    className={cn(ITEM, 'cursor-not-allowed text-text-4')}
                  >
                    {dest.label}
                  </span>
                ) : (
                  <NavLink
                    href={dest.href}
                    label={dest.label}
                    // Las dos preguntas, contestadas por SEPARADO: dentro de `/runs/x`,
                    // «Canvas» se RESALTA (estás en su área) pero NO es la página actual (su
                    // href es el intake, y activarlo te llevaría a un formulario vacío).
                    current={isCurrentPage(pathname, dest)}
                    highlighted={isHighlighted(pathname, dest)}
                  />
                )}
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <nav aria-label="Configuración">
        <ul className="flex items-center gap-0.75">
          {UTILITIES.map((util) => (
            <li key={util.label}>
              <NavLink
                href={util.href}
                label={util.label}
                // Una utilidad no declara `matches`: no tiene ÁREA que resaltar, así que
                // resaltado y página actual COINCIDEN por construcción. Explícito aquí, no
                // escondido dentro del componente.
                current={isCurrentPage(pathname, util)}
                highlighted={isCurrentPage(pathname, util)}
              />
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
