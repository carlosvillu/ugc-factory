// `POST /api/webhooks/fal` (T4.2, §9.6, api.md §5): el webhook con el que fal nos NOTIFICA que una
// generación terminó, SIN polling. Su autenticación ES la firma ED25519 (no `withAuth`: fal no
// tiene sesión) — por eso NO se envuelve en `withAuth` y el proxy ya excluye `/api/*` (allowlist §6).
//
// HIGIENE DE WEBHOOK (orden ESTRICTO, api.md §5):
//   1. RAW body: la firma cubre los BYTES EXACTOS → `req.text()`, y el JSON se parsea DESPUÉS.
//      Un `req.json()` → re-serializar perdería los bytes originales y TODA firma fallaría.
//   2. Verificar firma + timestamp ±5 min ANTES de tocar la BD. Un POST forjado devuelve 401
//      `invalid_signature` sin crear NI UNA fila.
//   3. SOLO ENTONCES parsear el payload, persistir el evento y encolar la descarga (handler de
//      @ugc/services). La descarga real (cientos de MB) es el job `output.download`, nunca aquí.
//
// El verificador (`verifyFalWebhook`) es una FUNCIÓN PURA de core con `now` y `getJwks` inyectados;
// la caché ≤24 h del JWKS y el encolado se cablean aquí (composition root de web).
import {
  FalWebhookPayloadSchema,
  verifyFalWebhook,
  type FalWebhookHeaders,
} from '@ugc/core/generation';
import { AppError } from '@ugc/core/contracts';
import type { EnqueueRequest } from '@ugc/core/jobs';
import type { JobQueue } from '@ugc/core/orchestrator';
import { handleFalWebhookEvent, makeFalJwksCache } from '@ugc/services';
import { getDb, getBoss, getRequestLogger, toErrorResponse } from '@/server';

// pg + pg-boss + node:crypto viven en el runtime Node, jamás en edge.
export const runtime = 'nodejs';
// El webhook muta estado en cada POST: nunca se cachea.
export const dynamic = 'force-dynamic';

// Caché del JWKS a nivel de MÓDULO (persiste entre requests del mismo proceso, ≤24 h): un fetch por
// ventana para N webhooks, no uno por webhook (api.md §5, testing/api.md §2.6). `now`/`fetch` son
// los reales en producción; los tests handler-level inyectan su JWKS vía msw (mismo proceso).
const jwksCache = makeFalJwksCache();

export const POST = async (req: Request): Promise<Response> => {
  try {
    // 1) TEXTO CRUDO: la firma cubre estos bytes exactos. El JSON se parsea DESPUÉS de verificar.
    const rawBody = await req.text();

    // 2) Cabeceras + verificación ANTES de tocar la BD. Cualquier fallo (headers, timestamp, firma)
    //    es un único 401 `invalid_signature` — el detalle (reason) va al log, no al cliente.
    const headers = readHeaders(req);
    const verification = await verifyFalWebhook(headers, rawBody, {
      now: Date.now,
      getJwks: jwksCache.getJwks,
    });
    if (!verification.ok) {
      getRequestLogger().warn(
        { event: 'fal_webhook_rejected', reason: verification.reason },
        'webhook de fal rechazado: firma/cabeceras/timestamp inválidos',
      );
      // 401 SIN tocar la BD (el test del POST forjado asserta CERO filas nuevas).
      throw new AppError('invalid_signature', 'firma o timestamp de webhook inválidos');
    }

    // 3) Firma VÁLIDA: recién AHORA se parsea el payload. CLAVE (rareza del verifier): un payload que
    //    no parsea (JSON roto o schema fail) tras una firma VÁLIDA NO puede devolver 4xx — fal
    //    reintenta los webhooks no-2xx 10×/2 h, y reintentar un payload que nunca vamos a aceptar es
    //    una tormenta inútil. Se responde 200 + `warn` (mismo patrón que `unknown_request`) para que
    //    fal DEJE de reintentar, sin perder la señal. NB: un 4xx aquí solo tendría sentido si el
    //    emisor pudiera CORREGIR y reenviar — fal no va a cambiar su payload por nuestro 400.
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      getRequestLogger().warn(
        { event: 'fal_webhook_unparseable', reason: 'json' },
        'webhook de fal con firma válida pero body no-JSON: 200 para no disparar reintentos de fal',
      );
      return Response.json({ ok: true, outcome: 'unparseable_payload' });
    }
    const parsed = FalWebhookPayloadSchema.safeParse(json);
    if (!parsed.success) {
      getRequestLogger().warn(
        { event: 'fal_webhook_unparseable', reason: 'schema', issues: parsed.error.issues },
        'webhook de fal con firma válida pero payload fuera de contrato: 200 para no disparar reintentos de fal',
      );
      return Response.json({ ok: true, outcome: 'invalid_payload' });
    }

    const result = await handleFalWebhookEvent(
      { db: getDb(), jobQueue: await getWebJobQueue(), logger: getRequestLogger() },
      parsed.data,
    );
    return Response.json({ ok: true, outcome: result.outcome });
  } catch (err) {
    return toErrorResponse(err);
  }
};

/** Extrae las cuatro cabeceras `X-Fal-Webhook-*` (valores crudos; el verificador las valida). Una
 *  cabecera ausente cae a '' → `verifyFalWebhook` lo rechaza como `missing_headers`. */
function readHeaders(req: Request): FalWebhookHeaders {
  return {
    requestId: req.headers.get('x-fal-webhook-request-id') ?? '',
    userId: req.headers.get('x-fal-webhook-user-id') ?? '',
    timestamp: req.headers.get('x-fal-webhook-timestamp') ?? '',
    signature: req.headers.get('x-fal-webhook-signature') ?? '',
  };
}

/** Puerto `JobQueue` sobre el boss de web (encola `output.download` sin transacción — la
 *  idempotencia la dan el re-query + UNIQUE `fal_request_id` + la idempotencia del consumer). La
 *  cola la crea `getBoss()` (`ensureQueue(outputDownloadJob)`); aquí solo se envía. */
async function getWebJobQueue(): Promise<JobQueue> {
  const boss = await getBoss();
  return {
    async enqueue(request: EnqueueRequest): Promise<void> {
      const data = request.job.payload.parse(request.payload) as object;
      await boss.send(request.job.name, data, {
        ...(request.singletonKey !== undefined && { singletonKey: request.singletonKey }),
        ...(request.startAfter !== undefined && { startAfter: request.startAfter }),
      });
    },
  };
}
