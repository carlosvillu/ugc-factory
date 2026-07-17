// DAG del LOTE (T2.6, F2): el run que GUIONIZA un lote ya creado. Un único nodo N5 (ScriptWriter)
// que además es CP3 (el checkpoint del editor de guiones). Hermano de `analysisRunDefinition`
// (analysis-dag.ts).
//
// POR QUÉ N5 ES UN RUN NUEVO Y NO UN NODO MÁS DEL DAG DE ANÁLISIS (decisión anclada al código):
//   - El DAG de análisis (N1→N2→N3→N4) se CONGELA en N0: sus nodos se instancian al crear el run,
//     ANTES de que exista ningún `ad_batch`. N5 necesita el `batchId` —el lote que CP2 aprobó—, que
//     no existe hasta que la aprobación de CP2 lo crea. Meter N5 en el DAG de análisis exigiría un
//     `batchId` que ese DAG no puede conocer.
//   - N5 GASTA dinero (Sonnet 5). Los nodos de pago son SIEMPRE executors del worker con retry e
//     idempotencia, nunca un efecto síncrono del route handler.
//   Solución: N5 arranca como el PRIMER (y único) step de un RUN DE LOTE nuevo, creado con
//   `createRun` DENTRO de la misma tx que la aprobación de CP2 (server/batch-checkpoint.ts). El
//   `batchId` viaja en su `config` — el lote ya existe cuando el run se crea, en esa misma tx.
//
// Frontera de core (SKILL.md backend, principio 1): sin BD, sin cola. Habla nodos y config, no filas.
import { z } from 'zod';
import { PACKSHOT_MIN_SHOTS, PACKSHOT_MAX_SHOTS } from '../generation/packshot-prompt';
import type { RunDefinitionInput } from './run-definition';

/**
 * Config del step N5 (guionización): el LOTE que se guioniza. El executor la re-valida al leerla de
 * la BD (`step_run.config` es jsonb opaco), pero contra ESTE schema, no contra una copia — misma
 * disciplina productor(core)/consumidor(worker) que las `AnalysisN*ConfigSchema` (analysis-dag.ts).
 * Del `batchId` el executor saca el `BatchPlan` (`ad_batch.matrix`) y el `briefId`.
 */
export const AnalysisN5ConfigSchema = z.object({
  batchId: z.string().min(1),
});
export type AnalysisN5Config = z.infer<typeof AnalysisN5ConfigSchema>;

/**
 * Config del step N6 (compilador de prompts, T3.5). ESQUELETO: el corte de alcance de T3.5 es el
 * MOTOR completo en core (funciones puras) + este executor de REGISTRO mínimo. El cableado pesado
 * del DAG de generación (N6→N7a-e), la tabla `generation` donde vive `resolved_prompt` y la lectura
 * de brief/persona/guion desde la BD son F4/T4.11 — NO se construyen aquí.
 *
 * Por eso la config apunta a la `variantId` (el forward-pointer estable, como `batchId` en N5): en
 * F4 el executor sacará de ella el guion, la persona y las facetas para compilar. Hoy el executor
 * VALIDA la config y delega en el motor puro de `@ugc/core/gallery` cuando F4 le pase las fuentes.
 */
export const AnalysisN6ConfigSchema = z.object({
  variantId: z.string().min(1),
});
export type AnalysisN6Config = z.infer<typeof AnalysisN6ConfigSchema>;

/**
 * Config del step N7a · PRODUCT SHOTS (T4.4, §7.2). N7a genera los shots del producto según la RUTA
 * que CP1 decidió (§9.2, `checkpoint_decision.images`): `ai_packshot` (packshot generado por IA,
 * sin fotos reales) o —cuando T4.4b lo cablee— la ruta con referencias reales.
 *
 * LA RUTA VIENE POR CONFIG, NO POR UN LOOKUP. T4.11 rellenará este `route` desde la decisión de CP1
 * al construir el DAG; hasta entonces (y en el smoke STEPLESS) la ruta viaja explícita en la config
 * — la MISMA costura stepless que N5/N6 mantienen: el executor no necesita un `step_run_id` real ni
 * leer `checkpoint_decision` de la BD para elegir la ruta. Esto hace que el smoke pueda conducir
 * `ai_packshot` sin run.
 *
 * T4.4 SOLO implementa `ai_packshot`. El enum admite las otras rutas para que el CONTRATO esté
 * completo desde ya (T4.11 y T4.4b no tendrán que ampliarlo), pero el executor las rechaza con
 * `PermanentStepError` — un seam explícito, no un fallthrough silencioso.
 *
 * `briefId` es el forward-pointer estable (como `batchId` en N5, `variantId` en N6): el executor
 * lee de él la descripción del producto para construir el prompt de packshot. `numShots` (2–3) y
 * `aspect` (9:16) los fija el config; el executor los traduce al payload de flux-2.
 */
export const PackshotRouteSchema = z.enum(['ai_packshot', 'upload_images', 'promote_scraped']);
export type PackshotRoute = z.infer<typeof PackshotRouteSchema>;

export const N7aConfigSchema = z.object({
  route: PackshotRouteSchema,
  briefId: z.string().min(1),
  // 2–3 shots (Entrega T4.4). El rango vive en `PACKSHOT_MIN/MAX_SHOTS` (core/generation) y el config
  // lo REUSA por deep-import (`../generation/packshot-prompt`): esas constantes son la ÚNICA fuente de
  // verdad del rango. Deep-import (no el barril `../generation`) porque es idiomático en core y evita
  // arrastrar el barril entero; no hay ciclo (generation no importa de orchestrator).
  numShots: z
    .number()
    .int()
    .min(PACKSHOT_MIN_SHOTS)
    .max(PACKSHOT_MAX_SHOTS)
    .default(PACKSHOT_MIN_SHOTS),
  // Aspecto vertical 9:16 (Entrega). Se deja como enum de un valor por ahora (N7a es 9:16), pero
  // explícito en el contrato para que T4.11/T4.4b no lo asuman.
  aspect: z.enum(['9:16']).default('9:16'),
});
export type N7aConfig = z.infer<typeof N7aConfigSchema>;

/**
 * Config del step N7b · TTS + WORD TIMESTAMPS (T4.5, §7.2 N7b + §13.1). N7b sintetiza un voiceover por
 * ESCENA del guion (`scene.narration`) con el TTS del tier (kokoro/turbo/eleven-v3) y encadena el ASR
 * (`fal-ai/elevenlabs/speech-to-text`) para los word timestamps (ruta por defecto §13.1: el TTS no los
 * emite nativos).
 *
 * `scriptId` es el forward-pointer estable (patrón de N5/N6/N7a): el executor lee de la fila `ad_script`
 * REAL sus `scenes[].narration` (path de PRODUCCIÓN — NO recibe la narración por config, que fijaría a
 * mano lo que el pipeline deriva; trampa T1.13). `language` mapea a `language_code` del ASR.
 *
 * EL TRIPLE DE VOZ ES CONSISTENTE POR CONSTRUCCIÓN (T4.5 = ejecución + resolución MÍNIMA). En T4.5 el
 * config suministra un triple ya resuelto (`ttsEndpoint` + `voice` + `provider`) del MISMO tier — la
 * costura stepless: el smoke conduce la cadena sin leer el recipe/voice_map de la BD. `resolveVoiceStep`
 * (core) valida que el triple es coherente (p. ej. tier kokoro con un voiceId de elevenlabs →
 * `PermanentStepError`, nunca coerción silenciosa). T4.11 rellenará el triple desde el recipe del tier +
 * el `voice_map` de la Persona por idioma.
 */
export const N7bConfigSchema = z.object({
  scriptId: z.string().min(1),
  /** El idioma del guion (`ad_script.language`), p. ej. `es`/`en`. Mapea a `language_code` del ASR. */
  language: z.string().min(1),
  /** El endpoint del TTS del tier (`fal-ai/kokoro`, `fal-ai/elevenlabs/tts/turbo-v2.5`, …). */
  ttsEndpoint: z.string().min(1),
  /** El proveedor de la voz (`kokoro`/`elevenlabs`/`minimax`), del `voice_map` de la Persona. */
  provider: z.enum(['elevenlabs', 'minimax', 'kokoro']),
  /** El `voiceId` DENTRO del proveedor (kokoro: `af_heart`; elevenlabs: un id de voz). */
  voice: z.string().min(1),
  /** Velocidad del habla (kokoro `speed`, default 1). Opcional. */
  speed: z.number().positive().optional(),
});
export type N7bConfig = z.infer<typeof N7bConfigSchema>;

/**
 * Config del step N7c · CLIP DE AVATAR, tiers image+audio (T4.7, §7.2). N7c anima una IMAGEN de la
 * Persona con el AUDIO del hook (voiceover TTS de N7b) para producir un clip del avatar hablando, con
 * lipsync. Dos tiers image+audio: Kling AI Avatar v2 Std (`fal-ai/kling-video/ai-avatar/v2/standard`)
 * y OmniHuman v1.5 (`fal-ai/bytedance/omnihuman/v1.5`). Ambos toman `{image_url, audio_url, prompt}`;
 * la duración del clip = la del audio automáticamente (ninguno expone `duration_seconds` de entrada).
 *
 * (El tier Test — VEED — es T4.7b: su ASR-del-clip exige extraer el audio del vídeo con ffmpeg, ausente
 * hoy en el worker.)
 *
 * FORWARD-POINTERS ESTABLES (patrón N7a/N7b): la Persona y el hook viajan como IDs de `asset` REALES —
 * `imageAssetId` (fila `asset` kind `reference_image` de la Persona) y `audioAssetId` (fila `asset` kind
 * `tts_audio` del hook, producida por N7b). El executor lee esas filas, sube sus bytes a fal storage
 * (caché §9.6 de `uploadInputCached`) y obtiene las URLs `image_url`/`audio_url`. NO recibe URLs por
 * config (fijaría a mano lo que el pipeline deriva; trampa T1.13). La costura STEPLESS: el smoke elige
 * el tier + los assets por config, sin run/DAG. T4.11 rellenará estos punteros desde la resolución
 * recipe×tier + el voiceover real de la variante.
 *
 * `resolution` SOLO la consume OmniHuman (`720p|1080p`, default `1080p`); Kling la ignora. `prompt` es
 * opcional (ambos modelos lo aceptan; default en el executor).
 */
export const N7cConfigSchema = z.object({
  /** El endpoint del modelo de avatar del tier (Kling Std / OmniHuman Premium). Clave natural del
   *  catálogo (el executor resuelve el perfil por endpoint, patrón N7a/N7b). */
  avatarEndpoint: z.string().min(1),
  /** El `asset` de la IMAGEN de la Persona (kind `reference_image`): sube a fal → `image_url`. */
  imageAssetId: z.string().min(1),
  /** El `asset` del AUDIO del hook (kind `tts_audio`, de N7b): sube a fal → `audio_url`. La duración
   *  del clip = la de este audio automáticamente. */
  audioAssetId: z.string().min(1),
  /** Prompt opcional del avatar (guía de la actuación). Ambos modelos lo aceptan. */
  prompt: z.string().min(1).optional(),
  /** Resolución de OmniHuman (`720p|1080p`, default 1080p). Kling la ignora. El límite de audio de
   *  OmniHuman depende de ella (≤30 s @1080p, ≤60 s @720p) — pero el executor valida contra
   *  `capabilities.maxDuration` del perfil, no contra este enum. */
  resolution: z.enum(['720p', '1080p']).optional(),
});
export type N7cConfig = z.infer<typeof N7cConfigSchema>;

/**
 * Config del step N7d · B-ROLL POR ESCENA (T4.8, §7.2 N7d + §7.5). N7d genera UN clip de vídeo por
 * ESCENA DEL BODY del guion (§7.5 «el b-roll es el body»): i2v desde un keyframe
 * (`fal-ai/veo3.1/image-to-video`) o R2V del producto (`fal-ai/veo3.1/reference-to-video`) cuando el
 * producto debe regenerarse en escena. Las escenas > `maxDuration` del modelo se TROCEAN en clips
 * (§7.5, `planGeneration` de core); la duración de cada clip se CUANTIZA al enum del modelo
 * (`quantizeDurationToEnum`).
 *
 * `scriptId` es el forward-pointer estable (patrón N7b): el executor lee de la fila `ad_script` REAL sus
 * `scenes[]` (path de PRODUCCIÓN — NO recibe las escenas por config, que fijaría a mano lo que el
 * pipeline deriva; trampa T1.13) y FILTRA a `segment: 'body'` (el b-roll es el body).
 *
 * `brollEndpoint` decide la RUTA por el `kind` del perfil (i2v → keyframe único; r2v → referencias del
 * producto). `imageAssetIds` son los assets de imagen de entrada (keyframe de N7a para i2v, packshots
 * del producto para r2v) — el executor los sube a fal y los pasa como `image_url`/`image_urls[]`. La
 * costura STEPLESS: el smoke elige endpoint + imágenes por config, sin run/DAG. T4.11 rellenará estos
 * punteros desde la resolución recipe×tier + los keyframes/packshots reales de la variante, y la
 * decisión i2v-vs-R2V desde si el producto aparece en la escena.
 *
 * `aspect`/`resolution` van explícitos (default 9:16 / 720p) — enums exactos de `capabilities` del
 * modelo (cierre de deuda §13.1 l.600). El executor los valida contra el catálogo antes de gastar.
 */
export const N7dConfigSchema = z.object({
  /** El guion cuyas escenas de body se materializan en b-roll (fila `ad_script` real). */
  scriptId: z.string().min(1),
  /** El endpoint del modelo de b-roll (Veo i2v / Veo R2V). Clave natural del catálogo; el executor
   *  resuelve el perfil por endpoint y su `kind` decide la ruta (i2v/r2v). */
  brollEndpoint: z.string().min(1),
  /** Los `asset` de imagen de entrada: el keyframe (i2v, se usa el primero) o las referencias del
   *  producto (r2v, hasta `capabilities.refImages`). Al menos uno. */
  imageAssetIds: z.array(z.string().min(1)).min(1),
  /** Aspecto vertical del clip (default 9:16). Debe estar en `capabilities.aspects` del modelo. */
  aspect: z.string().min(1).default('9:16'),
  /** Preset de resolución (`720p|1080p|4k`, default 720p — §7.5 pide 720p+). Debe estar en
   *  `capabilities.resolutions` del modelo. */
  resolution: z.string().min(1).default('720p'),
});
export type N7dConfig = z.infer<typeof N7dConfigSchema>;

/**
 * Construye la definición del run de lote (un solo nodo N5) para un proyecto y un lote ya creado.
 *
 * `autopilot=false` + N5 `isCheckpoint` con `alwaysPause`: CP3 —el editor de guiones— es el
 * checkpoint humano de F2. El run arranca SIN autopilot, así que N5 pausa en `waiting_approval` con
 * sus `ad_script` v1 ya persistidos y linteados, y de ahí los recoge el panel de CP3.
 *
 * ── POR QUÉ `alwaysPause` NO ES OPCIONAL AQUÍ ────────────────────────────────────────────────────
 * Mismo argumento que N4/CP2 (§7.1.b): CP3 es donde se confirman los guiones ANTES de que N6/N7
 * (T3.5/T4.11) gasten en la generación real. Un checkpoint normal con autopilot ON no pausa
 * (`shouldPause` → `!autopilot`), así que N5 pasaría directo a `succeeded` sin que nadie revisara ni
 * aprobara los guiones —ni resolviera un flag FTC bloqueante—, y las variantes nunca llegarían a
 * `scripted`. Autopilot significa «no me preguntes por lo gratis», no «gasta en generación sin que
 * yo vea los guiones».
 */
export function batchRunDefinition(projectId: string, batchId: string): RunDefinitionInput {
  return {
    projectId,
    autopilot: false,
    nodes: [
      {
        key: 'N5',
        nodeKey: 'N5',
        dependsOn: [],
        config: { batchId } satisfies AnalysisN5Config,
        isCheckpoint: true,
        checkpointConfig: { alwaysPause: true },
      },
    ],
  };
}
