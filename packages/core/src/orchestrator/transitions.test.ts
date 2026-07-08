// Test EXHAUSTIVO de la tabla de transiciones pura (§7.1): enumera TODAS las
// transiciones válidas y verifica que `nextStatus` las acepta con el destino
// correcto, y que CUALQUIER par fuera de esa lista es ilegal (`null`). Sin BD:
// esto es lógica pura y se prueba en la capa de core (testing tabla de decisión).
import { describe, expect, it } from 'vitest';
import { isLegalTransition, nextStatus, type StepEvent, type StepStatus } from './transitions';

// Todos los estados del enum (§7.1: los 13).
const ALL_STATUSES: StepStatus[] = [
  'awaiting_deps',
  'pending',
  'queued',
  'submitting',
  'running',
  'waiting_approval',
  'succeeded',
  'failed',
  'rejected',
  'skipped',
  'cancelled',
  'expired',
  'superseded',
];

// Todos los eventos.
const ALL_EVENTS: StepEvent[] = [
  'deps_satisfied',
  'enqueue',
  'start',
  'succeed',
  'fail',
  'retry',
  'expire',
  'reach_checkpoint',
  'approve',
  'approve_edited',
  'reject',
  'skip',
  'cancel',
  'supersede',
];

// La lista COMPLETA de transiciones válidas de §7.1, como fuente de verdad
// independiente de la tabla del código: si divergen, esta suite lo caza.
// Cada tupla es origen, evento y estado destino esperado.
const LEGAL: [StepStatus, StepEvent, StepStatus][] = [
  // §7.1.a: inicial awaiting_deps → pending cuando las deps se satisfacen.
  ['awaiting_deps', 'deps_satisfied', 'pending'],
  ['awaiting_deps', 'skip', 'skipped'],
  ['awaiting_deps', 'cancel', 'cancelled'],
  ['awaiting_deps', 'supersede', 'superseded'],
  // pending → queued (listo, se encola).
  ['pending', 'enqueue', 'queued'],
  ['pending', 'skip', 'skipped'],
  ['pending', 'cancel', 'cancelled'],
  ['pending', 'supersede', 'superseded'],
  // queued → running.
  ['queued', 'start', 'running'],
  ['queued', 'cancel', 'cancelled'],
  ['queued', 'supersede', 'superseded'],
  // running → succeeded/failed/expired/waiting_approval.
  ['running', 'succeed', 'succeeded'],
  ['running', 'fail', 'failed'],
  ['running', 'expire', 'expired'],
  ['running', 'reach_checkpoint', 'waiting_approval'],
  ['running', 'cancel', 'cancelled'],
  ['running', 'supersede', 'superseded'],
  // failed → queued (retry; legalidad no depende del contador).
  ['failed', 'retry', 'queued'],
  ['failed', 'cancel', 'cancelled'],
  ['failed', 'supersede', 'superseded'],
  // §7.1.b: waiting_approval → succeeded (aprobar / editar) / rejected (rechazar).
  ['waiting_approval', 'approve', 'succeeded'],
  ['waiting_approval', 'approve_edited', 'succeeded'],
  ['waiting_approval', 'reject', 'rejected'],
  ['waiting_approval', 'cancel', 'cancelled'],
  ['waiting_approval', 'supersede', 'superseded'],
];

describe('nextStatus: transiciones VÁLIDAS de §7.1 (exhaustivo)', () => {
  it.each(LEGAL)('%s --(%s)--> %s', (from, event, to) => {
    expect(nextStatus(from, event)).toBe(to);
    expect(isLegalTransition(from, event)).toBe(true);
  });
});

describe('nextStatus: TODO par fuera de la tabla es ILEGAL (null)', () => {
  // Producto cartesiano completo estado × evento MENOS las válidas: cada uno
  // debe devolver null. Esto es el "no spot-check": enumera el complemento entero.
  const legalKeys = new Set(LEGAL.map(([f, e]) => `${f}|${e}`));
  const illegal: [StepStatus, StepEvent][] = [];
  for (const from of ALL_STATUSES) {
    for (const event of ALL_EVENTS) {
      if (!legalKeys.has(`${from}|${event}`)) illegal.push([from, event]);
    }
  }

  it('la tabla tiene exactamente las transiciones válidas esperadas', () => {
    // 13 estados × 14 eventos = 182 pares; 23 válidos ⇒ 159 ilegales.
    expect(legalKeys.size).toBe(LEGAL.length);
    expect(illegal.length).toBe(ALL_STATUSES.length * ALL_EVENTS.length - LEGAL.length);
  });

  it.each(illegal)('%s --(%s)--> ✗', (from, event) => {
    expect(nextStatus(from, event)).toBeNull();
    expect(isLegalTransition(from, event)).toBe(false);
  });
});

describe('estados terminales: sin salida (§7.1)', () => {
  const TERMINAL: StepStatus[] = [
    'succeeded',
    'rejected',
    'skipped',
    'cancelled',
    'expired',
    'superseded',
  ];
  it.each(TERMINAL)('%s no admite ningún evento', (from) => {
    for (const event of ALL_EVENTS) {
      expect(nextStatus(from, event)).toBeNull();
    }
  });
});
