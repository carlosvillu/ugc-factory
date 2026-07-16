// Contrato del PAYLOAD de un webhook de fal (T4.2, §9.6). Es la forma del JSON que fal POSTea a
// nuestra URL cuando una request encolada termina — ALINEADO CON EL BODY REAL capturado por el
// verifier vía cloudflared (`docs/verifications/T4.2/webhook-1-body.raw`, 2026-07-16):
//   {"error": null, "gateway_request_id": "…", "payload": {"images":[…], …}, "request_id": "…", "status": "OK"}
//
// LECCIÓN DE CONFORMANCE (principio 9): fal NO omite los campos ausentes — los envía como `null`
// EXPLÍCITO. En un webhook de ÉXITO, `error` viene `null` (no ausente). `z.string().optional()`
// acepta `undefined` pero RECHAZA `null` (`invalid_type`) → el `safeParse` FALLABA y el handler
// respondía 400, dejando la generación colgada sin descarga. Por eso los campos que fal NULLIFICA
// son `.nullish()` (string | null | undefined), no `.optional()`. Esto se aprendió del body REAL,
// no de la doc — la doc mostraba `error` solo en ERROR y omitía que en OK viaja como null.
//
// `payload` OPACO a propósito: su forma real (imágenes, seed, timings, has_nsfw_concepts…) la valida
// `extractImageOutput` en el finalize, no este schema. Sobre-especificarlo acoplaría el contrato del
// webhook al de CADA modelo; lo dejamos `unknown`.
import { z } from 'zod';

/** Estado terminal de una request en el webhook de fal: OK (éxito) o ERROR (fallo). */
export const FalWebhookStatusSchema = z.enum(['OK', 'ERROR']);
export type FalWebhookStatus = z.infer<typeof FalWebhookStatusSchema>;

export const FalWebhookPayloadSchema = z.object({
  // El id de la request en el queue de fal — la clave de idempotencia (UNIQUE `fal_request_id`).
  request_id: z.string().min(1),
  // El último id intentado (puede diferir si fal reintentó). fal puede enviarlo `null`.
  gateway_request_id: z.string().nullish(),
  status: FalWebhookStatusSchema,
  // El output del modelo (éxito) o el detalle del error (fallo). Opaco: lo valida el finalize.
  payload: z.unknown().optional(),
  // Mensaje de error. En un webhook de ÉXITO fal lo envía `null` EXPLÍCITO (body real) → `.nullish()`,
  // no `.optional()` (que rechazaría el null y tumbaría el parseo del payload de éxito).
  error: z.string().nullish(),
  // Detalle de serialización si el payload no era JSON válido (raro; solo se persiste). `unknown` ya
  // acepta null, pero se deja explícito que fal puede nullificarlo.
  payload_error: z.unknown().nullish(),
});
export type FalWebhookPayload = z.infer<typeof FalWebhookPayloadSchema>;
