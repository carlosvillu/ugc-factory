// Tests de las funciones PURAS de la vista de galería (T3.8): resaltado de slots, validación en
// vivo y diff v2↔v1. Son las cláusulas DETERMINISTAS de la Verificación de T3.8 («editar un slot
// inválido muestra el error»; «diff visible v2 vs v1») convertidas en red permanente del gate
// (implementer regla 3): si el resaltado o el diff se rompen, ESTO se pone rojo, no solo el E2E.
import { describe, expect, it } from 'vitest';
import { CANONICAL_SLOTS } from './canonical-variables';
import { diffLines, invalidBodySlots, splitBodySlots } from './gallery-view';

describe('splitBodySlots — resaltado de slots §10.4', () => {
  it('trocea texto y slots, marcando cada slot como válido/ inválido', () => {
    const segs = splitBodySlots('Hola {product.name}, mira {producto.nombre}.');
    expect(segs).toEqual([
      { kind: 'text', value: 'Hola ' },
      { kind: 'slot', token: 'product.name', valid: true },
      { kind: 'text', value: ', mira ' },
      { kind: 'slot', token: 'producto.nombre', valid: false },
      { kind: 'text', value: '.' },
    ]);
  });

  it('reconoce el slot indexado de beneficio (§10.4) como válido', () => {
    const segs = splitBodySlots('{benefit[0]} y {benefit[2]}');
    const slots = segs.filter((s): s is Extract<typeof s, { kind: 'slot' }> => s.kind === 'slot');
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.valid)).toBe(true);
  });

  it('un body sin slots es un único segmento de texto', () => {
    expect(splitBodySlots('sin slots aquí')).toEqual([{ kind: 'text', value: 'sin slots aquí' }]);
  });

  it('acepta CADA slot canónico §10.4 como válido (contrato compartido con el compilador)', () => {
    for (const slot of CANONICAL_SLOTS) {
      const segs = splitBodySlots(`{${slot}}`);
      expect(segs).toEqual([{ kind: 'slot', token: slot, valid: true }]);
    }
  });
});

describe('invalidBodySlots — validación EN VIVO', () => {
  it('devuelve solo los slots que NO son §10.4 (feedback del editor)', () => {
    expect(invalidBodySlots('{product.name} {nope} {benefit.primary} {typo.field}')).toEqual([
      'nope',
      'typo.field',
    ]);
  });

  it('un body con todos los slots canónicos no tiene inválidos', () => {
    expect(invalidBodySlots('{product.name} usa {benefit.primary} en {platform}')).toEqual([]);
  });
});

describe('diffLines — diff v2 vs v1 (LCS, sin librería)', () => {
  it('una línea cambiada aparece como del (v1) + add (v2)', () => {
    const d = diffLines('línea A\nlínea B\nlínea C', 'línea A\nlínea B EDITADA\nlínea C');
    expect(d).toEqual([
      { op: 'same', text: 'línea A' },
      { op: 'del', text: 'línea B' },
      { op: 'add', text: 'línea B EDITADA' },
      { op: 'same', text: 'línea C' },
    ]);
  });

  it('una línea añadida al final es un add', () => {
    const d = diffLines('a\nb', 'a\nb\nc');
    expect(d).toEqual([
      { op: 'same', text: 'a' },
      { op: 'same', text: 'b' },
      { op: 'add', text: 'c' },
    ]);
  });

  it('bodies idénticos no producen ningún cambio (todo same)', () => {
    const d = diffLines('x\ny\nz', 'x\ny\nz');
    expect(d.every((l) => l.op === 'same')).toBe(true);
    expect(d).toHaveLength(3);
  });

  it('el diff SIEMPRE contiene al menos un add o del cuando los bodies difieren (la Verificación exige diff visible)', () => {
    const d = diffLines('cuerpo original v1', 'cuerpo modificado v2');
    expect(d.some((l) => l.op === 'add' || l.op === 'del')).toBe(true);
  });
});
