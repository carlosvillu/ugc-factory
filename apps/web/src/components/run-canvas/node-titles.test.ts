import { expect, test } from 'vitest';
import { canonicalNodeKey, nodeBadgeLabel, nodeTitle, NODE_TITLES } from './node-titles';

// Los títulos son los del PRD §7.2 y coinciden con los que el DS ya pinta en su
// PipelineScreen (`code="N1" title="Ingesta"`, `code="N3 · CP1" title="ProductBrief"`…).
test('resuelve el título humano de las claves canónicas del PRD §7.2 / del DS', () => {
  expect(nodeTitle('N1')).toBe('Ingesta');
  expect(nodeTitle('N2')).toBe('Análisis visual');
  expect(nodeTitle('N3')).toBe('ProductBrief');
  // El DS abrevia «Estrategia»; el PRD §7.2 dice «Estrategia del lote» y el PRD manda.
  expect(nodeTitle('N4')).toBe('Estrategia del lote');
  expect(nodeTitle('N7c')).toBe('Clip de avatar');
});

test('cubre N0–N11 (el pipeline entero del §7.2), no solo los nodos que ya existen', () => {
  for (const key of ['N0', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9', 'N10', 'N11']) {
    expect(NODE_TITLES[key], `falta el título de ${key}`).toBeTruthy();
  }
});

test('un node_key PREFIJADO por el DAG resuelve por su clave canónica', () => {
  // El DAG de demo emite `demo.canvas.N2`: el título se resuelve por el último segmento.
  expect(canonicalNodeKey('demo.canvas.N2')).toBe('N2');
  expect(nodeTitle('demo.canvas.N2')).toBe('Análisis visual');
});

test('una clave desconocida se devuelve TAL CUAL (no se inventa título)', () => {
  expect(nodeTitle('X99')).toBe('X99');
  expect(nodeTitle('demo.canvas.N9')).toBe('QA'); // sí existe
});

// El badge del nodo sigue el patrón del DS: `N3 · CP1` mientras el checkpoint espera.
test('nodeBadgeLabel añade el `· CPn` solo cuando el step ES checkpoint', () => {
  expect(nodeBadgeLabel('N3', false)).toBe('N3');
  expect(nodeBadgeLabel('N3', true)).toBe('N3 · CP1');
  expect(nodeBadgeLabel('N4', true)).toBe('N4 · CP2');
  // Un checkpoint sobre un nodo SIN CP asignado (los de demo de F0) no inventa un número.
  expect(nodeBadgeLabel('demo.canvas.N1', true)).toBe('demo.canvas.N1');
});
