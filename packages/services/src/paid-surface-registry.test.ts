// CHECK DE COMPLETITUD de la superficie de pago (auditoría del journal 2026-07-23,
// patrón "gasto-real-sin-ledger"). Descubre por análisis estático TODO módulo de
// services que INVOCA recordCost() y falla si alguno no está declarado en PAID_SURFACE
// (o si el registro declara un módulo que ya no cobra). Así un executor de pago nuevo
// NO puede entrar sin declarar sus invariantes de dinero: gate rojo hasta registrarlo.
//
// Es la garantía TRANSVERSAL que faltaba: el invariante "toda llamada de pago ⇒
// cost_entry" vivía en prosa (architecture.md:36) y la clase de bug reapareció en
// T4.2/T4.5/T4.4b/T4.7b. Esto lo sube al escalón mecánico (corre en el gate vía
// `pnpm test`, proyecto services:unit).

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PAID_SURFACE } from './paid-surface-registry';

const SRC = dirname(fileURLToPath(import.meta.url));

// Módulos que INVOCAN recordCost() de verdad — no en un comentario, no la línea de
// import. Un `import { recordCost } from '@ugc/db'` sin llamada no cuenta (no cobra).
function modulesThatCallRecordCost(): string[] {
  const found: string[] = [];
  for (const name of readdirSync(SRC)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    if (name === 'paid-surface-registry.ts') continue; // el propio registro no es un executor
    const text = readFileSync(join(SRC, name), 'utf8');
    const calls = text.split('\n').filter((line) => {
      const trimmed = line.trim();
      // comentarios: //  /*  /**  *  (JSDoc y bloque, no solo línea)
      if (/^(\/\/|\/\*|\*)/.test(trimmed)) return false;
      if (/^import\b/.test(trimmed)) return false; // línea de import
      return /\brecordCost\s*\(\s*\w/.test(line); // llamada real (recordCost(db,…), no "recordCost (texto")
    });
    if (calls.length > 0) found.push(name.replace(/\.ts$/, ''));
  }
  return found.sort();
}

describe('superficie de pago: el registro cubre exactamente lo que cobra', () => {
  const actual = modulesThatCallRecordCost();
  const registered = PAID_SURFACE.map((s) => s.module).sort();

  it('todo módulo que llama recordCost() está en PAID_SURFACE', () => {
    // Si esto falla, `unregistered` lista los módulos que cobran (llaman recordCost) pero NO
    // están en paid-surface-registry.ts: declara su entrada (proveedor, nº de llamadas
    // facturadas, unidad de pricing) — el punto donde el arnés obliga a pensar los invariantes
    // de dinero de un executor nuevo antes de que fal facture sin cost_entry.
    const unregistered = actual.filter((m) => !registered.includes(m));
    expect(unregistered).toEqual([]);
  });

  it('todo módulo de PAID_SURFACE sigue llamando recordCost() (sin entradas fósiles)', () => {
    // `stale` lista entradas del registro cuyo módulo ya no llama recordCost: si el executor
    // dejó de cobrar, bórralas; si se renombró, actualiza el registro.
    const stale = registered.filter((m) => !actual.includes(m));
    expect(stale).toEqual([]);
  });

  it('cada entrada declara metadatos de dinero coherentes', () => {
    for (const s of PAID_SURFACE) {
      expect(s.billableCalls).toBeGreaterThanOrEqual(1);
      expect(s.provider).toBeTruthy();
      expect(s.unit).toBeTruthy();
    }
  });
});
