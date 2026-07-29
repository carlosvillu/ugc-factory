// Unit tests del guard de higiene (T5.25). Testean la lógica PURA de conteo/parseo. El CONTROL
// NEGATIVO GENUINO contra Docker real (arrancar contenedores → el guard los cuenta → limpiarlos →
// guard limpio, Y un contenedor SIN la etiqueta de testcontainers NO se cuenta) NO cabe en la suite
// unitaria (arrancar contenedores es lento y depende del daemon), así que vive en el script
// reproducible `scripts/negctl-orphan-containers.sh` — se ejecuta a mano y su evidencia se pega en el
// report. Aquí probamos el parser con fixtures de `docker ps`, que es la pieza que podría mentir en
// silencio.
//
// El formato de la salida es `{{.ID}}\t{{.Names}}`: el finder ya filtra por
// `label=org.testcontainers=true`, pero el parser AÚN descarta por nombre cualquier infraestructura
// deliberada (ugc-postgres-dev) como defensa en profundidad — ese descarte es lo que estos fixtures
// verifican, porque es lo que impide el footgun de reiniciar la BD de desarrollo.
import { describe, it, expect } from 'vitest';
import { parseContainerIds, removeContainers } from './check-orphan-workers.mjs';

const row = (id, name) => `${id}\t${name}`;

describe('parseContainerIds — parser de `docker ps --format {{.ID}}\\t{{.Names}}`', () => {
  it('lista vacía cuando no hay contenedores', () => {
    expect(parseContainerIds('')).toEqual([]);
    expect(parseContainerIds('\n')).toEqual([]);
    expect(parseContainerIds('  \n  \n')).toEqual([]);
  });

  it('cuenta N IDs de una salida con N filas (el conteo que decide el aviso)', () => {
    const out =
      [
        row('a1b2c3d4e5f6', 'nice_feynman'),
        row('0987654321ab', 'hopeful_wilbur'),
        row('feedfacefeed', 'tender_edison'),
      ].join('\n') + '\n';
    const ids = parseContainerIds(out);
    expect(ids).toHaveLength(3);
    expect(ids).toEqual(['a1b2c3d4e5f6', '0987654321ab', 'feedfacefeed']);
  });

  it('ignora líneas en blanco y espacios (una sola fila real → 1, no 0)', () => {
    expect(parseContainerIds(`\n  ${row('deadbeef01', 'quirky_bohr')}  \n\n`)).toEqual([
      'deadbeef01',
    ]);
  });

  // EL CASO DEL FOOTGUN (correctness, code-review 2026-07-29): una fila cuyo nombre es
  // `ugc-postgres-dev` (la BD de desarrollo) NO se cuenta ni se limpia, aunque sea postgres:16. Belt
  // and suspenders sobre el filtro por label. Este es el test que prueba que el bug está muerto.
  it('DESCARTA ugc-postgres-dev por nombre (nunca es un huérfano — es la BD de desarrollo)', () => {
    const out =
      [
        row('7795be934cb6', 'peaceful_gould'), // testcontainer real → SÍ cuenta
        row('ae31bf42949f', 'ugc-postgres-dev'), // BD dev → NUNCA cuenta
      ].join('\n') + '\n';
    const ids = parseContainerIds(out);
    expect(ids).toEqual(['7795be934cb6']);
    expect(ids).not.toContain('ae31bf42949f');
  });

  it('si SOLO estuviera ugc-postgres-dev, el resultado es vacío (no un falso huérfano)', () => {
    expect(parseContainerIds(row('ae31bf42949f', 'ugc-postgres-dev') + '\n')).toEqual([]);
  });

  it('el fixture de la saturación real de T5.19 (51 testcontainers) cuenta 51', () => {
    const fixture =
      Array.from({ length: 51 }, (_, i) =>
        row(`c${i.toString(16).padStart(11, '0')}`, `tc_${i}`),
      ).join('\n') + '\n';
    expect(parseContainerIds(fixture)).toHaveLength(51);
  });
});

describe('removeContainers — fail-open ante un contenedor que ya no existe', () => {
  // CONTROL NEGATIVO del footgun: un `docker rm -f` en bloque LANZA si un id ya no está (un
  // testcontainer que terminó solo entre el snapshot y el rm). Sin fail-open, esa excepción MATA el
  // guard — lo que su cabecera prohíbe. Aquí inyectamos un `dockerRm` que lanza para UN id concreto
  // (simula el "No such container") y comprobamos que removeContainers NO propaga y cuenta lo real.
  it('un id inexistente en la lista NO lanza; devuelve el conteo realmente eliminado', () => {
    const gone = 'ghost0000000';
    const dockerRm = (id) => {
      if (id === gone) throw new Error('Error: No such container: ' + gone);
      return '';
    };
    let removed;
    expect(() => {
      removed = removeContainers(['a1b2c3d4e5f6', gone, 'feedfacefeed'], dockerRm);
    }).not.toThrow();
    expect(removed).toBe(2); // los 2 que sí existían; el ghost se ignora (fail-open)
  });

  it('lista vacía → 0 eliminados, sin tocar docker', () => {
    let called = 0;
    const dockerRm = () => {
      called++;
    };
    expect(removeContainers([], dockerRm)).toBe(0);
    expect(called).toBe(0);
  });

  it('si TODOS ya desaparecieron, no lanza y devuelve 0', () => {
    const dockerRm = () => {
      throw new Error('No such container');
    };
    expect(() => removeContainers(['x1', 'x2'], dockerRm)).not.toThrow();
    expect(removeContainers(['x1', 'x2'], dockerRm)).toBe(0);
  });
});
