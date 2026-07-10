// `GET /api/runs/:id/events` (T0.10, §9.0): stream SSE del progreso de un run.
// Emite `snapshot` al conectar (SIEMPRE, también en reconexión con `Last-Event-ID`
// → re-snapshot del estado ACTUAL, NUNCA replay de deltas), deltas `step_changed`
// vía LISTEN/NOTIFY del canal `pipeline_events`, y `heartbeat` cada
// `SSE_HEARTBEAT_MS`. `id:` monotónico sembrado desde `Last-Event-ID` entre
// reconexiones. El contrato de eventos es el discriminated union `RunEventSchema`
// de core (T0.11 lo consume desde el hook del frontend).
//
// runtime nodejs + force-dynamic: streaming vivo con una conexión pg dedicada;
// jamás edge (ni streaming largo ni pg allí), jamás caché (la respuesta es un
// stream sin fin).
import { Client } from 'pg';
import { readRunSnapshot, readChangedSteps } from '@ugc/db';
import { getDb } from '@/server';
import { getRootLogger } from '@/server/logger';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// `withAuth` por fuera: un request sin sesión válida es 401 JSON tipado antes de
// abrir ninguna conexión pg (misma barrera que el resto de la API, api.md §6). El
// ctx de Next porta `params` async (Next 16).
export const GET = withAuth(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id: runId } = await ctx.params;
  const db = getDb();
  // Heartbeat inyectable por env (default 25 s): el test server-level lo pone a 250
  // para ver un latido en <1 s sin esperar 25 s reales (testing/api.md §3.3).
  const heartbeatMs = Number(process.env.SSE_HEARTBEAT_MS ?? 25_000);
  // Semilla del id monotónico desde `Last-Event-ID`: entre reconexiones los ids
  // siguen creciendo (el cliente ya vio hasta `eventId`).
  let eventId = Number(req.headers.get('last-event-id') ?? 0);
  if (!Number.isFinite(eventId) || eventId < 0) eventId = 0;

  const encoder = new TextEncoder();
  // Conexión pg DEDICADA (connectionString, NO el pool de Drizzle): una conexión en
  // LISTEN queda bloqueada esperando notificaciones y no sirve para queries; el pool
  // no debe prestar una conexión que nunca se devuelve. Las queries de snapshot/delta
  // van por `db` (el pool), separadas de esta.
  const listener = new Client({ connectionString: process.env.DATABASE_URL });
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  // Flag idempotente: `close()` puede dispararse por abort del cliente, por el
  // `cancel()` del ReadableStream, o por el error path (connect/LISTEN fallan). Sin
  // este guard, un doble-close cerraría el controller dos veces (throw) y podría
  // filtrar la conexión pg — el modo de fallo es agotar Postgres a reconexión por
  // reconexión.
  let closed = false;
  // Teardown único: `close()` cierra sobre `controller` (solo accesible dentro de
  // `start()`), así que se expone aquí para que `cancel()` reuse EXACTAMENTE la misma
  // limpieza en vez de duplicarla (un teardown que divergiera filtraría el intervalo
  // o la conexión pg). `start()` lo asigna en su prólogo síncrono, antes de cualquier
  // await, así que `cancel()` — que nunca corre antes — siempre lo encuentra definido.
  let teardown: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown): void => {
        if (closed) return;
        const nextId = String(++eventId);
        controller.enqueue(
          encoder.encode(`id: ${nextId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      const close = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        // `.end()` SIEMPRE (abort, cancel, error path): sin esto cada reconexión
        // filtra una conexión pg hasta agotar Postgres.
        void listener.end();
        try {
          controller.close();
        } catch {
          // El controller ya podía estar cerrado por el runtime (cliente
          // desconectado): cerrar dos veces lanza y aquí no es un error.
        }
      };
      teardown = close;
      // Next dispara `abort` en `req.signal` cuando el cliente desconecta.
      req.signal.addEventListener('abort', close, { once: true });

      // El `Client` de pg es un EventEmitter de conexión de LARGA VIDA (LISTEN).
      // Cuando Postgres se reinicia (rutinario en un VPS self-hosted) o el backend
      // cae, el `Client` emite un evento 'error' ASÍNCRONO. Sin handler, Node aplica
      // su regla de "unhandled 'error' event" y TUMBA el proceso web entero — el
      // try/catch de abajo solo cubre el rechazo de connect()/LISTEN en el ARRANQUE,
      // no un error de la conexión YA VIVA. Se registra ANTES de connect() para
      // cubrir toda la vida de la conexión. El handler loguea y llama a `close()`
      // idempotente: cerrar el stream zombi es lo correcto, porque el cliente
      // (EventSource/curl) reconectará con `Last-Event-ID` → re-snapshot (la ruta de
      // recuperación diseñada). Precedente: apps/worker/src/boss.ts (boss.on('error')).
      listener.on('error', (err: unknown) => {
        getRootLogger().error({ err, run_id: runId }, 'SSE listener pg connection error');
        close();
      });

      try {
        // 1) LISTEN ANTES del snapshot: cualquier transición que ocurra ENTRE la
        //    foto y la suscripción se perdería si el orden se invirtiera. Con LISTEN
        //    ya activo, esa transición llega como notificación y se re-lee.
        await listener.connect();
        listener.on('notification', (msg) => {
          // El canal es del run entero: ignorar NOTIFYs de OTROS runs.
          if (msg.payload !== runId) return;
          // El NOTIFY solo transporta `run_id` (§9.0): la verdad se RELEE de las
          // tablas (readChangedSteps re-emite el estado actual de cada step), nunca
          // viaja en el payload. El cliente aplica idempotentemente sobre el mapa del
          // snapshot.
          void readChangedSteps(db, runId)
            .then((deltas) => {
              for (const delta of deltas) send('step_changed', delta);
            })
            .catch(() => {
              // Un fallo de re-lectura no debe tumbar el stream: el próximo NOTIFY
              // (o el heartbeat) mantiene la conexión; el cliente re-sincroniza al
              // reconectar. Silenciar es correcto aquí (sin logger de request en el
              // callback del listener).
            });
        });
        await listener.query('LISTEN pipeline_events');

        // 2) snapshot SIEMPRE primero — también con `Last-Event-ID` (re-snapshot con
        //    el estado ACTUAL, no replay). Aquí se gana la cláusula de verificación
        //    "reabrir con Last-Event-ID re-sincroniza sin perder el estado final".
        const snapshot = await readRunSnapshot(db, runId);
        send('snapshot', { event: 'snapshot', ...snapshot });

        // 3) heartbeat: mantiene vivo el paso por proxies y permite al cliente
        //    detectar un stream zombi.
        heartbeat = setInterval(() => {
          send('heartbeat', { event: 'heartbeat', ts: Date.now() });
        }, heartbeatMs);
      } catch {
        // Error path (connect()/LISTEN lanzan): cerrar limpia la conexión a medio
        // abrir para no filtrarla. Sin este catch, un fallo de arranque dejaría la
        // conexión pg colgada.
        close();
      }
    },
    // Red de seguridad del runtime: si el stream se cancela por otra vía que el
    // abort, delega en el MISMO teardown que `close()` (idempotente por el flag
    // `closed`; su `controller.close()` extra lo traga el try/catch si el runtime ya
    // lo cerró durante el cancel).
    cancel() {
      teardown?.();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      // no-transform: que ningún intermediario comprima/bufferice el stream.
      'cache-control': 'no-cache, no-transform',
      // desactiva el buffering de nginx/proxies para que los frames salgan al vuelo.
      'x-accel-buffering': 'no',
    },
  });
});
