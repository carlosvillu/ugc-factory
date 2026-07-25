// NARRATION-AWARE SCENE SIZING (T5.8c, §7.5). The MISSING half of the §7.5 splitting rule.
//
// THE BUG THIS CLOSES: `planScene` splits a scene into `ceil(scene.seconds / maxDuration)` clips, but
// `scene.seconds` is the ESTIMATE the script writer computed as `countWords(narration) / 2.5`. The REAL
// TTS narration (measured by N7b via ASR, `N7bClipRef.durationSeconds`) routinely OVERSHOOTS that
// estimate (~+45% observed in the T5.9 real run: estimate ≤6s, measured 8.68s). Consequences:
//   1. The clip count is computed against a number that is too small → a scene that genuinely needs 2
//      clips gets planned as 1 → the single clip (capped at the model's `maxDuration`, e.g. 8s) can
//      NEVER cover the narration → `fitSegmentFile` throws `FitError` (correctly: anti-T1.8) and N8
//      composes 0 masters. This is exactly what killed the T5.9 phase run.
//   2. Even when the count is right, each clip's quantized duration is derived from the estimate, so
//      Σ(clips) < narration and the deficit reappears after the intra-scene concat.
//
// THE FIX: when the MEASURED narration of a scene is known (the N7b dep is wired — see the conditional
// N7d→N7b / N7f→N7b edges in `generation-dag.ts`), size the scene from the measured seconds instead of
// the estimate BEFORE calling `planGeneration`. Everything downstream (`planScene` splitting, the
// `quantizeDurationToEnum` round-up, the `bodySceneIndex:clipIndex` dedup salt) is unchanged — it just
// operates on honest numbers, so Σ(clips) ≥ narration holds and N8's concat+fit TRIMS instead of failing.
//
// PURE + FREE: no I/O, no ffmpeg, no DB. The measured durations arrive as a plain map from the caller
// (the executor reads them from its resolved N7b dep). NEVER SHRINKS a scene: the effective seconds are
// `max(estimate, measured)` — a measured narration SHORTER than the estimate is harmless (the fitter
// trims), whereas shrinking could drop a clip the estimate said was needed.
import type { AdScene } from '../../contracts/ad-script';

/**
 * The measured narration duration of each scene, keyed by the scene's ABSOLUTE index in the script
 * (`AdScript.scenes[i]`) — the same index space `N7bClipRef.sceneIndex` uses. Scenes missing from the
 * map keep their estimated `seconds` (a partially-wired N7b degrades to today's behaviour, it does not
 * crash).
 */
export type MeasuredNarrationByScene = ReadonlyMap<number, number>;

/**
 * Returns the scene sized to the duration the clips must actually COVER: `max(scene.seconds, measured)`.
 * `measured` is `undefined` when N7b is absent (stepless/smoke wiring) → the scene is returned unchanged.
 * Non-finite or non-positive measurements are ignored (a bogus probe must not shrink or explode the plan).
 *
 * ⚠ `scene.t` (the scene's start offset in the ad) is NOT recomputed and becomes STALE when the scene grows:
 * downstream `PlannedClip.t` values can overlap across scenes. Deliberate — the only consumers of this
 * sizing (N7d/N7f) read `seconds` and `clipIndex`, never `t`, and the authoritative timeline of the master
 * is the MEASURED narration of N7b (§9.7: the fitter cuts each segment to its own voice; `composeMaster`
 * concatenates in array order). Recomputing `t` here would fabricate a timeline nobody consumes and that
 * would still disagree with the fitter's. If a future consumer needs a coherent `t`, it must be recomputed
 * over the sized scenes as a whole, not patched per-scene.
 *
 * PRIVATE to this module (the exported entry point is `sizeScenesToNarration`, which knows the filtered ↔
 * absolute index mapping a caller would otherwise have to get right by hand).
 */
function sizeSceneToNarration(scene: AdScene, measuredSeconds: number | undefined): AdScene {
  if (
    measuredSeconds === undefined ||
    !Number.isFinite(measuredSeconds) ||
    measuredSeconds <= scene.seconds
  ) {
    return scene;
  }
  return { ...scene, seconds: measuredSeconds };
}

/**
 * Sizes a FILTERED subset of scenes (the body subset of N7d, the cta subset of N7f) against the measured
 * narrations. `absoluteIndices[i]` is the ABSOLUTE script index of `scenes[i]` — the filtered subsets N7d
 * and N7f plan over do NOT share the index space N7b keys its clips by (constraint 2 of
 * `assembleCompositionSpec`), so the caller passes the mapping explicitly rather than letting this
 * function guess it. Order is preserved (the indices N8 and the dedup salt depend on are stable).
 */
export function sizeScenesToNarration(
  scenes: readonly AdScene[],
  absoluteIndices: readonly number[],
  measured: MeasuredNarrationByScene,
): AdScene[] {
  return scenes.map((scene, i) => {
    const absolute = absoluteIndices[i];
    return sizeSceneToNarration(scene, absolute === undefined ? undefined : measured.get(absolute));
  });
}

/**
 * The ABSOLUTE script indices of the scenes of one segment, in order: filtered ordinal `i` ↔ absolute index
 * `segmentSceneIndices(scenes, 'body')[i]`. It is what the generation executors (N7d/N7f) use to look up the
 * MEASURED narration of a scene they only know by its filtered ordinal.
 *
 * ⚠ There are TWO live derivations of this same filtered↔absolute mapping, on purpose:
 *   · this function, over the whole `scenes` array, for the generation side (N7d/N7f);
 *   · the `bodyOrdinal`/`ctaOrdinal` counters `assembleCompositionSpec` advances while walking the script
 *     scene by scene, for the composition side.
 * They are NOT unified: that walk IS the mechanism of constraint 2 of `assembleCompositionSpec` (pairing
 * each clip with ITS voice/captions in a single ordered pass), and replacing it with a lookup table would
 * dissolve the very structure that constraint documents. Both must agree — the filtered subsets are built
 * by the same `segment === X` predicate on the same persisted script — but each states the mapping in the
 * form its own side needs.
 */
export function segmentSceneIndices(
  scenes: readonly AdScene[],
  segment: AdScene['segment'],
): number[] {
  const indices: number[] = [];
  for (const [i, scene] of scenes.entries()) {
    if (scene.segment === segment) indices.push(i);
  }
  return indices;
}
