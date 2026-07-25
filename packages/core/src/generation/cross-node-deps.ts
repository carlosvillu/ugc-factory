// RESOLUCIÓN CROSS-NODE del sub-DAG de generación (T4.11 pass 2b-ii, §7.2 N7 + §9.6) — LÓGICA PURA,
// sin BD ni cola. El punto de MÁXIMO RIESGO DE DINERO de F4: cablear mal aquí anima/renderiza con el
// asset de OTRA variante y quema vídeo real (§9.6).
//
// EL PROBLEMA. Dos executors N7 consumen el OUTPUT de otro nodo N7 de la MISMA variante:
//   · N7c (avatar) consume el AUDIO del hook que produjo N7b (voiceover) — para el lipsync.
//   · N7d (b-roll i2v) consume los KEYFRAMES que produjo N7a (product shots).
// El DAG (generation-dag.ts) ya ORDENA la ejecución (`dependsOn` N7c←N7b, N7d←N7a) y el consumer
// resuelve esas deps por los ULIDs EXACTOS de `step.dependsOn` (executor.ts): como el DAG cablea el
// `dependsOn` de N7c al N7b de SU PROPIA variante (vía `localKey(nodeKey, variantId)`), las deps que
// llegan en `ctx.deps` son de la MISMA variante POR CONSTRUCCIÓN. Aislar por variante NO es una
// comprobación que este código haga: es una propiedad del grafo. Lo que este módulo garantiza es que el
// puntero al asset se DERIVA de esa dep resuelta —NO de una config arbitraria del caller— para que la
// propiedad del grafo llegue intacta al payload de fal.
//
// DISCRIMINACIÓN POR SCHEMA, NUNCA POR node_key (T0.8): `node_key` no es único tras un supersede. Se
// busca la dep cuyo `outputRefs` VALIDA contra el schema del productor (patrón `parseScriptsOutput`).
import { z } from 'zod';
import { N7aOutputSchema, N7bOutputSchema, type N7bOutput } from '../contracts/step-outputs';
import { PermanentStepError } from '../orchestrator/executor';

/** Una dep YA resuelta (espejo del `ExecutorDep` del orquestador; se re-declara mínimo para no acoplar
 *  este módulo puro a la interfaz completa del executor). Solo `outputRefs` importa para discriminar. */
export interface ResolvedDep {
  outputRefs: unknown;
}

/**
 * Busca en las deps resueltas la ÚNICA cuyo `outputRefs` valida contra `schema` (el output de un
 * productor concreto, N7a/N7b). Discrimina por SCHEMA, no por node_key. Devuelve `undefined` si ninguna
 * casa (path stepless: sin DAG no hay deps → el executor cae a su config). Lanza si DOS casan (ambigüedad
 * de cableado: un run bien formado tiene a lo sumo un N7a y un N7b por variante).
 */
export function findDepBySchema<T>(
  deps: readonly ResolvedDep[],
  schema: z.ZodType<T>,
  producerLabel: string,
): T | undefined {
  const matches: T[] = [];
  for (const dep of deps) {
    const parsed = schema.safeParse(dep.outputRefs);
    if (parsed.success) matches.push(parsed.data);
  }
  if (matches.length > 1) {
    throw new PermanentStepError(
      `cross-node: se resolvieron ${String(matches.length)} deps que validan como ${producerLabel} — ` +
        'el DAG debe tener a lo sumo uno por variante (cableado ambiguo)',
    );
  }
  return matches[0];
}

/**
 * La ÚNICA dep N7b (voiceover) entre las deps resueltas, o `undefined` si no hay (path stepless). Aplica
 * el guard de ambigüedad de `findDepBySchema` (2+ N7b → `PermanentStepError`). El executor N7c la usa para
 * sacar el `scriptId` (con el que localiza la escena del hook) SIN re-escanear luego en
 * `deriveHookAudioAssetId`: se parsea una vez aquí y el output resuelto se reusa.
 */
export function findN7bDep(deps: readonly ResolvedDep[]): N7bOutput | undefined {
  return findDepBySchema(deps, N7bOutputSchema, 'N7b (voiceover)');
}

/**
 * Deriva el `assetId` del AUDIO DEL HOOK que N7c (avatar) debe consumir, del output de su dep N7b
 * (voiceover) de la MISMA variante — YA RESUELTO por el caller (`findN7bDep`, que aplica el guard de
 * ambigüedad): así el output no se re-escanea/re-valida aquí. `hookSceneIndex` es el índice de la escena
 * `segment:'hook'` del guion (lo calcula el executor desde la fila `ad_script`, la fuente de verdad de
 * los segmentos): se elige el clip de N7b con ESE `sceneIndex`, NO ciegamente `clips[0]` (el orden podría
 * cambiar y el hook no ser la primera escena). Lanza si el output N7b no trae el clip del hook (cableado
 * roto: N7c animaría con el audio equivocado — se aborta ANTES de gastar en vídeo).
 */
export function deriveHookAudioAssetId(n7b: N7bOutput, hookSceneIndex: number): string {
  const hookClip = n7b.clips.find((c) => c.sceneIndex === hookSceneIndex);
  if (hookClip === undefined) {
    throw new PermanentStepError(
      `cross-node: la dep N7b no tiene voiceover para la escena del hook (sceneIndex=${String(hookSceneIndex)}); ` +
        `sus clips cubren [${n7b.clips.map((c) => c.sceneIndex).join(', ')}] — N7c no puede animar sin el audio del hook`,
    );
  }
  return hookClip.assetId;
}

/**
 * Deriva los `assetId` de los KEYFRAMES que N7d (b-roll i2v) debe consumir, del output de su dep N7a
 * (product shots) de la MISMA variante. Devuelve `undefined` si no hay dep N7a (path stepless → el
 * executor usa `cfg.imageAssetIds`). Lanza si hay dep N7a pero no produjo ningún shot (cableado roto:
 * un b-roll i2v sin keyframe se aborta ANTES de gastar).
 */
export function deriveKeyframeAssetIds(deps: readonly ResolvedDep[]): string[] | undefined {
  const n7a = findDepBySchema(deps, N7aOutputSchema, 'N7a (product shots)');
  if (n7a === undefined) return undefined;
  if (n7a.shots.length === 0) {
    throw new PermanentStepError(
      'cross-node: la dep N7a no produjo ningún shot; N7d (b-roll i2v) no tiene keyframe que animar',
    );
  }
  return n7a.shots.map((s) => s.assetId);
}

/**
 * Deriva las duraciones MEDIDAS de las voces (T5.8c) de la dep N7b, indexadas por el `sceneIndex`
 * ABSOLUTO del guion — el input de `sizeScenesToNarration` (@ugc/core/gallery), con el que N7d/N7f
 * dimensionan el troceo §7.5 contra la narración REAL en vez de la estimada (`countWords/2.5`, que el TTS
 * desborda ~+45% → 1 clip corto → `FitError` en N8, el bug que destapó el run de T5.9).
 *
 * Devuelve un mapa VACÍO si no hay dep N7b (path stepless/smoke): el llamante degrada a la estimación del
 * guion, que es el comportamiento anterior a T5.8c — NO lanza. La arista N7d→N7b/N7f→N7b es CONDICIONAL en
 * el DAG (mismo patrón que N7c→N7b), así que su ausencia es un modo legítimo, no un cableado roto.
 */
export function deriveMeasuredNarrationByScene(
  deps: readonly ResolvedDep[],
): ReadonlyMap<number, number> {
  const n7b = findN7bDep(deps);
  if (n7b === undefined) return new Map();
  return new Map(n7b.clips.map((c) => [c.sceneIndex, c.durationSeconds]));
}
