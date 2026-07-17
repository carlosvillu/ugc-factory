// Tests del botón ▶ de preview de voz (T4.6, frontend.md §5): el disparador llama al endpoint de
// preview, MEMOIZA el assetId (la 2ª reproducción del mismo botón NO re-llama), y muestra un error
// accionable si la generación falla. El `<audio>` se mockea (jsdom no implementa `HTMLMediaElement`).
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { server, useHttpMocks } from '@ugc/test-utils';

import { VoicePreviewButton } from './voice-preview-button';

const PERSONA_ID = '01J0000000000000000VERA00';

// jsdom no implementa `HTMLMediaElement.play/pause` — se mockean para que `new Audio().play()` no
// lance "Not implemented". `play` resuelve (autoplay permitido en test).
beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(),
  });
});

// eslint-disable-next-line react-hooks/rules-of-hooks
useHttpMocks();
afterEach(cleanup);

function renderButton() {
  return render(
    <VoicePreviewButton
      personaId={PERSONA_ID}
      language="es"
      languageLabel="Español"
      personaName="Vera"
    />,
  );
}

describe('VoicePreviewButton (T4.6)', () => {
  test('la 1ª reproducción llama al endpoint de preview; la 2ª reutiliza el assetId (no re-llama)', async () => {
    let calls = 0;
    server.use(
      http.post(`*/api/personas/${PERSONA_ID}/voice-preview`, async ({ request }) => {
        calls += 1;
        const body = (await request.json()) as { language: string };
        expect(body.language).toBe('es'); // el idioma viaja en el body
        return HttpResponse.json({ assetId: '01J000000000000000ASSET00', cached: false });
      }),
    );
    const user = userEvent.setup();
    renderButton();

    const button = screen.getByRole('button', { name: /escuchar la voz de vera en español/i });
    await user.click(button);
    await waitFor(() => {
      expect(calls).toBe(1);
    });

    // Segunda reproducción del MISMO botón: el assetId ya está memoizado → NO se vuelve a llamar al
    // endpoint (la caché del cliente; la del servidor la prueba el E2E contando el ledger).
    await user.click(button);
    // Da margen a una hipotética 2ª llamada; debe seguir en 1.
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(1);
  });

  test('un fallo del preview muestra un error accionable (role=alert)', async () => {
    server.use(
      http.post(`*/api/personas/${PERSONA_ID}/voice-preview`, () =>
        HttpResponse.json(
          { code: 'provider_error', message: 'no hay API key de fal configurada' },
          { status: 502 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: /escuchar la voz/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/no hay api key de fal/i);
  });
});
