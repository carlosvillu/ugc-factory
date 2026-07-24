// REGISTRO DE LA SUPERFICIE DE PAGO — la lista, mantenida a mano y verificada por un
// test de completitud (paid-surface-registry.test.ts), de TODO módulo de services que
// escribe una fila de coste (`recordCost`). Existe para cortar de raíz el patrón más
// caro del proyecto (auditoría del journal 2026-07-23, "gasto-real-sin-ledger"): el
// registro de coste está re-implementado dentro del happy-path de CADA executor, y la
// CLASE de bug (fal factura, cost_entry no se escribe → /spend miente $0,00) reaparece
// con cada nodo nuevo (F1 → F4 → F5), pese a existir el invariante en prosa
// (backend/references/architecture.md:36) desde antes de F4.
//
// EL MECANISMO QUE ROMPE: un executor nuevo que llame a `recordCost` sin registrarse aquí
// hace FALLAR el test de completitud → gate rojo. No puede pasar inadvertido. Y cada
// entrada declara las PROPIEDADES de dinero que su executor debe cumplir, punto de anclaje
// para los tests de comportamiento (record-first, idempotencia, unidad de pricing) que se
// añaden incrementalmente sobre esta misma lista.

export interface PaidSurface {
  /** Módulo bajo packages/services/src/ que llama a recordCost (basename sin .ts). */
  module: string;
  /** Proveedor facturado. */
  provider: 'fal' | 'anthropic' | 'firecrawl';
  /** Cuántas llamadas de pago factura una ejecución feliz (⇒ cuántas filas cost_entry). */
  billableCalls: number;
  /** Unidad de pricing con la que se calcula el importe (para el test anti-degradación-a-0¢). */
  unit: 'second' | 'image' | 'token' | 'credit' | 'call';
  /** Nota sobre el patrón de liquidación (record-first, finalizer con lock, cadena…). */
  note: string;
}

export const PAID_SURFACE: readonly PaidSurface[] = [
  {
    module: 'anthropic-service',
    provider: 'anthropic',
    billableCalls: 1,
    unit: 'token',
    note: 'LLM (guiones/brief): record-first tras la respuesta, coste por tokens I/O.',
  },
  {
    module: 'firecrawl-ingest',
    provider: 'firecrawl',
    billableCalls: 1,
    unit: 'credit',
    note: 'Scrape de la URL de producto: 1 crédito por página.',
  },
  {
    module: 'finalize-generation',
    provider: 'fal',
    billableCalls: 1,
    unit: 'image',
    note: 'Liquidador SOLO-IMAGEN compartido por 4 callers concurrentes con SELECT … FOR UPDATE (T4.1/T4.2).',
  },
  {
    module: 'finalize-single-call-per-second',
    provider: 'fal',
    billableCalls: 1,
    unit: 'second',
    note: 'Liquidador de VÍDEO (avatar/b-roll): coste por segundo del clip, nunca 0 degradado.',
  },
  {
    module: 'generate-audio',
    provider: 'fal',
    billableCalls: 2,
    unit: 'second',
    note: 'Cadena TTS→ASR: DOS llamadas fal facturadas por separado, record-first del TTS antes de arriesgar el ASR.',
  },
  {
    module: 'generate-persona-images',
    provider: 'fal',
    billableCalls: 2,
    unit: 'image',
    note: 'FLUX base + Nano-Banana edit (identity-lock T4.12): 2 imágenes facturadas.',
  },
  {
    module: 'generate-veed-avatar',
    provider: 'fal',
    billableCalls: 1,
    unit: 'second',
    note: 'Avatar VEED: una llamada facturada por segundo del clip.',
  },
];
