// EL SEAM de CP2 (T2.3): estimar el lote de una config, y CREARLO al aprobar el checkpoint.
//
// POR QUÉ VIVE AQUÍ Y NO EN CORE — mismo argumento que `brief-checkpoint.ts`: `approveStep` es una
// operación GENÉRICA del orquestador (mueve estados, invalida sub-grafos, audita diffs) y no sabe
// —ni debe saber— qué hay dentro de un `output_refs`. El efecto de DOMINIO se compone FUERA, en el
// route handler, DENTRO de la misma transacción. Y por qué no en core: core no conoce la BD, y esto
// es LEER la librería/las personas/la receta y ESCRIBIR el lote. La aritmética (componer la matriz
// y estimarla) sí es de core: `planBatch` (@ugc/core/strategy). Aquí no se calcula ni un céntimo.
//
// ── LA REGLA DE ORO: LO QUE SE ESTIMA ES LO QUE SE CREA ──────────────────────────────────────
// Estimar y confirmar llaman a la MISMA función (`planBatch`) con los MISMOS datos (el brief de la
// fila, la librería sembrada, las personas, la receta del tier). Lo ÚNICO que cambia es el
// `batchDiscriminator`: vacío al previsualizar (el `ad_batch` no existe todavía), el id del lote al
// persistir. Si hubiera dos caminos de aritmética, el usuario aprobaría un número y el sistema
// crearía otro — y ese es el bug que ningún test de UI cazaría.
//
// ── ATOMICIDAD (misma lección que T1.10b) ───────────────────────────────────────────────────
// El lote se crea en la MISMA tx que la transición del step. Si `approveStep` commiteara y la
// creación del lote fallara después, el run habría REANUDADO aguas abajo (hacia N5, el
// ScriptWriter) sin lote que guionizar — y sin forma de reintentar (un segundo POST daría 409: el
// step ya no está en `waiting_approval`). El usuario habría confirmado un gasto que no existe.
import {
  N4OutputSchema,
  ProductBriefSchema,
  type BatchConfig,
  type BatchEstimate,
  type CheckpointDecision,
} from '@ugc/core/contracts';
import { planBatch } from '@ugc/core/strategy';
import {
  createBatchWithVariants,
  findStep,
  getBriefWithProject,
  listPlanningInputs,
  type CreatedBatch,
  type Db,
} from '@ugc/db';
import { AppError } from '@ugc/core/contracts';

/** Lo que el servidor aporta y el cliente no puede aportar: los datos de la BD. Se lee UNA vez y
 *  se usa para estimar y (si toca) para crear — de nuevo, para que las dos vean lo mismo. */
async function loadPlanningData(db: Db, briefId: string, config: BatchConfig) {
  // LAS LECTURAS VAN EN PARALELO: ninguna depende de otra (el `briefId` ya viene resuelto), y esto
  // corre en CADA cambio de config del panel — encadenarlas era pagar 4 RTT en serie para nada.
  //
  // La terna que `planBatch` necesita (`libraryHooks` + `personas` + `recipe`) se pide con
  // `listPlanningInputs`, LA MISMA que usa el worker en N4: es el brazo compartido del invariante
  // «lo que se propone == lo que se estima == lo que se crea». Lo que diverge legítimamente se
  // queda aquí — el brief se pide CON su proyecto (el `ad_batch.project_id` es NOT NULL), y el
  // error de «sin receta» lo lanza cada caller con SU tipo.
  const [found, inputs] = await Promise.all([
    getBriefWithProject(db, briefId),
    listPlanningInputs(db, config.tier),
  ]);

  // Las COMPROBACIONES, después y en el MISMO orden que antes: el 404 del brief tiene que seguir
  // ganando al 500 de la receta (si no existe el brief, que la librería esté sin sembrar es una
  // información secundaria — y culpar al seed de una petición a un brief inexistente despista).
  if (found === undefined) {
    throw new AppError('not_found', `el brief ${briefId} no existe`);
  }
  if (inputs.recipe === undefined) {
    // Sin receta no hay coste que enseñar, y CP2 sin coste es el botón de «aprueba a ciegas» que
    // este checkpoint existe para no ser. 500 (es drift NUESTRO: la librería debería estar
    // sembrada), no un 400 que culpe al usuario de una config perfectamente válida.
    throw new Error(`no hay receta sembrada del tier "${config.tier}" (¿falta \`pnpm seed\`?)`);
  }

  return {
    // `product_brief.data` es jsonb opaco: se VALIDA, no se castea (un brief corrupto no puede
    // llegar a una matriz que el usuario va a aprobar con dinero).
    brief: ProductBriefSchema.parse(found.brief.data),
    projectId: found.projectId,
    libraryHooks: inputs.libraryHooks,
    personas: inputs.personas,
    recipe: inputs.recipe,
  };
}

/**
 * UNA CONFIG IMPOSIBLE ES UN 400, NO UN 500.
 *
 * `composeMatrix` LANZA (`Error`) cuando la config no produce ni una variante — p. ej. ángulos
 * cuyos `hook_examples` están vacíos y sin líneas de librería en el idioma pedido. Es la defensa
 * correcta (el estimador es lo último antes de aprobar un gasto: ante un input imposible RECHAZA,
 * no inventa una cifra creíble), pero un `Error` pelado sale por el envelope como **500**, y esto
 * NO es un bug nuestro: es una selección que el usuario puede hacer y que el panel debe poder
 * explicarle. Se traduce a `validation_error` (400) CONSERVANDO el mensaje de core, que dice
 * exactamente qué pasó («ningún ángulo seleccionado produjo hooks…»).
 */
function toConfigError(err: unknown): never {
  if (err instanceof AppError) throw err;
  if (err instanceof Error) {
    throw new AppError('validation_error', err.message);
  }
  throw err;
}

/**
 * El `briefId` de un step de CP2, sacado de SU artefacto. Es la ÚNICA procedencia del brief, tanto
 * al estimar como al crear.
 *
 * POR QUÉ NO SE ACEPTA EL `briefId` DEL CLIENTE (aunque «solo» sea para estimar): la creación ya lo
 * sacaba del artefacto —el cliente no puede elegir de qué brief se compone un lote—, pero la
 * estimación lo tomaba del body validándolo solo como ULID. Un caller autenticado podía así estimar
 * CUALQUIER brief de la BD y recibir de vuelta sus ángulos, sus hooks y los nombres de las personas
 * candidatas. Hoy el producto es mono-usuario y el impacto es bajo; la asimetría (crear valida el
 * origen, estimar no) es justo el hueco que sobrevive hasta el día en que deja de ser inocuo. Con
 * esto hay UNA sola procedencia del brief para las dos operaciones, que es además el invariante que
 * el resto de la tarea ya defiende: **lo que se estima es lo que se crea**.
 */
async function briefIdOfMatrixStep(db: Db, stepId: string): Promise<string> {
  const step = await findStep(db, stepId);
  if (step === undefined) {
    throw new AppError('not_found', `el step ${stepId} no existe`);
  }
  const artifact = N4OutputSchema.safeParse(step.outputRefs);
  if (!artifact.success) {
    // Se discrimina por la FORMA del artefacto, nunca por `node_key` (T0.8: un supersede hace que
    // `node_key` no identifique una fila). Un step que no es CP2 no tiene matriz que estimar.
    throw new AppError(
      'validation_error',
      'el step no es un checkpoint de matriz (su output no es un N4Output): no hay lote que estimar',
    );
  }
  return artifact.data.briefId;
}

/**
 * PREVISUALIZAR: la matriz que saldría de esta config y lo que costaría. Sin `batchDiscriminator`
 * — el lote no existe, y el contrato de `PlannedVariant.filenameCode` dice que así es como se
 * previsualiza (los códigos son únicos DENTRO del plan, que es lo correcto para pintarlos).
 *
 * Toma el `stepId` (no el `briefId`): ver `briefIdOfMatrixStep`.
 */
export async function estimateBatch(
  db: Db,
  stepId: string,
  config: BatchConfig,
): Promise<BatchEstimate> {
  const briefId = await briefIdOfMatrixStep(db, stepId);
  const data = await loadPlanningData(db, briefId, config);
  try {
    const { plan, estimate } = planBatch({
      brief: data.brief,
      config,
      libraryHooks: data.libraryHooks,
      personas: data.personas,
      recipe: data.recipe,
    });
    return { plan, estimate };
  } catch (err) {
    toConfigError(err);
  }
}

/**
 * EFECTO DE DOMINIO de aprobar CP2: crea el `ad_batch` y sus `ad_variant` en `planned`.
 *
 * NO-OP si el step no es un checkpoint de MATRIZ o si el body no trajo decisión — se discrimina
 * por la FORMA DEL ARTEFACTO (`N4OutputSchema`), igual que CP1 (`parseBriefOutput`), y NUNCA por
 * `node_key` (que no identifica una fila tras un supersede, T0.8).
 *
 * ⚠ LA DECISIÓN MANDA SOBRE EL ARTEFACTO. El `N4Output` trae la config que el SISTEMA propuso;
 * la `decision` trae la que el USUARIO confirmó. Se usa la del usuario, por definición de
 * checkpoint. El artefacto solo aporta el `briefId` (qué brief se está guionizando) — y ese SÍ es
 * del sistema: dejar que el cliente eligiera el brief sería dejarle componer un lote de un brief
 * que este run no aprobó.
 *
 * ⚠ EL `batchDiscriminator` ES OBLIGATORIO AQUÍ (contrato de `PlannedVariant.filenameCode`): la
 * matriz se recompone DENTRO de `createBatchWithVariants` con el id del lote nuevo. Sin él, dos
 * lotes del mismo brief con la misma config producirían los MISMOS `filename_code` y el segundo
 * INSERT reventaría contra el UNIQUE GLOBAL de §12 — un 500 justo al confirmar el gasto, que es el
 * peor momento posible.
 */
export async function createBatchForStep(
  db: Db,
  outputRefs: unknown,
  decision: CheckpointDecision | undefined,
): Promise<CreatedBatch | undefined> {
  if (decision?.kind !== 'matrix') return undefined;

  const artifact = N4OutputSchema.safeParse(outputRefs);
  if (!artifact.success) {
    // Una decisión `matrix` sobre un step que NO es CP2: el caller está confundido y tragárselo
    // crearía un lote colgado de un checkpoint que no lo autorizó.
    throw new AppError(
      'validation_error',
      'el step no es un checkpoint de matriz (su output no es un N4Output): una decisión `matrix` aquí no significa nada',
    );
  }

  const config = decision.config;
  const data = await loadPlanningData(db, artifact.data.briefId, config);

  // Se ESTIMA de nuevo con la config confirmada (no se confía en ningún número del cliente): es lo
  // que se persiste en `ad_batch.cost_estimated_cents` — el gasto AUTORIZADO.
  const args = {
    brief: data.brief,
    config,
    libraryHooks: data.libraryHooks,
    personas: data.personas,
    recipe: data.recipe,
  };
  const estimate = ((): ReturnType<typeof planBatch>['estimate'] => {
    try {
      return planBatch(args).estimate;
    } catch (err) {
      // Misma traducción que al estimar: una config que no compone matriz es un 400, no un 500 —
      // y aquí ADEMÁS impide crear el lote, que es lo que importa.
      toConfigError(err);
    }
  })();

  return createBatchWithVariants(db, {
    projectId: data.projectId,
    briefId: artifact.data.briefId,
    tier: config.tier,
    objective: config.objective,
    languages: config.languages,
    // El TECHO de la horquilla: lo que se autoriza a gastar es el máximo de lo que se enseñó, no
    // su suelo. Presupuestar por el mínimo sería prometer un lote más barato de lo que puede salir.
    costEstimatedCents: estimate.total.maxCents,
    composePlan: (batchId) => planBatch({ ...args, batchDiscriminator: batchId }).plan,
  });
}
