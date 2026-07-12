// Entrada de api-client SOLO para server components (architecture.md §3.1):
// reenvía la cookie de sesión (el fetch de RSC no la propaga solo) y usa la base
// interna (`INTERNAL_API_URL`; el web se llama a sí mismo). `next/headers` es
// server-only a nivel de grafo de módulos: este archivo JAMÁS se importa desde un
// client component (lo importa solo el RSC `runs/[id]/page.tsx`). No usamos el
// paquete `server-only` (no instalado): la frontera la garantiza que `next/headers`
// revienta el build si se importa en cliente.
import type { z } from 'zod';
import { cookies } from 'next/headers';
import { apiFetch, resolveServerBaseUrl } from './api-client';

async function serverFetch<S extends z.ZodType>(path: string, schema: S, init: RequestInit = {}) {
  // `cookies()` hace la página dinámica: correcto — la app es dinámica (datos vivos
  // por SSE), sin 'use cache'.
  const cookieHeader = (await cookies()).toString();
  // Normaliza los headers a un objeto plano (init.headers puede ser Headers|array|
  // record; el spread directo sobre un array daría índices). En la práctica el RSC
  // solo hace GET sin headers extra; el cookie header se añade aquí.
  const headers = new Headers(init.headers);
  if (cookieHeader) headers.set('cookie', cookieHeader);
  return apiFetch(path, schema, {
    // Base interna resuelta por precedencia `INTERNAL_API_URL` > `http://localhost:$PORT` >
    // 3000 (T1.13, `resolveServerBaseUrl`). Antes estaba clavada al 3000: arrancar en otro
    // puerto (con el 3000 ocupado) hacía que este fetch fuera a un servidor AJENO → 404 →
    // 500 de la página. La misma función la usa el fallback de servidor de api-client, así
    // que las dos entradas resuelven idéntico: una sola verdad.
    ...init,
    baseUrl: resolveServerBaseUrl(process.env),
    headers,
  });
}

export const api = {
  get: <S extends z.ZodType>(path: string, schema: S) => serverFetch(path, schema),
};
