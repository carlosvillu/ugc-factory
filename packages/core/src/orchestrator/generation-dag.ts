// DAG de GENERACIÓN (T4.11 pass 2b-i, §7.2 N6→N7): el run que MATERIALIZA los assets de un lote ya
// guionizado. Hermano de `analysisRunDefinition` (analysis-dag.ts) y `batchRunDefinition` (batch-dag.ts).
//
// ── POR QUÉ ES UN RUN NUEVO ARRANCADO AL APROBAR CP3 (decisión anclada al código) ─────────────────
// Mismo argumento que N5 fue un run nuevo al aprobar CP2 (batch-dag.ts:5-14), reforzado por dos hechos
// del código:
//   1. El DAG se CONGELA en `createRun`: todas las filas `step_run` se instancian a la vez. N6→N7 solo
//      existe para las variantes que CP3 dejó `scripted` — y ESO no se sabe hasta que CP3 se aprueba
//      (el guard server-side de `approveScriptsForStep` decide variante a variante). Meter N6→N7 en el
//      `batchRunDefinition` de N5 exigiría instanciar sub-DAGs para variantes que quizá nunca se
//      aprueban (o self-skippearlas). Arrancar el run DESPUÉS, con las variantes `scripted` ya sabidas,
//      da un DAG exacto sin nodos-skip.
//   2. La progresión aquí SIEMPRE es un run nuevo: `insertSuperseding` (T0.8) solo MUTA un run para
//      re-ejecutar nodos INVALIDADOS, nunca para APPENDear una fase. CP2→N5 estableció el patrón
//      «aprobar un checkpoint arranca el run de la siguiente fase con `createRun` en su misma tx».
// Lo materializa `approveScriptsForStep` (server/script-checkpoint.ts): tras aplicar los veredictos,
// crea este run con `createRun` DENTRO de la misma tx de aprobación de CP3 y devuelve su `nextRunId`.
//
// ── EXPANSIÓN POR VARIANTE (§7.2 l.265 «sub-DAG por variante»; §UI l.318 «nodo compuesto por variante»)
// Hay N variantes `scripted`. Cada una recibe su PROPIO sub-DAG N6→N7a-e. El `node_key` se queda LIMPIO
// (`N6`/`N7a`…: reconocible por §12 y por el registro de executors, que resuelve por node_key exacto);
// la identidad de variante viaja en `variantId` (columna `step_run.variant_id`, §12 l.495), que además
// entra en el `singletonKey` de encolado — así N variantes con el mismo `node_key` NO colisionan en la
// cola. NO se hardcodea el nº de variantes: se deriva de las `scripted` reales del lote.
//
// ── FRONTERA N6 vs N7 (quién crea la fila `generation`) ───────────────────────────────────────────
// La decisión, anclada en cómo N7a YA funciona (executors/generation.ts): la fila `generation` —donde
// vive `resolved_prompt` (§12) y el `content_hash` de dedup (§9.6)— la crea el EXECUTOR N7 en submit-time
// vía `runGenerate`/`resolveProductionDedup`. N6 NO crea filas `generation`: COMPUTA el `resolvedPrompt`
// (motor puro `compilePrompt` de core, ya cerrado en T3.5) y lo entrega por `output_refs`; N7 lo consume
// de sus `deps` y lo persiste al submitear. Poner la fila en N7 es correcto: la dedup por `content_hash`
// se ancla donde se gasta el dinero (submit), no en un paso $0 previo.
//
// ── TOPOLOGÍA (dependsOn = flujo de datos REAL, §7.2 + §7.5) ──────────────────────────────────────
//   N6  ← []            resuelve el prompt de la variante ($0).
//   N7a ← [N6]          product shots / keyframes.
//   N7b ← [N6]          voiceover (TTS→ASR), independiente de las imágenes.
//   N7c ← [N6, N7b]     clip de avatar: CONSUME el audio del hook de N7b (§7.2 N7c). La arista N7b→N7c
//                       es load-bearing: sin ella N7c podría dispararse antes de que exista el audio.
//   N7d ← [N6, N7a, N7b] b-roll i2v: CONSUME los keyframes de N7a (§7.5 «b-roll desde keyframes») y las
//                       duraciones MEDIDAS de las voces de N7b para dimensionar el troceo §7.5 (T5.8c).
//   N7f ← [N6, N7a, N7b] clip de CTA i2v: mismas dos fuentes que N7d (product shot animado, §7.5).
//   N7e ← [N6]          bed musical, independiente (uno cubre la variante).
// Los N7 opcionales (según receta/ruta) los OMITE el caller no incluyéndolos en `nodes` de la variante;
// el builder no fuerza los cinco. La única regla dura es la topología de los que SÍ están.
//
// ── PRESUPUESTO DE RETRY DE LA CARRERA-PERDEDORA DE DEDUP (MONEY, deuda B de pass 2a) ──────────────
// TODO nodo N7 fija `maxRetries: N7_MAX_RETRIES` (80). Sin él correría al default de BD (3 = 90 s de
// presupuesto), insuficiente contra un ganador Veo de minutos: la carrera-perdedora de dedup (§9.6)
// agotaría sus reintentos e iría a `failed` en vez de deduplicar al asset del ganador, rompiendo
// «nº de generations = hooks+body+CTA+shots». Ver `N7_MAX_RETRIES`/`RETRY_BACKOFF_MS` (executor.ts).
//
// Frontera de core (SKILL.md backend, principio 1): sin BD, sin cola. Habla nodos y config, no filas.
import { N7_MAX_RETRIES } from './executor';
import type { RunDefinitionInput, RunNodeInput } from './run-definition';

/** El `node_key` (§12) de cada sub-step del sub-DAG de generación. LIMPIO (sin variante): el registro de
 *  executors resuelve por él y §12 lo enumera. La variante viaja en `variantId`, no aquí. */
export const GENERATION_NODE_KEYS = {
  n6: 'N6',
  n7a: 'N7a',
  n7b: 'N7b',
  n7c: 'N7c',
  n7d: 'N7d',
  n7f: 'N7f',
  n7e: 'N7e',
  n8: 'N8',
  n9: 'N9',
} as const;

/** Qué sub-steps N7 se materializan para una variante (además de N6, que SIEMPRE está). Cada flag lo
 *  decide el caller desde la receta/ruta del lote (p. ej. sin avatar → `avatar:false`); el builder solo
 *  emite los pedidos, con la topología correcta de los que estén. La config de cada nodo es OPACA para
 *  core (cada executor la re-valida contra su schema): el builder solo la coloca y encadena. */
export interface VariantGenerationPlan {
  /** La variante `scripted` a materializar (§12 `step_run.variant_id`). Identidad del sub-DAG. */
  variantId: string;
  /** Config de N6 (`AnalysisN6Config`: `{variantId}`), opaca aquí. */
  n6Config: unknown;
  /** Config de N7a (product shots), o `undefined` para omitir el sub-step. */
  n7aConfig?: unknown;
  /** Config de N7b (voiceover TTS→ASR), o `undefined` para omitir. */
  n7bConfig?: unknown;
  /** Config de N7c (clip de avatar; CONSUME el audio de N7b), o `undefined` para omitir. */
  n7cConfig?: unknown;
  /** Config de N7d (b-roll; CONSUME los keyframes de N7a), o `undefined` para omitir. */
  n7dConfig?: unknown;
  /** Config de N7f (clip de CTA i2v; CONSUME los keyframes de N7a, como N7d), o `undefined` para omitir. */
  n7fConfig?: unknown;
  /** Config de N7e (bed musical), o `undefined` para omitir. */
  n7eConfig?: unknown;
  /** BED MUSICAL PROPIO (T6.2b, §14 `own_license`): el `asset.id` (kind `music_bed`) que el usuario subió
   *  y ató a esta variante. Cuando está presente, `buildVariantGenerationPlan` OMITE `n7eConfig` (no se
   *  genera bed IA) y este asset se compone como `music.asset` en N8. Es una DECLARACIÓN DE INTENCIÓN del
   *  plan: N8 lee el asset del bed propio de la fila `ad_variant` (verdad SIEMPRE actual, no de un snapshot
   *  del plan que se quedaría rancio si el bed se ata/cambia después de crear el run), no de este campo —
   *  como `variantMaxDurationS`. El campo sirve para RAZONAR sobre el plan (y los tests lo asertan: bed
   *  propio ⇒ `n7eConfig` ausente). `undefined` = sin bed propio (la variante usa el bed IA de N7e). */
  providedMusicBedAssetId?: string;
  /** Config de N8 (composición; CONSUME los N7 de vídeo/voz/bed presentes), o `undefined` para omitir.
   *  N8 no paga fal (compone lo que N7 generó) → $0 runtime. */
  n8Config?: unknown;
  /** Config de N9 (QA + CHECKPOINT CP4; CONSUME N8), o `undefined` para omitir. N9 NO re-mide (lee el
   *  `qa_report` que N8 persistió) → $0 runtime; PAUSA el run en `waiting_approval` (§9.0 CP4). Solo se
   *  materializa si N8 está presente (sin máster no hay QA). */
  n9Config?: unknown;
}

/**
 * AÑADE la cola de COMPOSICIÓN (N8 máster + C2PA) y QA/CHECKPOINT (N9 → CP4) a un plan de generación
 * N6→N7 (T5.8b). Es el ÚNICO dueño de esa cola: los DOS callers que arrancan un run que debe llegar a un
 * máster —el flujo NORMAL (CP3-approve, `approveScriptsForStep`) y la op de REGEN (`regenerateVariantCta`)—
 * la obtienen de aquí, sin duplicar el par `{n8Config, n9Config}` inline.
 *
 * POR QUÉ VIVE EN CORE/ORCHESTRATOR Y NO EN EL BUILDER DE SERVICES (backend principio 1): un tail-adder
 * PURO —añade la cola de composición al SHAPE del `VariantGenerationPlan`, sin tocar la BD— es una cosa
 * ESTRUCTURALMENTE distinta de un builder que LEE la BD (`buildVariantGenerationPlan` resuelve
 * variante→lote→recipe→persona→guion). La resolución con I/O vive en @ugc/services; la transformación pura
 * sobre el tipo del plan vive junto a quien la CONSUME: `variantNodes` (abajo) emite N8 si `n8Config` está,
 * y N9 si N8+N9 están. Colocar el tail-adder junto al consumidor —no junto al builder de BD— es lo que la
 * frontera core/servicio pide. No hay ciclo: `withComposition` no importa nada de services.
 *
 * SHAPE `{variantId}`: N8/N9 leen su identidad de `ctx.variantId` (por-nodo, `step_run.variant_id`), NO de
 * su config — su config solo los ACTIVA (marcador de presencia). El `{variantId}` espeja el que el harness
 * de N8/N9 ya usa. Función PURA: compone un plan nuevo, no muta el de entrada.
 */
export function withComposition(plan: VariantGenerationPlan): VariantGenerationPlan {
  return {
    ...plan,
    n8Config: { variantId: plan.variantId },
    n9Config: { variantId: plan.variantId },
  };
}

/** Una `key` local ÚNICA por (nodo, variante): la referencian los `dependsOn`. El `node_key` se queda
 *  limpio; ESTA es la desambiguación local dentro del DAG. */
function localKey(nodeKey: string, variantId: string): string {
  return `${nodeKey}__${variantId}`;
}

/** Construye el sub-DAG N6→N7a-e de UNA variante (nodos + aristas). Los N7 llevan `maxRetries` holgado
 *  (dedup concurrente); N6 no (es $0, sus fallos son transitorios normales). */
function variantNodes(plan: VariantGenerationPlan): RunNodeInput[] {
  const { variantId } = plan;
  const k = GENERATION_NODE_KEYS;
  const nodes: RunNodeInput[] = [];

  // N6 · COMPILADOR DE PROMPTS (determinista, $0): raíz del sub-DAG de la variante. Los N7 dependen de
  // él (consumen su `resolvedPrompt` de sus deps).
  const n6Key = localKey(k.n6, variantId);
  nodes.push({
    key: n6Key,
    nodeKey: k.n6,
    variantId,
    dependsOn: [],
    config: plan.n6Config,
  });

  // Helper para un sub-step N7: `key` local única, `node_key` limpio, `variantId`, `maxRetries` holgado
  // (la carrera-perdedora de dedup), y sus `dependsOn` (siempre N6 + los productores de sus inputs).
  const n7Node = (
    nodeKey: string,
    config: unknown,
    extraDeps: readonly string[],
  ): RunNodeInput => ({
    key: localKey(nodeKey, variantId),
    nodeKey,
    variantId,
    dependsOn: [n6Key, ...extraDeps],
    config,
    // MONEY: el presupuesto de retry de la dedup concurrente (§9.6) DEBE cubrir la latencia peor-caso
    // del ganador (Veo, minutos). Ver el docblock de cabecera y `N7_MAX_RETRIES`.
    maxRetries: N7_MAX_RETRIES,
  });

  // N7a · PRODUCT SHOTS / KEYFRAMES ← [N6].
  if (plan.n7aConfig !== undefined) {
    nodes.push(n7Node(k.n7a, plan.n7aConfig, []));
  }
  // N7b · VOICEOVER (TTS→ASR) ← [N6]. Independiente de las imágenes.
  if (plan.n7bConfig !== undefined) {
    nodes.push(n7Node(k.n7b, plan.n7bConfig, []));
  }
  // N7c · CLIP DE AVATAR ← [N6, N7b]: consume el audio del hook de N7b. Si se pide N7c pero no N7b, es
  // un plan incoherente (avatar sin voz) — el caller no debe construirlo así; aquí la arista solo se
  // añade si N7b está presente (un N7c sin N7b quedaría dependiendo solo de N6, y su executor fallaría
  // ruidoso al no encontrar el audio, que es el surface honesto).
  if (plan.n7cConfig !== undefined) {
    const audioDep = plan.n7bConfig !== undefined ? [localKey(k.n7b, variantId)] : [];
    nodes.push(n7Node(k.n7c, plan.n7cConfig, audioDep));
  }
  // N7d · B-ROLL ← [N6, N7a, N7b]: consume los keyframes de N7a (i2v) Y —desde T5.8c— las duraciones
  // MEDIDAS de las voces de N7b para dimensionar el troceo §7.5. Sin la arista N7b, N7d trocea contra la
  // duración ESTIMADA del guion (`countWords/2.5`), que el TTS real desborda (~+45% en el run de T5.9):
  // una escena de body real >8s planificaba UN clip topado a 8s → `fitSegmentFile` lanzaba `FitError` y N8
  // no componía. Misma regla condicional que N7c respecto a N7b: la arista solo se añade si N7b está
  // presente (sin ella el executor degrada a la estimación, que es la costura stepless del smoke).
  if (plan.n7dConfig !== undefined) {
    const keyframeDep = plan.n7aConfig !== undefined ? [localKey(k.n7a, variantId)] : [];
    const narrationDep = plan.n7bConfig !== undefined ? [localKey(k.n7b, variantId)] : [];
    nodes.push(n7Node(k.n7d, plan.n7dConfig, [...keyframeDep, ...narrationDep]));
  }
  // N7f · CLIP DE CTA ← [N6, N7a, N7b]: anima el keyframe de product shot de N7a por i2v (§7.5 «la CTA es
  // product shot animado»), MISMA regla de dep que N7d respecto a N7a (si N7a está, es su fuente de
  // keyframe; si no, el executor cae a la costura stepless) — y MISMA arista N7b de T5.8c: la escena de
  // CTA se trocea contra la narración medida, no la estimada.
  if (plan.n7fConfig !== undefined) {
    const keyframeDep = plan.n7aConfig !== undefined ? [localKey(k.n7a, variantId)] : [];
    const narrationDep = plan.n7bConfig !== undefined ? [localKey(k.n7b, variantId)] : [];
    nodes.push(n7Node(k.n7f, plan.n7fConfig, [...keyframeDep, ...narrationDep]));
  }
  // N7e · BED MUSICAL ← [N6]. Independiente.
  if (plan.n7eConfig !== undefined) {
    nodes.push(n7Node(k.n7e, plan.n7eConfig, []));
  }

  // N8 · COMPOSICIÓN ← [los N7 PRESENTES que producen sus inputs]: los clips de vídeo (N7c avatar /
  // N7d b-roll / N7f clip de CTA), las voces (N7b) y el bed (N7e). NO depende de N7a (sus keyframes los
  // consumen N7d/N7f, no N8). `n7Node` prepone N6 (raíz del sub-DAG) por uniformidad, aunque el orden ya lo
  // garantizarían los N7. N8 lee los outputs de esas deps por SCHEMA (findDepBySchema) para ensamblar la
  // CompositionSpec. Sin fal → $0 runtime, pero SÍ lleva el maxRetries holgado por uniformidad (sus fallos
  // de composición son deterministas → Permanent, no gastan).
  if (plan.n8Config !== undefined) {
    const n8Deps: string[] = [];
    if (plan.n7bConfig !== undefined) n8Deps.push(localKey(k.n7b, variantId));
    if (plan.n7cConfig !== undefined) n8Deps.push(localKey(k.n7c, variantId));
    if (plan.n7dConfig !== undefined) n8Deps.push(localKey(k.n7d, variantId));
    if (plan.n7fConfig !== undefined) n8Deps.push(localKey(k.n7f, variantId));
    if (plan.n7eConfig !== undefined) n8Deps.push(localKey(k.n7e, variantId));
    nodes.push(n7Node(k.n8, plan.n8Config, n8Deps));
  }

  // N9 · QA + CHECKPOINT CP4 (T5.5c, §9.7 N9 / §9.0) ← [N8]. Emite el veredicto de QA de la variante
  // (LEE el `qa_report` que N8 persistió — NO re-mide → $0 runtime) y PAUSA el run en `waiting_approval`.
  // Es el ÚNICO checkpoint del DAG de generación: aunque el run corre en `autopilot` (el gasto se autorizó
  // en CP2), `checkpointConfig.alwaysPause=true` GANA sobre autopilot (checkpoint.ts:shouldPause) — la cola
  // FINAL del run de generación deja de ser autopilot y espera el juicio humano de CP4 (aprobar/rechazar/
  // regenerar). Sin `maxRetries` holgado: N9 no paga (sus fallos son deterministas → Permanent, no gastan).
  if (plan.n9Config !== undefined && plan.n8Config !== undefined) {
    nodes.push({
      key: localKey(k.n9, variantId),
      nodeKey: k.n9,
      variantId,
      dependsOn: [localKey(k.n8, variantId)],
      config: plan.n9Config,
      isCheckpoint: true,
      checkpointConfig: { alwaysPause: true },
    });
  }

  return nodes;
}

/**
 * Construye la definición del RUN DE GENERACIÓN de un lote: el sub-DAG N6→N7a-e EXPANDIDO POR VARIANTE
 * para todas las variantes `scripted`. Lo arranca `approveScriptsForStep` (CP3) con `createRun` en su
 * misma tx (server/script-checkpoint.ts).
 *
 * `autopilot=true`: los sub-steps de generación N6/N7/N8 NO son checkpoints — corren sin pausas; el gasto
 * ya lo autorizó el usuario en CP2 (la puerta de dinero). La ÚNICA pausa es N9/QA (CP4, T5.5c): aunque el
 * run está en autopilot, N9 lleva `checkpointConfig.alwaysPause=true`, que GANA sobre autopilot
 * (checkpoint.ts:shouldPause) — la cola final del run espera el juicio humano de CP4.
 *
 * Lanza (indirectamente, vía `createRun`→`validateDag`) si el resultado es estructuralmente inválido;
 * y aquí mismo si `variants` viene vacío (un run de generación sin variantes no tendría root: ningún
 * step arrancaría — mejor un error claro que un run muerto).
 */
export function generationRunDefinition(
  projectId: string,
  variants: readonly VariantGenerationPlan[],
  opts: GenerationRunOptions = {},
): RunDefinitionInput {
  if (variants.length === 0) {
    throw new Error(
      'generationRunDefinition: no hay variantes `scripted` que generar (el run no tendría root)',
    );
  }
  return {
    projectId,
    autopilot: true,
    nodes: variants.flatMap((v) => variantNodes(v)),
    // §12: `kind` del run. La generación normal de CP3 (T4.11) lo OMITE → run 'full' (default de la
    // columna). La REGENERACIÓN PARCIAL (CU4, T5.8) pasa `kind:'regen'` para que la run-list lo distinga
    // (ese campo SÍ tiene lector). La IDENTIDAD de variante viaja por-nodo (`variantId` de cada
    // N6/N7/N8/N9), no a nivel de run; el linaje al lote es alcanzable vía `step_run.variant_id →
    // ad_variant.batch_id` (no se puebla `pipeline_run.batch_id`: media-columna sin lector = ruido).
    ...(opts.kind !== undefined ? { kind: opts.kind } : {}),
  };
}

/** Opciones de linaje del run de generación (T5.8). La generación normal no las usa (run 'full'); la
 *  regeneración parcial fija `kind:'regen'` (lo distingue en la run-list). */
export interface GenerationRunOptions {
  kind?: 'full' | 'partial' | 'regen';
}
