// Precedencia del base URL del fetch de SERVIDOR (T1.13). El bug que este test blinda:
// hasta T1.13 la base estaba HARDCODEADA a `http://localhost:3000`, así que un web
// sirviendo en otro puerto (el 3000 ocupado por otro proyecto) hacía que los RSC
// (/spend, /settings, /runs/[id]) llamaran a un servidor ajeno → 404 → 500 de la página.
// Ningún test lo cazaba porque el stack E2E fijaba `INTERNAL_API_URL` a mano.
//
// `resolveServerBaseUrl` es pura sobre el env: la precedencia se afirma sin tocar
// `process.env` (determinista y gratis ⇒ vive en `pnpm gate`, regla de trabajo 8).
import { describe, expect, it } from 'vitest';
import { resolveServerBaseUrl } from './api-client';

describe('resolveServerBaseUrl', () => {
  it('el override explícito INTERNAL_API_URL gana sobre el PORT', () => {
    expect(
      resolveServerBaseUrl({ INTERNAL_API_URL: 'http://api.internal:8080', PORT: '3100' }),
    ).toBe('http://api.internal:8080');
  });

  it('sin override, DERIVA la base del puerto real en el que sirve el proceso', () => {
    // El caso del bug: el web corre en 3001 y debe llamarse a SÍ MISMO, no al 3000.
    expect(resolveServerBaseUrl({ PORT: '3001' })).toBe('http://localhost:3001');
    expect(resolveServerBaseUrl({ PORT: '3100' })).toBe('http://localhost:3100');
  });

  it('sin override ni PORT, cae al default de Next (3000)', () => {
    expect(resolveServerBaseUrl({})).toBe('http://localhost:3000');
  });

  it('un PORT no numérico cae al default en vez de fabricar una URL inválida', () => {
    // Se valida la FORMA, no el rango. `http://localhost:abc` sería una URL inválida; el
    // default, al menos, es diagnosticable. NO se valida el rango a propósito: `PORT=99999`
    // impide que Next arranque (⇒ esta función nunca se llamaría con él) y rechazar `PORT=0`
    // —con el que Next SÍ arranca, en un puerto efímero— nos devolvería al 3000 y al 500 que
    // esta tarea elimina. `PORT=0` queda NO SOPORTADO (proyecto self-hosted de puerto fijo).
    expect(resolveServerBaseUrl({ PORT: '' })).toBe('http://localhost:3000');
    expect(resolveServerBaseUrl({ PORT: '   ' })).toBe('http://localhost:3000');
    expect(resolveServerBaseUrl({ PORT: 'abc' })).toBe('http://localhost:3000');
    expect(resolveServerBaseUrl({ PORT: '30 01' })).toBe('http://localhost:3000');
  });
});
