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
import { deriveHookAudioAssetId, findN7bDep } from '@ugc/core/generation';
import { AdScriptSchema } from '@ugc/core/contracts';
import { getAsset, getModelProfileByEndpoint, getScriptById } from '@ugc/db';
import { runGenerateAvatar } from '@ugc/services';

import type { GenerationExecutorDeps } from './generation';
import { requireOutputContext, runGenerationStep } from './_shared';

/** Índice de la escena del HOOK del guion (segment `hook`) cuyo voiceover (N7b) anima el avatar. Lee la
 *  fila `ad_script` REAL (la fuente de verdad de los segmentos) por el `scriptId` que N7b dejó en su
 *  output — NO se asume que el hook sea `scenes[0]`. Lanza si el guion no tiene escena de hook. */
async function resolveHookSceneIndex(
  deps: GenerationExecutorDeps,
  scriptId: string,
): Promise<number> {
  const scriptRow = await getScriptById(deps.db, scriptId);
  if (scriptRow === undefined) {
    throw new PermanentStepError(`N7c: el guion ${scriptId} (de la dep N7b) no existe`);
  }
  const script = AdScriptSchema.pick({ scenes: true }).parse({ scenes: scriptRow.scenes });
  const hookIndex = script.scenes.findIndex((s) => s.segment === 'hook');
  if (hookIndex === -1) {
    throw new PermanentStepError(
      `N7c: el guion ${scriptId} no tiene ninguna escena de hook — no hay audio de hook que animar`,
    );
  }
  return hookIndex;
}

/** El `assetId` del audio del hook DERIVADO de la dep N7b de la misma variante, o `undefined` si no hay
 *  dep N7b (path stepless). Encadena: dep N7b (por schema) → su `scriptId` → escena del hook →
 *  `deriveHookAudioAssetId` (core, puro). La discriminación por schema + el aislamiento por variante los
 *  garantiza el grafo (ver cross-node-deps.ts). */
async function resolveHookAudioFromDeps(
  deps: GenerationExecutorDeps,
  resolvedDeps: readonly { outputRefs: unknown }[],
): Promise<string | undefined> {
  // Una sola resolución de la dep N7b (con el guard de ambigüedad de core); su output se REUSA para
  // sacar el `scriptId` y para elegir el clip del hook — sin re-escanear/re-validar.
  const n7b = findN7bDep(resolvedDeps);
  if (n7b === undefined) return undefined;
  const hookSceneIndex = await resolveHookSceneIndex(deps, n7b.scriptId);
  return deriveHookAudioAssetId(n7b, hookSceneIndex);
}

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
    const { collectOutput, stepId } = requireOutputContext(ctx, 'N7c');

    const parsed = N7cConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      throw new PermanentStepError(`N7c: config inválida: ${parsed.error.message}`);
    }
    const cfg = parsed.data;

    // CROSS-NODE (T4.11 §9.6, el money-path de F4): el AUDIO DEL HOOK que N7c anima viene del voiceover
    // de N7b de la MISMA variante. En un RUN se DERIVA del output de la dep N7b (`ctx.deps`, resueltas
    // por el consumer desde `step.dependsOn` → aisladas por variante por construcción); la config
    // `audioAssetId` es solo la costura STEPLESS del smoke. Precedencia DEP-WINS: si hay dep N7b, MANDA
    // — un puntero rancio a OTRA variante quemaría vídeo real. El hook se identifica por su escena
    // (segment `hook` del guion que N7b guionizó), NO por `clips[0]`.
    const depAudioAssetId = await resolveHookAudioFromDeps(deps, ctx.deps ?? []);
    const audioAssetId = depAudioAssetId ?? cfg.audioAssetId;
    if (audioAssetId === undefined) {
      throw new PermanentStepError(
        'N7c: no hay audio del hook — ni dep N7b (run) ni cfg.audioAssetId (stepless). Cableado roto.',
      );
    }

    // Resolver el perfil del avatar (por endpoint, clave natural) + leer el asset del audio del hook
    // (para su duración). Independientes → en UNO (`Promise.all`, patrón N7a/N7b). La imagen NO se lee
    // aquí (el servicio la resuelve y la sube); el audio SÍ, porque su duración es el guard de dinero.
    const [profile, audioAsset] = await Promise.all([
      getModelProfileByEndpoint(deps.db, cfg.avatarEndpoint),
      getAsset(deps.db, audioAssetId),
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
      throw new PermanentStepError(`N7c: el asset de audio ${audioAssetId} no existe`);
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

    const res = await runGenerationStep(() =>
      runGenerateAvatar(
        {
          db: deps.db,
          storage: deps.storage,
          falKey: deps.falKey,
          ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
          ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
          ...(deps.falBaseUrl !== undefined
            ? { falOptions: { baseUrlOverride: deps.falBaseUrl } }
            : {}),
        },
        {
          avatarModelProfileId: profile.id,
          imageAssetId: cfg.imageAssetId,
          audioAssetId,
          ...(cfg.prompt !== undefined ? { prompt: cfg.prompt } : {}),
          ...(cfg.resolution !== undefined ? { resolution: cfg.resolution } : {}),
          ...(stepId !== undefined ? { stepRunId: stepId } : {}),
        },
      ),
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
