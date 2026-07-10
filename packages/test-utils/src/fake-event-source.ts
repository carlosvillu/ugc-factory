// FakeEventSource — doble controlable de EventSource para los tests del cliente
// SSE de apps/web (testing/references/frontend.md §4). jsdom no implementa
// EventSource; los tests lo instalan con vi.stubGlobal('EventSource', FakeEventSource)
// y controlan snapshot/deltas/reconexión desde el propio test.
//
// Declara las constantes estáticas del estándar (CONNECTING/OPEN/CLOSED) para que
// el código del hook que compara `readyState` contra `EventSource.CONNECTING` /
// `EventSource.CLOSED` funcione idéntico contra el fake (frontend.md §4 nota b).
export class FakeEventSource {
  // Constantes del estándar EventSource: el hook compara readyState contra ellas.
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  static instances: FakeEventSource[] = [];
  static last(): FakeEventSource {
    const es = this.instances.at(-1);
    if (!es) throw new Error('FakeEventSource: no instances yet');
    return es;
  }
  static reset(): void {
    this.instances = [];
  }

  // Instancia — superficie mínima del estándar que consume el hook.
  readyState = FakeEventSource.CONNECTING;
  withCredentials = false;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  private listeners = new Map<string, Set<(ev: MessageEvent) => void>>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (ev: MessageEvent) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: (ev: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  // ---- helpers solo-test ----
  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }

  emit(type: string, data: unknown, id = ''): void {
    const ev = new MessageEvent(type, { data: JSON.stringify(data), lastEventId: id });
    if (type === 'message') this.onmessage?.(ev);
    this.listeners.get(type)?.forEach((fn) => {
      fn(ev);
    });
  }

  // fail() dispara onerror. El hook puede ramificar según readyState: un test que
  // simule "cerrado definitivamente" puede fijar `es.readyState = FakeEventSource.CLOSED`
  // ANTES de llamar a fail(); por defecto no toca readyState (fallo transitorio).
  fail(): void {
    this.onerror?.(new Event('error'));
  }
}
