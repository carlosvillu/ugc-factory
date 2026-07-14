// Rate limit del login (api.md §6): contador en memoria por IP con ventana
// deslizante. En memoria del proceso es suficiente (single-user, un solo proceso
// web) y es exactamente lo que asume el test.
//
// Diseño (importante para el CUA de un solo navegador/IP/ventana):
//   1) `assertNotRateLimited(ip)` — LANZA 429 si la IP ya superó el máximo, pero
//      NO registra nada (comprobar no cuenta como intento).
//   2) `recordFailure(ip)` — registra UN fallo (solo se llama cuando el password
//      es incorrecto: los aciertos no llenan el contador).
//   3) `clearAttempts(ip)` — en un login CORRECTO se limpia el contador, para que
//      un acierto tras varios fallos NO quede bloqueado por la ventana.
// Así, en el navegador (misma IP 'local', misma ventana): N fallos → 429 visible,
// y el acierto posterior entra limpio (no lo envenena el contador de fallos).
import { AppError } from '@ugc/core/contracts';

// Lee un entero positivo de env con fallback. CRÍTICO para un control de
// seguridad: un valor malformado (typo del operador, p.ej. `LOGIN_MAX_ATTEMPTS=3
// tries`) daría `Number(...)=NaN`, y como `x >= NaN`/`t > now-NaN` son SIEMPRE
// falsos el limiter fallaría ABIERTO (fuerza bruta ilimitada, sin 429). Fail
// CLOSED al default en vez de deshabilitar el limiter en silencio.
function posIntEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Defaults: la Verificación de T0.4 exige "password incorrecto 3 veces → rate
// limit visible". Con LOGIN_MAX_ATTEMPTS=2, el 3.er intento fallido YA devuelve 429
// (fencepost abajo): tras 2 fallos registrados, `assert` del 3.er intento ve
// 2 >= 2 y lanza ANTES de verificar el password. Ventana corta en dev para que un
// bloqueo demostrado se auto-limpie (el CUA no espera 15 min).
//
// Memoizado: las env vars son constantes en la vida del proceso, así que no se
// reparsean en cada intento de login. Se invalida en resetRateLimitForTests (los
// tests fijan LOGIN_MAX_ATTEMPTS/LOGIN_WINDOW_MS/TRUST_PROXY por caso).
let configCache: { max: number; windowMs: number; trustProxy: boolean } | undefined;

function config(): { max: number; windowMs: number; trustProxy: boolean } {
  configCache ??= {
    max: posIntEnv(process.env.LOGIN_MAX_ATTEMPTS, 2),
    windowMs: posIntEnv(process.env.LOGIN_WINDOW_MS, 15 * 60 * 1000),
    // Trust boundary (T0.13): TRUST_PROXY=1 declara que hay EXACTAMENTE un proxy
    // de confianza delante (Caddy) que sobrescribe x-forwarded-for con la IP del
    // socket. Solo el compose de producción lo activa.
    trustProxy: process.env.TRUST_PROXY === '1',
  };
  return configCache;
}

// IP → timestamps de FALLOS dentro de la ventana.
const failures = new Map<string, number[]>();

function recentFailures(ip: string, now: number, windowMs: number): number[] {
  const since = now - windowMs;
  return (failures.get(ip) ?? []).filter((t) => t > since);
}

/**
 * Lanza `AppError('rate_limited')` 429 si `ip` ya acumuló `max` fallos en la
 * ventana. NO registra el intento actual (comprobar no cuenta).
 *
 * Fencepost (max=2): intentos 1 y 2 fallan → 401 y registran 1 y 2 fallos; el
 * 3.er intento ve `recent.length == 2 >= 2` y lanza 429 ANTES de verificar. Así el
 * 3.er password incorrecto es el primer 429 visible (literal a la Verificación).
 */
export function assertNotRateLimited(ip: string, now = Date.now()): void {
  const { max, windowMs } = config();
  const recent = recentFailures(ip, now, windowMs);
  failures.set(ip, recent); // purga oportunista de la ventana
  if (recent.length >= max) {
    throw new AppError('rate_limited', 'demasiados intentos de acceso, espera unos minutos');
  }
}

/** Registra un fallo de login para `ip`. Solo se llama cuando el password es
 *  incorrecto: un acierto no cuenta. */
export function recordFailure(ip: string, now = Date.now()): void {
  const { windowMs } = config();
  const recent = recentFailures(ip, now, windowMs);
  recent.push(now);
  failures.set(ip, recent);
}

/** Limpia el contador de fallos de `ip` (login correcto). */
export function clearAttempts(ip: string): void {
  failures.delete(ip);
}

/**
 * La IP del request, con trust boundary explícito (T0.13, deuda de T0.4).
 *
 * `x-forwarded-for` es client-controllable hasta que un proxy DE CONFIANZA lo
 * reescriba: sin frontera, un atacante rota el header y cada request cae en un
 * bucket distinto → fuerza bruta ilimitada contra el login.
 *
 * - **TRUST_PROXY=1 (producción, detrás de Caddy)**: Caddy sobrescribe (no
 *   append) `x-forwarded-for` con la IP del socket (`header_up X-Forwarded-For
 *   {client_ip}` en el site file; además es el default de Caddy para clientes
 *   no confiables). El header que llega es SUYO, no del cliente — y solo Caddy
 *   puede alcanzar la app (web publicado únicamente en 127.0.0.1:3100). Se toma
 *   la ÚLTIMA entrada como defensa en profundidad: si un hop futuro hiciera
 *   append en vez de overwrite, la última sigue siendo la escrita por el hop
 *   más cercano (el confiable); la primera sería la del atacante. `x-real-ip`
 *   se IGNORA: Caddy no lo sanea, sería un bypass del boundary.
 * - **Sin TRUST_PROXY (dev/tests, sin proxy delante)**: no hay control de
 *   seguridad que proteger (la app escucha en localhost); el header se usa como
 *   bucketing de conveniencia — es lo que los tests y el stack E2E usan para
 *   aislar contadores por caso (primera entrada, comportamiento histórico).
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (config().trustProxy) {
    const last = fwd?.split(',').at(-1)?.trim();
    if (last) return last;
    return 'local'; // sin header (healthcheck local, smoke directo a 127.0.0.1)
  }
  const first = fwd?.split(',')[0]?.trim();
  if (first) return first;
  return req.headers.get('x-real-ip') ?? 'local';
}

/** Solo para tests: limpia todo el estado del limiter entre casos (contadores y el
 *  config memoizado, para que un test que cambie LOGIN_MAX_ATTEMPTS/WINDOW_MS lo
 *  vea reflejado). */
export function resetRateLimitForTests(): void {
  failures.clear();
  configCache = undefined;
}
