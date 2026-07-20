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
export { buildVariantGenerationPlan } from './build-variant-generation-plan';
