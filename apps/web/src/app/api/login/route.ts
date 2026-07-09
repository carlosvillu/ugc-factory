// `POST /api/login` (T0.4, api.md §6): la ÚNICA ruta de emisión de sesión. Exenta
// de withAuth (es el login), pero sí rate-limitada por IP. Password correcto →
// 200 + cookie de sesión httpOnly; incorrecto → 401 unauthorized; demasiados
// intentos → 429 rate_limited. El hash vive en `app_setting` (scrypt), sembrado
// en el arranque (instrumentation).
import { z } from 'zod';
import { getPasswordHash } from '@ugc/db';
import {
  withRoute,
  clientIp,
  assertNotRateLimited,
  recordFailure,
  clearAttempts,
  verifyPassword,
  createSessionCookie,
  getDb,
  getRequestLogger,
} from '@/server';
import { AppError } from '@ugc/core/contracts';

// pg vive en el runtime Node, no en edge.
export const runtime = 'nodejs';
// Muta estado de sesión y consulta la BD: jamás se cachea.
export const dynamic = 'force-dynamic';

const LoginBodySchema = z.object({ password: z.string().min(1) });

export const POST = withRoute(
  async ({ req, body }) => {
    const ip = clientIp(req);

    // 1) Rate limit ANTES de tocar la BD: si la IP ya superó el máximo de FALLOS en
    //    la ventana, 429 sin verificar nada. Comprobar no cuenta como intento.
    assertNotRateLimited(ip);

    // 2) Hash sembrado. Si falta, el arranque no sembró (o BD vacía): trátalo como
    //    credencial no configurada → unauthorized (no filtramos el detalle). Cuenta
    //    como fallo (protege contra fuerza bruta aunque no haya hash).
    const stored = await getPasswordHash(getDb());
    if (!stored || !verifyPassword(body.password, stored)) {
      if (!stored) getRequestLogger().warn({}, 'login sin hash sembrado en app_setting');
      recordFailure(ip); // solo los FALLOS llenan el contador
      throw new AppError('unauthorized', 'credenciales inválidas');
    }

    // 3) Éxito: limpia el contador (un acierto tras fallos no debe quedar bloqueado
    //    por la ventana) y emite la cookie de sesión firmada (exp.hmac).
    clearAttempts(ip);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': createSessionCookie(),
      },
    });
  },
  { body: LoginBodySchema },
);
