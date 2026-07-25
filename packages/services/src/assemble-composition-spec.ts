// ENSAMBLADOR del `CompositionSpec` de una variante (T5.5d, §9.7 N8 l.288). El GEMELO INVERSO de
// `buildVariantGenerationPlan`: aquel va guion→plan de generación (qué generar); éste va generaciones→spec
// de composición (qué ensamblar). Es la mitad de LÓGICA de N8: dado los OUTPUTS ya resueltos de los N7 de
// la variante (por dep, discriminados POR SCHEMA) + la BD, produce la `CompositionSpec` que la cadena de
// render (fitter→normalize→concat→compose) consume. §9.7 l.288: "Plan determinista que conecta guion N5 →
// generaciones N7 → segmentos de la CompositionSpec".
//
// FRONTERA CORE/SERVICIO (backend principio 1): este módulo TOCA la BD (guion + word timestamps) →
// @ugc/services, no core. La discriminación de deps por schema es PURA (`findDepBySchema`, core); aquí
// queda el I/O (guion, assets) + el ensamblado + la validación en la frontera (`CompositionSpecSchema.parse`).
//
// MAPEO ESCENA→CLIP (el corazón, §9.7) — cada tipo de escena lee su clip de la dep que le corresponde:
//   · N7c (avatar) → el clip de vídeo del segmento HOOK (una escena de hook por variante).
//   · N7d.clips (b-roll) → los clips de vídeo de los segmentos BODY, indexados por `bodySceneIndex` (índice
//     en el subconjunto FILTRADO de body). El ensamblador MAPEA ese índice al `sceneIndex` ABSOLUTO del
//     guion (con un `bodyOrdinal` paralelo) para emparejar cada clip con SU voz/duración/captions.
//   · N7f.clips (CTA) → los clips de vídeo de los segmentos CTA, indexados por `ctaSceneIndex` (índice en el
//     subconjunto FILTRADO de CTA — el GEMELO del `bodySceneIndex` de N7d). Se mapea con un `ctaOrdinal`
//     paralelo al `bodyOrdinal`: en hook·body·cta·body la CTA está en ABSOLUTO 2 pero su clip es
//     `n7f.clips[0]` — indexar por absoluto leería `undefined`. Es el primo del bug de índice del body.
//   · N7b.clips (voces) → la voz de cada escena por `sceneIndex` ABSOLUTO (`voAudio` + duración MEDIDA).
//   · N7e (bed) → el bed musical único (opcional).
//
// SIMETRÍA DEL THROW (anti principio-9, T5.5d): cada tipo de escena lee su clip de la dep que le
// corresponde y LANZA `PermanentStepError` si esa dep no existe — NUNCA degrada reusando el clip de otra
// escena (el reuso del avatar para la CTA fue el bug que originó T5.5a).
//
// TRES CONSTRAINTS DE CORRECCIÓN (T5.5d):
//   1. Discriminabilidad: las deps se buscan por schema (N7b/N7c/N7d/N7e/N7f); `findDepBySchema` LANZA si
//      2+ validan el mismo (cableado ambiguo). Cada schema exige su clave distintiva (step-outputs.ts); el
//      par de riesgo N7d↔N7f se separa por `brollEndpoint` vs `ctaEndpoint`.
//   2. Espacios de índice de body Y cta: N7d/N7f indexan por índice FILTRADO (`bodySceneIndex`/
//      `ctaSceneIndex`), N7b por `sceneIndex` absoluto. Se mapea entre ambos (con `bodyOrdinal`/`ctaOrdinal`)
//      para no pegar la voz/caption/duración de OTRA escena a un clip.
//   3. `narrationDurationS` autoritativa = `N7bClipRef.durationSeconds` (duración MEDIDA de la voz, no
//      `scene.seconds` estimada) — es lo que el fitter consume. `voWords` NO viaja en el output N7b: vive
//      en el asset (`getAsset(assetId).wordTimestamps`).
import {
  AdScriptSchema,
  CompositionSpecSchema,
  MUSIC_VOLUME_MIN,
  N7bOutputSchema,
  N7cOutputSchema,
  N7dOutputSchema,
  N7eOutputSchema,
  N7fOutputSchema,
  type CompositionSpec,
  type CompositionSegment,
  type N7bOutput,
  type N7cOutput,
  type N7dOutput,
  type N7eOutput,
  type N7fOutput,
} from '@ugc/core/contracts';
import { findDepBySchema, WordTimestampsSchema } from '@ugc/core/generation';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { getAsset, getScriptById, type DbClient } from '@ugc/db';

export interface AssembleCompositionSpecDeps {
  db: DbClient;
}

/** Las deps YA resueltas del executor N8 (los `output_refs` de sus deps N7c/N7d/N7f/N7b/N7e). Espejo mínimo
 *  del `ExecutorDep` (solo `outputRefs` importa para discriminar por schema). */
export interface AssembleCompositionSpecInput {
  variantId: string;
  deps: readonly { outputRefs: unknown }[];
  /** El TECHO de duración de la variante (`ad_variant.duration_target`), para `output.maxDurationS`. */
  variantMaxDurationS: number;
}

/** El volumen del bed musical bajo la voz (§9.7: 0,2–0,3). Se elige el MÍNIMO del rango canónico (0,2) —
 *  el más conservador (la voz manda); F8 podría derivarlo del brief. */
const MUSIC_VOLUME = MUSIC_VOLUME_MIN;

/**
 * Ensambla el `CompositionSpec` de una variante desde los outputs YA RESUELTOS de sus N7 (por dep) + el
 * guion + los word timestamps de la BD. Valida la salida contra `CompositionSpecSchema` (frontera).
 *
 * Falla RUIDOSO (`PermanentStepError`, patrón `assembleN6Sources`) si:
 *   · no hay dep N7b (sin voces no hay narración que cuadrar),
 *   · el guion de N7b no existe,
 *   · la variante no tiene NINGUNA fuente de vídeo (ni N7c ni N7d ni N7f) → nunca emite un spec vacío,
 *   · una escena de hook/body/cta no tiene su dep de vídeo correspondiente (N7c/N7d/N7f) — NUNCA reusa el
 *     clip de otra escena (simetría del throw),
 *   · un segmento de vídeo no tiene su voz (cableado roto).
 */
export async function assembleCompositionSpec(
  deps: AssembleCompositionSpecDeps,
  input: AssembleCompositionSpecInput,
): Promise<CompositionSpec> {
  const { db } = deps;
  const { variantId, deps: resolvedDeps, variantMaxDurationS } = input;

  // 1. DISCRIMINAR las deps N7 por SCHEMA (constraint 1). `findDepBySchema` lanza si 2+ validan el mismo.
  const n7b = findDepBySchema<N7bOutput>(resolvedDeps, N7bOutputSchema, 'N7b (voiceover)');
  const n7c = findDepBySchema<N7cOutput>(resolvedDeps, N7cOutputSchema, 'N7c (avatar)');
  const n7d = findDepBySchema<N7dOutput>(resolvedDeps, N7dOutputSchema, 'N7d (b-roll)');
  const n7e = findDepBySchema<N7eOutput>(resolvedDeps, N7eOutputSchema, 'N7e (music)');
  const n7f = findDepBySchema<N7fOutput>(resolvedDeps, N7fOutputSchema, 'N7f (cta clip)');

  if (n7b === undefined) {
    throw new PermanentStepError(
      `assembleCompositionSpec: la variante ${variantId} no tiene dep N7b (voiceover) — sin voces no hay narración que ensamblar`,
    );
  }
  if (n7c === undefined && n7d === undefined && n7f === undefined) {
    // Nunca un spec vacío (patrón `assembleN6Sources`): sin avatar NI b-roll NI clip de CTA no hay ningún
    // clip de vídeo que componer.
    throw new PermanentStepError(
      `assembleCompositionSpec: la variante ${variantId} no tiene NINGUNA fuente de vídeo (ni dep N7c avatar ni N7d b-roll ni N7f cta) — no hay máster que componer`,
    );
  }

  // 2. Leer la fila REAL del guion (por el `scriptId` que N7b dejó en su output — la fuente de verdad de
  //    los segmentos). El jsonb `scenes` se VALIDA (nunca castear).
  const scriptRow = await getScriptById(db, n7b.scriptId);
  if (scriptRow === undefined) {
    throw new PermanentStepError(
      `assembleCompositionSpec: el guion ${n7b.scriptId} (de la dep N7b) de la variante ${variantId} no existe`,
    );
  }
  const script = AdScriptSchema.pick({ scenes: true }).parse({ scenes: scriptRow.scenes });
  const scenes = script.scenes;

  // 3. Ensamblar los segmentos EN ORDEN TEMPORAL (recorriendo el guion escena a escena). Cada escena lee su
  //    clip de LA dep que le corresponde: hook→N7c, body→N7d (por `bodyOrdinal`), cta→N7f (por `ctaOrdinal`).
  //    El array del spec respeta el orden del guion (§9.7: el orden del array es el orden del concat).
  const segments: CompositionSegment[] = [];

  // `bodyOrdinal`/`ctaOrdinal` recorren los subconjuntos FILTRADOS de body/cta EN PARALELO al recorrido
  // absoluto: la N-ésima escena de body del guion es la que N7d indexó como `bodySceneIndex = N`, y la
  // N-ésima escena de cta es la que N7f indexó como `ctaSceneIndex = N` (constraint 2). Sin estos ordinales,
  // indexar N7f/N7d por el `sceneIndex` absoluto leería el clip equivocado (o `undefined`).
  let bodyOrdinal = 0;
  let ctaOrdinal = 0;

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const scene = scenes[sceneIndex];
    if (scene === undefined) continue;

    if (scene.segment === 'hook') {
      // El clip de vídeo del hook lo produjo N7c (avatar). Su voz es la de ESTA escena (`sceneIndex`).
      if (n7c === undefined) {
        throw new PermanentStepError(
          `assembleCompositionSpec: la escena ${String(sceneIndex)} es un hook pero la variante ${variantId} no tiene dep N7c (avatar) que lo cubra`,
        );
      }
      segments.push(await buildSegment(db, 'hook', [n7c.assetId], sceneIndex, n7b));
    } else if (scene.segment === 'body') {
      // El clip de vídeo del body lo produjo N7d. Se localiza por el índice de body ACTUAL (`bodyOrdinal`),
      // NO por `sceneIndex` — N7d indexa en el subconjunto filtrado (constraint 2). Si la escena se troceó,
      // N7d emitió VARIOS clips con el mismo `bodySceneIndex`, distinguidos por `clipIndex`: se recogen
      // TODOS ordenados por `clipIndex` (T5.8c) — el render los concatena intra-escena ANTES de recortar a
      // la narración. Antes de T5.8c se usaba solo el `clipIndex 0` y el resto se pagaba y se TIRABA.
      if (n7d === undefined) {
        throw new PermanentStepError(
          `assembleCompositionSpec: la escena ${String(sceneIndex)} es body pero la variante ${variantId} no tiene dep N7d (b-roll) que la cubra`,
        );
      }
      const bodyClips = pickSceneClips(n7d.clips, (c) => c.bodySceneIndex, bodyOrdinal, {
        variantId,
        sceneIndex,
        dep: 'N7d',
        segment: 'body',
        indexField: 'bodySceneIndex',
      });
      segments.push(
        await buildSegment(
          db,
          'body',
          bodyClips.map((c) => c.assetId),
          sceneIndex,
          n7b,
        ),
      );
      bodyOrdinal++;
    } else {
      // CTA: el clip de vídeo lo produjo N7f (§7.5 «la CTA es product shot animado»). Se localiza por el
      // índice de cta ACTUAL (`ctaOrdinal`), NO por `sceneIndex` — N7f indexa en el subconjunto FILTRADO de
      // cta (constraint 2, el primo del bug del body). LANZA si no hay dep N7f — NUNCA reusa el clip del
      // avatar (el bug que originó T5.5a: simetría del throw).
      if (n7f === undefined) {
        throw new PermanentStepError(
          `assembleCompositionSpec: la escena ${String(sceneIndex)} es una CTA pero la variante ${variantId} no tiene dep N7f (clip de CTA) que la cubra`,
        );
      }
      const ctaClips = pickSceneClips(n7f.clips, (c) => c.ctaSceneIndex, ctaOrdinal, {
        variantId,
        sceneIndex,
        dep: 'N7f',
        segment: 'cta',
        indexField: 'ctaSceneIndex',
      });
      segments.push(
        await buildSegment(
          db,
          'cta',
          ctaClips.map((c) => c.assetId),
          sceneIndex,
          n7b,
        ),
      );
      ctaOrdinal++;
    }
  }

  if (segments.length === 0) {
    throw new PermanentStepError(
      `assembleCompositionSpec: la variante ${variantId} no produjo ningún segmento (guion sin escenas cubiertas por N7c/N7d/N7f)`,
    );
  }

  const spec: CompositionSpec = {
    segments,
    music:
      n7e !== undefined
        ? { asset: n7e.assetId, volume: MUSIC_VOLUME, ducking: true, fadeOutS: 1 }
        : null,
    output: { width: 1080, height: 1920, fps: 30, maxDurationS: variantMaxDurationS },
  };

  // Frontera: un ensamblado incoherente falla AQUÍ, no en ffmpeg.
  return CompositionSpecSchema.parse(spec);
}

/** Etiquetas de diagnóstico de `pickClip`: qué dep/segmento/campo de índice se está resolviendo. Se pasan
 *  explícitas (no genéricas) para que el mensaje de fallo NOMBRE la dep y el campo reales — un fallo de body
 *  dice `N7d`/`body`/`bodySceneIndex`, uno de cta dice `N7f`/`cta`/`ctaSceneIndex` (no difuminar el
 *  diagnóstico). */
interface PickClipLabels {
  variantId: string;
  sceneIndex: number;
  dep: string;
  segment: string;
  indexField: string;
}

/** Un clip de vídeo por-escena (N7d b-roll / N7f cta): índice filtrado + `clipIndex` de troceo + `assetId`. */
interface FilteredClip {
  clipIndex: number;
  assetId: string;
}

/** Localiza TODOS los clips de la N-ésima escena de su segmento (`ordinal`) en los clips de una dep de
 *  vídeo por-escena (N7d/N7f), ORDENADOS por `clipIndex` ascendente (= orden temporal del troceo §7.5).
 *  Esas deps indexan por su ÍNDICE FILTRADO (`bodySceneIndex`/`ctaSceneIndex`, extraído por `getIndex`), NO
 *  por el `sceneIndex` absoluto (en hook·body·cta·body la cta está en absoluto 2 pero su clip es el filtrado
 *  0).
 *
 *  T5.8c: ANTES devolvía SOLO el clip de `clipIndex` mínimo (`reduce`) y los demás clips de una escena
 *  troceada se pagaban y se tiraban — fuga de dinero y, peor, un único clip topado a `maxDuration` que no
 *  cubría la narración → `FitError` en el fitter. Ahora se devuelven todos y el render los concatena.
 *
 *  DOS THROWS, dos fallos distintos:
 *   1. NINGÚN clip para ese índice (cableado roto: el guion tiene más escenas del segmento que clips generó
 *      la dep), NOMBRANDO la dep y el campo concretos para no degradar el diagnóstico.
 *   2. El set de `clipIndex` recogido NO es contiguo `0..n-1` sin duplicados. Un HUECO (p.ej. clipIndex 0 y
 *      2, que puede producir una carrera de dedup o un retry parcial de N7d/N7f) haría que el concat
 *      intra-escena produjese una escena a la que le FALTA el tramo central — y el fitter, que solo mira la
 *      duración TOTAL, la recortaría tan tranquilo: un máster visualmente CORRUPTO que pasa el QA e
 *      indistinguible de uno correcto. Es la misma clase de defecto que T5.8c cierra (clips pagados que no
 *      aterrizan en el output), un nivel más abajo, así que se ABORTA ruidoso en vez de componer basura.
 *
 *  ⚠ LÍMITE CONOCIDO Y DELIBERADO: esta comprobación NO caza una COLA TRUNCADA (el planner planificó 3
 *  clips y solo existen el 0 y el 1: el set `[0,1]` es denso y pasa). Cazarlo exigiría propagar el
 *  `clipCount` de `planScene` por `N7dOutput`/`N7fOutput` (plumbing invasivo del contrato cross-node) y NO
 *  cubre un riesgo vivo: un clip que falla hace fallar SU step, luego la truncación no llega a N8. El riesgo
 *  real —y el que sí se caza— es el hueco por carrera de dedup. */
function pickSceneClips<T extends FilteredClip>(
  clips: readonly T[],
  getIndex: (clip: T) => number,
  ordinal: number,
  labels: PickClipLabels,
): T[] {
  const forScene = clips.filter((c) => getIndex(c) === ordinal);
  if (forScene.length === 0) {
    throw new PermanentStepError(
      `assembleCompositionSpec: la escena de ${labels.segment} ${String(labels.sceneIndex)} ` +
        `(índice de ${labels.segment} ${String(ordinal)}) de la variante ${labels.variantId} no tiene clip en la dep ${labels.dep} ` +
        `(sus clips cubren ${labels.indexField}=[${[...new Set(clips.map(getIndex))].join(', ')}])`,
    );
  }

  const ordered = [...forScene].sort((a, b) => a.clipIndex - b.clipIndex);
  // Contiguidad `0..n-1` sin duplicados: el i-ésimo clip del orden DEBE tener `clipIndex === i`. Un hueco y
  // un duplicado fallan ambos por esta misma comparación (con 0 y 2 el índice 1 vale 2; con 0,0,1 el índice
  // 1 vale 0).
  const broken = ordered.findIndex((clip, i) => clip.clipIndex !== i);
  if (broken !== -1) {
    throw new PermanentStepError(
      `assembleCompositionSpec: los clips de la escena de ${labels.segment} ${String(labels.sceneIndex)} ` +
        `(índice de ${labels.segment} ${String(ordinal)}) de la variante ${labels.variantId} en la dep ${labels.dep} ` +
        `NO forman un troceo §7.5 contiguo: clipIndex=[${ordered.map((c) => c.clipIndex).join(', ')}] ` +
        `(se esperaba 0..${String(ordered.length - 1)} sin huecos ni duplicados). Concatenar este set ` +
        'produciría una escena con un tramo FALTANTE que el fitter recortaría en silencio (máster corrupto ' +
        'que pasa el QA) — se aborta la composición.',
    );
  }
  return ordered;
}

/**
 * Construye UN segmento del spec: sus clips de vídeo (`videoAssets`, en orden de `clipIndex`) + su voz de N7b (`voAudio` por
 * `sceneIndex` absoluto) + los `voWords` (word timestamps del asset de la voz, NO del output N7b —
 * constraint 3). La `narrationDurationS` autoritativa (lo que el fitter consume por-clip) es
 * `N7bClipRef.durationSeconds` — el executor la lee de este mismo clip N7b al fittear.
 *
 * NOTA: la `narrationDurationS` no viaja en el `CompositionSegment` (el contrato de T5.3 no la lleva; el
 * fitter la recibe del executor). Aquí solo se VALIDA que la voz existe (para fallar ruidoso si el clip de
 * esa escena no se generó). El emparejamiento clip↔voz es por `sceneIndex` absoluto.
 */
async function buildSegment(
  db: DbClient,
  type: 'hook' | 'body' | 'cta',
  videoAssetIds: readonly string[],
  sceneIndex: number,
  n7b: N7bOutput,
): Promise<CompositionSegment> {
  const voiceClip = n7b.clips.find((c) => c.sceneIndex === sceneIndex);
  if (voiceClip === undefined) {
    throw new PermanentStepError(
      `assembleCompositionSpec: la escena ${String(sceneIndex)} (segmento ${type}) no tiene voz en la dep N7b ` +
        `(sus clips cubren sceneIndex=[${n7b.clips.map((c) => c.sceneIndex).join(', ')}]) — no se puede componer sin la voz`,
    );
  }

  // `voWords` VIVE EN EL ASSET de la voz, no en el output N7b (constraint 3): se lee de la BD. Los word
  // timestamps son jsonb OPACO → se VALIDAN con `WordTimestampsSchema` (nunca castear). Si el asset no
  // tiene timestamps (null) o no valida, se OMITE `voWords` (una variante sin captions no lo lleva; el
  // spec deja `captions` ausente) — degradación honesta, no un crash.
  const voiceAsset = await getAsset(db, voiceClip.assetId);
  const wordsParsed =
    voiceAsset?.wordTimestamps != null
      ? WordTimestampsSchema.safeParse(voiceAsset.wordTimestamps)
      : undefined;

  const segment: CompositionSegment = {
    type,
    videoAssets: [...videoAssetIds],
    voAudio: voiceClip.assetId,
    ...(wordsParsed?.success === true ? { voWords: wordsParsed.data } : {}),
  };
  return segment;
}
