// Tests del formulario de intake manual (frontend.md §6): validación visible,
// payload correcto del ManualIntakeConfig, loading/error recuperables, y el upload
// de imágenes contra /api/assets. Interacción como el usuario (roles/texto +
// userEvent), asserts sobre lo renderizado o el payload emitido.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { server, useHttpMocks } from '@ugc/test-utils';

import { IntakeForm } from './intake-form';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const PROJECT_ID = '01J000000000000000000PROJ0';
const LONG_TEXT =
  'Un sérum hidratante con ácido hialurónico para piel sensible que hidrata 24 horas.';

// `useHttpMocks` no es un React hook (es el helper de ciclo de vida de msw de
// test-utils): la regla rules-of-hooks es un falso positivo por el prefijo `use`.
// eslint-disable-next-line react-hooks/rules-of-hooks
useHttpMocks();

beforeEach(() => {
  push.mockClear();
});

// Sin `globals: true` en el vitest de web, RTL no auto-limpia entre tests: se
// desmonta a mano para que cada test parta de un DOM vacío (si no, los botones de
// tests previos se acumulan y las queries por rol encuentran múltiples).
afterEach(() => {
  cleanup();
});

describe('IntakeForm (intake manual)', () => {
  test('un texto demasiado corto muestra el error de validación y no envía', async () => {
    const user = userEvent.setup();
    render(<IntakeForm projectId={PROJECT_ID} />);

    const textarea = screen.getByRole('textbox', { name: /descripción del producto/i });
    await user.type(textarea, 'corto');
    await user.click(screen.getByRole('button', { name: /analizar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/al menos/i);
    expect(push).not.toHaveBeenCalled();
  });

  test('un submit válido envía el ManualIntakeConfig correcto y navega al análisis', async () => {
    let received: unknown;
    server.use(
      http.post('*/api/analyses', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(
          { id: 'analysis-1', status: 'done', source: 'manual', reused: false },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    render(<IntakeForm projectId={PROJECT_ID} />);

    await user.type(screen.getByRole('textbox', { name: /descripción del producto/i }), LONG_TEXT);
    await user.click(screen.getByRole('button', { name: /analizar/i }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/analyses/analysis-1');
    });
    expect(received).toMatchObject({
      source: 'manual',
      projectId: PROJECT_ID,
      freeText: LONG_TEXT,
      imageRefs: [],
    });
  });

  test('un 500 re-habilita el botón y muestra el error (recuperable, no atascado)', async () => {
    server.use(
      http.post('*/api/analyses', async () => {
        await new Promise((r) => setTimeout(r, 40)); // ventana para ver el loading
        return HttpResponse.json({ code: 'internal', message: 'boom' }, { status: 500 });
      }),
    );
    const user = userEvent.setup();
    render(<IntakeForm projectId={PROJECT_ID} />);

    await user.type(screen.getByRole('textbox', { name: /descripción del producto/i }), LONG_TEXT);
    await user.click(screen.getByRole('button', { name: /analizar/i }));

    expect(await screen.findByRole('button', { name: /analizando/i })).toBeDisabled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/i);
    expect(screen.getByRole('button', { name: /analizar/i })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });

  test('subir una imagen la lista y la incluye en el payload del análisis', async () => {
    let received: { imageRefs?: { url: string }[] } | undefined;
    server.use(
      http.post('*/api/assets', () =>
        HttpResponse.json({ id: 'asset-1', url: '/api/assets/asset-1/download' }, { status: 201 }),
      ),
      http.post('*/api/analyses', async ({ request }) => {
        received = (await request.json()) as { imageRefs?: { url: string }[] };
        return HttpResponse.json(
          { id: 'analysis-2', status: 'done', source: 'manual', reused: false },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    render(<IntakeForm projectId={PROJECT_ID} />);

    await user.type(screen.getByRole('textbox', { name: /descripción del producto/i }), LONG_TEXT);

    const file = new File([new Uint8Array([1, 2, 3])], 'ref.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/añadir imágenes/i), file);

    // La imagen subida aparece listada (por su nombre) y es quitable.
    expect(await screen.findByRole('button', { name: /quitar ref\.png/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /analizar/i }));
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/analyses/analysis-2');
    });
    expect(received?.imageRefs).toEqual([{ url: '/api/assets/asset-1/download', alt: 'ref.png' }]);
  });

  test('un upload rechazado por el endpoint (p. ej. tamaño) muestra el mensaje y no bloquea el form', async () => {
    server.use(
      http.post('*/api/assets', () =>
        HttpResponse.json(
          { code: 'validation_error', message: 'La imagen supera el máximo de 8 MB' },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<IntakeForm projectId={PROJECT_ID} />);

    // El fichero pasa el filtro `accept="image/*"` del input (mime de imagen); el
    // rechazo lo decide el SERVIDOR (tamaño/allowlist), no el navegador.
    const file = new File([new Uint8Array([1, 2, 3])], 'huge.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/añadir imágenes/i), file);

    expect(await screen.findByRole('alert')).toHaveTextContent(/supera el máximo/i);
    // El textarea sigue operativo: el error de upload no atasca el formulario.
    expect(screen.getByRole('textbox', { name: /descripción del producto/i })).toBeEnabled();
  });
});
