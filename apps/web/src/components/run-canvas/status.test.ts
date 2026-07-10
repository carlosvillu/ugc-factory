import { expect, test } from 'vitest';
import { visualGroupOf, formatCost, formatDuration, statusLabel } from './status';

test('el mapeo 13→grupo visual distingue failed y skipped (Verificación)', () => {
  // La Verificación exige VER failed y skipped distintos de succeeded/pending:
  // el mapeo NO puede colapsarlos.
  expect(visualGroupOf('failed')).toBe('failed');
  expect(visualGroupOf('expired')).toBe('failed');
  expect(visualGroupOf('skipped')).toBe('skipped');
  expect(visualGroupOf('succeeded')).toBe('done');
  expect(visualGroupOf('waiting_approval')).toBe('checkpoint');
  expect(visualGroupOf('running')).toBe('running');
  expect(visualGroupOf('pending')).toBe('pending');
  expect(visualGroupOf('awaiting_deps')).toBe('pending');
});

test('todos los 13 estados tienen etiqueta y grupo (exhaustivo)', () => {
  const all = Object.keys(statusLabel) as (keyof typeof statusLabel)[];
  expect(all).toHaveLength(13);
  for (const s of all) {
    expect(statusLabel[s]).toBeTruthy();
    expect(visualGroupOf(s)).toBeTruthy();
  }
});

test('formatCost: céntimos → dólares, null → —', () => {
  expect(formatCost(0)).toBe('$0.00');
  expect(formatCost(12)).toBe('$0.12');
  expect(formatCost(3840)).toBe('$38.40');
  expect(formatCost(null)).toBe('—');
  expect(formatCost(undefined)).toBe('—');
});

test('formatDuration: ms → texto corto, null → —', () => {
  expect(formatDuration(null)).toBe('—');
  expect(formatDuration(820)).toBe('820ms');
  expect(formatDuration(5100)).toBe('5.1s');
  expect(formatDuration(63000)).toBe('1m 03s');
});
