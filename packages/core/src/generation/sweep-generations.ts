// `sweepStuckGenerations` (T4.3, §9.6): la LÓGICA de la 2ª pieza del tick del sweeper — reconciliar
// las generaciones colgadas contra fal. Espeja `sweepExpiredSteps` (T0.9): lista las filas
// reconciliables (inyectado desde db), llama a `reconcileGeneration` por fila, y NUNCA deja que el
// fallo de UNA fila tumbe el barrido (try/catch por fila, como el de steps). Vive en core (frontera
// backend §1): no importa drizzle ni pg-boss; el listado y las escrituras/encolado se inyectan.
//
// Es lo que "matar el worker y reiniciar" reanuda (Verificación cláusula 2): el sweeper del worker
// releela la fila `submitted` de BD y pollea el MISMO `status_url` guardado — NUNCA re-submitea.
import {
  reconcileGeneration,
  type GenerationKind,
  type ReconcilableGeneration,
  type ReconcileDeadlines,
  type ReconcileCheckStatus,
  type ReconcileEnqueueDownload,
  type ReconcileOutcome,
  type ReconcileUpdate,
} from './reconcile';
import type { Logger } from '../observability';

/** La forma mínima de una fila `generation` que el sweep necesita LEER (subset, no la fila Drizzle
 *  entera — core no ve columnas que no usa). El worker mapea su fila a esto. */
export interface SweepableGenerationRow {
  id: string;
  status: string;
  falRequestId: string | null;
  statusUrl: string | null;
  responseUrl: string | null;
  createdAt: Date;
  startedAt: Date | null;
  /** Última actualización de la fila: base del deadline de descarga de una fila `in_progress`. */
  updatedAt: Date;
  /** El id del modelo, para derivar el `kind` (imagen/vídeo) del deadline por tipo. */
  modelProfileId: string;
}

/** Lista las generaciones reconciliables (lo implementa `listReconcilableGenerations` de @ugc/db y
 *  lo cablea el worker; core no sabe de Drizzle). */
export type ListReconcilableGenerations = () => Promise<SweepableGenerationRow[]>;

/** Deriva el `kind` (imagen/vídeo) de una generación para elegir su deadline por tipo. Hoy solo hay
 *  imagen (FLUX.2 dev); la costura queda abierta para que vídeo (T4.7/T4.8) resuelva su `kind` desde
 *  el `model_profile.capabilities` sin tocar esta lógica. Default: `'image'`. */
export type ResolveGenerationKind = (row: SweepableGenerationRow) => GenerationKind;

export interface SweepGenerationsDeps {
  listReconcilable: ListReconcilableGenerations;
  checkStatus: ReconcileCheckStatus;
  updateGeneration: ReconcileUpdate;
  enqueueDownload: ReconcileEnqueueDownload;
  /** Deriva el tipo por fila (default: todo `image`). */
  resolveKind?: ResolveGenerationKind;
  /** `now` inyectable (tests deterministas). Default `Date.now`. */
  now?: () => number;
  deadlines?: ReconcileDeadlines;
  logger: Logger;
}

/** Resumen del barrido de generaciones (logs/tests). Nunca lanza por una fila individual. */
export interface SweepGenerationsResult {
  /** Cuántas descargas se encolaron: fal COMPLETED (1ª vez) O una fila `in_progress` colgada re-encolada. */
  enqueued: number;
  /** Cuántas se expiraron (colgadas / crash-mid-submit / fal FAILED). */
  expired: number;
  /** Cuántas siguen procesando (no-op este tick). */
  stillProcessing: number;
  /** Cuántas fueron no-op (terminal/intermedio/dentro de edad). */
  noop: number;
  /** Cuántas filas fallaron con un error propagado (contrato roto): se loggean y se continúa. */
  errored: number;
}

/**
 * Barre las generaciones colgadas y reconcilia cada una contra fal (§9.6). Cada `reconcileGeneration`
 * es idempotente y READ-ONLY-a-fal salvo su enqueue/expire; un `FalResponseError` (contrato roto)
 * propaga por fila y se captura aquí (se loggea, el barrido continúa) — igual que `sweepExpiredSteps`
 * captura el fallo de un step sin tumbar el resto.
 */
export async function sweepStuckGenerations(
  deps: SweepGenerationsDeps,
): Promise<SweepGenerationsResult> {
  const rows = await deps.listReconcilable();
  const resolveKind = deps.resolveKind ?? ((): GenerationKind => 'image');
  const result: SweepGenerationsResult = {
    enqueued: 0,
    expired: 0,
    stillProcessing: 0,
    noop: 0,
    errored: 0,
  };

  for (const row of rows) {
    const gen: ReconcilableGeneration = {
      id: row.id,
      status: row.status,
      falRequestId: row.falRequestId,
      statusUrl: row.statusUrl,
      responseUrl: row.responseUrl,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      updatedAt: row.updatedAt,
      kind: resolveKind(row),
    };
    try {
      const { outcome } = await reconcileGeneration(
        {
          checkStatus: deps.checkStatus,
          updateGeneration: deps.updateGeneration,
          enqueueDownload: deps.enqueueDownload,
          ...(deps.now !== undefined ? { now: deps.now } : {}),
          ...(deps.deadlines !== undefined ? { deadlines: deps.deadlines } : {}),
          logger: deps.logger,
        },
        gen,
      );
      tally(result, outcome);
    } catch (err) {
      // Un error propagado (contrato roto de fal) de UNA fila no tumba el barrido: se loggea y se
      // sigue con las demás. El próximo tick reintenta esa fila.
      result.errored += 1;
      deps.logger.warn(
        { err, generation_id: row.id },
        'sweep-generations: fallo reconciliando una generación; se continúa con el resto',
      );
    }
  }

  if (rows.length > 0) {
    deps.logger.info(
      { ...result, total: rows.length },
      'sweep-generations: barrido de reconciliación completado',
    );
  }
  return result;
}

function tally(result: SweepGenerationsResult, outcome: ReconcileOutcome): void {
  if (outcome === 'enqueued_download' || outcome === 're_enqueued_download') result.enqueued += 1;
  else if (outcome === 'expired') result.expired += 1;
  else if (outcome === 'still_processing') result.stillProcessing += 1;
  else result.noop += 1;
}
