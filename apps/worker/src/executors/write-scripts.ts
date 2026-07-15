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
    if (existing.length > 0) {
      // Reconstruye el artefacto ligero desde las filas ya escritas. `filenameCode` sale de la
      // variante (la fila `ad_script` no lo guarda); los flags, de su columna.
      collectOutput(
        toN5Output(
          batchId,
          existing.map((row) => ({
            scriptId: row.id,
            variantId: row.variantId,
            filenameCode: codeByVariantId.get(row.variantId) ?? '',
            flags: (row.guardrailFlags as GuardrailFlag[] | null) ?? [],
          })),
          'reused',
          [],
        ),
      );
      return;
    }

    // ── ESCRITURA REAL (paga Sonnet 5). El servicio registra el `cost_entry` (record-first) atribuido
    // a ESTE step. NUNCA lanza: estado tipado (`scripted`/`over_budget`/`refused`/`parse_error`/…).
    const result = await runWriteScripts(
      {
        db: deps.db,
        secretsKey: deps.secretsKey,
        fetch: deps.fetch,
        anthropicBaseUrl: deps.anthropicBaseUrl,
      },
      { projectId: batch.projectId, plan, brief, stepRunId: stepId },
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

    collectOutput(toN5Output(batchId, persisted, result.status, result.warnings));
  };
}
