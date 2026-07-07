import { describe, expect, it } from 'vitest';
import { HealthStatusSchema } from '@ugc/core/contracts';
import { GET } from './route';

// LOG_LEVEL=silent lo fija test.env en vitest.config.ts: el logger de web es
// lazy y se memoiza en la primera request — el env debe estar puesto ANTES de
// que cualquier test lo dispare, sin depender del orden de hooks.

describe('GET /api/health', () => {
  it('devuelve 200 con {ok:true} conforme a HealthStatusSchema', async () => {
    const res = GET(new Request('http://localhost:3000/api/health'));

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(HealthStatusSchema.parse(body)).toEqual({ ok: true });
  });

  it('respeta el x-request-id entrante sin romper la respuesta (correlación)', async () => {
    const res = GET(
      new Request('http://localhost:3000/api/health', {
        headers: { 'x-request-id': 'req-fixture-1' },
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});
