'use client';

// Cliente SSE transversal (state-and-sse.md §4): ~100 líneas, SIN librería npm — el
// contrato de reconexión de §9.0 (query param `lastEventId`, backoff con jitter,
// pausa en background) es nuestro. No sabe nada de runs. Los eventos SSE con nombre
// ("event: snapshot") llegan por `addEventListener(type)`, NO por `onmessage`.
//
// Comportamientos (el porqué de cada uno en la skill):
//  - estados connecting/open/reconnecting/closed para que la UI pinte la conexión.
//  - EventSource reconecta solo en error transitorio (readyState CONNECTING): solo
//    marcamos 'reconnecting'. En error fatal (CLOSED) recreamos con `?lastEventId=`
//    (EventSource no admite headers custom; el server acepta el query param).
//  - backoff exponencial con jitter, cap 30 s (sin jitter todas las pestañas
//    martillean a la vez tras un reinicio).
//  - pausa en visibilitychange oculto, reconexión al volver (el server re-snapshotea).
//  - cleanup estricto (close + clearTimeout en el return del effect).
//  - useEffectEvent para onEvent: el effect depende solo de [url, enabled], así un
//    callback inline del consumidor no re-suscribe la conexión en cada render.
import { useEffect, useEffectEvent, useRef, useState } from 'react';

export type EventSourceStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

interface UseEventSourceOptions {
  events: readonly string[];
  onEvent: (type: string, ev: MessageEvent<string>) => void;
  enabled?: boolean;
}

const MAX_BACKOFF_MS = 30_000;

export function useEventSource(
  url: string,
  { events, onEvent, enabled = true }: UseEventSourceOptions,
): { status: EventSourceStatus; lastEventId: string } {
  const [status, setStatus] = useState<EventSourceStatus>(enabled ? 'connecting' : 'closed');
  // lastEventId expuesto se actualiza SOLO en transiciones de conexión (un re-render
  // por delta/heartbeat no aporta valor de UI). El tracking fino es un ref.
  const [lastEventId, setLastEventId] = useState('');
  const lastEventIdRef = useRef('');

  const fireEvent = useEffectEvent(onEvent);

  useEffect(() => {
    if (!enabled) {
      // Sincronizar con el sistema externo (la conexión SSE): al deshabilitar,
      // reflejar 'closed'. Es el caso legítimo "subscribe/desuscribe de un sistema
      // externo" que la propia regla describe como OK; el linter no lo distingue.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('closed');
      return;
    }
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    const connect = () => {
      const id = lastEventIdRef.current;
      const source = new EventSource(
        id ? `${url}${url.includes('?') ? '&' : '?'}lastEventId=${encodeURIComponent(id)}` : url,
      );
      es = source;

      source.onopen = () => {
        attempt = 0;
        setStatus('open');
        setLastEventId(lastEventIdRef.current);
      };

      for (const type of events) {
        source.addEventListener(type, (ev) => {
          const msg = ev as MessageEvent<string>;
          if (msg.lastEventId) lastEventIdRef.current = msg.lastEventId; // id monotónico (§9.0)
          fireEvent(type, msg);
        });
      }

      source.onerror = () => {
        if (disposed) return;
        if (source.readyState === EventSource.CONNECTING) {
          setStatus('reconnecting'); // el navegador ya reintenta: no estorbar
          return;
        }
        source.close(); // CLOSED: reintento manual con backoff + jitter
        setStatus('reconnecting');
        setLastEventId(lastEventIdRef.current);
        const delay = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempt) * (0.5 + Math.random() * 0.5);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        es?.close();
        if (retryTimer) clearTimeout(retryTimer);
        setStatus('closed');
      } else {
        // CLOSE-THEN-CONNECT: cerrar el stream vivo y limpiar el timer de backoff
        // pendiente ANTES de reconectar. Sin esto se filtra un stream/timer zombi que
        // procesa cada frame por duplicado (o abre un tercer stream al vencer el
        // backoff) cada vez que la pestaña vuelve a primer plano.
        es?.close();
        if (retryTimer) clearTimeout(retryTimer);
        attempt = 0;
        setStatus('connecting');
        connect(); // con ?lastEventId= → el server re-snapshotea al reconectar
      }
    };

    // Arranque de la suscripción SSE (sincronización con sistema externo). Solo
    // conecta si la pestaña está VISIBLE: montarla en segundo plano (cmd+click)
    // dispararía este connect Y otro al enfocar → dos streams vivos. Oculta ⇒
    // 'closed'; onVisibility reconecta al enfocar.
    if (document.visibilityState === 'hidden') {
      setStatus('closed');
    } else {
      setStatus('connecting');
      connect();
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `events` es estable (RUN_EVENT_TYPES de módulo); fireEvent es un effect event.
  }, [url, enabled]);

  return { status, lastEventId };
}
