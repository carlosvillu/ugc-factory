// Tests del formulario de settings (frontend.md §6). Lo crítico es de SEGURIDAD: una
// key guardada NUNCA se re-renderiza en claro (assert negativo) y el PATCH es write-only
// (solo incluye la key si el usuario escribió una nueva; nunca machaca la real con el
// placeholder). Además: estado de guardado observable y error recuperable.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, test } from 'vitest';
import { server, useHttpMocks } from '@ugc/test-utils';
import type { SettingsView } from '@ugc/core/contracts';

import { SettingsForm } from './settings-form';

// eslint-disable-next-line react-hooks/rules-of-hooks
useHttpMocks();
afterEach(() => {
  cleanup();
});

// Vista inicial: fal ya configurada (últimos 4 = 'cdef'), los demás sin configurar.
const INITIAL_VIEW: SettingsView = {
  secrets: {
    fal: { set: true, last4: 'cdef' },
    anthropic: { set: false, last4: null },
    firecrawl: { set: false, last4: null },
  },
  preferences: {
    defaultLanguages: ['es'],
    durationPreset: 'standard',
    thresholds: { killHookRate: 0.01, scaleHookRate: 0.03 },
  },
};

const REAL_FAL_KEY = 'fal-real-secret-abcdef';

describe('SettingsForm (credenciales write-only, T0.14)', () => {
  test('NUNCA re-renderiza la key en claro: solo un placeholder enmascarado con last4', () => {
    render(<SettingsForm initialView={INITIAL_VIEW} />);

    // Assert negativo de seguridad: la key real NO está en el DOM (el componente jamás
    // la recibe — solo `set` + `last4`).
    expect(screen.queryByText(REAL_FAL_KEY)).toBeNull();
    expect(screen.queryByDisplayValue(REAL_FAL_KEY)).toBeNull();

    // El input de fal arranca VACÍO y muestra el placeholder enmascarado con last4.
    const falInput = screen.getByLabelText('fal.ai');
    expect(falInput).toHaveValue('');
    expect(falInput).toHaveAttribute('type', 'password');
    expect(falInput).toHaveAttribute('autocomplete', 'new-password');
    expect(falInput).toHaveAttribute('placeholder', expect.stringContaining('cdef'));
  });

  test('el PATCH solo incluye la key que el usuario escribió (write-only, no machaca las demás)', async () => {
    let received: unknown;
    server.use(
      http.patch('*/api/settings', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({
          secrets: {
            fal: { set: true, last4: 'wxyz' },
            anthropic: { set: false, last4: null },
            firecrawl: { set: false, last4: null },
          },
          preferences: INITIAL_VIEW.preferences,
        } satisfies SettingsView);
      }),
    );
    const user = userEvent.setup();
    render(<SettingsForm initialView={INITIAL_VIEW} />);

    // El usuario solo cambia la key de fal; deja anthropic/firecrawl vacías.
    await user.type(screen.getByLabelText('fal.ai'), 'nueva-fal-key-uvwxyz');
    await user.click(screen.getByRole('button', { name: /guardar ajustes/i }));

    await waitFor(() => {
      expect(received).toBeDefined();
    });
    const body = received as { secrets?: Record<string, string> };
    // Solo fal viaja; anthropic/firecrawl NO están en el payload (no se tocan).
    expect(body.secrets).toEqual({ fal: 'nueva-fal-key-uvwxyz' });
  });

  test('un PATCH sin keys nuevas (solo preferencias) no incluye secrets', async () => {
    let received: unknown;
    server.use(
      http.patch('*/api/settings', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({
          secrets: INITIAL_VIEW.secrets,
          preferences: INITIAL_VIEW.preferences,
        } satisfies SettingsView);
      }),
    );
    const user = userEvent.setup();
    render(<SettingsForm initialView={INITIAL_VIEW} />);

    // Sin tocar ninguna key: guardar solo persiste preferencias.
    await user.click(screen.getByRole('button', { name: /guardar ajustes/i }));

    await waitFor(() => {
      expect(received).toBeDefined();
    });
    const body = received as { secrets?: unknown; preferences?: unknown };
    expect(body.secrets).toBeUndefined();
    expect(body.preferences).toBeDefined();
  });

  test('tras guardar, muestra confirmación y el input de key vuelve a vacío (no eco)', async () => {
    server.use(
      http.patch('*/api/settings', () =>
        HttpResponse.json({
          secrets: {
            fal: { set: true, last4: 'wxyz' },
            anthropic: { set: false, last4: null },
            firecrawl: { set: false, last4: null },
          },
          preferences: INITIAL_VIEW.preferences,
        } satisfies SettingsView),
      ),
    );
    const user = userEvent.setup();
    render(<SettingsForm initialView={INITIAL_VIEW} />);

    await user.type(screen.getByLabelText('fal.ai'), 'nueva-fal-key');
    await user.click(screen.getByRole('button', { name: /guardar ajustes/i }));

    // Confirmación en role="status".
    expect(await screen.findByRole('status')).toHaveTextContent(/guardad/i);
    // El input vuelve a vacío: jamás eco del valor guardado.
    expect(screen.getByLabelText('fal.ai')).toHaveValue('');
  });

  test('un validation_error de CAMPO NO muestra el banner de "Ajustes guardados"', async () => {
    // FIX de correctness: un 400 con fieldErrors (sin formErrors) hace setError en el campo
    // pero el submit async resuelve normal → antes RHF marcaba isSubmitSuccessful=true y el
    // banner verde se colaba junto al error rojo. Con el flag `saved` explícito no ocurre.
    server.use(
      http.patch('*/api/settings', () =>
        HttpResponse.json(
          {
            code: 'validation_error',
            message: 'payload inválido',
            details: {
              formErrors: [],
              fieldErrors: { 'preferences.defaultLanguages': ['inválido'] },
            },
          },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<SettingsForm initialView={INITIAL_VIEW} />);

    await user.type(screen.getByLabelText('fal.ai'), 'x-key');
    await user.click(screen.getByRole('button', { name: /guardar ajustes/i }));

    // El error de campo se muestra…
    expect(await screen.findByText(/inválido/i)).toBeInTheDocument();
    // …y el banner de éxito NUNCA aparece (un guardado fallido no se anuncia como exitoso).
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/ajustes guardados/i)).toBeNull();
  });

  test('idiomas inválidos (validación cliente) bloquean el submit sin banner de éxito', async () => {
    let called = false;
    server.use(
      http.patch('*/api/settings', () => {
        called = true;
        return HttpResponse.json({
          secrets: INITIAL_VIEW.secrets,
          preferences: INITIAL_VIEW.preferences,
        } satisfies SettingsView);
      }),
    );
    const user = userEvent.setup();
    render(<SettingsForm initialView={INITIAL_VIEW} />);

    // Vacía el campo de idiomas → el resolver (zod) lo rechaza en cliente: no hay submit.
    const langs = screen.getByLabelText(/idiomas por defecto/i);
    await user.clear(langs);
    await user.click(screen.getByRole('button', { name: /guardar ajustes/i }));

    expect(await screen.findByText(/al menos un código de idioma/i)).toBeInTheDocument();
    expect(called).toBe(false); // no llegó al servidor
    expect(screen.queryByText(/ajustes guardados/i)).toBeNull();
  });

  test('un 500 muestra el error recuperable y no atasca el formulario', async () => {
    server.use(
      http.patch('*/api/settings', () =>
        HttpResponse.json({ code: 'internal', message: 'fallo al guardar' }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    render(<SettingsForm initialView={INITIAL_VIEW} />);

    await user.type(screen.getByLabelText('fal.ai'), 'x-key');
    await user.click(screen.getByRole('button', { name: /guardar ajustes/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/fallo al guardar/i);
    expect(screen.getByRole('button', { name: /guardar ajustes/i })).toBeEnabled();
  });
});
