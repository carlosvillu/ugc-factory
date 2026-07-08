// Dominio `ops` (§12). En T0.3 solo `app_setting` y `audit_log`, y SOLO como
// tablas: sin repo ni writer (eso es T0.4 para app_setting; el writer de
// audit_log llega con su consumidor). El resto del mapa de db.md §1 (cost_entry,
// budget) llega con sus tareas.
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { ulidPk } from './columns.helpers';

// §12: `app_setting key, value jsonb`. La PK es `key` (NO un ULID): es un
// key-value de configuración (API keys cifradas, defaults, umbrales kill/scale).
// El cifrado de `value` y su writer son T0.4 — aquí solo la tabla.
export const appSetting = pgTable('app_setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

export type AppSetting = typeof appSetting.$inferSelect;
export type NewAppSetting = typeof appSetting.$inferInsert;

// §12: `audit_log id, actor, action, entity, entity_id, diff jsonb, at`.
// `at` = timestamp del evento (con timezone); `diff` = el cambio en JSONB.
// Tabla sin writer en T0.3.
export const auditLog = pgTable('audit_log', {
  id: ulidPk(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  diff: jsonb('diff'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
