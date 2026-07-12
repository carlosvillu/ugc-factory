// `withRoute` (api.md §1): un route handler hace exactamente cuatro cosas —
// parsear → validar → delegar en core → serializar. Este HOF factoriza la
// repetición: establece el scope ALS con `request_id`, lee JSON + safeParse en la
// frontera de ENTRADA, y mapea cualquier throw a envelope vía `toErrorResponse`.
//
// `JSON.parse`/`schema.parse` a pelo sobre la entrada está PROHIBIDO: un body
// malformado es un 400 tipado, no un 500 con stack. La SALIDA sí se serializa con
// `Schema.parse` en el handler (un fallo ahí es drift servidor↔contrato).
import { z } from 'zod';
import { AppError } from '@ugc/core/contracts';
import { getRootLogger } from './logger';
import { runWithRequestContext } from './request-context';
import { toErrorResponse } from './errors';

interface Ctx {
  params: Promise<Record<string, string>>; // params asíncrono en Next 16
}

export function withRoute<B = undefined, P = Record<string, string>>(
  handler: (input: { req: Request; body: B; params: P }) => Promise<Response>,
  schemas: { body?: z.ZodType<B>; params?: z.ZodType<P> } = {},
): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
    const log = getRootLogger().child({ request_id: requestId });
    return runWithRequestContext({ log, requestId }, async () => {
      try {
        const raw = await ctx.params;
        const params = (schemas.params ? parseOrThrow(schemas.params, raw) : raw) as P;
        const body = (
          schemas.body ? parseOrThrow(schemas.body, await readJson(req)) : undefined
        ) as B;
        return await handler({ req, body, params });
      } catch (err) {
        return toErrorResponse(err);
      }
    });
  };
}

/** safeParse de una frontera de entrada → `validation_error` 400 con details Zod.
 *  Interno por ahora; el webhook de fal (§5, T4.2) lo promoverá a export cuando lo
 *  consuma (knip veta el export anticipado sin consumidor). */
function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new AppError('validation_error', 'payload inválido', z.flattenError(r.error));
  }
  return r.data;
}

/**
 * Techo del body JSON (T1.11, code-review). `readJson` MATERIALIZA el body entero en memoria
 * (string + objeto parseado): sin tope, un POST gigante —accidental o no— es un OOM del proceso
 * que sirve TODA la app. 1 MiB da holgura de sobra al payload más grande que existe hoy (el DAG
 * de `POST /api/runs`, unos pocos KB) y a los briefs del Apéndice A.
 */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * El body de la petición como JSON.
 *
 * BODY VACÍO ⇒ `{}` (T1.11). Un body SIN CONTENIDO no es JSON malformado: es "sin body", y para
 * un POST cuyo payload es enteramente OPCIONAL (`/approve` con o sin `decision`; `curl -X POST`
 * sin `-d`) eso equivale a `{}`. Devolverlo así deja que el SCHEMA decida —si todos sus campos
 * son opcionales, pasa; si exige alguno, da 400 con el detalle Zod— en vez de rechazar con un
 * opaco "el body no es JSON" una petición perfectamente legal. Se trata como vacío tanto el body
 * de cero bytes como el de SOLO ESPACIOS (`" \n\t "`): en JSON ninguno de los dos lleva
 * información, y distinguirlos solo cambiaría el mensaje de un 400 por otro.
 *
 * BYTES QUE NO PARSEAN ⇒ 400: eso sí es un caller roto.
 *
 * DEMASIADO GRANDE ⇒ 400 (`validation_error`), no 413: `APP_ERROR_CODES` es una unión CERRADA y
 * su mapa code→status es la tabla del Apéndice E del PRD — añadir un `payload_too_large` es un
 * cambio de contrato, no una decisión de este fichero. El `Content-Length` se mira ANTES de leer
 * (rechaza sin materializar nada); el tope sobre el texto ya leído es el cinturón para las
 * peticiones sin `Content-Length` (chunked).
 */
async function readJson(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? Number.NaN);
  const declaredSize = Number.isFinite(declared);
  if (declaredSize && declared > MAX_BODY_BYTES) {
    throw new AppError('validation_error', 'el body es demasiado grande');
  }

  const raw = await req.text();
  // Solo cuando NO hubo `Content-Length` (chunked): si lo hubo, el tamaño ya quedó acotado
  // arriba y recontar los bytes de un body ya validado es trabajo por nada en el 100% de las
  // peticiones reales.
  if (!declaredSize && Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    throw new AppError('validation_error', 'el body es demasiado grande');
  }
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError('validation_error', 'el body no es JSON');
  }
}
