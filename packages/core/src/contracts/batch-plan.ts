// EL CONTRATO `BatchPlan` — la frontera N4 → N5 del pipeline (§7.4: `ProductBrief →
// BatchPlan → AdScript[]`). Vive en `contracts/` (transversal) y no en `strategy/` porque
// lo cruzan varios módulos: lo produce el compositor de matriz (N4, `strategy/`), lo
// persiste `ad_batch.matrix` (jsonb opaco en la BD, §12), lo pinta CP2 (T2.3) y lo consume
// el ScriptWriter (N5, T2.4) para saber qué guiones escribir y CUÁLES comparte.
//
// La matriz es el producto cartesiano de §7.2 N4: **ángulos × hooks × personas × idiomas**,
// con la duración (preset §8.4) y el tier fijos para todo el lote (§12: `ad_batch.tier`,
// `ad_batch.objective`, `ad_batch.languages` son columnas del LOTE, no de la variante).
import { z } from 'zod';
import { AdObjectiveSchema, RecipeTierSchema } from '../library/contracts';

/**
 * Los tres SEGMENTOS de un anuncio (§7.5 y §7.4 `CompositionSpec.segments[]{type: hook|body|cta}`).
 * Es la unidad de GENERACIÓN y de DEDUPLICACIÓN: en hook-testing el `body` y el `cta` se
 * comparten entre las variantes del mismo ángulo (§7.2 N5) y se generan UNA sola vez (§7.2 N7:
 * dedup por content-hash), así que el estimador desglosa POR SEGMENTO, no por variante.
 */
export const AdSegmentSchema = z.enum(['hook', 'body', 'cta']);
export type AdSegment = z.infer<typeof AdSegmentSchema>;

/** De dónde salió el hook de una variante: de los `hook_examples` del ángulo del brief, o de
 *  la librería sembrada en T2.1 (§7.2 N4: «2–3 por ángulo del brief + hook library»). Es lo que
 *  decide si `ad_variant.hook_line_id` lleva FK (librería) o va a null (brief). */
export const HookSourceSchema = z.enum(['brief', 'library']);
export type HookSource = z.infer<typeof HookSourceSchema>;

/**
 * Un hook concreto de la matriz, con su procedencia.
 *
 * CÓMO SE IDENTIFICA UNA LÍNEA DE LIBRERÍA — y por qué NO por su posición. La primera versión
 * llevaba un `libraryIndex`: la posición en el array de hooks que recibió el compositor. Era una
 * referencia **al array de la llamada**, guardada en un documento que **sobrevive a la llamada**
 * (el `BatchPlan` se persiste en `ad_batch.matrix` como jsonb opaco). Cuando T2.4 relea esa
 * matriz, ese array ya no existe: cualquiera que quisiera volver a la línea tendría que
 * reconstruir la lista con el MISMO filtro y el MISMO orden, o el índice apuntaría a otra línea
 * EN SILENCIO.
 *
 * La identidad estable ya viaja en el plan: `hook_line` tiene UNIQUE natural **(language, text)**
 * —el mismo que usa el seed de T2.1 para su idempotencia—, y el plan lleva `text` (aquí) y
 * `language` (en la variante). El caller resuelve con un lookup único (`SELECT id FROM hook_line
 * WHERE language = $1 AND text = $2`); core sigue sin conocer IDs de BD. Sin índices posicionales,
 * sin acoplar al orden de una lista, y el plan persistido se auto-explica.
 */
export const PlannedHookSchema = z.object({
  text: z.string().min(1),
  source: HookSourceSchema,
});
export type PlannedHook = z.infer<typeof PlannedHookSchema>;

/**
 * Una VARIANTE planificada: una fila futura de `ad_variant` (§12). Todavía no existe en la
 * BD — CP2 (T2.3) es quien la crea en estado `planned` al confirmar el gasto.
 *
 * `sharedSegments` es la mitad de la Entrega de esta tarea: en modo hook-testing (§7.2 N5) el
 * body y el CTA son **los mismos textos y los mismos clips** para todas las variantes de un
 * ángulo. Aquí se declara con qué CLAVE se comparte cada segmento (`segmentKeys`), de forma
 * que dos variantes que comparten clave comparten generación — y el estimador solo la cobra
 * una vez.
 */
export const PlannedVariantSchema = z.object({
  /** Índice del ángulo dentro de `ProductBrief.angles[]` (el nombre viaja aparte, legible). */
  angleIndex: z.number().int().nonnegative(),
  angleName: z.string().min(1),
  /** `angles[].framework` del brief → `ad_variant.framework` (NOT NULL en §12). */
  framework: z.string().min(1),
  hook: PlannedHookSchema,
  /** `null` = persona sin fijar: «el usuario puede fijar o dejar que rote para el A/B» (§11). */
  personaName: z.string().min(1).nullable(),
  language: z.string().min(1),
  /** Duración objetivo en segundos (el preset del lote, §8.4) → `ad_variant.duration_target`. */
  durationTargetSeconds: z.number().int().positive(),
  /**
   * `ad_variant.filename_code` (§12): legible y trazable en Ads Manager (§8.3).
   *
   * ⚠ CONTRATO CON EL LLAMANTE, no una nota suelta. En BD la constraint es **UNIQUE GLOBAL**, no
   * por lote: dos lotes compuestos del MISMO brief con la MISMA config producirían los mismos
   * códigos y el segundo `INSERT` reventaría — justo al confirmar el gasto en CP2, que es el peor
   * momento posible para un 500.
   *
   * LA DEFENSA ESTÁ EN EL CÓDIGO: `composeMatrix` acepta `batchDiscriminator` (ver
   * `strategy/matrix.ts`). El llamante que va a PERSISTIR (T2.3, que tiene el `ad_batch.id`
   * delante) **DEBE pasarlo**, y entonces el código es único por construcción. Sin él, el código
   * solo es único DENTRO del plan — que es lo correcto para previsualizar la matriz en CP2 antes
   * de que el lote exista, y lo INCORRECTO para insertar.
   */
  filenameCode: z.string().min(1),
  /**
   * La clave de GENERACIÓN de cada segmento. Dos variantes con la misma clave en `body`
   * reutilizan el mismo clip (y el mismo texto de guion): es la economía Hook×Body×CTA
   * («3×2×2 = 12 anuncios pagando 7 clips», §16.1). En modo normal cada variante tiene sus
   * tres claves propias y no se comparte nada.
   */
  segmentKeys: z.record(AdSegmentSchema, z.string().min(1)),
});
export type PlannedVariant = z.infer<typeof PlannedVariantSchema>;

/**
 * `BatchPlan`: la MATRIZ completa que CP2 confirma y que se persiste en `ad_batch.matrix`.
 * Lleva la config del lote (lo que son columnas de `ad_batch`) + las variantes planificadas.
 */
export const BatchPlanSchema = z.object({
  objective: AdObjectiveSchema,
  tier: RecipeTierSchema,
  /** El preset de §8.4 elegido por el objetivo: su duración objetivo en segundos. */
  durationTargetSeconds: z.number().int().positive(),
  languages: z.array(z.string().min(1)).min(1),
  /** `true` cuando el lote comparte body/CTA por ángulo (§7.2 N5: objetivo `hook_test`). */
  sharedBodyAndCta: z.boolean(),
  /**
   * POR QUÉ NINGUNA VARIANTE LLEVA PERSONA, cuando no la lleva. Sin esta señal, en la salida
   * **«no había personas en la librería» era INDISTINGUIBLE de «ninguna casó con el segmento»** —
   * y CP2 solo podía enseñar un lote mudo. Con ella puede decir la verdad: *«no encontré personas
   * compatibles con este segmento»* (y ofrecer elegir a mano), que es información accionable.
   *
   * `matched` = hubo candidatas y se asignaron. `no_personas` = la librería estaba vacía.
   * `no_match` = había personas, pero `matchPersonas` (§11) descartó a TODAS para el `avatar_hint`
   * del segmento — el caso que antes se perdía.
   */
  personaSelection: z.enum(['matched', 'no_match', 'no_personas']),
  variants: z.array(PlannedVariantSchema).min(1),
});
export type BatchPlan = z.infer<typeof BatchPlanSchema>;
