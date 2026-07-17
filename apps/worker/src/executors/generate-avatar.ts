// Executor del nodo N7c · CLIP DE AVATAR, tiers image+audio (T4.7, §7.2 N7c). Molde: N7a/N7b
// (`generation.ts`/`generate-voice.ts`): una cáscara FINA que parsea la config, resuelve el perfil del
// avatar por endpoint, valida la duración del audio del hook contra el límite del modelo, y llama al
// servicio `runGenerateAvatar` (@ugc/services). Toda la lógica de submit/poll/download/coste vive en el
// servicio; aquí solo se cablea + se cría el guard de dinero (no gastar si fal rechazará la request).
//
// FRONTERAS DE T4.7 (no over-build):
//   - SOLO los tiers image+audio (Kling Std / OmniHuman Premium). El tier Test (VEED) es T4.7b: su
//     ASR-del-clip exige extraer el audio del vídeo con ffmpeg, ausente hoy en el worker.
//   - Los forward-pointers (imageAssetId/audioAssetId/avatarEndpoint) vienen del CONFIG (costura
//     stepless: el smoke conduce el clip sin run). T4.11 los rellenará desde la resolución recipe×tier +
//     el voiceover real de la variante.
//   - CABLEARLO al DAG (step_run_id/variant_id/canvas) es T4.11, NO T4.7. Y T4.11 debe además hacer el
//     sweeper/`output.download` kind-aware ANTES de cablear esto (marcadores en output-download.ts +
//     reconcile.ts): una generación de VÍDEO recogida por la vía de imagen del sweeper explotaría.
import { N7cConfigSchema, PermanentStepError } from '@ugc/core/orchestrator';
import type { StepExecutor } from '@ugc/core/orchestrator';
import { ModelCapabilitiesSchema } from '@ugc/core/gallery';
import { getAsset, getModelProfileByEndpoint } from '@ugc/db';
import { runGenerateAvatar } from '@ugc/services';

import type { GenerationExecutorDeps } from './generation';

/** El ref ligero del clip de avatar generado (la verdad vive en `generation`/`asset`). */
interface N7cOutput {
  avatarEndpoint: string;
  generationId: string;
  assetId: string;
  durationSeconds: number;
  costCents: number;
}

/**
 * N7c · CLIP DE AVATAR, tiers image+audio (T4.7, §7.2). Anima la imagen de la Persona con el audio del
 * hook (voiceover de N7b) para producir un clip del avatar hablando con lipsync, en el tier del config
 * (Kling Std / OmniHuman Premium).
 */
export function makeN7cExecutor(deps: GenerationExecutorDeps): StepExecutor {
  return async (ctx) => {
    const { collectOutput, stepId } = requireContext(ctx);

    const parsed = N7cConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      throw new PermanentStepError(`N7c: config inválida: ${parsed.error.message}`);
    }
    const cfg = parsed.data;

    // Resolver el perfil del avatar (por endpoint, clave natural) + leer el asset del audio del hook
    // (para su duración). Independientes → en UNO (`Promise.all`, patrón N7a/N7b). La imagen NO se lee
    // aquí (el servicio la resuelve y la sube); el audio SÍ, porque su duración es el guard de dinero.
    const [profile, audioAsset] = await Promise.all([
      getModelProfileByEndpoint(deps.db, cfg.avatarEndpoint),
      getAsset(deps.db, cfg.audioAssetId),
    ]);
    if (profile === undefined) {
      throw new PermanentStepError(
        `N7c: no existe el model_profile de avatar ${cfg.avatarEndpoint} (¿galería sin sembrar?)`,
      );
    }
    if (profile.kind !== 'avatar') {
      throw new PermanentStepError(
        `N7c: el model_profile ${cfg.avatarEndpoint} es kind '${profile.kind}', no 'avatar'`,
      );
    }
    if (audioAsset === undefined) {
      throw new PermanentStepError(`N7c: el asset de audio ${cfg.audioAssetId} no existe`);
    }

    // GUARD DE DINERO (≤maxDuration ANTES DE GASTAR): OmniHuman @1080p exige audio ≤30 s
    // (`capabilities.maxDuration` del perfil — dato del catálogo, NO un `if endpoint === omnihuman`
    // hardcodeado, así el guard generaliza a cualquier modelo que declare el límite). El clip dura lo
    // que el audio (`duración = audio automáticamente`), así que si el audio excede el límite fal
    // rechazará la request y quemaría dinero: se ABORTA con `PermanentStepError` (reintentarlo no acorta
    // el audio). Kling no declara `maxDuration` → no gatea. Un audio sin `duration_s` no se puede cribar:
    // se deja pasar (el servicio caerá a la duración del output de fal) — un `tts_audio` de N7b siempre
    // la tiene, así que en el path de producción esto no ocurre.
    // `capabilities` es jsonb OPACO al salir de la BD → se VALIDA en la frontera (patrón adapter/N5),
    // no se castea. Un shape inválido es un bug de datos permanente (galería mal sembrada).
    const capsParsed = ModelCapabilitiesSchema.safeParse(profile.capabilities);
    if (!capsParsed.success) {
      throw new PermanentStepError(
        `N7c: capabilities inválidas en ${cfg.avatarEndpoint}: ${capsParsed.error.message}`,
      );
    }
    const maxDuration = capsParsed.data.maxDuration;
    const audioDurationS = audioAsset.durationS;
    if (maxDuration !== undefined && audioDurationS !== null && audioDurationS > maxDuration) {
      throw new PermanentStepError(
        `N7c: el audio del hook dura ${audioDurationS.toFixed(2)}s pero ${cfg.avatarEndpoint} ` +
          `admite ≤${String(maxDuration)}s — no se gasta en una request que fal rechazará`,
      );
    }

    const res = await runGenerateAvatar(
      {
        db: deps.db,
        storage: deps.storage,
        falKey: deps.falKey,
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
        ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
      },
      {
        avatarModelProfileId: profile.id,
        imageAssetId: cfg.imageAssetId,
        audioAssetId: cfg.audioAssetId,
        ...(cfg.prompt !== undefined ? { prompt: cfg.prompt } : {}),
        ...(cfg.resolution !== undefined ? { resolution: cfg.resolution } : {}),
        ...(stepId !== undefined ? { stepRunId: stepId } : {}),
      },
    );

    collectOutput({
      avatarEndpoint: cfg.avatarEndpoint,
      generationId: res.generation.id,
      assetId: res.assetId,
      durationSeconds: res.durationSeconds,
      costCents: res.costCents,
    } satisfies N7cOutput);
  };
}

/** Igual que N7a/N7b: `collectOutput` es el canal de salida obligatorio; `stepId` es opcional (stepless
 *  en el smoke). Sin `collectOutput` es un bug de cableado (permanente). */
function requireContext(ctx: { collectOutput?: (outputRefs: unknown) => void; stepId?: string }): {
  collectOutput: (outputRefs: unknown) => void;
  stepId: string | undefined;
} {
  const { collectOutput, stepId } = ctx;
  if (collectOutput === undefined) {
    throw new PermanentStepError('N7c: el ExecutorContext no trae collectOutput (bug de cableado)');
  }
  return { collectOutput, stepId };
}
