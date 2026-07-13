// Reintento ACOTADO ante un corte de TRANSPORTE en las llamadas a la API desde el
// `request` de Playwright (T1.19). e2e.md §12 prohíbe reintentar TESTS; esto NO es eso: no
// reintenta un test ni relaja un assert — reintenta UNA petición HTTP que murió ANTES de
// llegar a la app.
//
// LA CAUSA (medida en T1.19, tumbando specs SANOS en dos rutas distintas —un `POST /api/runs`
// de seed y un `GET /api/runs/:id`—): el stack E2E local sirve con `next dev`, y su servidor
// HTTP cierra las conexiones keep-alive ociosas (keepAliveTimeout de Node, 5 s por defecto).
// El `APIRequestContext` de Playwright REUSA sockets, así que una petición enviada por un
// socket que el servidor acaba de cerrar muere con `read ECONNRESET` sin haber tocado nunca
// el producto. Es una carrera de TRANSPORTE del cliente Node, no un fallo de la app: un
// navegador la absorbe reintentando sobre un socket nuevo; el cliente de Playwright, no. En
// CI la superficie es menor (el stack sirve el build de producción con `next start`).
//
// Por qué esto NO tapa nada: se reintenta EXCLUSIVAMENTE el corte de conexión. Un 4xx/5xx del
// servidor NO es un corte — la respuesta llega y se propaga intacta al assert que la mire. Y
// si el servidor estuviera realmente caído, los 3 intentos fallarían igual y el test saldría
// rojo con el mensaje del último corte.
import type { APIResponse } from '@playwright/test';

/** Marcas de un corte de conexión (nada que ver con una respuesta de error de la app). */
const TRANSPORT_ERROR = /ECONNRESET|socket hang up|EPIPE|ECONNREFUSED/i;

/**
 * Ejecuta una llamada a la API reintentándola SOLO si murió por un corte de transporte.
 * Cualquier otro error (incluido un fallo de programación del propio helper) se propaga tal
 * cual, y una respuesta HTTP —sea 200 o 500— se devuelve sin tocar.
 */
export async function apiCall(
  send: () => Promise<APIResponse>,
  what: string,
  attempts = 3,
): Promise<APIResponse> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await send();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!TRANSPORT_ERROR.test(message)) throw err;
      last = err;
    }
  }
  throw new Error(
    `${what}: la petición murió por corte de transporte en ${String(attempts)} intentos: ${String(last)}`,
  );
}
