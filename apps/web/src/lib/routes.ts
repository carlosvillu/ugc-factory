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
 * Los 8 destinos de la nav: los 6 DEL MOCKUP 2a (`docs/mockups/dashboard.html`) + «Personas»
 * (T2.0) + «Runs» (T1.17).
 *
 * Se muestran todos aunque 3 no existan aún (decisión del usuario): el mockup es vinculante,
 * enseñan a dónde va el producto, y —al ir deshabilitados— nunca llevan a una página rota.
 *
 * ⚠ «PERSONAS» ES UNA DESVIACIÓN DELIBERADA DEL MOCKUP, APROBADA POR EL USUARIO (T2.0). El
 * mockup 2a dibuja 6 destinos; este es el séptimo. Por qué:
 *
 *   · `/personas` EXISTE HOY y está completa (CRUD, imágenes de referencia, voz por idioma). Una
 *     página que funciona entera y a la que solo se llega TECLEANDO la URL es exactamente la
 *     queja que originó T1.13 («solo veo la home, no he visto absolutamente nada»).
 *   · Y NO cabía en «Biblioteca»: **Biblioteca ≠ Personas.** «Biblioteca» es el área de F2
 *     (guiones y variantes) y sigue deshabilitada esperando a su fase; darle `href` ahora
 *     afirmaría que ese área existe. Son dos cosas distintas.
 *
 * Va JUNTO a «Biblioteca» porque conceptualmente son los RECURSOS REUTILIZABLES del producto
 * (los avatares que protagonizan los anuncios, y los guiones/variantes que los visten), frente a
 * los destinos de flujo (Canvas) y de resultado (Galería, Métricas, Gasto).
 *
 * ⚠ «RUNS» ES LA SEGUNDA DESVIACIÓN DEL MOCKUP (T1.17), y nace de un fallo de uso REAL: tras
 * lanzar un run no había forma de volver a él ni de ver los anteriores — solo existía
 * `/runs/[id]`, al que se llegaba TECLEANDO el ULID. Exactamente la misma queja que originó
 * T1.13, un nivel más abajo. El dashboard completo (que sí dibuja el mockup) es T5.10, en F5:
 * demasiado lejos para algo que bloquea el uso diario.
 *
 * «Canvas» y «Runs» NO son lo mismo y por eso son dos entradas: **Canvas es el VERBO, Runs es
 * el SUSTANTIVO.** Canvas apunta al intake (`/analyses/new` → POST /api/runs → `/runs/:id`):
 * es la puerta por la que NACE un pipeline. Runs es dónde VIVEN los que ya lanzaste. Fundirlas
 * obligaría a elegir una sola URL para la entrada, y cualquiera de las dos dejaría la otra mitad
 * del flujo sin acceso desde la nav.
 */
export const DESTINATIONS: Destination[] = [
  { label: 'Inicio', href: '/' },
  {
    label: 'Canvas',
    cardTitle: 'Nuevo análisis',
    href: '/analyses/new',
    // ⚠ `/runs` YA NO ESTÁ AQUÍ (T1.17), y es un cambio deliberado. Hasta ahora «Canvas» se
    // resaltaba dentro de un run porque era el único destino que reclamaba esa área — no había
    // otro. Con «Runs» existiendo, `/runs/:id` pertenece a SU área: es un run del listado, al
    // que se llega DESDE el listado. Si «Canvas» conservara el prefijo, DOS entradas de la nav
    // se resaltarían a la vez estando en `/runs` (Canvas por prefijo, Runs por igualdad) — y
    // «estás por aquí» dejaría de señalar UN sitio, que es lo único que la señal significa.
    matches: ['/analyses'],
    description:
      'Pega la URL del producto (o descríbelo con tus palabras) y arranca el pipeline: se extrae la landing, se miran las imágenes y se sintetiza el brief.',
  },
  {
    // «Runs» (T1.17): el listado de pipelines lanzados. Es la entrada que faltaba — la nota 2 de
    // T1.13 ya declaró el hueco: tras lanzar un run no había forma de VOLVER a él ni de ver los
    // anteriores (solo existía `/runs/[id]`, y solo se llegaba tecleando el ULID).
    //
    // Va JUSTO DESPUÉS de «Canvas» porque es su continuación natural en el flujo: Canvas lanza
    // un pipeline, Runs es dónde viven todos los que lanzaste. `matches: ['/runs']` hace que el
    // canvas de un run (`/runs/:id`) resalte ESTA entrada — el canvas de un run es un run.
    label: 'Runs',
    href: '/runs',
    matches: ['/runs'],
    description:
      'Los pipelines lanzados: en qué estado está cada uno, qué ha costado y acceso directo a su canvas.',
  },
  {
    label: 'Personas',
    href: '/personas',
    description:
      'Los avatares que protagonizan los anuncios: demografía, personalidad, voz por idioma e imágenes de referencia del identity lock.',
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
