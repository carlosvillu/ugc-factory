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
  'skip_inapplicable',
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
  // T1.10a: auto-skip del nodo INAPLICABLE, ya en ejecución. Respaldo del PRD:
  // §7.1 ("skipped (nodo no aplicable, p. ej. N2 sin imágenes)") y §7.2, ficha de
  // N2 ("Con source=manual ... si no hay ninguna → skipped"). Es un EVENTO NUEVO,
  // distinto del `skip` de usuario a propósito: `skip` (POST /api/steps/:id/skip)
  // sigue ILEGAL desde `running` — saltar un step EN VUELO abandonaría trabajo ya
  // pagado a mitad (una generación fal.ai en curso, F4). Ver el test de regresión
  // "el `skip` de USUARIO sigue prohibido desde running" más abajo.
  ['running', 'skip_inapplicable', 'skipped'],
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
    // 13 estados × 15 eventos = 195 pares; 24 válidos ⇒ 171 ilegales (T1.10a sumó
    // el evento `skip_inapplicable` y su único par legal: running → skipped).
    expect(legalKeys.size).toBe(LEGAL.length);
    expect(illegal.length).toBe(ALL_STATUSES.length * ALL_EVENTS.length - LEGAL.length);
  });

  it.each(illegal)('%s --(%s)--> ✗', (from, event) => {
    expect(nextStatus(from, event)).toBeNull();
    expect(isLegalTransition(from, event)).toBe(false);
  });
});

// T1.10a. Este bloque NO es redundante con el barrido exhaustivo de arriba (que ya
// cubre `running|skip` por construcción): existe para que el motivo quede ESCRITO
// junto al assert. Los dos eventos aterrizan en `skipped`, así que la "simplificación"
// obvia (fusionarlos en uno) es tentadora — y sería un agujero de seguridad, porque
// `skip` está expuesto como acción de usuario en POST /api/steps/:id/skip
// (checkpoint-ops.skipStep NO valida estados por su cuenta: delega ENTERAMENTE en la
// tabla, que es su única guardia). Si alguien fusiona los eventos, esto se pone rojo
// con el porqué delante.
describe('regresión T1.10a: el `skip` de USUARIO sigue prohibido desde `running`', () => {
  it('running --(skip)--> ✗ (saltar un step EN VUELO abandonaría trabajo ya pagado)', () => {
    // Un `skip` de usuario sobre un step en ejecución (p. ej. una generación fal.ai
    // en vuelo, F4) dejaría el step abandonado a mitad y el dinero gastado. La única
    // vía a `skipped` desde `running` es que el PROPIO nodo se declare inaplicable.
    expect(nextStatus('running', 'skip')).toBeNull();
    expect(isLegalTransition('running', 'skip')).toBe(false);
  });

  it('running --(skip_inapplicable)--> skipped SÍ es legal (PRD §7.1/§7.2: N2 sin imágenes)', () => {
    expect(nextStatus('running', 'skip_inapplicable')).toBe('skipped');
  });

  it('`skip_inapplicable` NO abre ninguna otra puerta: solo es legal desde `running`', () => {
    // El auto-skip es del nodo EN EJECUCIÓN. Desde cualquier otro estado (incluidos
    // awaiting_deps/pending, donde el `skip` de usuario sí es legal) es ilegal: nadie
    // puede usarlo como un `skip` alternativo que se salte las guardias del de usuario.
    for (const from of ALL_STATUSES) {
      if (from === 'running') continue;
      expect(nextStatus(from, 'skip_inapplicable')).toBeNull();
    }
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
