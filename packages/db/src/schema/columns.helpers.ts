// Helpers de columnas compartidos por todos los ficheros de schema (db.md §1).
import { newUlid } from '@ugc/core/contracts';
import { text, timestamp } from 'drizzle-orm/pg-core';

/**
 * PK ULID generada en la app (db.md §1): ordenable por tiempo y disponible ANTES
 * del INSERT. `$defaultFn` la rellena en cada insert sin pasarla a mano.
 */
export const ulidPk = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => newUlid());

/**
 * `created_at`/`updated_at` con timezone (convención §12). `updated_at` se
 * refresca en cada UPDATE vía `$onUpdateFn`; ambos por defecto `now()` en el
 * INSERT.
 */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
};
