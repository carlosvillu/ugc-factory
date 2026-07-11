// Tests del formulario de intake por URL (T1.10a, frontend.md §6): validación visible,
// la definición del DAG que se envía a `POST /api/runs`, y navegación al canvas en vivo.
// Interacción como el usuario (roles/texto + userEvent), asserts sobre lo renderizado o
// el payload emitido.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { server, useHttpMocks } from '@ugc/test-utils';

import { UrlIntakeForm } from './url-intake-form';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const PROJECT_ID = '01J000000000000000000PROJ0';
const URL_OK = 'https://tienda.com/products/serum';

// eslint-disable-next-line react-hooks/rules-of-hooks
useHttpMocks();

beforeEach(() => {
  push.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('UrlIntakeForm (intake por URL)', () => {
  test('una URL vacía muestra el error de validación y no arranca ningún run', async () => {
    const user = userEvent.setup();
    render(<UrlIntakeForm projectId={PROJECT_ID} />);

    await user.click(screen.getByRole('button', { name: /analizar/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  test('un texto que no es http(s) se rechaza en el cliente (no se scrapea cualquier cosa)', async () => {
    const user = userEvent.setup();
    render(<UrlIntakeForm projectId={PROJECT_ID} />);

    await user.type(
      screen.getByRole('textbox', { name: /url del producto/i }),
      'javascript:alert(1)',
    );
    await user.click(screen.getByRole('button', { name: /analizar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/http/i);
    expect(push).not.toHaveBeenCalled();
  });

  test('un submit válido crea el run del DAG N1→N2→N3 y navega al CANVAS', async () => {
    let definition: unknown;
    server.use(
      http.post('*/api/runs', async ({ request }) => {
        definition = await request.json();
        return HttpResponse.json({ runId: 'run-9' }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(<UrlIntakeForm projectId={PROJECT_ID} />);

    await user.type(screen.getByRole('textbox', { name: /url del producto/i }), URL_OK);
    await user.click(screen.getByRole('button', { name: /analizar/i }));

    // Al canvas EN VIVO: es donde el usuario ve progresar N1→N2→N3.
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/runs/run-9');
    });

    // La definición lleva la cadena completa y N1 en modo `url` con la URL a scrapear.
    // (El intake por URL NO crea el análisis: lo crea N1 dentro del run.)
    expect(definition).toMatchObject({
      projectId: PROJECT_ID,
      autopilot: false,
      nodes: [
        { nodeKey: 'N1', dependsOn: [], config: { source: 'url', url: URL_OK } },
        { nodeKey: 'N2', dependsOn: ['N1'] },
        { nodeKey: 'N3', dependsOn: ['N1', 'N2'], config: { targetLanguage: 'es' } },
      ],
    });
  });

  test('el idioma elegido viaja en la config de N3', async () => {
    let definition: { nodes?: { nodeKey: string; config?: { targetLanguage?: string } }[] } = {};
    server.use(
      http.post('*/api/runs', async ({ request }) => {
        definition = (await request.json()) as typeof definition;
        return HttpResponse.json({ runId: 'run-10' }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(<UrlIntakeForm projectId={PROJECT_ID} />);

    await user.type(screen.getByRole('textbox', { name: /url del producto/i }), URL_OK);
    await user.selectOptions(screen.getByRole('combobox', { name: /idioma del análisis/i }), 'en');
    await user.click(screen.getByRole('button', { name: /analizar/i }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/runs/run-10');
    });
    const n3 = definition.nodes?.find((n) => n.nodeKey === 'N3');
    expect(n3?.config?.targetLanguage).toBe('en');
  });

  test('un 500 re-habilita el botón y muestra el error (recuperable, no atascado)', async () => {
    server.use(
      http.post('*/api/runs', async () => {
        await new Promise((r) => setTimeout(r, 40)); // ventana para ver el loading
        return HttpResponse.json({ code: 'internal', message: 'boom' }, { status: 500 });
      }),
    );
    const user = userEvent.setup();
    render(<UrlIntakeForm projectId={PROJECT_ID} />);

    await user.type(screen.getByRole('textbox', { name: /url del producto/i }), URL_OK);
    await user.click(screen.getByRole('button', { name: /analizar/i }));

    expect(await screen.findByRole('button', { name: /analizando/i })).toBeDisabled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/i);
    expect(screen.getByRole('button', { name: /analizar/i })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });
});
