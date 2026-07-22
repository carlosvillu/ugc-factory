// Unit del executor N9 · QA (T5.5c): la lógica PURA de emitir el veredicto — lee el qa_report que N8
// persistió (por schema), lo re-emite, deriva `passed`, y falla RUIDOSO cuando falta la dep o el reporte
// es malformado. Sin BD ni media (N9 no re-mide): corre en `worker:unit`, $0.
import { describe, expect, it } from 'vitest';
import { PermanentStepError } from '@ugc/core/orchestrator';
import type { ExecutorContext } from '@ugc/core/orchestrator';
import { N9OutputSchema, type N8Output, type QaReport } from '@ugc/core/contracts';
import { makeN9Executor } from './qa-verdict';

/** Un `qa_report` bien formado (todos los checks en `pass`, score 100) — lo que N8 mide sobre un máster limpio. */
function passingQaReport(): QaReport {
  return {
    checks: {
      resolution: 'pass',
      fps: 'pass',
      codec: 'pass',
      duration: 'pass',
      loudness: 'pass',
      av_duration_diff: 'pass',
      captions_safe_zone: 'pass',
      filesize: 'pass',
    },
    metrics: { width: 1080, height: 1920, fps: 30 },
    passed: true,
    score: 100,
  };
}

/** El `N8Output` que la dep N8 lleva en su `outputRefs` (lo que `findDepBySchema` resuelve). */
function n8Output(qaReport: QaReport): N8Output {
  return {
    variantId: 'v1',
    masterAssetId: 'master-1',
    thumbnailAssetId: 'thumb-1',
    qaReport,
  };
}

/** Ejecuta N9 con un ctx mínimo; captura lo que emite por `collectOutput`. */
async function runN9(ctx: Partial<ExecutorContext>): Promise<unknown[]> {
  const outputs: unknown[] = [];
  const fullCtx: ExecutorContext = {
    config: {},
    variantId: 'v1',
    collectOutput: (refs) => outputs.push(refs),
    deps: [],
    ...ctx,
  };
  await makeN9Executor()(fullCtx);
  return outputs;
}

describe('N9 executor (T5.5c): veredicto de QA leído de N8, sin re-medir', () => {
  it('lee el qa_report de la dep N8 y lo re-emite como N9Output con `passed` derivado', async () => {
    const report = passingQaReport();
    const outputs = await runN9({
      deps: [{ stepId: 's8', nodeKey: 'N8', status: 'succeeded', outputRefs: n8Output(report) }],
    });

    expect(outputs).toHaveLength(1);
    const parsed = N9OutputSchema.parse(outputs[0]);
    expect(parsed.variantId).toBe('v1');
    expect(parsed.passed).toBe(true);
    // Passthrough del reporte que N8 midió (N9 NO re-mide): el objeto emitido es el mismo qa_report.
    expect(parsed.qaReport).toEqual(report);
  });

  it('un máster que FALLA algún check → N9Output con `passed:false` (no lo re-juzga, lo transporta)', async () => {
    const failing = passingQaReport();
    failing.checks.loudness = 'fail';
    failing.passed = false;
    failing.score = 88;

    const outputs = await runN9({
      deps: [{ stepId: 's8', nodeKey: 'N8', status: 'succeeded', outputRefs: n8Output(failing) }],
    });
    const parsed = N9OutputSchema.parse(outputs[0]);
    expect(parsed.passed).toBe(false);
  });

  it('sin dep N8 (ningún outputRefs valida como N8Output) → PermanentStepError (sin máster no hay QA)', async () => {
    await expect(
      runN9({
        deps: [{ stepId: 'x', nodeKey: 'X', status: 'succeeded', outputRefs: { foo: 'bar' } }],
      }),
    ).rejects.toThrow(PermanentStepError);
  });

  it('qa_report de N8 malformado → PermanentStepError (bug de datos, no un retry)', async () => {
    const bad = {
      variantId: 'v1',
      masterAssetId: 'm',
      thumbnailAssetId: 't',
      qaReport: { nope: 1 },
    };
    await expect(
      runN9({ deps: [{ stepId: 's8', nodeKey: 'N8', status: 'succeeded', outputRefs: bad }] }),
    ).rejects.toThrow(/no valida contra QaReportSchema/);
  });

  it('sin variantId (bug de cableado) → PermanentStepError', async () => {
    await expect(
      runN9({
        variantId: null,
        deps: [
          {
            stepId: 's8',
            nodeKey: 'N8',
            status: 'succeeded',
            outputRefs: n8Output(passingQaReport()),
          },
        ],
      }),
    ).rejects.toThrow(/variantId/);
  });
});
