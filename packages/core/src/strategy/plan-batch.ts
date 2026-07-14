// DE LA CONFIG DE CP2 A LA MATRIZ + SU COSTE (T2.3) — la función que el servidor llama tanto
// para PREVISUALIZAR (`POST /api/batches/estimate`) como para CONFIRMAR (el efecto de dominio de
// `/approve`), y que garantiza que las dos hagan LA MISMA aritmética.
//
// POR QUÉ VIVE EN CORE Y NO EN EL ROUTE HANDLER. Es lógica pura y determinista (§7.2 N4: «$0»):
// resolver la config del usuario contra el brief, la librería y las personas, componer la matriz
// y estimar su coste. Un route handler que hiciera esto sería lógica de negocio en la capa de
// transporte (api.md §1) — y, sobre todo, habría DOS caminos de aritmética (el de estimar y el de
// confirmar) que podrían divergir: el usuario aprobaría un número y el sistema crearía otro. Con
// una función, la divergencia no es posible: **lo que se estima es lo que se compone**.
//
// LO ÚNICO QUE CAMBIA ENTRE PREVISUALIZAR Y CONFIRMAR es `batchDiscriminator` (ver
// `ComposeMatrixInput`): vacío al previsualizar (el lote todavía no existe), el `ad_batch.id` al
// persistir (que es lo que hace GLOBALMENTE único el `filename_code`, §12). Es un parámetro, no
// una rama: el caller que va a insertar lo pasa, y el que solo pinta, no.
import type { ProductBrief } from '../contracts/product-brief';
import type { BatchConfig } from '../contracts/batch-config';
import type { BatchPlan } from '../contracts/batch-plan';
import type { HookLineSeed, RecipeSeed } from '../library/contracts';
import { composeMatrix, type PlannablePersona } from './matrix';
import { estimateBatchCost, type BatchCostEstimate } from './cost';

/**
 * LA CONFIG QUE N4 PROPONE (la que CP2 pre-selecciona antes de que el usuario toque nada).
 *
 * Conservadora A PROPÓSITO: **es una propuesta de GASTO**. Si el default fuera «todos los ángulos
 * del brief × 3 hooks × todos los idiomas × premium», el sistema estaría empujando al usuario a
 * confirmar el lote más caro que puede componer, y el panel de CP2 —que existe para que el gasto
 * sea una decisión CONSCIENTE— se convertiría en un botón de «sí» sobre un número que él no eligió.
 *
 *  · 3 ángulos (de los 5–10 del brief): suficiente para un A/B real, lejos del máximo.
 *  · 2 hooks/ángulo: el suelo de la horquilla de §7.2 N4 («2–3 por ángulo»).
 *  · `hook_test`: el objetivo BARATO (12 s) y el que comparte body/CTA (§7.2 N5) — el lote de
 *    exploración con el que se empieza, no el de producción.
 *  · `test`: el tier barato del Apéndice B ($0,3–1,7 / 30 s).
 *  · `rotate`: §11 dice que la persona rota para el A/B salvo que el usuario la fije.
 */
export function defaultBatchConfig(brief: ProductBrief, languages: string[]): BatchConfig {
  const angleCount = Math.min(3, brief.angles.length);
  return {
    angleIndices: Array.from({ length: angleCount }, (_unused, i) => i),
    hooksPerAngle: 2,
    objective: 'hook_test',
    tier: 'test',
    languages,
    personaMode: 'rotate',
  };
}

/** Todo lo que el SERVIDOR aporta (y el cliente no puede aportar: son datos de la BD). */
export interface PlanBatchInput {
  brief: ProductBrief;
  config: BatchConfig;
  /** La librería sembrada (T2.1) para completar los hooks del brief. */
  libraryHooks: HookLineSeed[];
  /** TODAS las personas de la librería. El filtrado por `avatar_hint` lo hace `composeMatrix`
   *  (que reutiliza `matchPersonas`); aquí solo se aplica el MODO (`fixed`/`rotate`/`none`). */
  personas: PlannablePersona[];
  /** La receta del tier elegido — la fila REAL de `recipe` (T2.1), nunca una constante. */
  recipe: RecipeSeed;
  /** El `ad_batch.id` al PERSISTIR; ausente al previsualizar (ver la cabecera). */
  batchDiscriminator?: string;
}

export interface PlannedBatch {
  plan: BatchPlan;
  estimate: BatchCostEstimate;
}

/**
 * EL MODO DE PERSONA (§11: «fijar o dejar que rote») aplicado al POOL que ve el compositor.
 *
 * No se filtra la SALIDA de `composeMatrix` (eso sería reescribir variantes ya compuestas y
 * dejar `sharedScope` —la clave de dedup, o sea LA DE DINERO— apuntando a una cara que ya no
 * está): se le da al compositor el pool CORRECTO y él compone coherente.
 *
 *  · `fixed`  → un pool de UNA persona. Ojo: si esa persona NO casa con el `avatar_hint`,
 *    `matchPersonas` la descarta y el plan sale con `personaSelection: 'no_match'` y variantes
 *    sin cara. Es HONESTO (el compositor no recomienda a quien su propia regla descarta), y CP2
 *    solo ofrece fijar entre las CANDIDATAS, así que el caso no se alcanza desde la UI.
 *  · `rotate` → todas: `matchPersonas` se queda con las compatibles y las reparte.
 *  · `none`   → ninguna: variantes sin persona (lo único honesto con la librería vacía).
 */
function personaPool(config: BatchConfig, personas: PlannablePersona[]): PlannablePersona[] {
  if (config.personaMode === 'none') return [];
  if (config.personaMode === 'fixed') {
    return personas.filter((p) => p.id === config.personaId);
  }
  return personas;
}

/**
 * Compone la matriz de la config y la estima con la receta REAL. Es la ÚNICA aritmética de dinero
 * de CP2 — el navegador no calcula ni un céntimo (decisión vinculante de T2.3).
 *
 * Lanza (con el mensaje de `composeMatrix`/`estimateBatchCost`) si la config produce una matriz
 * vacía o incoherente: el estimador es la última defensa antes de que el usuario apruebe un gasto,
 * y su trabajo ante un input imposible es RECHAZARLO, no convertirlo en una cifra creíble.
 */
export function planBatch(input: PlanBatchInput): PlannedBatch {
  const { brief, config, libraryHooks, personas, recipe, batchDiscriminator } = input;

  const plan = composeMatrix({
    brief,
    angleIndices: config.angleIndices,
    hooksPerAngle: config.hooksPerAngle,
    libraryHooks,
    personas: personaPool(config, personas),
    languages: config.languages,
    objective: config.objective,
    tier: config.tier,
    batchDiscriminator,
  });

  return { plan, estimate: estimateBatchCost(plan, recipe) };
}
