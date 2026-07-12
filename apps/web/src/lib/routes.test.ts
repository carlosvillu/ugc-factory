// Los destinos de la app y la resolución del activo (T1.13).
//
// El test central es la SEPARACIÓN de «resaltado» y «página actual»: fusionarlas en un
// booleano hace que el `aria-current` MIENTA. Estando en `/runs/01H…`, un lector de pantalla
// anunciaría «Canvas, página actual» y al activar el enlace el usuario aterrizaría en un
// formulario de intake VACÍO — no donde creía estar.
//
//   · `isHighlighted` (visual): prefijo de ÁREA — `/runs/x` resalta «Canvas».
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

const CANVAS: Destination = {
  label: 'Canvas',
  href: '/analyses/new',
  matches: ['/analyses', '/runs'],
};
const GASTO: Destination = { label: 'Gasto', href: '/spend' };
const INICIO: Destination = { label: 'Inicio', href: '/' };
const GALERIA: Destination = { label: 'Galería', href: null, pending: 'F5' };
const RUN_ID = '/runs/01J000000000000000000000';

describe('isHighlighted (resaltado visual del destino)', () => {
  it('resalta el destino cuya ruta ES la actual', () => {
    expect(isHighlighted('/spend', GASTO)).toBe(true);
    expect(isHighlighted('/', INICIO)).toBe(true);
  });

  it('«Canvas» se resalta DENTRO de un run o de un análisis, no solo en su href', () => {
    expect(isHighlighted('/analyses/new', CANVAS)).toBe(true);
    expect(isHighlighted(RUN_ID, CANVAS)).toBe(true);
    expect(isHighlighted('/analyses/01J000000000000000000000', CANVAS)).toBe(true);
    expect(isHighlighted('/spend', CANVAS)).toBe(false);
  });

  it('un prefijo NO resalta por coincidencia parcial de string', () => {
    // `/spending` empieza por `/spend` como TEXTO, pero no cuelga de él como RUTA.
    expect(isHighlighted('/spending', GASTO)).toBe(false);
    // `/` es prefijo textual de todo: la home solo se resalta en la home exacta.
    expect(isHighlighted('/settings', INICIO)).toBe(false);
  });

  it('un destino sin página (deshabilitado) nunca se resalta', () => {
    expect(isHighlighted('/', GALERIA)).toBe(false);
  });
});

describe('isCurrentPage (aria-current="page")', () => {
  it('SOLO con igualdad exacta: activar el enlace debe dejarte donde ya estás', () => {
    expect(isCurrentPage('/spend', GASTO)).toBe(true);
    expect(isCurrentPage('/analyses/new', CANVAS)).toBe(true);
    expect(isCurrentPage('/', INICIO)).toBe(true);
  });

  it('NO se anuncia «página actual» por estar dentro del ÁREA del destino', () => {
    // El hallazgo que motivó separar los dos booleanos: dentro de un run, «Canvas» se
    // RESALTA (estás en su área) pero NO es la página actual (su href es el intake, y
    // activarlo te llevaría a un formulario vacío).
    expect(isHighlighted(RUN_ID, CANVAS)).toBe(true);
    expect(isCurrentPage(RUN_ID, CANVAS)).toBe(false);
    expect(isCurrentPage('/analyses/01J000000000000000000000', CANVAS)).toBe(false);
  });

  it('un destino sin página nunca es la página actual', () => {
    expect(isCurrentPage('/', GALERIA)).toBe(false);
  });
});

describe('DESTINATIONS (los 6 del mockup 2a + «Personas»)', () => {
  // ⚠ ESTA LISTA CAMBIÓ EN T2.0, A PROPÓSITO Y CON APROBACIÓN DEL USUARIO. El mockup 2a dibuja
  // SEIS destinos y aquí hay SIETE: `/personas` es una desviación deliberada del mockup, porque
  // la página existe hoy, funciona entera, y dejarla accesible solo tecleando la URL es la queja
  // que originó T1.13. No cabía en «Biblioteca» (que es el área de F2 —guiones y variantes— y
  // sigue deshabilitada): Biblioteca ≠ Personas.
  //
  // El test sigue ENUMERANDO la lista completa en orden, y así debe quedarse: su trabajo es
  // cazar el próximo destino que alguien añada sin pensarlo. Un «hay al menos N destinos» no
  // cazaría nada.
  it('están los 7, en orden (los 6 del mockup + Personas junto a Biblioteca)', () => {
    expect(DESTINATIONS.map((d) => d.label)).toEqual([
      'Inicio',
      'Canvas',
      'Personas',
      'Biblioteca',
      'Galería',
      'Métricas',
      'Gasto',
    ]);
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
    expect(labels).not.toContain('Galería');
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
