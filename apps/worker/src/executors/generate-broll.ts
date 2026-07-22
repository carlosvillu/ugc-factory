// Executor del nodo N7d · B-ROLL POR ESCENA (T4.8, §7.2 N7d + §7.5). Molde: N7b (`generate-voice.ts`)
// + N7c (`generate-avatar.ts`): una cáscara FINA que parsea la config, lee la fila REAL de `ad_script`,
// FILTRA a las escenas del BODY (§7.5 «el b-roll es el body»), planifica el troceo §7.5 contra la
// `maxDuration` del modelo (`planGeneration` de core), cuantiza la duración de cada clip al enum del
// modelo (`quantizeDurationToEnum`) y llama al servicio `runGenerateBroll` una vez POR CLIP. Toda la
// lógica de submit/poll/download/coste vive en el servicio; aquí se cablea + se cría el guard de
// catálogo (aspect/resolution válidos ANTES de gastar).
//
// FRONTERAS DE T4.8 (no over-build):
//   - SOLO el body (§7.5). El router completo segmento→técnica de storytelling (alternar avatar/b-roll
//     en el body) es T4.11; T4.8 materializa TODAS las escenas de body como b-roll (que es lo que los
//     presets hook-test/conversión exigen: body = b-roll puro).
//   - i2v-vs-R2V lo decide el `kind` del `brollEndpoint` del config (costura stepless). T4.11 rellenará
//     el endpoint + los keyframes/packshots desde la resolución recipe×tier + si el producto aparece en
//     la escena.
//   - CABLEARLO al DAG (step_run_id/variant_id/canvas) es T4.11, NO T4.8. Y T4.11 debe hacer el
//     sweeper/`output.download` kind-aware ANTES de cablearlo (una generación de VÍDEO recogida por la
//     vía de imagen del sweeper explotaría — marcadores en output-download.ts + reconcile.ts).
import { N7dConfigSchema, PermanentStepError } from '@ugc/core/orchestrator';
import type { StepExecutor } from '@ugc/core/orchestrator';
import { isBrollModelKind, planGeneration, quantizeDurationToEnum } from '@ugc/core/gallery';
import { deriveKeyframeAssetIds } from '@ugc/core/generation';
import { AdScriptSchema } from '@ugc/core/contracts';
import { getModelProfileByEndpoint, getScriptById } from '@ugc/db';
import { runGenerateBroll } from '@ugc/services';

import type { GenerationExecutorDeps } from './generation';
import {
  requireOutputContext,
  runGenerationStep,
  resolveFalKeyOrPermanent,
  resolveVideoModelCaps,
} from './_shared';

/** El ref ligero de un clip de b-roll generado (la verdad vive en `generation`/`asset`). */
interface N7dClipRef {
  /** Índice de la escena de BODY (en el subconjunto filtrado) que originó el clip. */
  bodySceneIndex: number;
  /** Índice del clip DENTRO de su escena (0-based; >0 si la escena se troceó). */
  clipIndex: number;
  generationId: string;
  assetId: string;
  durationSeconds: number;
  costCents: number;
}
interface N7dOutput {
  scriptId: string;
  brollEndpoint: string;
  route: 'i2v' | 'r2v' | 't2v';
  clips: N7dClipRef[];
}

/**
 * N7d · B-ROLL POR ESCENA (T4.8, §7.2). Genera 1 clip de vídeo por escena del BODY (§7.5): i2v desde
 * keyframe o R2V del producto, troceando las escenas > maxDuration y cuantizando cada clip al enum de
 * duración del modelo. B-roll SILENCIOSO (la voz es de N7b).
 */
export function makeN7dExecutor(deps: GenerationExecutorDeps): StepExecutor {
  return async (ctx) => {
    const { collectOutput, stepId } = requireOutputContext(ctx, 'N7d');

    const parsed = N7dConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      throw new PermanentStepError(`N7d: config inválida: ${parsed.error.message}`);
    }
    const cfg = parsed.data;

    // CROSS-NODE (T4.11 §9.6, money-path): los KEYFRAMES i2v vienen de los product shots de N7a de la
    // MISMA variante. En un RUN se DERIVAN del output de la dep N7a (`ctx.deps`, resueltas por el
    // consumer desde `step.dependsOn` → aisladas por variante por construcción); `cfg.imageAssetIds` es
    // la costura STEPLESS del smoke. Precedencia DEP-WINS: si hay dep N7a, MANDA — un keyframe rancio de
    // OTRA variante animaría el producto equivocado y quemaría vídeo real.
    const depKeyframes = deriveKeyframeAssetIds(ctx.deps ?? []);
    const imageAssetIds = depKeyframes ?? cfg.imageAssetIds;
    if (imageAssetIds === undefined || imageAssetIds.length === 0) {
      throw new PermanentStepError(
        'N7d: no hay keyframes — ni dep N7a (run) ni cfg.imageAssetIds (stepless). Cableado roto.',
      );
    }

    // Leer la fila REAL de `ad_script` + el model_profile del b-roll (por endpoint). Independientes →
    // en UNO (`Promise.all`, patrón N7b). El script se VALIDA (nunca castear el jsonb opaco de la BD).
    const [scriptRow, profile] = await Promise.all([
      getScriptById(deps.db, cfg.scriptId),
      getModelProfileByEndpoint(deps.db, cfg.brollEndpoint),
    ]);
    if (scriptRow === undefined) {
      throw new PermanentStepError(`N7d: el guion ${cfg.scriptId} no existe`);
    }
    const script = AdScriptSchema.pick({ scenes: true, language: true }).parse({
      scenes: scriptRow.scenes,
      language: scriptRow.language,
    });
    if (profile === undefined) {
      throw new PermanentStepError(
        `N7d: no existe el model_profile de b-roll ${cfg.brollEndpoint} (¿galería sin sembrar?)`,
      );
    }
    if (!isBrollModelKind(profile.kind)) {
      throw new PermanentStepError(
        `N7d: el model_profile ${cfg.brollEndpoint} es kind '${profile.kind}', no un modelo de vídeo de b-roll (i2v/r2v/t2v)`,
      );
    }

    // GUARD DE CATÁLOGO COMPARTIDO (money-gate, ANTES de gastar): valida `capabilities` (jsonb opaco de
    // la BD, patrón adapter/N7c) y comprueba aspect/resolution/durations + el invariante
    // `maxDuration === max(durations)`. Extraído a `_shared.ts` (lo comparte N7f, clip de CTA — misma
    // mecánica i2v). Un aspect/resolución/duración que el modelo no declara haría que fal rechace la
    // request y queme dinero → `PermanentStepError` (reintentarlo no re-siembra el catálogo).
    const { durations, maxDuration } = resolveVideoModelCaps(
      profile.capabilities,
      { aspect: cfg.aspect, resolution: cfg.resolution },
      'N7d',
      cfg.brollEndpoint,
    );

    // §7.5: EL B-ROLL ES EL BODY. Se filtra a las escenas de segment 'body' ANTES de planificar —
    // generar hook/cta como b-roll rompería el presupuesto (1 avatar + 2 b-roll en conversión) y
    // quemaría dinero. El orden se preserva (los índices son estables para N8/dedup).
    const bodyScenes = script.scenes.filter((s) => s.segment === 'body');
    if (bodyScenes.length === 0) {
      throw new PermanentStepError(
        `N7d: el guion ${cfg.scriptId} no tiene ninguna escena de body — no hay b-roll que generar`,
      );
    }

    // Troceo §7.5: cada escena de body > maxDuration se parte en clips ≤ maxDuration (`planGeneration`
    // de core, función pura y testeada de T3.6). El plan es la lista EXACTA de clips a generar — la
    // cláusula «se generan exactamente los clips del presupuesto §7.5» sale de aquí.
    const plan = planGeneration(bodyScenes, maxDuration);

    // Un clip POR ENTRADA del plan. Se itera ESCENA→CLIP (no el `plan.clips` aplanado) para que
    // `bodySceneIndex` sea el índice REAL de la escena de body (si una escena se troceó, sus 2 clips
    // comparten `bodySceneIndex` y se distinguen por `clipIndex`). Secuencial (fail-fast de coste, como
    // los bucles de N7a/N7b). Cada clip cuantiza su duración al enum del modelo (redondeo-arriba: el clip
    // debe cubrir su ventana).
    // Resuelve la fal-key UNA vez por step (de `app_setting`): la comparten todos los clips del plan.
    // ANTES del primer submit (no hay gasto huérfano). Sin key/no descifra → falla PERMANENTE con
    // mensaje accionable (Ajustes → fal), no retry storm.
    const falKey = await resolveFalKeyOrPermanent(deps.falKey, 'N7d');
    const clips: N7dClipRef[] = [];
    for (let bodySceneIndex = 0; bodySceneIndex < plan.scenes.length; bodySceneIndex++) {
      const scenePlan = plan.scenes[bodySceneIndex];
      if (scenePlan === undefined) continue;
      for (const planned of scenePlan.clips) {
        const durationSeconds = quantizeDurationToEnum(planned.seconds, durations);
        const res = await runGenerationStep(() =>
          runGenerateBroll(
            {
              db: deps.db,
              storage: deps.storage,
              falKey,
              ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
              ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
              ...(deps.falBaseUrl !== undefined
                ? { falOptions: { baseUrlOverride: deps.falBaseUrl } }
                : {}),
            },
            {
              brollModelProfileId: profile.id,
              imageAssetIds,
              durationSeconds,
              aspectRatio: cfg.aspect,
              resolution: cfg.resolution,
              ...(stepId !== undefined ? { stepRunId: stepId } : {}),
              // SALT DE DEDUP (T4.10): dos clips de la MISMA escena troceada (§7.5) tienen keyframe+prompt+
              // duración idénticos → mismo content_hash → el dedup los colapsaría en uno solo (el vídeo
              // repetiría el clip). El salt `escena:clip` los distingue en el hash SIN filtrarse al payload de
              // fal. Variantes distintas que comparten la misma estructura de body reusan igual (mismo salt).
              dedupSalt: `${String(bodySceneIndex)}:${String(planned.clipIndex)}`,
            },
          ),
        );
        clips.push({
          bodySceneIndex,
          clipIndex: planned.clipIndex,
          generationId: res.generation.id,
          assetId: res.assetId,
          durationSeconds: res.durationSeconds,
          costCents: res.costCents,
        });
      }
    }

    collectOutput({
      scriptId: cfg.scriptId,
      brollEndpoint: cfg.brollEndpoint,
      route: profile.kind,
      clips,
    } satisfies N7dOutput);
  };
}
