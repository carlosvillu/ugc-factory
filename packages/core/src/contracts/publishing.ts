// EL CONTRATO DE PUBLICACIÓN (T6.2, §15.4 / §14 / §preámbulo F6). Lo que gobierna la superficie de
// PUBLICACIÓN de una variante YA aprobada (CP4): el checklist de compliance MARCABLE por plataforma, la
// elegibilidad de la opción Spark según `audio_source`, y la máquina de estados de CP5 (el checkpoint
// OPCIONAL del flujo de publicación en MODO DEGRADADO MANUAL — export + checklist + guía).
//
// FRONTERA DE CORE (SKILL.md backend, principio 1): PURO. Sin BD, sin cola. Habla banderas y estados, no
// filas. La BD persiste el marcado + el estado de CP5 (`variant_publishing`, T6.2); la API cablea; la UI de
// `/library` lo renderiza. Las dos reglas con MORDIENTE (Spark + pausa de CP5) viven aquí, cada una como UNA
// pieza revertible con su test — su control negativo (revertir la regla) las rompe RUIDOSAMENTE.
//
// POR QUÉ NO VIVE EN `export-bundle.ts`: `buildComplianceChecklist` de allí se serializa DENTRO del
// `metadata.json` del ZIP (T5.7) y sus ítems son contrato del bundle. La elegibilidad de Spark y CP5 son de
// la UI/API de publicación (F6), NO viajan en el ZIP — mezclarlas cambiaría el bundle y rompería T5.7. Aquí
// se REUSA `buildComplianceChecklist` tal cual para los pasos, y se LAYEREA Spark + CP5 por encima.
//
// LO QUE NO ES (fuera de alcance, T6.3/T6.4): esto NO publica (no hay N10, ni executor, ni cuenta real). CP5
// es una CONFIRMACIÓN del flujo de publicación en modo degradado manual, no un nodo del DAG de generación.
import { z } from 'zod';

import type { BatchDestination } from './batch-plan';
import {
  buildComplianceChecklist,
  ComplianceChecklistItemSchema,
  type BundleAudioSource,
  type ComplianceChecklistItem,
} from './export-bundle';

// ── Spark: la regla con mordiente (§14 pt 2 / §623-624, PRD:623) ──────────────────────────────────────────
//
// Un Spark Ad ES un ad y debe cumplir las Advertising Policies: solo Commercial Music Library o licencia
// propia. N10 BLOQUEA la generación de Spark code para posts cuyo `audio_source` sea `native_trending`
// (el trending nativo no está licenciado para uso comercial). La regla es DESTINO-INDEPENDIENTE: Spark ES
// el propio path orgánico→paid (§14 pt 2), así que un lote `destination='organic'` que quiera promocionarse
// después TAMBIÉN debe bloquearse. La Verificación de T6.2 keya SOLO en `audio_source`; NO se añade una
// segunda condición (plataforma/destino) — eso partiría el objetivo del control negativo.

/** El veredicto de elegibilidad de la opción Spark de una variante. `allowed=false` trae la EXPLICACIÓN
 *  (la Verificación exige «bloquea la opción Spark CON EXPLICACIÓN»). */
export const SparkEligibilitySchema = z.object({
  allowed: z.boolean(),
  /** Presente SOLO cuando `allowed=false`: por qué Spark no se ofrece (para el aviso de la UI). */
  reason: z.string().optional(),
});
export type SparkEligibility = z.infer<typeof SparkEligibilitySchema>;

/** El aviso EXACTO cuando el audio nativo/trending bloquea Spark (§14 pt 2). Constante para que UI y API no
 *  divergan en el texto y el control negativo lo pueda asertar. */
export const SPARK_BLOCK_REASON =
  'El audio nativo/trending no está licenciado para uso comercial: un Spark Ad solo admite Commercial Music Library o licencia propia (§14). Usa un bed IA o música con licencia para promocionar este vídeo.';

/**
 * ¿Se ofrece la opción Spark para esta variante? LA REGLA CON MORDIENTE de T6.2 (§14 pt 2):
 *   - `native_trending` → BLOQUEADA con explicación (Spark = ad, y el trending no está licenciado).
 *   - cualquier otro `audio_source` (`ai_bed`/`own_license`/`none`) → PERMITIDA.
 *
 * PURA y total. Su CONTROL NEGATIVO (regla del arnés): revertir la comparación (`=== 'native_trending'` →
 * algo que nunca casa, o quitar el bloqueo) hace que Spark se OFREZCA para `native_trending` → ROJO en el
 * test unit y en el e2e. Es UNA línea revertible, no una condición desperdigada por la UI.
 */
export function sparkEligibility(audioSource: BundleAudioSource): SparkEligibility {
  if (audioSource === 'native_trending') {
    return { allowed: false, reason: SPARK_BLOCK_REASON };
  }
  return { allowed: true };
}

// ── CP5: la máquina de estados del flujo de publicación en modo degradado manual (§preámbulo F6 / §268) ───
//
// CP5 es OPCIONAL (§9.7 N10: «opcional CP5 (confirmar publicación)»). Cuando está ACTIVADO, el flujo de
// publicación en modo degradado manual (export + checklist + guía) NO se completa de una: se PAUSA en el
// checkpoint esperando confirmación humana, y solo `confirm` lo reanuda a `confirmed`. Cuando está
// DESACTIVADO, `start` llega directo a `confirmed` (sin pausa). Espeja el idiom de `checkpoint.ts`
// (`shouldPause` per-nodo) pero es una MÁQUINA DE ESTADOS, no un booleano: la Verificación exige que el
// flujo «se pause en el checkpoint y al confirmar se reanude», que un predicado no captura.

/** Los estados del flujo de publicación (modo degradado manual):
 *   - `ready`               · aún no se ha iniciado (o CP5 off y ya listo para publicar manualmente).
 *   - `waiting_confirmation`· PAUSADO en CP5 esperando confirmación humana (solo alcanzable con CP5 on).
 *   - `confirmed`           · confirmado → listo para la subida manual guiada. */
export const PublishFlowStateSchema = z.enum(['ready', 'waiting_confirmation', 'confirmed']);
export type PublishFlowState = z.infer<typeof PublishFlowStateSchema>;

/** Las acciones que mueven el flujo: iniciar, confirmar (reanuda desde la pausa), o reabrir a `ready`. */
export const PublishFlowActionSchema = z.enum(['start', 'confirm', 'reopen']);
export type PublishFlowAction = z.infer<typeof PublishFlowActionSchema>;

/**
 * LA MÁQUINA DE ESTADOS de CP5. Dado el estado actual + si CP5 está activado + la acción, calcula el
 * siguiente estado. LA REGLA CON MORDIENTE está en la rama de `start`:
 *   - `start` con CP5 ACTIVADO  → `waiting_confirmation` (SE PAUSA; solo `confirm` la saca).
 *   - `start` con CP5 desactivado → `confirmed` (sin pausa, publicación manual directa).
 *   - `confirm` desde `waiting_confirmation` → `confirmed` (REANUDA).
 *   - `reopen` → `ready` (volver a empezar).
 * Cualquier otra combinación es NO-OP (devuelve el estado actual): la máquina es total y no lanza.
 *
 * CONTROL NEGATIVO (regla del arnés): borrar la rama `cp5Enabled` de `start` (que `start` vaya SIEMPRE a
 * `confirmed`) hace que el flujo NO se detenga con CP5 on → el e2e que espera `waiting_confirmation` y el
 * botón de confirmar da ROJO. La pausa es UNA rama revertible, no un flag que se lee tal cual.
 */
export function nextPublishState(input: {
  cp5Enabled: boolean;
  current: PublishFlowState;
  action: PublishFlowAction;
}): PublishFlowState {
  const { cp5Enabled, current, action } = input;
  if (action === 'reopen') return 'ready';
  if (action === 'confirm') {
    // Confirmar reanuda desde la pausa (o confirma directamente un flujo ya iniciado sin CP5).
    return current === 'waiting_confirmation' ? 'confirmed' : current;
  }
  // action === 'start'
  if (current !== 'ready') return current; // ya iniciado: iniciar de nuevo es no-op.
  // LA RAMA CON MORDIENTE: con CP5 el flujo se PAUSA; sin CP5 va directo a confirmado.
  return cp5Enabled ? 'waiting_confirmation' : 'confirmed';
}

// ── El checklist MARCABLE + el estado de publicación (lo que la API devuelve y persiste) ─────────────────

/** Un ítem del checklist de publicación CON su estado de marcado. EXTIENDE el ítem base de compliance
 *  (`ComplianceChecklistItemSchema` de T5.7) con `done` — así el shape (id/label/platform/required) NO puede
 *  divergir del contrato del bundle. `done` = marcado «hecho» (trabajo NUEVO de F6, `export-bundle.ts:145`). */
export const PublishingChecklistItemSchema = ComplianceChecklistItemSchema.extend({
  /** ¿El usuario lo marcó «hecho»? Persistido en `variant_publishing.checklist_marks` (T6.2). */
  done: z.boolean(),
});
export type PublishingChecklistItem = z.infer<typeof PublishingChecklistItemSchema>;

/** El estado COMPLETO de publicación de una variante que la UI de `/library` renderiza (T6.2). */
export const PublishingStateSchema = z.object({
  /** El checklist §15.4 con el estado de marcado por ítem. */
  checklist: z.array(PublishingChecklistItemSchema),
  /** La elegibilidad de la opción Spark (según `audio_source`). */
  spark: SparkEligibilitySchema,
  /** ¿Está activado CP5 (el checkpoint opcional del flujo de publicación)? */
  cp5Enabled: z.boolean(),
  /** El estado actual del flujo de publicación (modo degradado manual). */
  flowState: PublishFlowStateSchema,
});
export type PublishingState = z.infer<typeof PublishingStateSchema>;

/** El mapa `id → done` persistido en `variant_publishing.checklist_marks` (jsonb). Se valida al leerlo de la
 *  BD (jsonb opaco). Un id desconocido en el mapa se IGNORA al ensamblar (el checklist se re-deriva de la
 *  variante: si un ítem deja de aplicar, su marca vieja no lo resucita). */
export const ChecklistMarksSchema = z.record(z.string(), z.boolean());
export type ChecklistMarks = z.infer<typeof ChecklistMarksSchema>;

/**
 * ENSAMBLA el estado de publicación de una variante (T6.2). Determinista:
 *   - checklist §15.4 REUSANDO `buildComplianceChecklist` (mismos ítems que el bundle), fusionado con las
 *     marcas persistidas (`done`).
 *   - la elegibilidad de Spark desde el `audioSource` de la VARIANTE (`ad_variant.audio_source`) — NO desde
 *     el `none` degradado del bundle sin-bed: una variante `native_trending` vista en la versión sin bed
 *     seguiría bloqueando Spark, que es lo correcto (§14 pt 2).
 *   - el estado de CP5 (activado + estado del flujo) tal cual se lee de la BD.
 *
 * El checklist se re-deriva SIEMPRE de la variante; las marcas solo aportan `done`. Un ítem que ya no aplica
 * (cambió el destino/plataforma) desaparece aunque tuviera marca — la marca huérfana no lo resucita.
 */
export function buildPublishingState(input: {
  platforms: readonly string[];
  audioSource: BundleAudioSource;
  destination: BatchDestination;
  marks: ChecklistMarks;
  cp5Enabled: boolean;
  flowState: PublishFlowState;
}): PublishingState {
  const items: ComplianceChecklistItem[] = buildComplianceChecklist({
    platforms: input.platforms,
    audioSource: input.audioSource,
    destination: input.destination,
  });
  const checklist: PublishingChecklistItem[] = items.map((item) => ({
    ...item,
    done: input.marks[item.id] === true,
  }));
  return {
    checklist,
    spark: sparkEligibility(input.audioSource),
    cp5Enabled: input.cp5Enabled,
    flowState: input.flowState,
  };
}

// ── Contratos de la API de publicación (T6.2): el cuerpo de las mutaciones ────────────────────────────────

/** `PATCH /api/variants/:id/publishing`: marca/desmarca UN ítem del checklist. */
export const MarkChecklistItemSchema = z.object({
  itemId: z.string().min(1),
  done: z.boolean(),
});
export type MarkChecklistItemBody = z.infer<typeof MarkChecklistItemSchema>;

/** `POST /api/variants/:id/publishing/cp5`: activa/desactiva CP5 o mueve el flujo (start/confirm/reopen).
 *  Es una unión discriminada por `op`:
 *   - `{op:'toggle', enabled}` · activa/desactiva el checkpoint CP5.
 *   - `{op:'flow', action}`    · mueve el flujo (la máquina de estados calcula el destino). */
export const Cp5OpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('toggle'), enabled: z.boolean() }),
  z.object({ op: z.literal('flow'), action: PublishFlowActionSchema }),
]);
export type Cp5Op = z.infer<typeof Cp5OpSchema>;
