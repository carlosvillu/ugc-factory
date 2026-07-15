// Los destinos de la app y la resolución del activo (T1.13).
//
// El test central es la SEPARACIÓN de «resaltado» y «página actual»: fusionarlas en un
// booleano hace que el `aria-current` MIENTA. Estando en `/runs/01H…`, un lector de pantalla
// anunciaría «Runs, página actual» y al activar el enlace el usuario saldría del run al que
// acaba de entrar (el href de «Runs» es el LISTADO) — no se quedaría donde creía estar.
//
//   · `isHighlighted` (visual): prefijo de ÁREA — `/runs/x` resalta «Runs» (T1.17; antes de que
//     el listado existiera, ese prefijo lo reclamaba «Canvas», que era el único que podía).
//   · `isCurrentPage` (aria-current): igualdad EXACTA con el href, y nada más.
//
// Y el invariante de la home: sus tarjetas se DERIVAN de la misma lista que pinta la nav, así
// que un destino sin página no puede colarse como tarjeta muerta.
import { describe, expect, it } from 'vitest';
import {
  DESTINATIONS,
  UTILITIES,
  homeEntries,
  isCurrentPage,
  isHighlighted,
  type Destination,
} from './routes';

// Los fixtures reflejan la config REAL de `routes.ts` (T1.17): «Canvas» YA NO reclama `/runs`
// —lo reclama «Runs», que ahora existe— y su área es solo la del intake.
const CANVAS: Destination = {
  label: 'Canvas',
  href: '/analyses/new',
  matches: ['/analyses'],
};
const RUNS: Destination = { label: 'Runs', href: '/runs', matches: ['/runs'] };
const GASTO: Destination = { label: 'Gasto', href: '/spend' };
const INICIO: Destination = { label: 'Inicio', href: '/' };
// Un destino DESHABILITADO para los tests genéricos de «un destino sin página nunca se resalta».
// Antes era «Galería», pero desde T3.8 Galería es navegable (`/gallery`): «Biblioteca» sigue sin
// página (llega en F2), así que asume el papel de fixture-deshabilitado.
const BIBLIOTECA: Destination = { label: 'Biblioteca', href: null, pending: 'F2' };
const GALERIA: Destination = { label: 'Galería', href: '/gallery', matches: ['/gallery'] };
const RUN_ID = '/runs/01J000000000000000000000';

describe('isHighlighted (resaltado visual del destino)', () => {
  it('resalta el destino cuya ruta ES la actual', () => {
    expect(isHighlighted('/spend', GASTO)).toBe(true);
    expect(isHighlighted('/', INICIO)).toBe(true);
  });

  it('«Canvas» se resalta dentro de su área (el intake), no solo en su href', () => {
    expect(isHighlighted('/analyses/new', CANVAS)).toBe(true);
    expect(isHighlighted('/analyses/01J000000000000000000000', CANVAS)).toBe(true);
    expect(isHighlighted('/spend', CANVAS)).toBe(false);
  });

  it('«Runs» se resalta DENTRO del canvas de un run: el canvas de un run ES un run (T1.17)', () => {
    expect(isHighlighted('/runs', RUNS)).toBe(true);
    expect(isHighlighted(RUN_ID, RUNS)).toBe(true);
    // …y «Canvas» ya NO: su área es el intake. Antes de T1.17 reclamaba `/runs` porque era el
    // único destino que podía; con «Runs» existiendo, ese prefijo es de «Runs».
    expect(isHighlighted(RUN_ID, CANVAS)).toBe(false);
  });

  it('un prefijo NO resalta por coincidencia parcial de string', () => {
    // `/spending` empieza por `/spend` como TEXTO, pero no cuelga de él como RUTA.
    expect(isHighlighted('/spending', GASTO)).toBe(false);
    // `/` es prefijo textual de todo: la home solo se resalta en la home exacta.
    expect(isHighlighted('/settings', INICIO)).toBe(false);
  });

  it('un destino sin página (deshabilitado) nunca se resalta', () => {
    expect(isHighlighted('/', BIBLIOTECA)).toBe(false);
  });

  it('«Galería» se resalta en su área (T3.8): /gallery activa el destino', () => {
    expect(isHighlighted('/gallery', GALERIA)).toBe(true);
    expect(isHighlighted('/spend', GALERIA)).toBe(false);
  });
});

describe('isCurrentPage (aria-current="page")', () => {
  it('SOLO con igualdad exacta: activar el enlace debe dejarte donde ya estás', () => {
    expect(isCurrentPage('/spend', GASTO)).toBe(true);
    expect(isCurrentPage('/analyses/new', CANVAS)).toBe(true);
    expect(isCurrentPage('/', INICIO)).toBe(true);
  });

  it('NO se anuncia «página actual» por estar dentro del ÁREA del destino', () => {
    // El hallazgo que motivó separar los dos booleanos. Sigue vivo con «Runs» (T1.17): dentro
    // del canvas de un run, «Runs» se RESALTA (estás en su área) pero NO es la página actual
    // —su href es el LISTADO, y activarlo te sacaría del run al que has entrado—. Con un solo
    // booleano, un lector de pantalla anunciaría «Runs, página actual» estando en un canvas.
    expect(isHighlighted(RUN_ID, RUNS)).toBe(true);
    expect(isCurrentPage(RUN_ID, RUNS)).toBe(false);
    expect(isCurrentPage('/analyses/01J000000000000000000000', CANVAS)).toBe(false);
  });

  it('un destino sin página nunca es la página actual', () => {
    expect(isCurrentPage('/', BIBLIOTECA)).toBe(false);
  });
});

describe('DESTINATIONS (los 6 del mockup 2a + «Personas» + «Runs»)', () => {
  // ⚠ ESTA LISTA HA CAMBIADO DOS VECES, LAS DOS A PROPÓSITO. El mockup 2a dibuja SEIS destinos
  // y aquí hay OCHO:
  //   · «Personas» (T2.0): la página existe hoy y funciona entera; dejarla accesible solo
  //     tecleando la URL era la queja que originó T1.13. No cabía en «Biblioteca» (área de F2,
  //     guiones y variantes, aún deshabilitada): Biblioteca ≠ Personas.
  //   · «Runs» (T1.17): tras lanzar un run no había forma de volver a él ni de ver los
  //     anteriores. El dashboard del mockup es T5.10 (F5) — demasiado lejos para algo que
  //     bloquea el uso diario.
  //
  // El test sigue ENUMERANDO la lista completa en orden, y así debe quedarse: su trabajo es
  // cazar el próximo destino que alguien añada sin pensarlo. Un «hay al menos N destinos» no
  // cazaría nada.
  it('están los 8, en orden (los 6 del mockup + Runs tras Canvas + Personas junto a Biblioteca)', () => {
    expect(DESTINATIONS.map((d) => d.label)).toEqual([
      'Inicio',
      'Canvas',
      'Runs',
      'Personas',
      'Biblioteca',
      'Galería',
      'Métricas',
      'Gasto',
    ]);
  });

  // EL INVARIANTE QUE PROTEGE EL CAMBIO DE T1.17. «Estás por aquí» solo significa algo si
  // señala UN sitio: si dos entradas de la nav se resaltan a la vez, la señal deja de informar.
  // Y ese empate es EXACTAMENTE lo que pasaría si alguien devolviera `/runs` a los `matches` de
  // «Canvas» (Canvas por prefijo + Runs por igualdad) — un cambio de una línea, invisible en
  // cualquier test de «la lista tiene 8 destinos». Este test lo caza.
  it('NINGUNA ruta resalta dos destinos a la vez (la señal «estás por aquí» señala UNO)', () => {
    const paths = [
      '/',
      '/analyses/new',
      '/analyses/01J000000000000000000000',
      '/runs',
      RUN_ID,
      '/personas',
      '/gallery',
      '/spend',
      '/settings',
      '/design-system',
    ];
    for (const path of paths) {
      const highlighted = [...DESTINATIONS, ...UTILITIES].filter((d) => isHighlighted(path, d));
      expect(
        highlighted.map((d) => d.label),
        `ruta ${path}`,
      ).toHaveLength(1);
    }
  });

  it('«Biblioteca» SIGUE deshabilitada: Personas no la activa (es otra área, la de F2)', () => {
    const biblioteca = DESTINATIONS.find((d) => d.label === 'Biblioteca');
    expect(biblioteca?.href).toBeNull();
    expect(biblioteca?.pending).toMatch(/fase F2/);

    const personas = DESTINATIONS.find((d) => d.label === 'Personas');
    expect(personas?.href).toBe('/personas');
  });

  it('todo destino sin página declara POR QUÉ y en qué fase llega', () => {
    // El motivo acaba en el NOMBRE ACCESIBLE del elemento deshabilitado: sin él, un lector
    // anunciaría «Biblioteca, enlace, deshabilitado» y nada más.
    for (const dest of DESTINATIONS.filter((d) => d.href === null)) {
      expect(dest.pending).toMatch(/fase F\d/);
    }
  });
});

describe('homeEntries (las tarjetas de la home)', () => {
  it('NO incluye destinos sin página: el invariante lo sostiene el tipo, no un comentario', () => {
    const labels = homeEntries().map((e) => e.label);
    expect(labels).not.toContain('Biblioteca');
    expect(labels).not.toContain('Métricas');
  });

  it('NO incluye la propia home (una tarjeta a la página en la que ya estás no es destino)', () => {
    expect(homeEntries().map((e) => e.href)).not.toContain('/');
  });

  it('incluye los destinos navegables Y las utilidades, todos con descripción', () => {
    const labels = homeEntries().map((e) => e.label);
    expect(labels).toContain('Canvas');
    // Personas tiene página: aparece como tarjeta SOLA, sin tocar la home. Es la promesa de
    // T1.13 («activar un destino es darle href») cobrada por primera vez.
    expect(labels).toContain('Personas');
    expect(labels).toContain('Gasto');
    expect(labels).toContain('Ajustes');
    expect(labels).toContain('Design system');
    for (const entry of homeEntries()) expect(entry.description).toBeTruthy();
  });

  it('las utilidades SIEMPRE tienen página (no hay «Ajustes que llegan en F6»)', () => {
    for (const util of UTILITIES) expect(util.href).not.toBeNull();
  });
});
