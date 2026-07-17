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
import {
  isBrollModelKind,
  ModelCapabilitiesSchema,
  planGeneration,
  quantizeDurationToEnum,
} from '@ugc/core/gallery';
import { AdScriptSchema } from '@ugc/core/contracts';
import { getModelProfileByEndpoint, getScriptById } from '@ugc/db';
import { runGenerateBroll } from '@ugc/services';

import type { GenerationExecutorDeps } from './generation';

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
    const { collectOutput, stepId } = requireContext(ctx);

    const parsed = N7dConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      throw new PermanentStepError(`N7d: config inválida: ${parsed.error.message}`);
    }
    const cfg = parsed.data;

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

    // `capabilities` es jsonb OPACO al salir de la BD → se VALIDA en la frontera (patrón adapter/N7c),
    // no se castea. Un shape inválido es un bug de datos permanente (galería mal sembrada).
    const capsParsed = ModelCapabilitiesSchema.safeParse(profile.capabilities);
    if (!capsParsed.success) {
      throw new PermanentStepError(
        `N7d: capabilities inválidas en ${cfg.brollEndpoint}: ${capsParsed.error.message}`,
      );
    }
    const caps = capsParsed.data;

    // GUARD DE CATÁLOGO (aspect/resolution/durations válidos ANTES de gastar): un aspect/resolución que
    // el modelo no declara haría que fal rechace la request y quemaría dinero → se ABORTA con
    // `PermanentStepError` (reintentarlo no lo arregla). Data-driven (lee los enums del perfil), no un
    // `if endpoint === veo` hardcodeado.
    if (caps.aspects !== undefined && !caps.aspects.includes(cfg.aspect)) {
      throw new PermanentStepError(
        `N7d: el aspect "${cfg.aspect}" no está en aspects=[${caps.aspects.join(', ')}] de ${cfg.brollEndpoint}`,
      );
    }
    if (caps.resolutions !== undefined && !caps.resolutions.includes(cfg.resolution)) {
      throw new PermanentStepError(
        `N7d: la resolución "${cfg.resolution}" no está en resolutions=[${caps.resolutions.join(', ')}] de ${cfg.brollEndpoint}`,
      );
    }
    const durations = caps.durations;
    if (durations === undefined || durations.length === 0) {
      throw new PermanentStepError(
        `N7d: el model_profile ${cfg.brollEndpoint} no declara capabilities.durations (enum de duración): no se puede cuantizar el clip`,
      );
    }
    // INVARIANTE `maxDuration === max(durations)` (dinero, ANTES de gastar). El troceo usa `maxDuration`
    // (`planScene`) y la cuantización usa `durations` (`quantizeDurationToEnum`): DOS fuentes de verdad
    // de duración que DEBEN coincidir. Si un perfil declarara `maxDuration:12, durations:[4,6,8]`, una
    // escena de 12 s NO se trocearía (12 ≤ 12) → 1 clip de 12 s → la cuantización lo CLAMPA a 8 → se
    // generaría y FACTURARÍA 8 s para una ventana de 12 s (body corto, ledger deshonesto). Y si el perfil
    // NO declara `maxDuration` con `durations` presente, el troceo NO topa nada → el mismo clamp
    // silencioso sobre cualquier escena larga. Ambos son bug de DATOS permanente (galería mal sembrada):
    // se ABORTA con `PermanentStepError` que nombra ambos valores (reintentar no re-siembra el catálogo).
    const maxDuration = caps.maxDuration;
    if (maxDuration === undefined) {
      throw new PermanentStepError(
        `N7d: el model_profile ${cfg.brollEndpoint} declara durations=[${durations.join(', ')}] pero no maxDuration: el troceo §7.5 no topa la duración → clamp silencioso. Siembra maxDuration = max(durations).`,
      );
    }
    const maxAllowedDuration = Math.max(...durations);
    if (maxDuration !== maxAllowedDuration) {
      throw new PermanentStepError(
        `N7d: incoherencia de catálogo en ${cfg.brollEndpoint}: maxDuration=${String(maxDuration)} pero max(durations)=${String(maxAllowedDuration)} (durations=[${durations.join(', ')}]). El troceo y la cuantización usan fuentes distintas y deben coincidir — corrige el seed.`,
      );
    }

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
    const clips: N7dClipRef[] = [];
    for (let bodySceneIndex = 0; bodySceneIndex < plan.scenes.length; bodySceneIndex++) {
      const scenePlan = plan.scenes[bodySceneIndex];
      if (scenePlan === undefined) continue;
      for (const planned of scenePlan.clips) {
        const durationSeconds = quantizeDurationToEnum(planned.seconds, durations);
        const res = await runGenerateBroll(
          {
            db: deps.db,
            storage: deps.storage,
            falKey: deps.falKey,
            ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
            ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
          },
          {
            brollModelProfileId: profile.id,
            imageAssetIds: cfg.imageAssetIds,
            durationSeconds,
            aspectRatio: cfg.aspect,
            resolution: cfg.resolution,
            ...(stepId !== undefined ? { stepRunId: stepId } : {}),
          },
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

/** Igual que N7a/N7b/N7c: `collectOutput` es el canal de salida obligatorio; `stepId` es opcional
 *  (stepless en el smoke). Sin `collectOutput` es un bug de cableado (permanente). */
function requireContext(ctx: { collectOutput?: (outputRefs: unknown) => void; stepId?: string }): {
  collectOutput: (outputRefs: unknown) => void;
  stepId: string | undefined;
} {
  const { collectOutput, stepId } = ctx;
  if (collectOutput === undefined) {
    throw new PermanentStepError('N7d: el ExecutorContext no trae collectOutput (bug de cableado)');
  }
  return { collectOutput, stepId };
}
