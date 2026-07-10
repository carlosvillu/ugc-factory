// Adaptador del puerto `AuditStore` de core (db.md §5): envuelve audit.repo. Habla
// los tipos de core (AuditEntry), no filas Drizzle. Tx-scoped: lo construye
// `makeWithTransaction` con la tx abierta, así la fila de auditoría comparte la
// transacción de la transición de checkpoint (T0.8, §19.1).
import type { AuditStore } from '@ugc/core/orchestrator';
import type { Db } from '../client';
import { writeAuditLog } from '../repos/audit.repo';

export function makeAuditStore(db: Db): AuditStore {
  return {
    write: (entry) => writeAuditLog(db, entry),
  };
}
