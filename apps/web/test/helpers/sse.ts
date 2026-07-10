// Helper de streaming SSE para los tests server-level (testing/references/api.md
// §3.3). Se usa `fetch` streaming + `AbortController`, NO `EventSource`: en Node
// EventSource no permite el header `cookie` (necesario para pasar withAuth) y su
// auto-reconexión esconde justo lo que el test quiere assertar (el snapshot al
// reconectar con Last-Event-ID).
export interface SseEvent {
  id?: string;
  event: string;
  // El payload ya parseado (JSON.parse de la línea `data:`).
  data: Record<string, unknown>;
}

// Parsea UN frame SSE (bloque terminado en `\n\n`): líneas `id:` / `event:` /
// `data:`. `data:` se JSON.parse (nuestro handler siempre serializa JSON).
function parseSseFrame(frame: string): SseEvent {
  let id: string | undefined;
  let event = 'message';
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data = line.slice(5).trim();
  }
  return { id, event, data: data ? (JSON.parse(data) as Record<string, unknown>) : {} };
}

/**
 * Conecta al stream `url`, acumula eventos y resuelve cuando `until(events)` es
 * true (o al agotarse `timeoutMs`, que aborta y devuelve lo acumulado — un stream
 * colgado SIN heartbeats hace saltar el timeout: ese ES el bug que el heartbeat
 * existe para detectar). `onEvent` permite disparar efectos entre frames (p. ej.
 * provocar la transición SOLO tras recibir el snapshot, evitando la carrera
 * conexión/NOTIFY).
 */
export async function collectSse(
  url: string,
  opts: {
    headers?: Record<string, string>;
    onEvent?: (e: SseEvent) => void;
    until: (events: SseEvent[]) => boolean;
    timeoutMs?: number;
  },
): Promise<SseEvent[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort();
  }, opts.timeoutMs ?? 10_000);
  const events: SseEvent[] = [];
  try {
    const res = await fetch(url, {
      headers: { accept: 'text/event-stream', ...opts.headers },
      signal: ac.signal,
    });
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      throw new Error(`no es un stream SSE (status ${String(res.status)}, ct ${contentType})`);
    }
    const decoder = new TextDecoder();
    let buf = '';
    // El body de fetch es un ReadableStream async-iterable en Node 18+.
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        if (frame.trim() === '') continue;
        const ev = parseSseFrame(frame);
        events.push(ev);
        opts.onEvent?.(ev);
      }
      if (opts.until(events)) {
        ac.abort();
        break;
      }
    }
  } catch (err) {
    // El abort PROPIO (until satisfecho o timeout) no es un fallo: se devuelve lo
    // acumulado. Cualquier otro error sí sube.
    if (!ac.signal.aborted) throw err;
  } finally {
    clearTimeout(timer);
  }
  return events;
}
