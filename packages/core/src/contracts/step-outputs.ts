// Contratos de los ARTEFACTOS que los nodos dejan en `step_run.output_refs` (T1.10a).
//
// Viven en core, y no en el executor que los produce, porque `output_refs` es una
// INTERFAZ PÚBLICA, no un detalle interno: lo consumen (a) el nodo siguiente de la cadena,
// (b) el panel genérico del canvas y (c) CP1 (T1.10b), que renderiza el brief de N3 y el
// motivo del skip de N2. Y `apps/web` NO puede importar de `apps/worker` (son composition
// roots hermanos, architecture.md §1) — si el schema viviera en el executor, web acabaría
// redeclarando la misma forma y tendríamos DOS verdades divergiendo en silencio.
import { z } from 'zod';
import { BatchConfigSchema } from './batch-config';
import { BatchPlanSchema } from './batch-plan';
import { UlidSchema } from './ids';
import { RawContentSchema } from './raw-content';
import { VisualAnalysisSchema } from './visual-analysis';

/**
 * Lo que persiste CUALQUIER nodo que se autodeclare INAPLICABLE (PRD §7.1: "skipped (nodo
 * no aplicable, p. ej. N2 sin imágenes)"). El nodo cierra con `skip_inapplicable` →
 * `skipped` y deja aquí el MOTIVO, para que la UI explique POR QUÉ se saltó en vez de
 * mostrar un hueco.
 *
 * GENÉRICO a propósito (no `N2SkipOutput`): el auto-skip no es de N2 — es un mecanismo del
 * orquestador que F2–F4 van a reutilizar (un nodo de la matriz que no aplique a una
 * variante, una plataforma no seleccionada…). `reason` es un string libre y no un enum:
 * cada nodo tiene sus motivos, y encerrarlos hoy en un enum obligaría a tocar este contrato
 * cada vez que un nodo nuevo se sepa saltar.
 */
export const SkippedOutputSchema = z.object({
  skipped: z.literal(true),
  reason: z.string(),
});
export type SkippedOutput = z.infer<typeof SkippedOutputSchema>;

/** ¿El `output_refs` de un step es el marcador de auto-skip (y no un artefacto real)? Es
 *  el discriminante que un nodo consumidor usa para saber si su dependencia hizo el trabajo
 *  o se descartó. General: sirve para cualquier nodo saltable, no solo N2. */
export function isSkippedOutput(outputRefs: unknown): outputRefs is SkippedOutput {
  return SkippedOutputSchema.safeParse(outputRefs).success;
}

/**
 * N1 · INGESTA: el `RawContent` + el id del `url_analysis` que lo persiste. N2 y N3 lo leen
 * de aquí (no vuelven a la BD a por el análisis). Es el MISMO artefacto en los dos modos de
 * intake —url (scrapeado) y manual (texto libre)—, que es justo lo que hace a N2/N3
 * agnósticos del modo.
 */
export const N1OutputSchema = z.object({
  analysisId: z.string(),
  projectId: z.string(),
  raw: RawContentSchema,
});
export type N1Output = z.infer<typeof N1OutputSchema>;

/** N2 · ANÁLISIS VISUAL: el `VisualAnalysis` cuando SÍ hubo imágenes que analizar. Cuando
 *  NO las hubo, N2 no escribe esto sino un `SkippedOutput` (ver arriba). */
export const N2OutputSchema = z.object({
  visualAnalysis: VisualAnalysisSchema,
  status: z.string(),
  warnings: z.array(z.string()),
});
export type N2Output = z.infer<typeof N2OutputSchema>;

/**
 * N3 · PRODUCTBRIEF: el brief YA validado (T1.9: precio cruzado, `suggested_assets` podadas)
 * + los warnings acumulados del sintetizador y del validador. Es lo que CP1 (T1.10b) edita
 * campo a campo y lo que el panel genérico muestra hoy como output del nodo.
 *
 * `brief` se deja como `unknown` A PROPÓSITO: tiparlo aquí con `ProductBriefSchema` obligaría
 * a validar el brief ENTERO (un objeto grande) cada vez que alguien lee el output de N3, y el
 * brief ya fue validado en su frontera (N3, con `validateBrief`) antes de persistirse. Quien
 * necesite el brief tipado lo parsea con `ProductBriefSchema` en su punto de uso.
 */
export const N3OutputSchema = z.object({
  /**
   * T1.10b — LA FILA del brief en `product_brief`, que es la FUENTE DE VERDAD desde ahora.
   * Hasta T1.10a el brief vivía SOLO inline aquí (sin fila, sin versión): CP1 necesita
   * versionarlo (v1 IA → v2 editado → v3 standalone) y el endpoint `GET/PATCH /api/briefs/:id`
   * necesita poder direccionarlo fuera del run. `brief` (abajo) se conserva porque el panel
   * genérico del canvas y el excerpt del SSE lo leen sin ir a la BD, pero ante una divergencia
   * manda la FILA, no el inline.
   */
  briefId: UlidSchema,
  brief: z.unknown(),
  status: z.string(),
  warnings: z.array(z.unknown()),
});
export type N3Output = z.infer<typeof N3OutputSchema>;

/**
 * N4 · ESTRATEGIA DEL LOTE (T2.3, §7.2 N4: determinista y **$0**): la matriz PROPUESTA por el
 * sistema y la config con la que se compuso. Es lo que abre CP2 (§7.1.b: el step pausa en
 * `waiting_approval` con su artefacto ya escrito) y lo que el panel pinta como punto de partida.
 *
 * ES UNA PROPUESTA, NO UN COMPROMISO. El plan de aquí se compone SIN `batchDiscriminator` (el
 * `ad_batch` todavía no existe), así que sus `filenameCode` solo son únicos DENTRO del plan —
 * exactamente lo que dice el contrato de `PlannedVariant.filenameCode` que hay que hacer para
 * PREVISUALIZAR. El plan que se PERSISTE lo recompone el servidor al confirmar, con el id del
 * lote nuevo como discriminante. Por eso este artefacto **no se puede insertar tal cual**: es la
 * pantalla inicial de CP2, no las filas de `ad_variant`.
 *
 * `briefId` es la fuente de verdad (la fila de `product_brief` que CP1 aprobó); `brief` viaja
 * inline por la misma razón que en N3 —el panel y el excerpt del SSE lo leen sin ir a la BD— y
 * como `unknown` por la misma razón también: quien lo necesite tipado lo parsea con
 * `ProductBriefSchema` en su punto de uso, en vez de re-validar un objeto grande en cada lectura
 * del artefacto.
 */
export const N4OutputSchema = z.object({
  briefId: UlidSchema,
  brief: z.unknown(),
  /** La config por defecto que el compositor usó (la que el panel pre-selecciona). */
  config: BatchConfigSchema,
  /** El `BatchPlan` propuesto (preview, sin `batchDiscriminator`). */
  plan: BatchPlanSchema,
});
export type N4Output = z.infer<typeof N4OutputSchema>;

/**
 * N5 · GUIONIZACIÓN (T2.6, §7.2 N5): el ScriptWriter escribió un `ad_script` v1 por variante y los
 * linteó (FTC, T2.5). Es el artefacto que abre CP3 (§7.1.b: el step pausa en `waiting_approval` con
 * los guiones ya persistidos y linteados) y lo que el panel del editor lista.
 *
 * ARTEFACTO LIGERO A PROPÓSITO (patrón N3/N4): NO trae los guiones completos ni sus
 * `guardrail_flags` inline. La FUENTE DE VERDAD son las filas `ad_script` del lote, que el panel de
 * CP3 relee por REST (`GET /api/batches/:id/scripts`) para editar y aprobar. Aquí viajan solo el
 * `batchId` (con qué lote guionizar), el `status` del writer y sus warnings —lo justo para el
 * excerpt del SSE y para que el panel sepa a qué lote pedirle los guiones—. Meter cada guion inline
 * obligaría a re-validar un objeto grande en cada lectura del artefacto y duplicaría la verdad que
 * ya vive en la tabla.
 *
 * `scriptRefs` es la lista de referencias LIGERAS (una por guion persistido): `variantId` +
 * `scriptId` + `filenameCode` + si tiene algún flag bloqueante. Es lo que el excerpt necesita para
 * decir «6 guiones, 1 con aviso bloqueante» sin cargar el detalle. El detalle (`hook`/`scenes`/`cta`
 * + `guardrail_flags` completos) se relee de `ad_script`.
 */
export const N5ScriptRefSchema = z.object({
  variantId: UlidSchema,
  scriptId: UlidSchema,
  filenameCode: z.string(),
  /** ¿Tiene algún flag `blocking:true`? Derivado del re-lint del writer; el guard REAL de la
   *  aprobación vuelve a lintear server-side en CP3 (no se fía de este booleano). */
  blocked: z.boolean(),
});
export type N5ScriptRef = z.infer<typeof N5ScriptRefSchema>;

export const N5OutputSchema = z.object({
  batchId: UlidSchema,
  scriptRefs: z.array(N5ScriptRefSchema),
  status: z.string(),
  warnings: z.array(z.string()),
});
export type N5Output = z.infer<typeof N5OutputSchema>;

// ── ARTEFACTOS DEL SUB-DAG DE GENERACIÓN N6→N7 (T4.11) ────────────────────────────────────────────
//
// POR QUÉ VIVEN AQUÍ Y NO EN EL EXECUTOR (la razón de cabecera, agudizada por T4.11): estos NO son
// refs ligeros solo para el SSE. Son la FRONTERA CROSS-NODE por la que un executor N7 lee el asset
// que produjo OTRO nodo N7 de la MISMA variante — N7c (avatar) consume el `assetId` del audio del hook
// de N7b; N7d (b-roll) consume los `assetId` de los keyframes de N7a. El consumer resuelve las deps por
// ULID (`step.dependsOn`, aislado por variante por construcción) y las entrega en `ctx.deps`; el executor
// consumidor DISCRIMINA su dep POR SCHEMA (`safeParse`, patrón `parseScriptsOutput`/`resolveCompileInput`),
// NUNCA por `node_key` (T0.8: `node_key` no es único tras un supersede). Si estos schemas vivieran como
// interfaces locales en el worker, N7c/N7d no tendrían con qué validar su dep — y una config con un
// `audioAssetId`/keyframe de OTRA variante pasaría inadvertida quemando dinero de vídeo en el asset
// equivocado. Ese es el punto de máximo riesgo de dinero de F4 (§9.6).

/** T5b.1b-i · UN prompt POR ESCENA de segmento `body`/`cta`. N6 compila la variante ENTERA
 *  (`resolvedPrompt`, arriba) Y, además, una vez por cada escena `body`/`cta` del guion pasando
 *  `compilePrompt({ scene })` — así cada entrada trae los beats que solapan la ventana temporal de SU
 *  escena y su guard pack (§9.5). El consumidor de este array es T5b.1b-ii: N7d/N7f (i2v de b-roll y
 *  CTA) lo leerán para mandar a fal el prompt de ESCENA (con su compliance) en vez de `DEFAULT_BROLL_PROMPT`.
 *  `sceneIndex` es el índice ABSOLUTO en `script.scenes` (el mismo keying que `segmentSceneIndices`
 *  produce para N7d/N7f); `t`/`seconds`/`segment` acompañan para que el consumidor pueda mapear su
 *  escena bajo cualquier keying. NO cambia el `content_hash` (N7 aún no lo lee — eso es T5b.1b-ii). */
export const N6ScenePromptSchema = z.object({
  /** Índice ABSOLUTO de la escena en `script.scenes` (coincide con `segmentSceneIndices`). */
  sceneIndex: z.number().int().nonnegative(),
  segment: z.enum(['body', 'cta']),
  /** Instante de inicio de la escena en segundos (auditoría / mapeo alternativo). */
  t: z.number().nonnegative(),
  /** Duración de la escena en segundos. */
  seconds: z.number().positive(),
  /** El prompt compilado para ESTA escena. WINDOWING PARCIAL (importa para T5b.1b-ii): SOLO
   *  `resolvedBeats` y el bloque estructurado `Beats:` del prompt están acotados a la ventana temporal
   *  `[t, t+seconds)`. La PROSA del template `body` es GLOBAL: sigue narrando el hook y el cta de otras
   *  escenas como "cómo se ve" del clip. Es decir, el prompt de una escena `body` puede mencionar la
   *  línea del hook en prosa; lo que la ventana acota es qué beats aparecen en `Beats:`/`resolvedBeats`. */
  resolvedPrompt: z.string(),
  resolvedBeats: z.array(z.unknown()),
  /** Las keys de guard pack inyectadas en la escena (§9.5), en orden. */
  guardPackKeysUsed: z.array(z.string()),
  /** T5b.1b-i · SEÑAL AUDITABLE de que la ventana `[t, t+seconds)` de esta escena NO solapó NINGÚN
   *  beat del grid (estático) del template — p.ej. una escena cta en t=25s contra un template de 22s
   *  (el timing lo deriva el LLM, el grid del template es fijo, y nada los cruza). Cuando es `true`,
   *  `resolvedBeats` es `[]` y el prompt sale SIN sección `Beats:` con `ok:true` — indistinguible de
   *  una escena normal si no fuera por este flag. Deja rastro en `step_run.output_refs` para que
   *  T5b.1b-ii pueda decidir un default explícito en vez de mandar a fal un prompt sin beats en silencio. */
  noBeatsOverlap: z.boolean(),
});
export type N6ScenePrompt = z.infer<typeof N6ScenePromptSchema>;

/** N6 · COMPILADOR DE PROMPTS ($0): el `resolvedPrompt` de la variante + su procedencia de catálogo.
 *  HOY el `resolvedPrompt` de variante lo consume la UI de auditoría del canvas (T4.11); el array
 *  `scenePrompts` (T5b.1b-i) lo consumirá N7d/N7f en T5b.1b-ii. La fila `generation` la crea N7 al
 *  submitear (no N6), pero desde su propio config, no de aquí. */
export const N6OutputSchema = z.object({
  node: z.literal('N6'),
  variantId: z.string(),
  templateSlug: z.string(),
  guardPackKeysUsed: z.array(z.string()),
  resolvedPrompt: z.string(),
  resolvedBeats: z.array(z.unknown()),
  /** T5b.1b-i · un prompt por escena `body`/`cta` del guion (retrocompatible: se AÑADE, no reemplaza
   *  `resolvedPrompt`/`resolvedBeats`). `.optional()` para no romper el `safeParse` de filas
   *  `step_run.output_refs` históricas sin este campo; el executor SIEMPRE lo emite (incluido `[]`
   *  cuando el guion no tiene escenas `body`/`cta` — control negativo observable). */
  scenePrompts: z.array(N6ScenePromptSchema).optional(),
  /** T5.12 · presente SOLO cuando la selección de template tuvo que DEGRADAR una faceta porque la
   *  `product.category` del brief es texto libre del LLM que ningún template reconoce. Declarado en el
   *  contrato (no como campo suelto) para que el rastro de la degradación sea AUDITABLE y no lo
   *  elimine el `safeParse` de un consumidor — zod descarta las claves no declaradas. */
  degradedFacet: z
    .object({
      facet: z.literal('vertical'),
      value: z.string(),
      templateSlug: z.string(),
    })
    .optional(),
});
export type N6Output = z.infer<typeof N6OutputSchema>;

/** El ref de UN shot de N7a (product shot / keyframe). El `assetId` es lo que N7d consume como keyframe. */
export const N7aShotRefSchema = z.object({
  generationId: z.string(),
  assetId: z.string(),
  costCents: z.number(),
});
/** N7a · PRODUCT SHOTS / KEYFRAMES. Sus `shots[].assetId` son los KEYFRAMES que N7d (b-roll i2v)
 *  consume de su dep. DOS FORMAS por RUTA (T4.4b amplía a las de referencias):
 *   · `ai_packshot` (T4.4): shots GENERADOS por IA sin fotos reales → `syntheticProduct:true`.
 *   · `upload_images`/`promote_scraped` (T4.4b): shots editados desde las fotos hero REALES del brief
 *     con seedream/nano-banana edit → `syntheticProduct:false` (el producto es real, no sintético).
 *  Unión discriminada por `route`: N7d lee `shots[].assetId` igual en ambas (los keyframes son la
 *  frontera cross-node); `syntheticProduct` acompaña a la ruta por construcción (no un flag suelto). */
export const N7aOutputSchema = z.discriminatedUnion('route', [
  z.object({
    route: z.literal('ai_packshot'),
    syntheticProduct: z.literal(true),
    shots: z.array(N7aShotRefSchema),
  }),
  z.object({
    route: z.literal('upload_images'),
    syntheticProduct: z.literal(false),
    shots: z.array(N7aShotRefSchema),
  }),
  z.object({
    route: z.literal('promote_scraped'),
    syntheticProduct: z.literal(false),
    shots: z.array(N7aShotRefSchema),
  }),
]);
export type N7aOutput = z.infer<typeof N7aOutputSchema>;

/** El ref de UN voiceover de N7b (uno por escena). `sceneIndex` + `assetId`: N7c consume el asset de la
 *  escena del HOOK (segment `hook`), no ciegamente `clips[0]`. */
export const N7bClipRefSchema = z.object({
  sceneIndex: z.number(),
  generationId: z.string(),
  assetId: z.string(),
  durationSeconds: z.number(),
  wordCount: z.number(),
  ttsCostCents: z.number(),
  asrCostCents: z.number(),
});
/** N7b · VOICEOVER (TTS→ASR). Su `clips[].assetId` (el de la escena del hook) es el AUDIO que N7c
 *  (avatar) consume de su dep para animar el lipsync. */
export const N7bOutputSchema = z.object({
  scriptId: z.string(),
  language: z.string(),
  clips: z.array(N7bClipRefSchema),
});
export type N7bOutput = z.infer<typeof N7bOutputSchema>;

// ── OUTPUTS DE N7c/N7d/N7e/N7f + N8 (T5.5d) — FORMALIZADOS COMO SCHEMAS (antes `interface` LOCALES) ─────
//
// POR QUÉ AHORA SON SCHEMAS Y NO INTERFACES (T5.5d): el ensamblador N8 (`assembleCompositionSpec`) LEE
// los refs de asset de sus deps N7c (clip de avatar → hook), N7d (b-roll → body), N7f (clip de CTA → cta)
// y N7e (bed → music), y los DISCRIMINA POR SCHEMA con `findDepBySchema` (patrón cross-node, igual que N7c
// hace con N7b y N7d con N7a). Una `interface` local no tiene `.safeParse()`, así que N8 no podría
// distinguir por schema qué dep es cuál. Los executors emiten el mismo shape con `satisfies` (type-only;
// nadie llama `.parse()` en el emit — el typecheck del gate caza cualquier desajuste de forma).
//
// DISCRIMINABILIDAD (CONSTRAINT DE CORRECCIÓN T5.5d): `findDepBySchema` LANZA si 2+ deps validan el MISMO
// schema. Los pares de riesgo son:
//   · N7c ↔ N7e (casi idénticos: endpoint+generationId+assetId+durationSeconds+costCents).
//   · N7d ↔ N7f (IDÉNTICOS salvo la clave de endpoint y el índice de clip: b-roll y clip de CTA comparten
//     la mecánica i2v). ESTE es el par MÁS peligroso: si un schema quedara laxo, un output N7d validaría
//     como N7f (o al revés) y N8 rompería EN RUNTIME (no en el gate) por ambigüedad de dep.
// Por eso CADA schema DEBE exigir su clave DISTINTIVA con `z.object` NO-strict (basta exigir las claves
// propias; un output ajeno falla al no traer la clave exigida):
//   · N7c → `avatarEndpoint`;  N7e → `musicEndpoint` + `mood`.
//   · N7d → `brollEndpoint`;   N7f → `ctaEndpoint`  (la ÚNICA diferencia estructural entre ambos).

/** N7c · CLIP DE AVATAR (T4.7). Ref ligero del clip generado (la verdad vive en `generation`/`asset`). Su
 *  `assetId` es el clip de vídeo del segmento HOOK que N8 coloca en la CompositionSpec. Discriminado de N7e
 *  por `avatarEndpoint` (clave propia). */
export const N7cOutputSchema = z.object({
  avatarEndpoint: z.string(),
  generationId: z.string(),
  assetId: z.string(),
  durationSeconds: z.number(),
  costCents: z.number(),
});
export type N7cOutput = z.infer<typeof N7cOutputSchema>;

/** El ref de UN clip de b-roll de N7d (uno por clip de escena de body, posiblemente troceada). El
 *  `bodySceneIndex` es el índice DENTRO del subconjunto FILTRADO de escenas de body (NO el `sceneIndex`
 *  absoluto del guion); N8 lo MAPEA al espacio de índice absoluto para emparejar cada clip con su voz. */
export const N7dClipRefSchema = z.object({
  /** Índice de la escena de BODY en el subconjunto filtrado (§7.5): 0 = primera escena de body, etc. */
  bodySceneIndex: z.number(),
  /** Índice del clip DENTRO de su escena (0-based; >0 si la escena se troceó). */
  clipIndex: z.number(),
  generationId: z.string(),
  assetId: z.string(),
  durationSeconds: z.number(),
  costCents: z.number(),
});
/** N7d · B-ROLL POR ESCENA (T4.8). Sus `clips[].assetId` son los clips de vídeo de los segmentos BODY que
 *  N8 coloca en la CompositionSpec. Discriminado de N7f por `brollEndpoint` (clave propia, vs `ctaEndpoint`
 *  de N7f). */
export const N7dOutputSchema = z.object({
  scriptId: z.string(),
  brollEndpoint: z.string(),
  route: z.enum(['i2v', 'r2v', 't2v']),
  clips: z.array(N7dClipRefSchema),
});
export type N7dOutput = z.infer<typeof N7dOutputSchema>;

/** El ref de UN clip de CTA de N7f (§7.5 «la CTA es product shot animado»). El `ctaSceneIndex` es el índice
 *  DENTRO del subconjunto FILTRADO de escenas de CTA (NO el `sceneIndex` absoluto del guion) — el gemelo
 *  del `bodySceneIndex` de N7d; N8 lo MAPEA al espacio absoluto con un `ctaOrdinal` paralelo al de body. */
export const N7fClipRefSchema = z.object({
  /** Índice de la escena de CTA en el subconjunto filtrado (§7.5): 0 = primera escena de CTA, etc. */
  ctaSceneIndex: z.number(),
  /** Índice del clip DENTRO de su escena (0-based; >0 si la escena se troceó). */
  clipIndex: z.number(),
  generationId: z.string(),
  assetId: z.string(),
  durationSeconds: z.number(),
  costCents: z.number(),
});
/** N7f · CLIP DE CTA (T5.5a, §7.5). Sus `clips[].assetId` son los clips de vídeo de los segmentos CTA que
 *  N8 coloca en la CompositionSpec. GEMELO estructural de N7d salvo la CLAVE DE ENDPOINT: `ctaEndpoint`
 *  (no `brollEndpoint`) — es lo que permite a `findDepBySchema` distinguir la dep N7f de la N7d (par de
 *  riesgo T5.5d), y el índice de clip es `ctaSceneIndex` (no `bodySceneIndex`). */
export const N7fOutputSchema = z.object({
  scriptId: z.string(),
  ctaEndpoint: z.string(),
  route: z.enum(['i2v', 'r2v', 't2v']),
  clips: z.array(N7fClipRefSchema),
});
export type N7fOutput = z.infer<typeof N7fOutputSchema>;

/** N7e · BED MUSICAL IA (T4.9). Ref ligero del bed generado. Su `assetId` es el `music.asset` de la
 *  CompositionSpec (bed único por variante, §14). Discriminado de N7c por `musicEndpoint` + `mood`. */
export const N7eOutputSchema = z.object({
  musicEndpoint: z.string(),
  mood: z.string(),
  generationId: z.string(),
  assetId: z.string(),
  durationSeconds: z.number(),
  costCents: z.number(),
});
export type N7eOutput = z.infer<typeof N7eOutputSchema>;

/**
 * N8 · COMPOSICIÓN (T5.5d, §9.7): el máster PUBLICABLE de la variante ya persistido. Ref al
 * `masterAssetId` (la fila `asset` kind `final_video` que `finalizeVariantMaster` creó) + el
 * `thumbnailAssetId` + el `qaReport` (el que `composeVariant` devolvió, medido sobre el máster firmado). N8
 * NO paga fal ($0 runtime): ensambla el spec y encadena la cadena de render local
 * (fitter→normalize→concat→compose→persist).
 */
export const N8OutputSchema = z.object({
  variantId: z.string(),
  masterAssetId: z.string(),
  thumbnailAssetId: z.string(),
  /** El `qa_report` del pase final (validado por `QaReportSchema` en su frontera; aquí `unknown` para no
   *  re-validar el objeto entero en cada lectura del artefacto — patrón N3/N4 con `brief`). */
  qaReport: z.unknown(),
});
export type N8Output = z.infer<typeof N8OutputSchema>;

/**
 * N9 · QA (T5.5c, §9.7 N9): el VEREDICTO de QA de la variante. N9 NO re-mide — N8 ya corrió el validador
 * y persistió el `qa_report`; N9 lo LEE de su dep N8 (por schema) y lo re-emite como su artefacto. N9 es el
 * CHECKPOINT CP4 (`isCheckpoint:true`, `alwaysPause:true` en `generation-dag.ts`): al terminar, el step
 * PAUSA en `waiting_approval` y las ops de CP4 (aprobar/rechazar/regenerar, `server/qa-checkpoint.ts`) lo
 * resuelven. El efecto de dominio de CP4 discrimina el artefacto pausado por ESTE schema (`variantId`
 * presente + `passed`), NO por el de N8 (que lleva `masterAssetId`).
 *
 * Distinto de `N8OutputSchema` por su CLAVE distintiva `passed` (el veredicto binario global del QA), que
 * N8 no tiene: así el registro de efectos (`domain-effects.ts`) empareja CP4 sin ambigüedad con N8.
 */
export const N9OutputSchema = z.object({
  variantId: z.string(),
  /** ¿El máster pasó TODOS los checks de QA? (copia de `qaReport.passed`, elevada a nivel raíz para que
   *  el matcher del efecto de CP4 discrimine N9 de N8 sin abrir el jsonb opaco). */
  passed: z.boolean(),
  /** El `qa_report` completo que N8 midió sobre el máster firmado (passthrough, `unknown` como en N8). */
  qaReport: z.unknown(),
});
export type N9Output = z.infer<typeof N9OutputSchema>;
