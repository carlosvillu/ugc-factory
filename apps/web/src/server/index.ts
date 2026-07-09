// Barrel de la capa server de web (`@/server`): el punto de import único que
// api.md usa en sus ejemplos (`import { withRoute, ... } from '@/server'`). Solo
// reexporta símbolos con consumidor real (knip veta el over-export "para más
// adelante", knip.json): crece cuando una ruta nueva lo consume. Los módulos que
// se importan por su ruta específica (p. ej. `@/server/with-auth` desde runs) no
// pasan por aquí.
export { withRoute } from './with-route';
export { getRequestLogger } from './request-context';
export { createSessionCookie, verifyPassword } from './session';
export { assertNotRateLimited, recordFailure, clearAttempts, clientIp } from './rate-limit';
export { getDb } from './db';
export { getBoss } from './boss';
