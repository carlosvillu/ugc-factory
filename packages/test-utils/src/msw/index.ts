// Server msw compartido (stack-setup.md §4.5). Los handlers por defecto de cada
// proveedor (fal, Anthropic, Firecrawl…) llegan con external-apis.md (T1.4+);
// hasta entonces el server nace vacío y CUALQUIER petición HTTP en la suite
// normal falla: la hermeticidad es el contrato (una petición no mockeada es un
// bug que podría gastar dinero).
import { http, HttpResponse, type RequestHandler } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

// Export secundario: overrides puntuales con server.use(...) dentro de un test.
export const server = setupServer();

// Re-export de los constructores de handlers de msw: así un paquete que solo consume el `server`
// compartido (p. ej. @ugc/worker en el test de N7a) registra handlers `http.get/post(...)` SIN
// necesitar msw como dependencia directa — la única fuente de la frontera HTTP mockeada es
// test-utils, coherente con `server`.
export { http, HttpResponse };

export function useHttpMocks(...overrides: RequestHandler[]): void {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });
  beforeEach(() => {
    if (overrides.length > 0) server.use(...overrides);
  });
  afterEach(() => {
    server.resetHandlers();
  });
  afterAll(() => {
    server.close();
  });
}
