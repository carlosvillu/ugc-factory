// Executor del nodo N7b · TTS + WORD TIMESTAMPS (T4.5, §7.2 N7b + §13.1). Molde: N7a (`generation.ts`):
// una cáscara FINA que parsea la config, lee la fila REAL de `ad_script`, resuelve el triple de voz y
// llama al servicio `runGenerateAudio` (@ugc/services) una vez POR ESCENA. Toda la lógica de la cadena
// TTS→ASR (submit/poll/download/ASR/sellado/coste) vive en el servicio; aquí solo se cablea.
//
// FRONTERAS DE T4.5 (no over-build):
//   - Lee `scene.narration` de la fila `ad_script` REAL (path de PRODUCCIÓN — NO recibe la narración
//     por config; eso fijaría a mano lo que el pipeline deriva, la trampa T1.13).
//   - RESOLUCIÓN MÍNIMA: el triple de voz (endpoint TTS + provider + voiceId) llega por config ya
//     resuelto y se VALIDA su coherencia con `resolveVoiceStep` (core). La resolución COMPLETA (recipe
//     del tier × voice_map de la Persona × idioma) es T4.11.
//   - STEPLESS-capaz: `scriptId` + el triple vienen del CONFIG (el smoke conduce la cadena sin run).
//   - CABLEARLO al DAG (step_run_id/variant_id/canvas) es T4.11, NO T4.5. Y T4.11 debe además hacer el
//     sweeper/`output.download` kind-aware ANTES de cablear esto (marcadores en output-download.ts +
//     reconcile.ts): una generación de AUDIO recogida por la vía de imagen del sweeper explotaría.
import { N7bConfigSchema, PermanentStepError } from '@ugc/core/orchestrator';
import type { StepExecutor } from '@ugc/core/orchestrator';
import type { GenerationInputs } from '@ugc/core/generation';
import { resolveVoiceStep } from '@ugc/core/persona';
import { AdScriptSchema } from '@ugc/core/contracts';
import { getModelProfileByEndpoint, getScriptById } from '@ugc/db';
import { runGenerateAudio } from '@ugc/services';

import type { GenerationExecutorDeps } from './generation';

/** El endpoint del ASR: la ruta por defecto de word timestamps (§13.1). El mismo para los 3 tiers. */
const ASR_ENDPOINT = 'fal-ai/elevenlabs/speech-to-text';

/**
 * Mapea el código de idioma corto del guion (`ad_script.language`: `es`/`en`) al `language_code`
 * ISO-639-3 que espera el ASR de elevenlabs (`spa`/`eng`). Un idioma no mapeado → `undefined` (el ASR
 * autodetecta): degradación segura, no un fallo — la autodetección del ASR es fiable y no quema dinero.
 */
const ASR_LANGUAGE_CODE: Readonly<Record<string, string>> = {
  es: 'spa',
  en: 'eng',
};

/** El ref ligero de un voiceover generado (la verdad vive en `generation`/`asset`). */
interface N7bClipRef {
  sceneIndex: number;
  generationId: string;
  assetId: string;
  durationSeconds: number;
  wordCount: number;
  ttsCostCents: number;
  asrCostCents: number;
}
interface N7bOutput {
  scriptId: string;
  language: string;
  clips: N7bClipRef[];
}

/**
 * N7b · TTS + WORD TIMESTAMPS (T4.5, §7.2). Sintetiza un voiceover por ESCENA del guion con el TTS del
 * tier y sella los word timestamps del ASR encadenado. Un audio por escena (`num_images:1` de audio):
 * cada escena es una unidad de coste/asset propia (patrón de N7a con los shots).
 */
export function makeN7bExecutor(deps: GenerationExecutorDeps): StepExecutor {
  return async (ctx) => {
    const { collectOutput, stepId } = requireContext(ctx);

    const parsed = N7bConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      throw new PermanentStepError(`N7b: config inválida: ${parsed.error.message}`);
    }
    const cfg = parsed.data;

    // Leer la fila REAL de `ad_script` + los DOS model_profiles (TTS del tier por endpoint del config,
    // ASR constante) — TODO independiente (parte de `cfg`; los perfiles no consumen la fila del script)
    // → 3 round-trips en UNO (`Promise.all`, patrón N7a). El script se VALIDA (patrón N5/N7a: nunca
    // castear el jsonb opaco de la BD); un scriptId que no resuelve es un fallo de cableado (permanente).
    const [scriptRow, ttsProfile, asrProfile] = await Promise.all([
      getScriptById(deps.db, cfg.scriptId),
      getModelProfileByEndpoint(deps.db, cfg.ttsEndpoint),
      getModelProfileByEndpoint(deps.db, ASR_ENDPOINT),
    ]);
    if (scriptRow === undefined) {
      throw new PermanentStepError(`N7b: el guion ${cfg.scriptId} no existe`);
    }
    // La fila expone `scenes`/`language` sueltos; se reconstruye el objeto que `AdScriptSchema` valida
    // (solo lo que N7b necesita — el resto de columnas de la fila no son parte del contrato de core).
    const script = AdScriptSchema.pick({ scenes: true, language: true }).parse({
      scenes: scriptRow.scenes,
      language: scriptRow.language,
    });
    if (ttsProfile === undefined) {
      throw new PermanentStepError(
        `N7b: no existe el model_profile TTS ${cfg.ttsEndpoint} (¿galería sin sembrar?)`,
      );
    }
    if (asrProfile === undefined) {
      throw new PermanentStepError(
        `N7b: no existe el model_profile ASR ${ASR_ENDPOINT} (¿galería sin sembrar?)`,
      );
    }

    // Resolución MÍNIMA: valida la coherencia proveedor↔endpoint↔voiceId (mismatch → PermanentStepError,
    // nunca coerción). Produce los inputs del TTS (voice, speed).
    const resolved = resolveVoiceStep({
      provider: cfg.provider,
      ttsEndpoint: cfg.ttsEndpoint,
      voice: cfg.voice,
      ...(cfg.speed !== undefined ? { speed: cfg.speed } : {}),
    });
    // Los inputs del TTS que van a fal (voice, speed). `GenerationInputs` es `Record<string, unknown>`;
    // el objeto resuelto lo cumple estructuralmente pero un interface cerrado no es asignable a un index
    // signature → se re-expande explícito.
    const voiceInputs: GenerationInputs = {
      voice: resolved.voice,
      ...(resolved.speed !== undefined ? { speed: resolved.speed } : {}),
      // ElevenLabs turbo es multilingüe: `language_code` (ISO-639-1, p. ej. `es`) fija el idioma de
      // síntesis (verificado en vivo). kokoro no tiene ese parámetro (idioma implícito en la voz).
      ...(cfg.provider === 'elevenlabs' ? { language_code: cfg.language } : {}),
    };

    const asrLanguageCode = ASR_LANGUAGE_CODE[cfg.language];

    // Un voiceover POR ESCENA. Secuencial (fail-fast de coste, como el bucle de shots de N7a).
    const clips: N7bClipRef[] = [];
    for (let i = 0; i < script.scenes.length; i++) {
      const scene = script.scenes[i];
      if (scene === undefined) continue;
      const res = await runGenerateAudio(
        {
          db: deps.db,
          storage: deps.storage,
          falKey: deps.falKey,
          ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
          ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
        },
        {
          ttsModelProfileId: ttsProfile.id,
          asrModelProfileId: asrProfile.id,
          narration: scene.narration,
          ttsInputs: voiceInputs,
          ...(asrLanguageCode !== undefined ? { asrLanguageCode } : {}),
          ...(stepId !== undefined ? { stepRunId: stepId } : {}),
        },
      );
      clips.push({
        sceneIndex: i,
        generationId: res.generation.id,
        assetId: res.assetId,
        durationSeconds: res.durationSeconds,
        wordCount: res.wordCount,
        ttsCostCents: res.ttsCostCents,
        asrCostCents: res.asrCostCents,
      });
    }

    collectOutput({
      scriptId: cfg.scriptId,
      language: cfg.language,
      clips,
    } satisfies N7bOutput);
  };
}

/** Igual que N7a: `collectOutput` es el canal de salida obligatorio; `stepId` es opcional (stepless en
 *  el smoke). Sin `collectOutput` es un bug de cableado (permanente). */
function requireContext(ctx: { collectOutput?: (outputRefs: unknown) => void; stepId?: string }): {
  collectOutput: (outputRefs: unknown) => void;
  stepId: string | undefined;
} {
  const { collectOutput, stepId } = ctx;
  if (collectOutput === undefined) {
    throw new PermanentStepError('N7b: el ExecutorContext no trae collectOutput (bug de cableado)');
  }
  return { collectOutput, stepId };
}
