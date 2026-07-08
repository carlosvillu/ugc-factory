// Dominio `project` (§12). En T0.3 solo la tabla `project` de este fichero; el
// resto del mapa de db.md §1 (brand_kit, url_analysis, product_brief) llega con
// sus tareas (T1.2). No se anticipan aquí.
import { pgEnum, pgTable, text } from 'drizzle-orm/pg-core';
import { timestamps, ulidPk } from './columns.helpers';

// §12 exige enum nativo para `project.status` pero NO enumera valores. Enum
// mínimo sensato (decisión T0.3, anotada): un proyecto está `active` mientras se
// trabaja o `archived` cuando se retira sin borrarlo. Añadir un valor futuro es
// un `ALTER TYPE … ADD VALUE` trivial (db.md §1); por eso se empieza corto y no
// se sobre-diseña.
export const projectStatus = pgEnum('project_status', ['active', 'archived']);

export const project = pgTable('project', {
  id: ulidPk(),
  name: text('name').notNull(),
  // Locale por defecto de los guiones/briefs del proyecto. La plataforma es
  // ES-first (PRD): default 'es', aplicado por la BD.
  defaultLocale: text('default_locale').notNull().default('es'),
  status: projectStatus('status').notNull().default('active'),
  notes: text('notes'), // opcional (§12): nullable, sin default.
  ...timestamps,
});

export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;
