// API pública de `@ugc/services` (T1.10a): los servicios INVOCABLES que orquestan
// core (red/CPU) + db/storage (I/O de datos) para un paso del pipeline de análisis.
// Nacieron en `apps/web/src/server/` (T1.4/T1.7/T1.8) pero no importaban nada de
// Next — solo `@ugc/core` y `@ugc/db`. Se movieron aquí (T1.10a) para que
// `apps/worker` los reuse desde los executors N1/N2/N3 sin importar `apps/web`
// (backend/architecture.md §1: apps/web y apps/worker son composition roots
// hermanos, ninguno depende del otro). `apps/web` sigue important estos mismos
// servicios para sus route handlers (T1.4/T1.6/T1.7/T1.8) — MOVER, no duplicar.
//
// El barrel expone SOLO lo que se consume desde fuera del paquete: los tres servicios
// invocables. Los helpers internos (`loadAnthropicKey`, `recordAnthropicCost`,
// `anthropicCostOf`, `fetchableProductImageUrls`) y los tipos de sus deps NO salen: sus
// tests los importan por ruta relativa, y exportarlos "por si acaso" es superficie
// muerta (knip la caza).
export { runFirecrawlIngest } from './firecrawl-ingest';
export { runVisualAnalyze } from './visual-analyze';
export { runSynthesizeBrief } from './synthesize-brief';
// `runWriteScripts` (N5): su consumidor de runtime llegó en T2.6 — el executor de N5 (apps/worker)
// lo llama para escribir los guiones del lote antes de pausar en CP3. Sale al barrel ahora que hay
// quien lo importe desde FUERA del paquete (antes solo su test, por ruta relativa).
export { runWriteScripts } from './write-scripts';
// Generación de imagen contra fal (T4.1, §9.6): submit + polling inline + descarga del output +
// `cost_entry`. Lo consumen el smoke del verifier (`smoke-generate.ts`) y, en T4.11, el executor
// del nodo de generación. `uploadInputCached` es la base §9.6 de la caché de upload a fal storage.
export { runGenerate, uploadInputCached } from './generate';
// Puente URL→asset de las fotos hero del brief (T4.4b, N7a ruta de referencias): descarga la URL,
// re-valida que es descargable ANTES de gastar en fal (planning:352), normaliza a PNG (defensa AVIF)
// y crea la fila `asset` subible a fal por `uploadInputCached`. Lo consume el executor N7a.
export {
  bridgeReferenceImageUrl,
  HeroReferenceUnavailableError,
  type BridgedReferenceImage,
} from './reference-image-bridge';
// Generación de AUDIO contra fal (T4.5, §7.2 N7b + §13.1): la CADENA TTS→ASR que produce un voiceover
// con word timestamps. Servicio NUEVO (no `runGenerate`, cuyo tail es solo-imagen). Lo consume el
// smoke del verifier y, en T4.11, el executor N7b.
export { runGenerateAudio } from './generate-audio';
// Preview de voz TTS-only cacheado (T4.6, §8.3): la muestra por Persona/idioma que el botón ▶ de
// CP2/CP3 reproduce ANTES de gastar render. Comparte el scaffold submit→poll→download con
// `runGenerateAudio` pero SIN ASR (un preview no necesita timestamps) y con caché scoped
// (`voice_preview=true`) para que N reproducciones no añadan coste. Lo consume el route handler
// `POST /api/personas/[id]/voice-preview`.
export { runTtsOnly, type VoicePreviewResult } from './generate-audio';
// Imagen de PRUEBA de un template cacheada (T4.12, botón «Probar template»): el equivalente-imagen del
// preview de voz. Text-to-image flux-2 con caché scoped (`template_test=true`) para que N clicks de
// probar no añadan coste. Lo consume el route handler `POST /api/templates/[id]/test`.
export { runTemplateTest, FLUX2_ENDPOINT } from './generate-template-test';
// THUMBNAIL de galería de un template (T4.12): genera la miniatura-imagen con flux-2 (dedup de
// producción) y la asocia a `prompt_template.thumbnail_asset_id` — la pieza que permite publicar
// (§10.2 regla 2). Lo consume el route handler `POST /api/templates/[id]/thumbnail`.
export {
  generateTemplateThumbnail,
  type TemplateThumbnailResult,
} from './generate-template-thumbnail';
// Generación de CLIP DE AVATAR contra fal (T4.7, §7.2 N7c): anima una imagen de la Persona con el audio
// del hook (image+audio: Kling Std / OmniHuman Premium). Servicio NUEVO con finalizer PROPIO
// (`kind:'avatar_clip'`) — NO `finalizeGeneration` (solo-imagen). Lo consume el smoke del verifier y, en
// T4.11, el executor N7c.
export { runGenerateAvatar } from './generate-avatar';
// Generación del CLIP DE AVATAR tier TEST · VEED (T4.7b, §7.2 N7c / §7.5): text-to-video con voz de
// librería propia → extracción de la pista de audio con ffmpeg (imagen del worker, T5.1) → ASR →
// word timestamps. Discontinuidad del tier barato (NO usa la Persona ni el TTS de N7b). Lo consume el
// smoke del verifier (que lo corre EN la imagen del worker, la única con ffmpeg).
export { runGenerateVeedAvatar } from './generate-veed-avatar';
// Generación de CLIP DE B-ROLL contra fal (T4.8, §7.2 N7d): 1 clip por escena del body — i2v desde
// keyframe (`fal-ai/veo3.1/image-to-video`) o R2V del producto (`fal-ai/veo3.1/reference-to-video`).
// Servicio hermano de `runGenerateAvatar` (vídeo, finalizer `kind:'broll_clip'`), pero SIN audio y con
// duración como INPUT (el enum cuantizado del clip). Lo consume el smoke del verifier y, en T4.11, el
// executor N7d.
export { runGenerateBroll } from './generate-broll';
// Generación de BED MUSICAL IA contra fal (T4.9, §7.2 N7e): 1 bed por MOOD (`tags`) y DURACIÓN con
// ace-step (`fal-ai/ace-step`, text-to-music). Servicio HERMANO estructural de `runGenerateBroll`
// (UNA llamada, duración = INPUT no output, UNA unidad de coste por segundo, payload por BYPASS), pero
// audio-family (`extractAudioOutput`, finalizer `kind:'music_bed'`) — NO reusa el finalizer de N7b
// (fusionado con el ASR). Lo consume el smoke del verifier y, en T4.11, el executor N7e.
export { runGenerateMusic } from './generate-music';
// Generación IA de IMÁGENES DE REFERENCIA de una Persona (T4.12 pase B, §11 identity lock): retrato base
// (FLUX.2 t2i, ≥2K) → cada encuadre (`fal-ai/nano-banana-2/edit`, ≥2K validado) → persistido en la
// persona. Sin dedup ni seed (cada «Generar variación» = output fresco). Finalizer PROPIO
// (`kind:'reference_image'`, `unit:'images'`). Lo consume el route handler
// `POST /api/personas/[id]/reference-images/generate`. Los endpoints y tipos internos NO se re-exportan
// (los tests del módulo los importan por ruta relativa).
export { runGeneratePersonaImages } from './generate-persona-images';
// Discriminador PURO de limpieza de referencias de persona (T4.12 escalado): parte los assets de una
// persona en IA (a conservar) vs sintéticas del seed (a borrar) por `generationId`. Lo consume el script
// de escalado (`apps/web/scripts/seed-persona-images.ts`), que borra las sintéticas tras generar las IA
// para que cada persona quede SOLO con referencias consistentes del mismo sujeto (cláusula 1 de T4.12).
export { partitionPersonaReferences, MIN_AI_REFERENCES } from './persona-reference-cleanup';
// El dedup de generación (T4.10, §9.6: `resolveProductionDedup` en `generation-dedup.ts`) NO
// se re-exporta: es una pieza INTERNA que los 6 servicios de generación importan por ruta relativa antes
// de crear la fila `submitting`. Exportarla sería superficie muerta (misma disciplina que el resto del
// índice: nada "por si acaso").
// Submit VÍA WEBHOOK sin polling (T4.2, §9.6): deja la fila `generation` en `submitted` keyed por
// el request_id REAL de fal; la completion la conduce el webhook. Lo consume el smoke del verifier.
export { submitGenerationForWebhook } from './submit-generation';
// Tail compartido de la generación (T4.2, §9.6): descarga output → asset → cost → completed. Lo
// usan `runGenerate` (poll) y el consumer `output.download` (webhook). `OutputDownloader` es el
// puerto mínimo de descarga que el consumer inyecta (el FalClient lo cumple).
// `OutputDownloader` es el puerto mínimo de descarga que el consumer `output.download` inyecta (el
// FalClient lo cumple). `finalizeGeneration` (imagen) NO se re-exporta: lo consume internamente el
// dispatch kind-aware (`finalizeGenerationByKind`) por ruta relativa; el consumer solo ve el dispatch.
export { type OutputDownloader } from './finalize-generation';
// Dispatch KIND-AWARE del consumer `output.download` (T4.11, MONEY POINT): ruta una generación colgada
// reconciliada al finalizer correcto por su `model_profile.kind` (imagen/vídeo/música), NUNCA al de
// imagen a ciegas (un audio/vídeo reventaría o crearía un asset corrupto). Un `tts` no es liquidable por
// esta vía (necesita ASR) → `PermanentStepError`.
export { finalizeGenerationByKind } from './finalize-download';
// Webhook de fal (T4.2, §9.6): el handler que persiste el evento verificado y encola la descarga
// (lo llama el route handler de web), y la caché ≤24 h del JWKS que alimenta a `verifyFalWebhook`.
export { handleFalWebhookEvent } from './handle-fal-webhook';
export { makeFalJwksCache } from './fal-jwks';
// ENSAMBLADOR de N6Sources desde la BD (T4.11 pass 2b-ii, §7.2 N6): brief+persona+guion+facetas de una
// variante → el `N6Sources` que el motor puro `compilePrompt` consume. Lo llama el executor N6 (raíz del
// sub-DAG de generación, sin dep productora) para leer las fuentes de la BD por `variantId`.
export { assembleN6Sources } from './assemble-n6-sources';
// BUILDER del plan de generación de UNA variante (T4.11 pass 2b-ii, §7.2 N6→N7): variante `scripted` →
// `VariantGenerationPlan` (endpoints por componente resueltos del recipe×tier, triple de voz del
// voice_map). Lo llama `approveScriptsForStep` (CP3) para arrancar el run de generación. Money-safe: una
// etiqueta-no-endpoint lanza `PermanentStepError` ANTES de crear el run.
export { buildVariantGenerationPlan, isTierGenerationReady } from './build-variant-generation-plan';
// FUENTE ÚNICA de la API key de fal desde `app_setting` (cifrada): la usan WEB (preview/thumbnail/persona)
// y el WORKER (executors N7 + sweeper de reconciliación). `falOptionsFrom` deriva el override E2E de base
// URL del FalClient. Antes el worker leía `process.env.FAL_KEY`; ahora ambos resuelven de la BD.
export { loadFalKey, falOptionsFrom } from './fal-key';
// NORMALIZACIÓN CANÓNICA con caché normalize-once (T5.2, §9.7): el módulo que lleva cada asset de una
// variante al perfil de salida exacto (1080×1920/30fps/H.264 con `-an`, o audio AAC 48k estéreo) ANTES
// del concat+mix de T5.3. `createNormalizer` es la capa de orquestación (materializa + caché por
// inyección + persiste); `normalizeVideoFile`/`normalizeAudioFile` son la capa de encode file-in/file-out
// (ffmpeg inyectable), que la suite media sondea con ffprobe. Lo consumirá el executor de render (T5.3/
// T5.5); T5.2 entrega el módulo reutilizable, NO cablea el executor.
export {
  createNormalizer,
  normalizeVideoFile,
  normalizeAudioFile,
  buildVideoNormalizeArgs,
  buildAudioNormalizeArgs,
  NormalizeError,
  type Normalizer,
  type NormalizerDeps,
  type NormalizeSourceAsset,
  type NormalizedAsset,
  type CreateNormalizedAssetInput,
} from './normalize-asset';
// CONCAT + MEZCLA DE AUDIO → MÁSTER INTERMEDIO (T5.3, §9.7): el módulo que ensambla el máster de una
// variante desde su `CompositionSpec` (contrato en @ugc/core) — concat demuxer `-c copy` del vídeo (válido
// porque T5.2 ya normalizó los segmentos) + mezcla voz/bed con ducking (`sidechaincompress`), `afade` out y
// `loudnorm I=-14`. `composeMaster` es la orquestación (materializa + ffmpeg + bytes-out, NO crea asset);
// `buildDuckingGraph` es el builder de ducking que el test media importa y renderiza aislado (principio 9).
// Es un MÁSTER INTERMEDIO: sin burn-in (T5.4) ni qa_report/C2PA (T5.5). T5.3 entrega el módulo reutilizable,
// NO cablea el executor (patrón T5.2).
export {
  composeMaster,
  buildDuckingGraph,
  buildAudioMixGraph,
  buildConcatArgs,
  buildConcatListFile,
  buildAudioConcatArgs,
  buildMuxArgs,
  ComposeError,
  DUCKING_PARAMS,
  LOUDNORM_TARGET_I,
  type ComposeMasterDeps,
  type ComposeMasterResult,
  type ResolveAssetKey,
} from './compose-master';
// SEGMENT FITTER — recorte a la narración + hold del último frame (T5.5b, §9.7 N8 l.288): el módulo que
// cuadra cada clip crudo de N7 (duración CUANTIZADA al enum del modelo, §7.5) a la duración EXACTA de su
// narración ANTES de que T5.2 lo normalice y T5.3 lo concatene (que asume segmentos ya cuadrados). `trim`
// al final (`-t`, nunca `-ss`, re-encode para corte exacto) si el clip es más largo; `hold` del último
// frame (`tpad=stop_mode=clone`) si el déficit <0,5 s; `FitError` si el déficit ≥0,5 s (desajuste grosero
// de generación → no se tapa, anti-principio-9). `buildFitArgs`/`planFit` son los builders PUROS que el
// gate ejerce (boundary del umbral + throw sin ffmpeg); `fitSegmentFile` es file-in/file-out (paths-only,
// runner+ffprobe inyectables), que la suite media sondea con ffprobe. Lo consumirá el ensamblador N8 de
// T5.5d; T5.5b entrega el módulo reutilizable, NO cablea el executor (patrón T5.2/T5.3).
export {
  fitSegmentFile,
  planFit,
  buildFitArgs,
  FitError,
  MAX_HOLD_DEFICIT_S,
  type FitPlan,
  type FitSegmentDeps,
  type FitSegmentOptions,
  type FitSegmentResult,
} from './fit-segment';
// PASE FINAL, EXPORT MASTER + QA + C2PA (T5.5, §9.7 N8/N9 / Apéndice C): el módulo que toma el máster
// INTERMEDIO de T5.3 y produce el PUBLICABLE — re-encode con burn-in de subtítulos al `EXPORT_MASTER_PRESET`
// (`-c:a copy` si el audio no cambió, seam de T5.8), thumbnail, firma C2PA (`trainedAlgorithmicMedia`) y QA
// N9 sobre el fichero FIRMADO → `qa_report`. `composeVariant` es bytes-in/bytes-out (NO escribe BD — eso es
// `finalizeVariantMaster` en @ugc/db). El generador ASS de la variante y el check de safe zone se INYECTAN
// (viven en apps/worker/src/captions; services no puede importarlos). `EXPORT_MASTER_PRESET` es la única
// verdad de los parámetros del pase final; `evaluateQa` deriva de él sus esperados (anti-T1.9). Los builders
// puros (`buildFinalEncodeArgs`, `buildC2paManifest`, `evaluateQa`) los ejerce el gate; la media va en la
// imagen. T5.5 entrega el módulo reutilizable, NO cablea el executor N8/N9 (patrón F5).
export {
  composeVariant,
  buildFinalEncodeArgs,
  buildThumbnailArgs,
  buildC2paManifest,
  collectSpecParentAssetIds,
  escapeFilterPath,
  evaluateQa,
  measureAndEvaluateQa,
  EXPORT_MASTER_PRESET,
  QA_LOUDNESS_TOLERANCE_LUFS,
  QA_AV_DURATION_TOLERANCE_S,
  QA_AUDIO_BITRATE_TOLERANCE,
  ComposeVariantError,
  type ComposeVariantDeps,
  type ComposeVariantResult,
  type QaMeasurements,
  type CaptionAssGenerator,
  type SafeZoneChecker,
  type C2paSigner,
  type LoudnessMeter,
} from './compose-variant';
// El tipo del runner de ffmpeg INYECTABLE (default: subproceso real): lo comparten `extract-audio-track`
// (T4.7b) y el normalizador (T5.2). Sale al barrel porque la suite media inyecta un runner que CUENTA
// invocaciones (el instrumento del test «2ª pasada = 0 ffmpeg») y necesita tiparlo.
export type { FfmpegRunner, FfprobeRunner } from './extract-audio-track';
// `materializeToBytes` (helper storage→bytes): lo estrena como consumidor externo el executor N8 (T5.5d),
// que materializa cada clip crudo de N7 a temp antes de fittearlo. Sale al barrel aquí.
export { materializeToBytes } from './extract-audio-track';
// DERIVACIÓN PURA de la `normalized_cache_key` (T5.2, §9.7): la clave de lookup de la caché =
// `checksum-del-origen + perfil de salida` (w×h, fps, códec/CRF, autorotate, versión de receta). Su unit
// test co-locado corre en el gate (services:unit) — la caché no se puede envenenar en silencio.
export {
  computeNormalizedCacheKey,
  NORMALIZE_RECIPE_VERSION,
  CANONICAL_VIDEO_PROFILE,
  CANONICAL_AUDIO_PROFILE,
  type NormalizeProfile,
} from './normalized-cache-key';
// ENSAMBLADOR del `CompositionSpec` de una variante (T5.5d, §9.7 N8): el gemelo INVERSO de
// `buildVariantGenerationPlan` (guion→plan de generación); aquí generaciones N7→spec de composición. Lo
// llama el executor N8 (apps/worker), que luego encadena fitter→normalize→concat→compose→persist. Su unit
// test co-locado corre en el gate (services:unit) — el mapeo escena→clip no se corrompe en silencio.
export {
  assembleCompositionSpec,
  type AssembleCompositionSpecDeps,
  type AssembleCompositionSpecInput,
} from './assemble-composition-spec';
