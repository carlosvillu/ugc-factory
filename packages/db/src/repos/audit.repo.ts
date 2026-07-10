// Repo de `audit_log` (§19.1, db.md §4): primer writer de la tabla (T0.8). Escribe
// el diff artefacto-IA vs artefacto-editado de cada edit/approve/reject en un
// checkpoint. Executor (`Db`) como primer argumento para correr dentro de la tx
// del orquestador (la fila de auditoría se escribe en la MISMA tx que la
// transición, o no se escribe — rollback).
import type { Db } from '../client';
import { auditLog } from '../schema/ops';
import type { AuditEntry } from '@ugc/core/orchestrator';

/** INSERT de una entrada de auditoría. `at` lo pone el default de la BD (now()). */
export async function writeAuditLog(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actor: entry.actor,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    diff: entry.diff,
  });
}
