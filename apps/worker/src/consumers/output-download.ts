// Consumer `output.download` (T4.2, jobs.md §3, §9.6): descarga el OUTPUT de una generación de fal
// a NUESTRO storage tras el webhook. El route handler del webhook verificó la firma, persistió el
// `fal_status_payload` y ENCOLÓ este job — la descarga (cientos de MB potenciales) vive AQUÍ, nunca
// en el route handler (que fal corta a los 15 s).
//
// Reusa el TAIL COMPARTIDO `finalizeGeneration` de @ugc/services (el MISMO que el poll de T4.1):
//   validar output → descargar → asset → cost → completed en una tx. No se copia el tail (simplify
//   lo marcaría) — una sola verdad de "de output de fal a completed".
//
// IDEMPOTENTE (fal reintenta 10×/2 h, pg-boss redelivera bajo `retryLimit:5`):
//   1. safeParse del payload (payload viejo/corrupto → DLQ legible).
//   2. releer la fila `generation`: no-op si ya está `completed` (el output ya se descargó) o si no
//      es descargable (no `submitted`/`in_progress` con payload de éxito).
//   3. extraer el output del `fal_status_payload` persistido por el webhook y finalizar.
// `finalizeGeneration` LANZA en fallo (descarga caída → FalProviderError); aquí se DEJA propagar
// para que pg-boss reintente con backoff — una descarga caída es transitoria, no un fallo terminal.
import { OutputDownloadJobSchema, outputDownloadJob } from '@ugc/core/jobs';
import { FalWebhookPayloadSchema, makeFalClient } from '@ugc/core/generation';
import type { Logger, StorageAdapter } from '@ugc/core';
import { finalizeGeneration, type OutputDownloader } from '@ugc/services';
import { getGeneration, type DbClient } from '@ugc/db';
import type { PgBoss } from 'pg-boss';

export interface OutputDownloadConsumerDeps {
  boss: PgBoss;
  db: DbClient;
  storage: StorageAdapter;
  logger: Logger;
  /** Descargador del output (inyectable para tests deterministas sin red). Default: un FalClient
   *  con el MISMO timeout duro que submit/poll — la URL de output es pública, no necesita credencial. */
  downloader?: OutputDownloader;
}

export async function registerOutputDownloadConsumer({
  boss,
  db,
  storage,
  logger,
  downloader: injectedDownloader,
}: OutputDownloadConsumerDeps): Promise<void> {
  // La URL de output de fal es firmada y PÚBLICA (no lleva `Authorization: Key`), así que el
  // downloader no necesita credencial: el SDK solo se construye en submit/upload (que aquí no se
  // usan), nunca en `download`. Se reusa `makeFalClient` por su MISMO timeout duro (AbortController).
  const downloader = injectedDownloader ?? makeFalClient({ credentials: '' });

  await boss.work(
    outputDownloadJob.name,
    { batchSize: 1, localConcurrency: 4, pollingIntervalSeconds: 1 },
    async ([job]) => {
      if (job === undefined) return;
      const parsed = OutputDownloadJobSchema.safeParse(job.data);
      if (!parsed.success) {
        throw new Error(`payload de output.download inválido: ${parsed.error.message}`);
      }
      const { generationId } = parsed.data;
      const log = logger.child({
        queue: outputDownloadJob.name,
        job_id: job.id,
        generation_id: generationId,
      });

      const generation = await getGeneration(db, generationId);
      if (generation === undefined) {
        // La fila desapareció (borrado manual, test): no hay nada que descargar. No-op, no error.
        log.warn({}, 'output.download: generación inexistente; no-op');
        return;
      }
      // IDEMPOTENCIA: ya finalizada → el output está en storage y el coste registrado. No re-cobrar.
      if (generation.status === 'completed') {
        log.info({}, 'output.download: generación ya completed; no-op idempotente');
        return;
      }

      // El output vive en el `fal_status_payload` que el webhook handler persistió (el body crudo del
      // webhook de fal: `{ status:'OK', payload:{ images:[...] } }`). Se re-valida antes de usarlo.
      const payload = FalWebhookPayloadSchema.safeParse(generation.falStatusPayload);
      if (!payload.success || payload.data.status !== 'OK') {
        // Sin payload de éxito no hay output que descargar: un job encolado sobre una generación que
        // no llegó a OK es un no-op (p. ej. una carrera con un webhook de ERROR posterior).
        log.warn({}, 'output.download: la generación no tiene payload de webhook OK; no-op');
        return;
      }

      // Finalizar con el tail compartido. Un fallo de descarga PROPAGA (pg-boss reintenta con backoff).
      const finalized = await finalizeGeneration(
        { db, storage, downloader, logger: log },
        {
          generation,
          output: payload.data.payload,
          statusPayload: generation.falStatusPayload,
        },
      );
      log.info(
        { asset_id: finalized.assetId, cost_cents: finalized.costCents },
        'output.download: output descargado y generación completed (webhook verified)',
      );
    },
  );
}
