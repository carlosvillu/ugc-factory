// `handleFalWebhookEvent` (T4.2, §9.6): lo que el route handler `POST /api/webhooks/fal` invoca
// DESPUÉS de verificar la firma ED25519 y parsear el payload. El handler HTTP es fino (verifica →
// persiste → delega, api.md §5); esta función es el "delega": persiste el evento y ENCOLA la
// descarga del output como job del worker. La descarga en sí (cientos de MB potenciales) NUNCA
// ocurre aquí ni en el route handler — es el consumer `output.download`.
//
// IDEMPOTENCIA (fal reintenta 10×/2 h, pg-boss redelivera): la fila `generation` es el estado
// canónico (backend §2). Se relee por `fal_request_id` (UNIQUE §12) y:
//   · Si ya está `completed` → NO-OP (el output ya se descargó; no re-encolar, no re-cobrar).
//   · Si `fal_request_id` no existe → webhook espurio/tardío: se ignora (200 igualmente para que
//     fal deje de reintentar; se loggea como anomalía).
//   · `status:'ERROR'` → la fila pasa a `failed` con el payload crudo; NO se encola descarga.
//   · `status:'OK'` → se persiste `fal_status_payload` + `in_progress` y se ENCOLA `output.download`.
//     El consumer hace el resto (descargar → asset → cost → completed).
//
// CAMINO STEPLESS PRIMARIO (frontera de alcance): la generación de la Verificación se crea DIRECTA
// (submit + túnel, sin DAG — como el smoke de T4.1), así que NO tiene `step_run_id`. Por eso el
// camino primario es "actualizar la fila `generation` + encolar la descarga", SIN pasar por
// `transition()` del orquestador (que necesita un step sobre el que actuar). La delegación en la
// máquina de estados con `step_run_id` presente es de T4.11 (el executor del nodo de generación) —
// aquí se deja el hueco documentado, no se cablea contra un step que la Verificación no crea.
import { outputDownloadJob } from '@ugc/core/jobs';
import type { FalWebhookPayload } from '@ugc/core/generation';
import type { Logger } from '@ugc/core';
import type { JobQueue } from '@ugc/core/orchestrator';
import {
  getGenerationByFalRequestId,
  updateGeneration,
  type DbClient,
  type Generation,
} from '@ugc/db';

export interface HandleFalWebhookDeps {
  db: DbClient;
  /** Puerto de encolado (el `getBoss()` de web envuelto en `makeJobQueue`). NO transaccional: la
   *  idempotencia la da el re-query + UNIQUE `fal_request_id` + la idempotencia del consumer. */
  jobQueue: JobQueue;
  logger: Logger;
}

/** Qué hizo el handler con el webhook (para logs/tests; el route handler siempre responde 200). */
export type HandleFalWebhookResult =
  | { outcome: 'unknown_request' }
  | { outcome: 'already_completed'; generationId: string }
  | { outcome: 'already_in_progress'; generationId: string }
  | { outcome: 'failed'; generationId: string }
  | { outcome: 'enqueued_download'; generationId: string };

/**
 * Procesa un webhook de fal YA verificado y parseado. Idempotente por diseño (§9.6). No descarga el
 * output (eso es el job `output.download`); solo persiste el evento y encola.
 */
export async function handleFalWebhookEvent(
  deps: HandleFalWebhookDeps,
  event: FalWebhookPayload,
): Promise<HandleFalWebhookResult> {
  const { db, jobQueue, logger } = deps;
  const log = logger.child({ event: 'fal_webhook', fal_request_id: event.request_id });

  const generation = await getGenerationByFalRequestId(db, event.request_id);
  if (generation === undefined) {
    // Webhook para una request que no conocemos: no creamos filas a partir de un webhook (la
    // intención SIEMPRE se persiste ANTES del submit, §9.6). Anomalía observable, no un error 500.
    log.warn({}, 'webhook de fal para un request_id desconocido: ignorado');
    return { outcome: 'unknown_request' };
  }

  // IDEMPOTENCIA: la generación ya se liquidó → el output ya está en storage y el coste registrado.
  // Un reenvío (fal 10×/2 h) o un redelivery no debe re-encolar ni re-cobrar. NO-OP.
  if (generation.status === 'completed') {
    log.info(
      { generation_id: generation.id },
      'webhook de fal sobre generación ya completed: no-op',
    );
    return { outcome: 'already_completed', generationId: generation.id };
  }

  // FALLO reportado por fal: la request terminó en ERROR. Se persiste el payload crudo (auditoría) y
  // la fila pasa a `failed`; NO se encola descarga (no hay output que descargar).
  if (event.status === 'ERROR') {
    await markFailed(db, generation, event);
    log.warn(
      { generation_id: generation.id, fal_error: event.error ?? null },
      'webhook de fal: request en ERROR; generación failed sin descarga',
    );
    return { outcome: 'failed', generationId: generation.id };
  }

  // IDEMPOTENCIA del ÉXITO: un OK previo ya dejó la generación `in_progress` y ENCOLÓ la descarga.
  // fal reenvía el mismo webhook 10×/2 h → un segundo OK NO debe encolar una segunda descarga. La
  // descarga pendiente ya conduce a `completed`; re-encolar solo añade un job redundante (que el
  // consumer no-opearía, pero es tráfico inútil). Se persiste el payload más reciente (puede traer
  // más datos) pero NO se re-encola.
  if (generation.status === 'in_progress') {
    await updateGeneration(db, generation.id, { falStatusPayload: event });
    log.info(
      { generation_id: generation.id },
      'webhook de fal OK reenviado sobre generación ya in_progress: descarga ya encolada, no-op',
    );
    return { outcome: 'already_in_progress', generationId: generation.id };
  }

  // ÉXITO (primer OK): persistir el body crudo del webhook en `fal_status_payload` (evidencia +
  // fuente de la URL del output para el consumer) y marcar `in_progress`; luego ENCOLAR la descarga.
  // El orden importa: el payload se persiste ANTES de encolar, así el consumer siempre encuentra el
  // output al releer.
  await updateGeneration(db, generation.id, {
    status: 'in_progress',
    falStatusPayload: event,
  });
  // La barrera anti-doble-cobro es el `SELECT … FOR UPDATE` de `finalizeGeneration`, NO un
  // `singletonKey` aquí: la cola `output.download` es política `standard` y pg-boss solo aplica el
  // índice único de `singleton_key` en políticas `short`/`singleton`/etc. (no `standard`), así que un
  // `singletonKey` sería inerte. Dos jobs solapados de la misma generación serializan en el lock de
  // fila; el perdedor no-opea (a costa de una descarga desperdiciada, deuda menor aceptada).
  await jobQueue.enqueue({
    job: outputDownloadJob,
    payload: { generationId: generation.id },
  });
  log.info(
    { generation_id: generation.id },
    'webhook de fal verificado: descarga de output encolada',
  );
  return { outcome: 'enqueued_download', generationId: generation.id };
}

/** Marca la generación `failed` persistiendo el payload crudo del webhook de error. */
async function markFailed(
  db: DbClient,
  generation: Generation,
  event: FalWebhookPayload,
): Promise<void> {
  await updateGeneration(db, generation.id, {
    status: 'failed',
    falStatusPayload: event,
    completedAt: new Date(),
  });
}
