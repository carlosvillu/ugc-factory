// Job `output.download` (jobs.md §3, T4.2, §9.6): la descarga del OUTPUT de una generación de fal
// (el PNG/MP4 en fal.media, potencialmente cientos de MB) NUNCA se hace en el route handler del
// webhook — se encola como job del worker. Core DECLARA la cola (nombre + payload Zod + opciones);
// el HANDLER (consumer que descarga → asset → cost → completed) vive en apps/worker.
//
// El payload lleva el `generationId`: el consumer relee la fila `generation` (estado canónico,
// backend §2) y su `fal_status_payload` ya persistido por el webhook handler, extrae la URL del
// output y descarga. Es IDEMPOTENTE (fal reintenta 10×/2 h y pg-boss redelivera): el consumer
// no-opea si la generación ya está `completed`.
import { z } from 'zod';
import { UlidSchema } from '../contracts';
import { defineJob } from './registry';

export const OutputDownloadJobSchema = z.strictObject({
  generationId: UlidSchema,
});
export type OutputDownloadJob = z.infer<typeof OutputDownloadJobSchema>;

export const outputDownloadJob = defineJob({
  name: 'output.download',
  payload: OutputDownloadJobSchema,
  options: {
    // `standard`: una descarga por generación; no hay dedupe por singletonKey aquí (la
    // idempotencia la da el re-query de la fila `generation` + su UNIQUE `fal_request_id`).
    policy: 'standard',
    // Descarga de red de un CDN: reintentos con backoff exponencial acotado (jobs.md §3/§7). Un
    // glitch del CDN no debe fusilar el job al tercer martillazo; el techo evita delays disparados.
    retryLimit: 5,
    retryBackoff: true,
    retryDelayMax: 300,
    // Cientos de MB pueden tardar: techo duro generoso para el peor caso.
    expireInSeconds: 900,
  },
});
