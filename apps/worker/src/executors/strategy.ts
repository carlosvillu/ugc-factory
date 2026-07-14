// Executor de N4 · ESTRATEGIA DEL LOTE (T2.3, §7.2 N4: «elegir ángulos y componer la matriz …
// Preview del coste total estimado». **Determinista y $0**: sin LLM, sin red).
//
// QUÉ HACE, Y POR QUÉ TAN POCO. Compone la matriz que CP2 PROPONE al abrirse, y para (es un
// checkpoint: `isCheckpoint: true` en el DAG ⇒ el step cierra en `waiting_approval` con su
// artefacto ya escrito). Toda la aritmética —resolver la config contra el brief, la librería y las
// personas, componer y estimar— vive en `planBatch` (@ugc/core/strategy): aquí no hay ni una
// decisión de negocio. El executor es la cáscara que lee de la BD lo que core no puede leer.
//
// LA MATRIZ QUE ESCRIBE ES UNA PROPUESTA, NO EL LOTE. Se compone SIN `batchDiscriminator` (el
// `ad_batch` todavía no existe), así que sus `filename_code` solo son únicos DENTRO del plan — que
// es exactamente lo que el contrato de `PlannedVariant.filenameCode` prescribe para previsualizar.
// El lote REAL lo crea la aprobación de CP2 (`server/batch-checkpoint.ts` en web), recomponiendo
// la matriz con el id del lote nuevo. Este artefacto no se inserta jamás tal cual.
//
// GRATIS DE VERDAD: no llama a `recordCost` porque no hay coste que registrar ($0 en §7.2). Es el
// primer nodo real del pipeline que no pasa por caja.
import { AnalysisN4ConfigSchema, PermanentStepError } from '@ugc/core/orchestrator';
import type { ExecutorDep, StepExecutor } from '@ugc/core/orchestrator';
import { N3OutputSchema, ProductBriefSchema } from '@ugc/core/contracts';
import { defaultBatchConfig, planBatch } from '@ugc/core/strategy';
import { getBrief, listPlanningInputs, type DbClient } from '@ugc/db';

export interface StrategyExecutorDeps {
  db: DbClient;
}

/** El output de la dep `N3`, ya resuelta POR ULID por el consumer (nunca buscada por `node_key`:
 *  tras un supersede hay DOS filas con el mismo key — executor.ts). */
function briefIdFromN3(deps: ExecutorDep[]): string {
  const dep = deps.find((d) => d.nodeKey === 'N3');
  if (dep === undefined) {
    throw new PermanentStepError('N4: falta la dependencia N3 (el brief del que sale la matriz)');
  }
  const parsed = N3OutputSchema.safeParse(dep.outputRefs);
  if (!parsed.success) {
    throw new PermanentStepError(`N4: el output de N3 no es un brief: ${parsed.error.message}`);
  }
  return parsed.data.briefId;
}

/**
 * N4: compone la matriz propuesta del lote y pausa en CP2.
 *
 * EL BRIEF SE LEE DE LA FILA (`product_brief`), no del inline del artefacto de N3 — y la
 * diferencia importa: si el usuario EDITÓ el brief en CP1, `/edit` creó la v2 y dejó el `briefId`
 * de ESA versión en el `output_refs` del step (`brief-checkpoint.ts`). Componer la matriz sobre el
 * inline sería componerla sobre lo que escribió la IA, ignorando las correcciones del humano — o
 * sea, sobre un brief que él ya rechazó.
 */
export function makeN4Executor(deps: StrategyExecutorDeps): StepExecutor {
  return async (ctx) => {
    const { collectOutput, deps: stepDeps } = ctx;
    if (collectOutput === undefined) {
      throw new PermanentStepError(
        'N4: el ExecutorContext no trae collectOutput (bug de cableado)',
      );
    }

    const config = AnalysisN4ConfigSchema.safeParse(ctx.config);
    if (!config.success) {
      throw new PermanentStepError(`N4: config inválida: ${config.error.message}`);
    }

    const briefId = briefIdFromN3(stepDeps ?? []);
    const briefRow = await getBrief(deps.db, briefId);
    if (briefRow === undefined) {
      throw new PermanentStepError(`N4: el brief ${briefId} del step de N3 no existe`);
    }
    // `product_brief.data` es jsonb OPACO al salir de la BD: se VALIDA contra su contrato, no se
    // castea. Un brief corrupto tiene que reventar AQUÍ (ruidoso) y no colarse en una matriz que
    // el usuario va a aprobar con dinero.
    const brief = ProductBriefSchema.parse(briefRow.data);

    // La config por defecto sale del brief (y su tier, de ella): hay que tenerla ANTES de pedir la
    // receta, que es POR TIER.
    const batchConfig = defaultBatchConfig(brief, config.data.languages);

    // Todo lo que core no puede leer (es la BD) y sin lo cual la matriz sería una invención: la
    // librería sembrada (T2.1), las personas (T2.0) y la receta REAL del tier (nunca una constante:
    // el coste que se enseña es el de la fila que T3.4 recalibra). Es LA MISMA lectura que hace web
    // al estimar y al crear (`listPlanningInputs`, @ugc/db): el brazo compartido del invariante «lo
    // que se propone == lo que se estima == lo que se crea». Si se necesitara una entrada más y solo
    // se añadiera en uno de los dos, el usuario aprobaría una matriz y el sistema crearía otra.
    const { libraryHooks, personas, recipe } = await listPlanningInputs(deps.db, batchConfig.tier);
    if (recipe === undefined) {
      // La librería no está sembrada: sin receta no hay coste que enseñar, y CP2 sin coste es
      // exactamente el botón de «aprueba a ciegas» que este checkpoint existe para no ser.
      // `PermanentStepError` (y no un fallo reintentable): reintentar en bucle contra una BD sin
      // sembrar no arregla nada — el step queda `failed` y `retryStep` lo relanza tras `pnpm seed`.
      throw new PermanentStepError(
        `N4: no hay receta sembrada del tier "${batchConfig.tier}" (¿falta \`pnpm seed\`?): sin ella no se puede estimar el coste del lote`,
      );
    }

    const { plan } = planBatch({
      brief,
      config: batchConfig,
      libraryHooks,
      personas,
      recipe,
    });

    collectOutput({
      briefId,
      brief,
      config: batchConfig,
      plan,
    });
  };
}
