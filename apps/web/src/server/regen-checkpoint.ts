// LA OP «REGENERAR» DE CP4 (CU4, T5.8, §22.4): la tercera acción del checkpoint de QA (N9), la que
// T5.5c difirió aquí. Aprobar/rechazar (qa-checkpoint.ts) resuelven la variante EN SU SITIO; regenerar es
// distinto — NO toca la variante aprobada, sino que CLONA la variante con un cambio (el CTA) y arranca un
// RUN DE GENERACIÓN NUEVO `kind='regen'` que regenera SOLO lo que el cambio afecta y REUTILIZA el resto.
//
// ── POR QUÉ ES UN CLON + UN RUN DE GENERACIÓN COMPLETO (y no un «DAG recortado») ──────────────────────
// N8 (composición) ENSAMBLA su máster SOLO desde sus deps N7 (`assembleCompositionSpec` sobre `ctx.deps`,
// `findDepBySchema` — compose-variant.ts): no hace lookup de assets «sueltos» de la variante. Así que un
// máster nuevo EXIGE que N8 tenga como deps los N7 de esta generación — es decir, el sub-DAG de generación
// COMPLETO (N6→N7a-e→N8→N9) de la variante clon. La «regeneración parcial» NO se consigue recortando el
// DAG, sino por la DEDUP de T4.10: los N7 NO afectados por el cambio de CTA recomputan el MISMO
// `resolved_prompt` (hook/body idénticos) → `content_hash` HIT → coste $0 y MISMO asset (product shots
// N7a, avatar N7c, b-roll N7d — los caros). Solo el nodo del CTA (N7f) y la voz de la escena cta (N7b)
// tienen prompt distinto → se regeneran (céntimos, < $0,50 del criterio 22.4). Por eso NO hay un mecanismo
// nuevo de DAG-slicing: se COMPONE el sub-DAG de generación normal (reuso de `generationRunDefinition` +
// `buildVariantGenerationPlan`) para el clon, con `kind='regen'`, y la economía es EMERGENTE de la dedup.
//
// ── EL DECOUPLE `isTierGenerationReady` (regresión T4.11, restricción dura de T5.8) ───────────────────
// `buildVariantGenerationPlan` LANZA `PermanentStepError` por TRES causas: voz incoherente, persona sin
// imagen (bugs REALES) y endpoint-aún-etiqueta (benigno, pendiente-F4). Si se construyera el plan dentro
// de la tx sin gate, el throw benigno de un tier no generation-ready revertiría la clonación en silencio
// (justo el bug que rompió el E2E de F2). Se gatea con el PREDICADO explícito `isTierGenerationReady`
// ANTES de construir el plan (NO un try/catch que tragaría las tres causas). A DIFERENCIA de CP3
// (best-effort: un tier no listo deja la variante `scripted` sin run), aquí regenerar SÍ exige generar:
// un tier no listo es un error del usuario (`validation_error`) — no hay «regenerar a medias».
//
// ── ATOMICIDAD (patrón `approveScriptsForStep`) ──────────────────────────────────────────────────────
// El clon + el guion + `createRun` (el run regen con su sub-DAG encolado) van en la MISMA tx del
// checkpoint (el `withTransaction` del route). Si `createRun` falla, el clon se deshace con el rollback —
// no queda una variante clon huérfana sin run que la genere.
import {
  N9OutputSchema,
  ProductBriefSchema,
  BatchPlanSchema,
  reconstructAdScriptFromRow,
  AppError,
  type AdScript,
  type GuardrailFlag,
} from '@ugc/core/contracts';
import { lintScriptForBrief, rebuildEditedScript } from '@ugc/core/scripting';
import {
  createRun,
  generationRunDefinition,
  withComposition,
  type VariantGenerationPlan,
  type WithTransaction,
} from '@ugc/core/orchestrator';
import {
  cloneVariantForRegen,
  findStepForRegenGuard,
  markStepRegenSpawned,
  getBatch,
  getBrief,
  getLatestScriptsByBatch,
  getVariant,
  withDomainTransaction,
  type Db,
} from '@ugc/db';
import type { PgBoss } from 'pg-boss';
import type { Logger } from '@ugc/core/observability';
import { buildVariantGenerationPlan, isTierGenerationReady } from '@ugc/services';

/** El resultado de regenerar: el id del RUN DE GENERACIÓN `kind='regen'` arrancado (el cliente navega a su
 *  canvas para ver el progreso del run parcial, patrón `nextRunId` de CP2/CP3). */
export interface RegenCheckpointResult {
  nextRunId: string;
}

/**
 * LA ACCIÓN «regenerar» de CP4, EN UNA TX, IDEMPOTENTE (T5.8). Envuelve `withDomainTransaction` para que el
 * lock del N9 + el guard + el clon + el run + el marcador vivan en la MISMA tx. Es el seam que la ruta HTTP
 * y el test de concurrencia llaman (el test lanza DOS de estas SOLAPADAS y comprueba que solo una crea el
 * run — el lock de Postgres es el mecanismo bajo prueba).
 *
 * ── EL DOBLE-CHECK-LOCK (bug de dinero: POST /regenerate NO es idempotente) ────────────────────────────
 * Regenerar NO resuelve el N9 (se queda `waiting_approval` a propósito: el usuario aún puede aprobar/rechazar
 * la variante original), así que el guard de estado NO frena un 2º POST. Dos POST sobre el mismo N9 (retry de
 * red, dos pestañas) crearían DOS clones + DOS runs `kind=regen` = DOBLE gasto fal real, sin señal. El freno:
 *   1. `findStepForRegenGuard` toma `SELECT … FOR UPDATE` sobre la fila N9 → la 2ª petición ESPERA aquí.
 *   2. Si `spawnedRegenRunId != null` (esta petición o una previa ya lanzó su regen) → 409 `invalid_transition`.
 *   3. Tras crear el run, `markStepRegenSpawned` fija el marcador DENTRO de la tx, bajo el lock.
 * La 2ª tx, bloqueada en el `FOR UPDATE`, despierta al commitear la 1ª, RELEE la fila (READ COMMITTED), ve el
 * marcador → 409. De paso, serializar el N9 serializa el read-modify-write de `ad_batch.matrix` de
 * `cloneVariantForRegen` (2º bug latente: dos regens concurrentes perdían un clon de la matriz por
 * last-write-wins) — un solo mecanismo mata ambos.
 *
 * DECISIÓN DE PRODUCTO (intencional): "un regen por N9 origen" impide re-regenerar la MISMA variante original
 * dos veces desde el MISMO checkpoint. Aceptable: el usuario regenera desde el N9 del run MÁS RECIENTE (flujo
 * forward natural) — no se pierde capacidad.
 */
export async function spawnRegenForStep(
  db: Db,
  boss: PgBoss,
  logger: Logger,
  stepId: string,
  ctaText: string,
): Promise<RegenCheckpointResult> {
  return withDomainTransaction(db, boss, logger, async ({ db: tx, withTransaction }) => {
    // 1. LOCK del N9 (`FOR UPDATE`): la 2ª petición concurrente espera aquí hasta el commit de la 1ª.
    const step = await findStepForRegenGuard(tx, stepId);
    if (step === undefined) {
      throw new AppError('not_found', 'step no encontrado');
    }
    // 2. Guard de checkpoint pausado: regenerar solo tiene sentido sobre un N9 en `waiting_approval`.
    if (step.status !== 'waiting_approval') {
      throw new AppError(
        'invalid_transition',
        'solo se puede regenerar desde un checkpoint de QA pausado (waiting_approval)',
      );
    }
    // 3. Guard de IDEMPOTENCIA: este N9 ya lanzó su regen → 409 (no un 2º clon+run = doble gasto). La 2ª
    //    petición ve el marcador que la 1ª fijó bajo el mismo lock.
    if (step.spawnedRegenRunId !== null) {
      throw new AppError(
        'invalid_transition',
        'esta variante ya tiene una regeneración en curso desde este checkpoint (navega a ella para aprobar/rechazar)',
      );
    }
    // 4. EL EFECTO (clon + run `kind=regen`), atómico con el lock (patrón `approveScriptsForStep`).
    const spawned = await regenerateVariantCta(tx, withTransaction, step.outputRefs, ctaText);
    // 5. Fijar el marcador DENTRO de la tx, bajo el lock: la 2ª petición lo verá al despertar.
    await markStepRegenSpawned(tx, stepId, spawned.nextRunId);
    return spawned;
  });
}

/**
 * Efecto «regenerar» de CP4: clona la variante del máster N9 con el CTA cambiado y arranca su run de
 * generación `kind='regen'`. Discrimina el artefacto por `N9OutputSchema` (la variante origen es
 * `N9Output.variantId`): un `output_refs` que no es de N9 es un caller confundido → `validation_error`
 * (a diferencia de aprobar/rechazar, que no-opean: regenerar SIEMPRE se pide sobre un N9 concreto, y un
 * step equivocado debe fallar ruidoso, no arrancar un run sobre una variante equivocada).
 *
 * `ctaText` es el CTA HABLADO nuevo (la narración de la escena `cta`). Se aplica sobre la narración de la
 * escena `cta` del guion vigente y `rebuildEditedScript` recomputa `cta`/`fullText`/timing (misma mecánica
 * que la edición de CP3) — el resto del guion (hook, body) queda BYTE A BYTE idéntico, que es lo que hace
 * que sus N7 dedupliquen.
 */
export async function regenerateVariantCta(
  db: Db,
  withTransaction: WithTransaction,
  outputRefs: unknown,
  ctaText: string,
): Promise<RegenCheckpointResult> {
  const parsed = N9OutputSchema.safeParse(outputRefs);
  if (!parsed.success) {
    throw new AppError('validation_error', 'el step a regenerar no es un checkpoint de QA (N9)');
  }
  const sourceVariantId = parsed.data.variantId;

  const variant = await getVariant(db, sourceVariantId);
  if (variant === undefined) {
    throw new AppError('not_found', `la variante ${sourceVariantId} del step N9 no existe`);
  }
  const batch = await getBatch(db, variant.batchId);
  if (batch === undefined) {
    throw new AppError('not_found', `el lote ${variant.batchId} de la variante no existe`);
  }

  // TIER GENERATION-READY (restricción dura 1, decouple de la regresión T4.11): se comprueba ANTES de
  // clonar y de construir el plan. Un tier no listo (b-roll aún etiqueta, §13.1) NO puede regenerar — se
  // rechaza con `validation_error` (regenerar EXIGE generar; no hay estado «regenerado a medias»). Así el
  // throw benigno endpoint-pendiente-F4 de `buildVariantGenerationPlan` NO puede colarse dentro de la tx.
  if (!(await isTierGenerationReady(db, batch.tier))) {
    throw new AppError(
      'validation_error',
      `el tier '${batch.tier}' aún no es generation-ready (endpoints pendientes, §13.1): no se puede regenerar`,
    );
  }

  // Reconstruir el `AdScript` VIGENTE de la variante origen (fila + matriz, patrón `readBatchScripts`):
  // `AdScriptSchema` exige `filenameCode` (de `ad_variant`) y `sharedBodyKey` (de la matriz del lote).
  const latest = await getLatestScriptsByBatch(db, variant.batchId);
  const current = latest.find((l) => l.variantId === sourceVariantId);
  if (current === undefined) {
    throw new AppError(
      'validation_error',
      `la variante ${sourceVariantId} no tiene guion vigente que regenerar`,
    );
  }
  const plan = BatchPlanSchema.parse(batch.matrix);
  const planned = plan.variants.find((v) => v.filenameCode === current.filenameCode);
  if (planned === undefined) {
    throw new AppError(
      'validation_error',
      `la variante ${sourceVariantId} no está en la matriz de su lote (linaje roto)`,
    );
  }
  const currentScript = reconstructAdScriptFromRow(
    current.script,
    current.filenameCode,
    planned.segmentKeys.body,
  );

  // Aplicar el CTA nuevo sobre la narración de la escena `cta` y RECOMPUTAR el guion (timing/fullText/cta
  // derivan de las narraciones — `rebuildEditedScript`, la MISMA mecánica que la edición de CP3). El hook y
  // el body quedan intactos → sus N7 dedup; solo la escena cta cambia → N7f (y la voz cta de N7b) regeneran.
  const editedScript = applyCtaToScript(currentScript, ctaText);

  // Re-lint con el brief del lote (paridad con CP3): un CTA nuevo podría introducir un claim FTC. Si mete
  // un flag BLOQUEANTE, se aborta ANTES de gastar — regenerar hacia un guion bloqueado no tiene sentido.
  const briefRow = await getBrief(db, batch.briefId);
  if (briefRow === undefined) {
    throw new AppError('not_found', `el brief ${batch.briefId} del lote no existe`);
  }
  const brief = ProductBriefSchema.parse(briefRow.data);
  const flags: GuardrailFlag[] = lintScriptForBrief(editedScript, brief);
  if (flags.some((f) => f.blocking)) {
    throw new AppError(
      'validation_error',
      'el CTA nuevo introduce un problema bloqueante (guardrail FTC): corrige el texto antes de regenerar',
    );
  }

  // ── EL EFECTO, EN LA TX DEL CHECKPOINT (patrón `approveScriptsForStep`) ─────────────────────────────
  // `db` que recibe esta función ES la tx de la resolución del checkpoint (el route la llama dentro de
  // `withDomainTransaction`); el clon + el guion se escriben en ella. `createRun` recibe el MISMO
  // `withTransaction` (savepoint sobre esa tx): su INSERT del run + encolado de roots comparten la tx del
  // checkpoint. Si `createRun` falla, el clon se deshace con el rollback externo (no queda variante clon
  // huérfana sin run). Es EXACTAMENTE la atomicidad de CP3 (clon+run juntos o nada).

  // 1. CLONAR la variante con el guion editado (variante hermana `scripted` en el MISMO lote).
  const clone = await cloneVariantForRegen(db, {
    sourceVariantId,
    script: editedScript,
    guardrailFlags: flags,
  });

  // 2. El plan de generación del CLON (lee recipe×tier + voice_map + su guion recién clonado). Con el tier
  //    ya confirmado generation-ready, un throw aquí es un fallo REAL (no un endpoint pendiente) → ruidoso,
  //    aborta el regen (rollback) antes de crear un run a medias.
  const n7Plan: VariantGenerationPlan = await buildVariantGenerationPlan(
    { db },
    { variantId: clone.variantId },
  );

  // 2b. AÑADIR la cola de COMPOSICIÓN (N8 máster+C2PA → N9 CP4) al plan N6→N7 vía `withComposition` (T5.8b).
  //     `buildVariantGenerationPlan` solo emite los nodos de PAGO N6→N7; N8/N9 son la cola $0 que produce el
  //     MÁSTER NUEVO y pausa en CP4 — lo que la Entrega de T5.8 pide EXPLÍCITAMENTE. `withComposition` es el
  //     ÚNICO dueño de esa cola: el flujo NORMAL (CP3-approve) la comparte (T5.8b la cableó allí también),
  //     así el par `{n8Config,n9Config}` no queda duplicado inline en dos sitios.
  const genPlan: VariantGenerationPlan = withComposition(n7Plan);

  // 3. Arrancar el run de generación `kind='regen'` del clon (sub-DAG N6→N7a-e→N8→N9), atómico con el clon.
  //    La identidad de variante viaja por-nodo (`step_run.variant_id`); el linaje al lote se alcanza vía
  //    esa columna → `ad_variant.batch_id` (no se puebla `pipeline_run.batch_id`, sin lector hoy).
  const { runId } = await createRun(
    { withTransaction },
    generationRunDefinition(batch.projectId, [genPlan], { kind: 'regen' }),
  );

  return { nextRunId: runId };
}

/** El `AdScript` con el CTA cambiado: fija la narración de la(s) escena(s) `cta` al texto nuevo y
 *  RECOMPUTA el guion (`rebuildEditedScript` deriva `cta`/`fullText`/timing de las narraciones). Lanza si
 *  el guion no tiene escena `cta` (nada que regenerar del CTA). El hook/body quedan intactos → dedup. */
function applyCtaToScript(script: AdScript, ctaText: string): AdScript {
  const trimmed = ctaText.trim();
  if (trimmed.length === 0) {
    throw new AppError('validation_error', 'el CTA nuevo no puede estar vacío');
  }
  const hasCta = script.scenes.some((s) => s.segment === 'cta');
  if (!hasCta) {
    throw new AppError(
      'validation_error',
      'el guion no tiene escena de CTA que regenerar (solo hook/body)',
    );
  }
  const scenes = script.scenes.map((s) => (s.segment === 'cta' ? { ...s, narration: trimmed } : s));
  return rebuildEditedScript({ ...script, scenes });
}
