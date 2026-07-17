// Test del `fetch` de interceptación de fal para el preview de voz (T4.6). `makeFalPreviewFetch` es la
// costura que permite al E2E redirigir las llamadas a fal al fake server (vía FAL_BASE_URL) SIN tocar
// el FalClient de core: reescribe SOLO el origen de las URLs de la API de fal y deja pasar el resto.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFalPreviewFetch } from './voice-preview';

describe('makeFalPreviewFetch (T4.6)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sin FAL_BASE_URL devuelve undefined (producción usa el fetch global sin cambios)', () => {
    expect(makeFalPreviewFetch(undefined)).toBeUndefined();
    expect(makeFalPreviewFetch('')).toBeUndefined();
  });

  it('reescribe el ORIGEN de una URL de la API de fal al FAL_BASE_URL, preservando path+query', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const wrapped = makeFalPreviewFetch('http://127.0.0.1:9999');
    expect(wrapped).toBeDefined();

    await wrapped!('https://queue.fal.run/fal-ai/kokoro/requests/abc/status', { method: 'get' });

    // El origen se reescribió al fake; el path (…/requests/abc/status) se preservó tal cual.
    const calledUrl = spy.mock.calls[0]?.[0];
    expect(calledUrl).toBe('http://127.0.0.1:9999/fal-ai/kokoro/requests/abc/status');
  });

  it('deja pasar SIN tocar una URL que NO es de la API de fal (p. ej. el CDN de output)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const wrapped = makeFalPreviewFetch('http://127.0.0.1:9999');

    await wrapped!('https://fal.media/files/output.wav');

    // NO se reescribe: fal.media (CDN de output) no es un origen de la API que interceptamos.
    expect(spy.mock.calls[0]?.[0]).toBe('https://fal.media/files/output.wav');
  });
});
