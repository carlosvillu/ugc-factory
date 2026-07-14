// LO QUE `planBatch` NECESITA DE LA BD, en un solo sitio (T2.3).
//
// POR QUÉ EXISTE ESTE MÓDULO. La matriz del lote se compone DOS veces, en dos procesos distintos:
//
//   · el worker (N4, `executors/strategy.ts`) la PROPONE cuando el step llega a CP2, y
//   · web (`server/batch-checkpoint.ts`) la ESTIMA en cada cambio del panel y la CREA al confirmar.
//
// Las dos tienen que ver EXACTAMENTE los mismos datos, porque el invariante de toda la tarea es
// «lo que se propone == lo que se estima == lo que se crea». Mantenidas a mano, eran dos listas de
// lecturas que había que acordarse de tocar a la vez: el día que `planBatch` necesite una entrada
// más (una tabla de CTAs, una preferencia de marca), añadirla en un solo brazo hace que el usuario
// APRUEBE una matriz y el sistema CREE otra — sin error de tipos y sin un solo test en rojo.
//
// Aquí viven las lecturas COMUNES, y solo esas. Lo que legítimamente diverge se queda en cada
// caller y NO se mete a la fuerza en una abstracción:
//
//   · EL BRIEF: el worker lo saca por id (`getBrief`); web necesita además el `project_id` para el
//     `ad_batch` (`getBriefWithProject`, que hace el JOIN). Son dos preguntas distintas.
//   · EL TIER: el worker lo DERIVA (`defaultBatchConfig`), web lo TOMA de la config del usuario.
//     Por eso es un parámetro y no se resuelve dentro.
//   · EL ERROR: sin receta, el worker lanza `PermanentStepError` (el step falla y se puede
//     reintentar tras sembrar) y web lanza un 500 del envelope. `recipe` vuelve `undefined` y cada
//     uno lanza LO SUYO — meter el throw aquí obligaría a que `@ugc/db` conociera los dos.
import type { HookLineSeed, RecipeSeed, RecipeTier } from '@ugc/core/library';
import type { Db } from '../client';
import { getRecipe, listHookLines } from './library.repo';
import { listPersonas } from './persona.repo';
import type { Persona } from '../schema/gallery';

export interface PlanningInputs {
  /** La librería sembrada (T2.1): las líneas con las que se completan los hooks del brief. */
  libraryHooks: HookLineSeed[];
  /**
   * Las personas (T2.0). Las filas van TAL CUAL: satisfacen `PlannablePersona` estructuralmente y
   * re-proyectarlas campo a campo era un no-op y un punto de drift (el mismo que
   * `server/persona-response.ts` documenta como prohibido). Cuando el contrato gane campos, los
   * ganan todos los callers a la vez o no los gana ninguno.
   */
  personas: Persona[];
  /**
   * La receta REAL del tier — `undefined` si la librería no está sembrada. NO se lanza aquí: el
   * error correcto depende de quién pregunte (ver la cabecera). Nunca una constante: el coste que
   * se enseña es el de la fila que T3.4 recalibra.
   */
  recipe: RecipeSeed | undefined;
}

/**
 * Las tres entradas de `planBatch` que viven en la BD, en PARALELO (no dependen entre sí).
 *
 * Se llama en cada cambio de config del panel de CP2, así que encadenarlas sería pagar tres RTT en
 * serie por nada.
 */
export async function listPlanningInputs(db: Db, tier: RecipeTier): Promise<PlanningInputs> {
  const [libraryHooks, personas, recipe] = await Promise.all([
    listHookLines(db),
    listPersonas(db),
    getRecipe(db, tier),
  ]);
  return { libraryHooks, personas, recipe };
}
