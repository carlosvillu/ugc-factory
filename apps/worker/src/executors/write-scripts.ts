// Executor de N5 · GUIONIZACIÓN (T2.6, §7.2 N5). Molde del executor de N3 (analysis.ts): cáscara
// fina que conecta el orquestador con el servicio `runWriteScripts` (@ugc/services, T2.4) y persiste
// las filas `ad_script` v1 con sus flags FTC. Es el PRIMER step del run de LOTE (batch-dag.ts) y a la
// vez el checkpoint CP3 (`isCheckpoint` + `alwaysPause`): al terminar, el consumer lo deja en
// `waiting_approval` con los guiones ya escritos, y de ahí los recoge el panel del editor.
//
// DE DÓNDE SACA SU TRABAJO. A diferencia de N4 —que arranca de una dependencia (N3) que el
// orquestador le resuelve—, N5 corre en un run NUEVO sin dependencias: su único puntero es el
// `batchId` de su config. De él saca todo: `getBatch` → la matriz (`BatchPlan`) y el `briefId`;
// `getBrief` → el `ProductBrief`. El lote ya existe (lo creó la aprobación de CP2 en la misma tx que
// este run), así que estas lecturas nunca corren una carrera con su creación.
//
// IDEMPOTENCIA DE DINERO (patrón N3, §6.3.9): N5 paga Sonnet 5. Un retry (que conserva el
// `step_run.id`) NO puede re-pagar: `findScriptsByOriginStep(db, stepId)` relee los guiones que ya
// persistió y reusa. Solo si no hay ninguno se llama a `runWriteScripts`.
//
// LOTE COMPLETO O FALLO — NUNCA «ÉXITO PARCIAL» (T5.11, defecto de PRODUCCIÓN destapado por el run
// real de T5.9). El servicio NUNCA lanza: devuelve un estado TIPADO (`scripted`/`over_budget`/
// `refused`/`parse_error`/`api_error`) y los guiones que SÍ consiguió. Ese diseño es correcto para
// los fallos de CONTENIDO, pero el executor lo colapsaba en «terminé bien»: en el run de T5.9 el
// saldo de Anthropic se agotó a mitad de la tanda ⇒ `api_error` con 5 de 12 guiones escritos, y aun
// así el step quedó `waiting_approval` con `error = NULL` y CP3 ofreció «Confirmar guiones» sobre un
// lote TRUNCADO. Aprobarlo dispara generación REAL de fal sobre 5/12 variantes: dinero perdido
// presentado como flujo normal.
//
// La regla, aplicada en `assertCompleteBatch`: los guiones escritos se PERSISTEN siempre (están
// pagados, y el retry manual los reusa sin re-pagar), pero si el proveedor falló (`api_error`) O
// falta algún guion, el step va a `failed` con la causa TIPADA y el recuento real. Un
// error del PROVEEDOR (401/429/saldo/timeout ⇒ `api_error`) se distingue POR TIPO de un fallo de
// CONTENIDO (`refused`/`parse_error`/`over_budget`): son diagnósticos opuestos («recarga y
// reintenta» vs «cambia el guion»), no un estado genérico. Ambos son PERMANENTES (reintentar
// automáticamente contra un saldo agotado solo quema vueltas); el camino de vuelta es el retry
// MANUAL de `POST /api/steps/:id/retry`, que conserva el `step_run.id` ⇒ entra por la rama de reuso.
//
// Y LA RAMA DE REUSO NO PUEDE LIMITARSE A CORTOCIRCUITAR (el agujero de un salto): un retry sobre
// 5/12 filas ya escritas devolvía `reused` y declaraba éxito igual. Pero fallar ahí y ya sería un
// callejón sin salida —el lote nunca se completaría por ningún camino del producto—, así que el reuso
// solo cortocircuita cuando el lote está COMPLETO; truncado, hace TOP-UP: re-guioniza SOLO las
// variantes sin guion (plan filtrado) y las suma a las que ya estaban. Las pagadas no se re-pagan.
//
// EL EMPAREJAMIENTO guion↔variante. `runWriteScripts` devuelve `AdScript[]` identificados por
// `filenameCode` (core no conoce la BD). Para persistir cada guion hace falta el `ad_variant.id`:
// se resuelve `filenameCode → id` con `listBatchVariants`. Un guion cuyo `filenameCode` no case con
// ninguna variant es un fallo DURO (PermanentStepError): dejarlo caer en silencio dejaría una
// variante sin guion, que nunca llegaría a `scripted` — y la Verificación asserta las 6 en `scripted`.
import { AnalysisN5ConfigSchema, PermanentStepError } from '@ugc/core/orchestrator';
import type { ExecutorDep, StepExecutor } from '@ugc/core/orchestrator';
import {
  BatchPlanSchema,
  ProductBriefSchema,
  type GuardrailFlag,
  type N5Output,
} from '@ugc/core/contracts';
import { lintScriptForBrief } from '@ugc/core/scripting';
import {
  createScriptsForBatch,
  findScriptsByOriginStep,
  getBatch,
  getBrief,
  listBatchVariants,
  type DbClient,
  type ScriptToPersist,
} from '@ugc/db';
import { runWriteScripts } from '@ugc/services';

/** Deps de N5, cableadas por el composition root del worker. Como N5 PAGA (Sonnet 5), estrena su
 *  propio grupo de deps (BD + secretos + overrides de test) — no le basta el `{ db }` de N4. */
export interface WriteScriptsExecutorDeps {
  db: DbClient;
  /** Clave descifrante de secretos (T0.14), derivada de la master key en el bootstrap. */
  secretsKey: Buffer;
  fetch?: typeof globalThis.fetch;
  anthropicBaseUrl?: string;
}

/** Lo que el consumer SIEMPRE inyecta en producción. Sin ellos, N5 es un bug de CABLEADO (no un caso
 *  a tolerar): `collectOutput` es tan obligatorio como el `stepId`, y por dinero — sin él, N5 pagaría
 *  Sonnet y terminaría con `output_refs` vacío, y CP3 abriría sobre un lote sin guiones. */
function requireContext(ctx: {
  stepId?: string;
  collectOutput?: (outputRefs: unknown) => void;
  deps?: ExecutorDep[];
}): { stepId: string; collectOutput: (outputRefs: unknown) => void } {
  const { stepId, collectOutput } = ctx;
  if (stepId === undefined || collectOutput === undefined) {
    throw new PermanentStepError(
      'N5: el ExecutorContext no trae stepId/collectOutput (bug de cableado)',
    );
  }
  return { stepId, collectOutput };
}

/** Construye el artefacto LIGERO de N5 a partir de las filas persistidas (patrón: la verdad vive en
 *  la tabla; el artefacto solo lleva refs para el excerpt SSE y para que el panel sepa a qué lote
 *  pedir). `blocked` se deriva de los flags de CADA guion. */
function toN5Output(
  batchId: string,
  persisted: {
    scriptId: string;
    variantId: string;
    filenameCode: string;
    flags: GuardrailFlag[];
  }[],
  status: string,
  warnings: string[],
): N5Output {
  return {
    batchId,
    scriptRefs: persisted.map((p) => ({
      variantId: p.variantId,
      scriptId: p.scriptId,
      filenameCode: p.filenameCode,
      blocked: p.flags.some((f) => f.blocking),
    })),
    status,
    warnings,
  };
}

/** Estados del guionista que significan «el proveedor no nos dejó terminar» (infraestructura), por
 *  oposición a los de CONTENIDO (`refused`/`parse_error`/`over_budget`, decisiones del modelo sobre
 *  un texto dado). La distinción viaja al mensaje del fallo porque el diagnóstico es OPUESTO:
 *  `api_error` se arregla FUERA del producto (recargar saldo, arreglar la key, esperar el rate
 *  limit) y luego se reintenta el MISMO step; un `refused` no mejora reintentando. */
const PROVIDER_FAILURE_STATUSES: ReadonlySet<string> = new Set(['api_error']);

function describeFailureCause(status: string): string {
  return PROVIDER_FAILURE_STATUSES.has(status)
    ? `fallo del PROVEEDOR (${status}: saldo/401/429/timeout — recarga o corrige la clave y reintenta el step)`
    : `fallo de CONTENIDO (${status})`;
}

/**
 * GATE DE COMPLETITUD (T5.11). Un lote de guiones es «hecho» solo si hay un guion por variante Y el
 * guionista no murió por el PROVEEDOR. Cualquier otra cosa —incluido un `api_error` con k<n guiones
 * ya escritos y PAGADOS— es un FALLO del step, con la causa tipada y el recuento real en el mensaje.
 * Lanza `PermanentStepError` para NO reintentar automáticamente (un saldo agotado no se arregla en la
 * vuelta siguiente y cada vuelta puede pagar tokens); el retry MANUAL sigue disponible y COMPLETA el
 * lote con el top-up de la rama de reuso.
 *
 * NO borra los guiones parciales: están pagados y el top-up los aprovecha en cuanto el proveedor
 * vuelva. Lo que se prohíbe no es tenerlos, es PRESENTARLOS COMO EL LOTE COMPLETO.
 */
function assertCompleteBatch(
  batchId: string,
  status: string,
  writtenCount: number,
  expectedCount: number,
): void {
  // DOS condiciones INDEPENDIENTES, no una:
  //   · la CUENTA (un guion por variante) caza `refused`/`parse_error` —que devuelven `scripts: []`—
  //     y cualquier tanda cortada a mitad;
  //   · el TIPO caza el fallo del PROVEEDOR aunque por casualidad hubieran salido todos.
  // Lo que NO se gatea por tipo es `over_budget`: devuelve el LOTE COMPLETO (script-writer.ts:631) y
  // está DISEÑADO para llegar a CP3 («el usuario lo recorta en CP3»). Fallar ahí sería una regresión
  // nueva: un lote completo pero largo dejaría de poder recortarse.
  const complete = writtenCount === expectedCount;
  if (complete && !PROVIDER_FAILURE_STATUSES.has(status)) return;
  throw new PermanentStepError(
    `N5: el lote ${batchId} quedó INCOMPLETO — ${String(writtenCount)}/${String(expectedCount)} guiones escritos, ` +
      `${describeFailureCause(status)}. No se pausa en CP3: aprobar un lote truncado dispararía generación de pago ` +
      `sobre las variantes que sí tienen guion.`,
  );
}

/**
 * N5: escribe los guiones del lote, los lintea (FTC, T2.5) y los persiste v1 + pausa en CP3.
 */
export function makeN5Executor(deps: WriteScriptsExecutorDeps): StepExecutor {
  return async (ctx) => {
    const { stepId, collectOutput } = requireContext(ctx);

    const parsed = AnalysisN5ConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      throw new PermanentStepError(`N5: config inválida: ${parsed.error.message}`);
    }
    const { batchId } = parsed.data;

    // El lote y el brief (la fila es la fuente de verdad; su jsonb se VALIDA, no se castea).
    const batch = await getBatch(deps.db, batchId);
    if (batch === undefined) {
      throw new PermanentStepError(`N5: el lote ${batchId} no existe`);
    }
    const plan = BatchPlanSchema.parse(batch.matrix);
    const briefRow = await getBrief(deps.db, batch.briefId);
    if (briefRow === undefined) {
      throw new PermanentStepError(`N5: el brief ${batch.briefId} del lote no existe`);
    }
    const brief = ProductBriefSchema.parse(briefRow.data);

    // Las variantes del lote: los dos mapas de traducción entre `filenameCode` e `id` (una dirección
    // para persistir cada guion; la otra para reconstruir el artefacto ligero desde las filas). Se
    // construyen UNA vez —`variants` no se muta— y sirven a las dos ramas (reuso y escritura).
    const variants = await listBatchVariants(deps.db, batchId);
    const variantIdByCode = new Map(variants.map((v) => [v.filenameCode, v.id]));
    const codeByVariantId = new Map(variants.map((v) => [v.id, v.filenameCode]));

    // ── IDEMPOTENCIA DE DINERO ── ¿ya escribí yo los guiones de este step? Si sí, se REUSAN y NO se
    // vuelve a pagar Sonnet 5 (patrón N3). La clave es el `step_run.id`: un retry lo conserva; un
    // re-run del pipeline crea steps nuevos (y SÍ debe re-guionizar).
    const existing = await findScriptsByOriginStep(deps.db, stepId);
    const reusedRefs = existing.map((row) => ({
      scriptId: row.id,
      variantId: row.variantId,
      filenameCode: codeByVariantId.get(row.variantId) ?? '',
      flags: (row.guardrailFlags as GuardrailFlag[] | null) ?? [],
    }));
    if (existing.length >= variants.length) {
      // LOTE COMPLETO ya escrito por ESTE step: se reusa tal cual y NO se vuelve a pagar Sonnet 5.
      collectOutput(toN5Output(batchId, reusedRefs, 'reused', []));
      return;
    }

    // ── TOP-UP DE UN LOTE TRUNCADO (T5.11) ──────────────────────────────────────────────────────
    // `existing.length < variants.length` con `existing.length > 0` = el retry de una tanda que murió
    // a mitad (saldo agotado). NO se puede cortocircuitar en `reused` (sería el bug de un salto más
    // tarde: éxito declarado sobre 5/12) NI se puede fallar sin más (dejaría el lote en un callejón
    // sin salida: la Entrega de T5.11 nombra el retry granular como el camino de vuelta). Se COMPLETA:
    // se re-guioniza SOLO lo que falta, filtrando el plan a las variantes SIN guion.
    //
    // POR QUÉ EL FILTRO ES SEGURO: `groupVariantsForScripting` agrupa por `segmentKeys.body`, así que
    // un plan filtrado produce EXACTAMENTE los grupos que faltan, cada uno con su `sharedBodyKey`
    // intacto. Y por qué NO se re-escribe el lote entero: los guiones que ya están se PAGARON — pagar
    // otra vez por ellos para arreglar un bug de dinero sería contradecir la tarea.
    const writtenVariantIds = new Set(existing.map((row) => row.variantId));
    const missingCodes = new Set(
      variants.filter((v) => !writtenVariantIds.has(v.id)).map((v) => v.filenameCode),
    );
    const planToWrite =
      missingCodes.size === variants.length
        ? plan
        : { ...plan, variants: plan.variants.filter((v) => missingCodes.has(v.filenameCode)) };

    // ── ESCRITURA REAL (paga Sonnet 5). El servicio registra el `cost_entry` (record-first) atribuido
    // a ESTE step. NUNCA lanza: estado tipado (`scripted`/`over_budget`/`refused`/`parse_error`/…).
    const result = await runWriteScripts(
      {
        db: deps.db,
        secretsKey: deps.secretsKey,
        fetch: deps.fetch,
        anthropicBaseUrl: deps.anthropicBaseUrl,
      },
      { projectId: batch.projectId, plan: planToWrite, brief, stepRunId: stepId },
    );

    // Lintea cada guion con el MISMO brief (bannedClaims/briefLanguage de `lintScriptForBrief`) y
    // resuelve su variante. Los flags se persisten DESDE EL ARRANQUE: el bloqueo de CP3 no distingue
    // v1 de v2, así que la v1 tiene que llegar con sus flags para que un guion bloqueante nunca se
    // apruebe por descuido.
    const toPersist: ScriptToPersist[] = [];
    const flagsByCode = new Map<string, GuardrailFlag[]>();
    for (const script of result.scripts) {
      const variantId = variantIdByCode.get(script.filenameCode);
      if (variantId === undefined) {
        // Un guion sin variante que lo reciba: dejarlo caer dejaría una variante scriptless que
        // nunca llega a `scripted`. Es un desajuste plan↔lote, no un caso a tolerar.
        throw new PermanentStepError(
          `N5: el guion "${script.filenameCode}" no casa con ninguna variante del lote ${batchId}`,
        );
      }
      const flags = lintScriptForBrief(script, brief);
      flagsByCode.set(script.filenameCode, flags);
      toPersist.push({ variantId, content: script, guardrailFlags: flags });
    }

    const created = await createScriptsForBatch(deps.db, { stepRunId: stepId, scripts: toPersist });

    // Empareja las filas creadas con su `filenameCode`/flags para el artefacto ligero.
    const persisted = created.map((row) => {
      const filenameCode = codeByVariantId.get(row.variantId) ?? '';
      return {
        scriptId: row.id,
        variantId: row.variantId,
        filenameCode,
        flags: flagsByCode.get(filenameCode) ?? [],
      };
    });

    // El lote es lo YA reusado (top-up) + lo recién escrito. En el camino normal `reusedRefs` es
    // vacío y esto es exactamente lo de antes.
    const allRefs = [...reusedRefs, ...persisted];

    // GATE DE COMPLETITUD (T5.11) — DESPUÉS de persistir (los guiones escritos están pagados y se
    // conservan para el retry) y ANTES de emitir el artefacto: si el proveedor falló a mitad, el
    // step va a `failed` con la causa tipada, no a `waiting_approval` con `error = NULL`.
    assertCompleteBatch(batchId, result.status, allRefs.length, variants.length);

    collectOutput(toN5Output(batchId, allRefs, result.status, result.warnings));
  };
}
