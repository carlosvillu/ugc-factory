// Unit del rate limiter del login (T0.4): ventana deslizante en memoria por IP,
// con la separación assert (comprobar, no cuenta) / recordFailure (solo fallos) /
// clearAttempts (acierto limpia). Puro, sin BD. LOGIN_MAX_ATTEMPTS/LOGIN_WINDOW_MS
// se leen por llamada, así que el test los fija por env.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@ugc/core/contracts';
import {
  assertNotRateLimited,
  clearAttempts,
  clientIp,
  recordFailure,
  resetRateLimitForTests,
} from './rate-limit';

beforeEach(() => {
  resetRateLimitForTests();
  process.env.LOGIN_MAX_ATTEMPTS = '2';
  process.env.LOGIN_WINDOW_MS = '60000';
});
afterEach(() => {
  resetRateLimitForTests();
  delete process.env.LOGIN_MAX_ATTEMPTS;
  delete process.env.LOGIN_WINDOW_MS;
});

// Simula la secuencia del handler para una IP: assert (puede lanzar) + registrar
// fallo si el intento "falla". Devuelve la función para pasarla a expect().
function failingAttempt(ip: string, now?: number): () => void {
  return () => {
    assertNotRateLimited(ip, now);
    recordFailure(ip, now);
  };
}

describe('assertNotRateLimited + recordFailure', () => {
  it('el 3.er intento fallido (max=2) lanza rate_limited ANTES de registrar', () => {
    const ip = '1.2.3.4';
    expect(failingAttempt(ip)).not.toThrow(); // 1: assert 0<2 ok → registra (1)
    expect(failingAttempt(ip)).not.toThrow(); // 2: assert 1<2 ok → registra (2)
    const err = getThrown(failingAttempt(ip)); // 3: assert 2>=2 → 429
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('rate_limited');
    expect((err as AppError).status).toBe(429);
  });

  it('assertNotRateLimited por sí solo NO cuenta como intento', () => {
    const ip = 'check-only';
    // 100 comprobaciones sin registrar: nunca bloquea.
    for (let i = 0; i < 100; i++) assertNotRateLimited(ip);
    expect(() => {
      assertNotRateLimited(ip);
    }).not.toThrow();
  });

  it('clearAttempts limpia el contador: un acierto tras fallos desbloquea', () => {
    const ip = 'clears';
    recordFailure(ip);
    recordFailure(ip); // 2 fallos == max
    expect(() => {
      assertNotRateLimited(ip);
    }).toThrow(); // bloqueado
    clearAttempts(ip); // login correcto
    expect(() => {
      assertNotRateLimited(ip);
    }).not.toThrow(); // desbloqueado
  });

  it('aísla el contador por IP', () => {
    recordFailure('a');
    recordFailure('a');
    expect(() => {
      assertNotRateLimited('a');
    }).toThrow();
    expect(() => {
      assertNotRateLimited('b');
    }).not.toThrow();
  });

  it('la ventana desliza: fallos fuera de la ventana no cuentan', () => {
    const ip = 'slide';
    const t0 = 1_000_000;
    recordFailure(ip, t0);
    recordFailure(ip, t0 + 1); // 2 fallos en t0
    // t0+70s: los 2 fallos ya salieron de la ventana de 60s → no bloquea.
    expect(() => {
      assertNotRateLimited(ip, t0 + 70_000);
    }).not.toThrow();
  });

  // Seguridad: config malformada NO debe deshabilitar el limiter en silencio.
  // Con `Number(...)=NaN`, `x >= NaN` y `t > now-NaN` son SIEMPRE falsos → el
  // limiter fallaría ABIERTO (fuerza bruta ilimitada). posIntEnv cae al default.
  it('un LOGIN_MAX_ATTEMPTS no numérico cae al default (fail closed), no deshabilita el limiter', () => {
    process.env.LOGIN_MAX_ATTEMPTS = '3 tries'; // typo del operador → NaN
    resetRateLimitForTests(); // invalida el config memoizado para re-leer el env recién cambiado
    const ip = 'nan-max';
    // Con el default (2), el 3.er intento sigue bloqueando.
    expect(failingAttempt(ip)).not.toThrow();
    expect(failingAttempt(ip)).not.toThrow();
    expect(() => {
      assertNotRateLimited(ip);
    }).toThrow();
  });

  it('un LOGIN_WINDOW_MS no numérico cae al default (fail closed), no vacía la ventana', () => {
    process.env.LOGIN_WINDOW_MS = 'forever'; // → NaN; sin el guard, la ventana se vaciaría siempre
    resetRateLimitForTests(); // invalida el config memoizado para re-leer el env recién cambiado
    const ip = 'nan-window';
    const t0 = 1_000_000;
    recordFailure(ip, t0);
    recordFailure(ip, t0 + 1);
    // Dentro del default de 15 min los 2 fallos siguen contando → bloquea.
    expect(() => {
      assertNotRateLimited(ip, t0 + 2);
    }).toThrow();
  });
});

describe('clientIp', () => {
  it('toma la primera IP de x-forwarded-for', () => {
    const req = new Request('http://x/', { headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } });
    expect(clientIp(req)).toBe('9.9.9.9');
  });
  it('cae a un literal estable sin cabeceras de proxy', () => {
    expect(clientIp(new Request('http://x/'))).toBe('local');
  });
});

function getThrown(fn: () => void): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('se esperaba un throw y no lo hubo');
}
