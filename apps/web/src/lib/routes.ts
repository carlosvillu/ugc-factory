// Los destinos de la app, EN UN SOLO SITIO (T1.13).
//
// Antes de esta fuente de verdad, los destinos se declaraban DOS veces con forma distinta:
// en la nav global (`components/nav/app-nav.tsx`) y en las tarjetas de la home
// (`app/(app)/page.tsx`). Peor: el comentario de la home decía «los que aún no tienen página
// ya se ven en la nav global: no se repiten aquí» — un invariante entre dos ficheros que
// NINGÚN tipo garantizaba. Con esto, ese invariante lo sostiene el compilador: la home
// filtra por `href !== null` sobre la MISMA lista que pinta la nav.
//
// Consecuencia práctica (y es la promesa que esta tarea deja escrita): **activar un destino
// cuando cierre su fase es darle `href`**. Biblioteca (F2), Galería (F5) y Métricas (F6) se
// encienden solas —en la nav Y en la home— con una línea de este fichero.

export interface Destination {
  /** El label del mockup. Es también el texto visible y la base del nombre accesible. */
  label: string;
  /** `null` = la página aún no existe: se pinta deshabilitada con el motivo de `pending`. */
  href: string | null;
  /**
   * Prefijos de ruta que RESALTAN este destino, además de su propio `href` (`/runs/x` →
   * «Canvas»). Ojo: resaltar ≠ ser la página actual — ver `isHighlighted`/`isCurrentPage`.
   */
  matches?: string[];
  /**
   * Motivo por el que el destino aún no existe. Se compone en el NOMBRE ACCESIBLE del
   * elemento deshabilitado, así que se redacta como continuación del label: «Biblioteca ·
   * llega en la fase F2 (guiones y variantes)». Sin punto final ni paréntesis envolventes:
   * el nombre compuesto se lee de corrido en un lector de pantalla.
   */
  pending?: string;
  /** Qué se hace ahí. Lo usan las tarjetas de la home; la nav solo necesita el label. */
  description?: string;
  /**
   * Título de la TARJETA de la home, cuando el label de la nav no sirve como tal. La nav
   * nombra ÁREAS del producto («Canvas»); una tarjeta de la home invita a una ACCIÓN
   * («Nuevo análisis»). Es el único punto donde los dos consumidores necesitan textos
   * distintos, así que se declara aquí en vez de duplicar la lista entera.
   */
  cardTitle?: string;
}

/**
 * Los 6 destinos de la nav, EN EL ORDEN DEL MOCKUP 2a (`docs/mockups/dashboard.html`).
 *
 * Se muestran los 6 aunque 3 no existan aún (decisión del usuario): el mockup es vinculante,
 * enseñan a dónde va el producto, y —al ir deshabilitados— nunca llevan a una página rota.
 *
 * «Canvas» no tiene índice propio (un canvas es SIEMPRE el de un run concreto, `/runs/:id`):
 * su entrada apunta al intake, que es la puerta REAL por la que se llega hoy a un canvas
 * (`/analyses/new` → POST /api/runs → `/runs/:id`).
 */
export const DESTINATIONS: Destination[] = [
  { label: 'Inicio', href: '/' },
  {
    label: 'Canvas',
    cardTitle: 'Nuevo análisis',
    href: '/analyses/new',
    matches: ['/analyses', '/runs'],
    description:
      'Pega la URL del producto (o descríbelo con tus palabras) y arranca el pipeline: se extrae la landing, se miran las imágenes y se sintetiza el brief.',
  },
  { label: 'Biblioteca', href: null, pending: 'llega en la fase F2 (guiones y variantes)' },
  { label: 'Galería', href: null, pending: 'llega en la fase F5 (composición y export)' },
  { label: 'Métricas', href: null, pending: 'llega en la fase F6 (publicación y métricas)' },
  {
    label: 'Gasto',
    href: '/spend',
    description: 'Ledger de gasto por proveedor y día, presupuesto del mes y alertas.',
  },
];

/**
 * `/settings` y `/design-system` NO están en la nav del mockup. No se inventa una sección
 * nueva: van al lado DERECHO del topbar, que es exactamente el hueco que el mockup reserva
 * para la cuenta/config (allí dibuja el avatar). Son superficies de configuración y
 * referencia, no destinos de trabajo — por eso viven en su propia lista.
 *
 * El tipo estrecha `href` a `string`: una utilidad SIEMPRE existe (no hay «Ajustes que
 * llegan en F6»). Así el consumidor no tiene que desenvolver un `null` imposible.
 */
export const UTILITIES: (Destination & { href: string })[] = [
  {
    label: 'Design system',
    href: '/design-system',
    description: 'Muestrario de tokens y componentes: tema, acento y densidad en vivo.',
  },
  {
    label: 'Ajustes',
    href: '/settings',
    description: 'Credenciales de los proveedores, preferencias y apariencia de la interfaz.',
  },
];

/**
 * Las TARJETAS de la home: los destinos a los que HOY se puede ir, derivados de las listas de
 * arriba. Es lo que hace que el invariante «los destinos sin página no se repiten como
 * tarjetas muertas» lo sostenga el COMPILADOR y no un comentario: se filtra por
 * `href !== null` sobre la MISMA lista que pinta la nav.
 *
 * Se excluye la propia home (una tarjeta que enlaza a la página en la que ya estás no es un
 * destino). Y por eso «activar Biblioteca en F2» es, de verdad, darle `href`: aparece sola en
 * la nav Y en la home.
 */
export function homeEntries(): (Destination & { href: string })[] {
  return [...DESTINATIONS, ...UTILITIES].filter(
    (d): d is Destination & { href: string } => d.href !== null && d.href !== '/',
  );
}

// «Resaltado» y «página actual» son DOS PREGUNTAS DISTINTAS, y fusionarlas en un booleano
// hace que el `aria-current` MIENTA. Ejemplo real: estando en `/runs/01H…`, «Canvas» debe
// verse RESALTADO (estás dentro de su área: el canvas de un run cuelga de ahí), pero NO es
// la página actual — su href es `/analyses/new`, un formulario de intake vacío. Con un solo
// booleano, un lector de pantalla anunciaría «Canvas, página actual» y al activarlo el
// usuario aterrizaría en un sitio que no es donde creía estar. Se separan:

/**
 * RESALTADO VISUAL: la ruta ES el destino o CUELGA de uno de sus prefijos de área
 * (`/runs/x` → Canvas). Es la señal de «estás por aquí».
 */
export function isHighlighted(pathname: string, dest: Destination): boolean {
  if (dest.href === null) return false; // un destino sin página nunca está en curso
  if (pathname === dest.href) return true;
  return (dest.matches ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * `aria-current="page"`: IGUALDAD EXACTA con el href del destino, y nada más. Solo se
 * anuncia «página actual» cuando activar ese enlace te dejaría donde ya estás.
 */
export function isCurrentPage(pathname: string, dest: Destination): boolean {
  return dest.href !== null && pathname === dest.href;
}
