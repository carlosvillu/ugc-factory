// Executor del nodo N9 · QA + CHECKPOINT CP4 (T5.5c, §9.7 N9 / §9.0). La mitad final del run de
// generación: emite el VEREDICTO de QA de la variante y —por ser checkpoint `alwaysPause` en el DAG
// (generation-dag.ts)— el consumer lo cierra en `waiting_approval`, habilitando CP4.
//
// N9 NO RE-MIDE (LOAD-BEARING, $0 runtime): N8 ya corrió el validador QA sobre el máster FIRMADO y
// persistió el `qa_report` (en `ad_variant.qa_report` y en su `N8Output.qaReport`). N9 LEE ese reporte de
// su dep N8 (por SCHEMA, no por node_key — el patrón cross-node de F4) y lo re-emite como su artefacto,
// elevando `passed` a nivel raíz para que el efecto de dominio de CP4 discrimine N9 de N8 sin abrir el
// jsonb. Re-medir aquí duplicaría el trabajo de N8, exigiría ffmpeg/ffprobe (no los toca a propósito —
// prueba de que no re-mide: este módulo no importa ningún runner de media) y podría diverger del reporte
// que el usuario ve en el panel. La ÚNICA fuente de verdad del QA es lo que N8 midió.
//
// FRONTERA (SKILL.md backend): sin BD ni red. Lee su dep resuelta y emite. El aislamiento por variante lo
// garantiza el grafo (`dependsOn` cablea N9 al N8 de SU variante).
import { PermanentStepError } from '@ugc/core/orchestrator';
import type { StepExecutor } from '@ugc/core/orchestrator';
import { N8OutputSchema, QaReportSchema, type N9Output } from '@ugc/core/contracts';
import { findDepBySchema } from '@ugc/core/generation';

import { requireOutputContext } from './_shared';

/**
 * N9 · QA (T5.5c). Lee el `qa_report` que N8 persistió (de su dep N8, por schema), lo re-emite como su
 * artefacto y PAUSA el run en CP4 (la pausa la fuerza el consumer por el flag `alwaysPause` del nodo, no
 * este executor). $0 runtime: no re-mide, no toca fal, no toca media.
 */
export function makeN9Executor(): StepExecutor {
  // Cuerpo SÍNCRONO (N9 no re-mide → no hay I/O que esperar), pero `StepExecutor` devuelve `Promise<void>`:
  // se retorna `Promise.resolve()` al final. Los throws de validación son síncronos — el consumer los
  // captura igual (envuelve `await executor(...)` en try/catch, step-execute.ts).
  return (ctx) => {
    const { collectOutput } = requireOutputContext(ctx, 'N9');

    const variantId = ctx.variantId;
    if (variantId == null || variantId === '') {
      throw new PermanentStepError(
        'N9: el ExecutorContext no trae variantId — el QA es POR VARIANTE (bug de cableado)',
      );
    }

    // La dep N8 (composición): trae el `masterAssetId` + el `qaReport` que N8 midió sobre el máster firmado.
    // Discriminada por SCHEMA (N8OutputSchema), nunca por node_key (T0.8). Sin ella no hay QA que emitir:
    // reintentar no la crea → PermanentStepError.
    const n8 = findDepBySchema(ctx.deps ?? [], N8OutputSchema, 'N8 (composición)');
    if (n8 === undefined) {
      throw new PermanentStepError(
        `N9: la variante ${variantId} no tiene dep N8 — sin máster no hay qa_report que verificar`,
      );
    }

    // El `qa_report` de N8 es `unknown` (jsonb opaco): se VALIDA aquí contra su schema (nunca castear) para
    // derivar `passed` de forma segura. Un reporte malformado es un bug de datos permanente (N8 mal
    // cableado) → PermanentStepError, no un retry que produciría el mismo fallo.
    const qaParsed = QaReportSchema.safeParse(n8.qaReport);
    if (!qaParsed.success) {
      throw new PermanentStepError(
        `N9: el qa_report de N8 para la variante ${variantId} no valida contra QaReportSchema: ${qaParsed.error.message}`,
      );
    }

    collectOutput({
      variantId,
      passed: qaParsed.data.passed,
      // Passthrough del reporte que N8 midió (el mismo objeto que ya validó): el panel de CP4 y el efecto
      // de dominio lo releen. Se re-emite el reporte VALIDADO (no el `n8.qaReport` crudo) para que el
      // artefacto de N9 sea siempre un `qa_report` bien formado.
      qaReport: qaParsed.data,
    } satisfies N9Output);

    return Promise.resolve();
  };
}
