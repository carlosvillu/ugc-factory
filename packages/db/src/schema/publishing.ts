// Dominio `publishing` (T6.2, §15.4 / §preámbulo F6): el estado de PUBLICACIÓN de una variante aprobada —
// el marcado del checklist de compliance y el estado del checkpoint CP5 (el checkpoint OPCIONAL del flujo de
// publicación en modo degradado manual). Es trabajo NUEVO de F6: hasta ahora el bundle (T5.7) EMITÍA los
// pasos del checklist (`export-bundle.ts:145`) pero marcarlos «hechos» no se persistía en ningún sitio.
//
// UNA fila POR VARIANTE (1:1, `variant_id` UNIQUE): el checklist marcado es 1:N por variante pero se guarda
// como un mapa jsonb `id → done` (`checklist_marks`), no como filas por ítem — mismo trato que otros mapas
// opacos del proyecto (`ad_batch.matrix`, `ad_variant.qa_report`, `composition_spec`) cuyo shape lo valida
// un contrato Zod de core (`ChecklistMarksSchema`). El upsert por `variant_id` da la idempotencia del
// marcado (marcar dos veces el mismo ítem = mismo mapa), sin necesidad de un UNIQUE (variant_id, item_id).
//
// NO es la tabla `publication` de T6.3/T6.4 (esa lleva `external_post_id`/`spark_auth_expires_at` y nace con
// la publicación REAL). Aquí solo vive lo que T6.2 posee: el marcado + el estado de CP5. Cuando T6.3/T6.4
// creen `publication`, podrán absorber este estado o referenciarlo; hoy es una tabla NARROW deliberada.
import { boolean, index, jsonb, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';

import { adVariant } from './batch';
import { timestamps, ulidPk } from './columns.helpers';

// El estado del flujo de publicación (modo degradado manual), espejo de `PublishFlowStateSchema` de core:
//   - `ready`                · aún no iniciado (o CP5 off, listo para la subida manual guiada).
//   - `waiting_confirmation` · PAUSADO en CP5 esperando confirmación humana (solo con CP5 on).
//   - `confirmed`            · confirmado → listo para publicar manualmente.
export const publishFlowState = pgEnum('publish_flow_state', [
  'ready',
  'waiting_confirmation',
  'confirmed',
]);

export const variantPublishing = pgTable(
  'variant_publishing',
  {
    id: ulidPk(),
    // 1:1 con la variante. `cascade`: si la variante se borra, su estado de publicación se va con ella.
    // UNIQUE: una variante tiene UN estado de publicación (el upsert lo garantiza).
    variantId: text('variant_id')
      .notNull()
      .unique()
      .references(() => adVariant.id, { onDelete: 'cascade' }),
    // El mapa `id → done` del checklist §15.4 (jsonb OPACO; su shape lo valida `ChecklistMarksSchema` de
    // core al leerlo). Default `{}` = nada marcado. NO se guarda una fila por ítem: el checklist se
    // re-deriva de la variante y este mapa solo aporta el `done`.
    checklistMarks: jsonb('checklist_marks').notNull().default({}),
    // ¿Está activado CP5 (el checkpoint opcional del flujo de publicación)? Default false: CP5 es opcional
    // (§9.7 N10). Con `false`, iniciar el flujo va directo a `confirmed` (sin pausa).
    cp5Enabled: boolean('cp5_enabled').notNull().default(false),
    // El estado actual del flujo de publicación (modo degradado manual).
    flowState: publishFlowState('flow_state').notNull().default('ready'),
    ...timestamps,
  },
  (t) => [
    // Lookup por variante (la query caliente: el panel de publicación de una variante en `/library`).
    index('variant_publishing_variant_id_idx').on(t.variantId),
  ],
);

export type VariantPublishing = typeof variantPublishing.$inferSelect;
export type NewVariantPublishing = typeof variantPublishing.$inferInsert;
