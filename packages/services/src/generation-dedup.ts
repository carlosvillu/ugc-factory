// DEDUP DE GENERACIÓN DE PRODUCCIÓN (T4.10, §9.6): la clave de la economía Hook×Body×CTA. Un lote de N
// variantes del mismo ángulo comparte body y CTA — sus generaciones tienen el MISMO `content_hash`, así
// que la primera materializa el asset y las demás lo REUTILIZAN sin submitear a fal ni escribir un
// `cost_entry` (el ahorro se ve en /spend como MENOS filas de coste). Este módulo concentra el LOOKUP
// (paso previo, compartido por los 6 servicios de generación); la escritura atómica (`insertProduction
// GenerationIfAbsent`, ON CONFLICT contra el índice único parcial) la hace cada servicio junto a su
// `createGeneration`, porque va entrelazada con su shape de `NewGeneration` y su liquidación.
//
// PATRÓN GEMELO del dedup scoped de previews (`lookupCachedPreview` en generate-audio.ts): mismo lookup
// optimista sin `FOR UPDATE`, pero GLOBAL a producción (no scoped a `voice_preview`). La atomicidad de
// la CARRERA vive en el INSERT de la fila `submitting` (el índice parcial la serializa), NO aquí.
import {
  getCompletedGenerationByContentHash,
  getAssetByGenerationKind,
  insertProductionGenerationIfAbsent,
  type Asset,
  type DbClient,
  type Generation,
  type NewGeneration,
} from '@ugc/db';
import type { Logger } from '@ugc/core';
import { LoserRaceError } from '@ugc/core/generation';

/** Un acierto de dedup: la generación de producción `completed` previa con el mismo `content_hash` y su
 *  asset reutilizable. Reutilizarlo NO llama a fal ni escribe `cost_entry` (0 coste). */
interface DedupHit {
  /** La fila `generation` `completed` cuya salida se reutiliza (el servicio la devuelve como su
   *  `*Result.generation`). */
  generation: Generation;
  /** El asset (del `kind` esperado) a devolver como resultado — el mismo que produjo aquella generación. */
  assetId: string;
  /** El asset completo (por si el caller necesita su `fal_url`/`duration_s`/`mime` para su `*Result`). */
  asset: Asset;
}

/**
 * LOOKUP del dedup de producción (sin lock): dado un `content_hash` y el `kind` de asset que el servicio
 * produce, devuelve el acierto reutilizable — una generación `completed` NO-preview con ese hash CUYO
 * asset del `kind` esperado existe. `undefined` si no hay caché usable: no hay generación `completed` con
 * ese hash, o —invariante roto— la hay pero sin su asset (en cuyo caso el caller cae al insert-if-absent,
 * que o bien re-genera o bien choca y re-lee). NO usa `FOR UPDATE`: es el lookup optimista de la ruta
 * caliente; el índice único parcial ya serializa la carrera en el INSERT.
 */
async function lookupProductionDedupHit(
  db: DbClient,
  args: { contentHash: string; assetKind: Asset['kind'] },
): Promise<DedupHit | undefined> {
  const hit = await getCompletedGenerationByContentHash(db, args.contentHash);
  if (hit === undefined) return undefined;
  const asset = await getAssetByGenerationKind(db, hit.id, args.assetKind);
  if (asset === undefined) return undefined;
  return { generation: hit, assetId: asset.id, asset };
}

/** Resultado de resolver la fase de dedup (§9.6) de un servicio de generación:
 *  - `{ reused }`: hay un asset `completed` idéntico → el servicio construye su `*Result` con `reused:true`
 *    y coste 0 SIN llamar a fal. Cubre las DOS rutas de acierto (fast-hit optimista y re-lookup tras
 *    perder la carrera del INSERT) — el mismo shape.
 *  - `{ generation }`: la fila `submitting` viva recién creada → el servicio sigue con submit→poll→liquidar.
 */
export type DedupResolution = { reused: DedupHit } | { generation: Generation };

/**
 * Resuelve la fase de dedup de producción (§9.6): el CONTROL-FLOW idéntico que envuelve a los 5 servicios de
 * generación (imagen/avatar/broll/music/audio), extraído para no mantenerlo copiado (la semántica de la
 * carrera —el punto donde se evita el doble-submit-a-fal— vivía replicada 5×). Cada servicio conserva lo que
 * de verdad difiere: el `contentHash` (con el salt de b-roll), los `insertValues` (`NewGeneration`) y el
 * build de su `*Result` a partir del `DedupHit`.
 *
 * Secuencia: (1) fast-lookup optimista → acierto ⇒ `{reused}`; (2) si no, `insertProductionGenerationIfAbsent`
 * (ON CONFLICT contra el índice único parcial) → si crea fila ⇒ `{generation}`; (3) si el INSERT pierde la
 * carrera (`undefined`), re-lee el dedup → si ya está `completed` ⇒ `{reused}`; si aún en vuelo, LANZA
 * `FalResponseError` (con `serviceLabel`) para que el caller reintente y pegue en el fast-path del ganador.
 *
 * El acierto de dedup se loggea AQUÍ, en un solo punto, para las DOS rutas de reúso — antes solo el fast-hit
 * loggeaba `generation_dedup_hit` y el reúso-tras-carrera era mudo (infracontaba los hits concurrentes).
 * El `throw` NO viaja en el tipo de retorno: "el caller debe reintentar" ya es idiomático (todos los
 * servicios propagan `FalResponseError`). `insertProductionGenerationIfAbsent` fuerza `voicePreview:false`.
 */
export async function resolveProductionDedup(
  db: DbClient,
  args: {
    contentHash: string;
    assetKind: Asset['kind'];
    insertValues: NewGeneration;
    /** Nombre del servicio para el mensaje del throw de carrera (p.ej. `runGenerateBroll`). */
    serviceLabel: string;
    /** Etiqueta legible del asset para el mensaje del throw (p.ej. `un b-roll`, `un voiceover`). */
    assetLabel: string;
    logger?: Logger;
  },
): Promise<DedupResolution> {
  const { contentHash, assetKind, logger } = args;

  const fastHit = await lookupProductionDedupHit(db, { contentHash, assetKind });
  if (fastHit !== undefined) {
    logDedupHit(logger, fastHit);
    return { reused: fastHit };
  }

  const inserted = await insertProductionGenerationIfAbsent(db, args.insertValues);
  if (inserted !== undefined) return { generation: inserted };

  const raceHit = await lookupProductionDedupHit(db, { contentHash, assetKind });
  if (raceHit !== undefined) {
    logDedupHit(logger, raceHit);
    return { reused: raceHit };
  }
  // CARRERA PERDEDORA (MONEY POINT T4.11): perdimos el INSERT del índice único parcial y el ganador aún
  // no está `completed`. Se lanza `LoserRaceError` —una SEÑAL DE TIPO dedicada, no un `FalResponseError`
  // con string— para que el executor N7 la trate como REINTENTABLE (deja subir el throw → `failStep` →
  // retry) SIN confundirla con una violación de contrato (que es `PermanentStepError`, no re-paga). En el
  // reintento el ganador ya estará `completed` y esta rama deduplicará a su asset (0 submits, 0 coste).
  throw new LoserRaceError(
    `${args.serviceLabel}: ${args.assetLabel} idéntico se está produciendo en otra petición concurrente; reintenta`,
  );
}

function logDedupHit(logger: Logger | undefined, hit: DedupHit): void {
  logger?.info(
    { event: 'generation_dedup_hit', generationId: hit.generation.id, assetId: hit.assetId },
    'generación reutilizada de una completed idéntica (0 coste)',
  );
}
