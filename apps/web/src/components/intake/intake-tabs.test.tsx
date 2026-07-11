// Tests del selector de modo de intake (T1.10a). Lo que se fija: «Desde URL» es el modo
// por DEFECTO (el camino principal del producto) y cada pestaña enseña SOLO sus campos —
// no un formulario único con campos apagados.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useHttpMocks } from '@ugc/test-utils';

import { IntakeTabs } from './intake-tabs';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const PROJECT_ID = '01J000000000000000000PROJ0';

// eslint-disable-next-line react-hooks/rules-of-hooks
useHttpMocks();

afterEach(() => {
  cleanup();
});

describe('IntakeTabs', () => {
  test('arranca en «Desde URL» (el camino principal) y muestra SOLO el campo de URL', () => {
    render(<IntakeTabs projectId={PROJECT_ID} />);

    expect(screen.getByRole('tab', { name: /desde url/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('textbox', { name: /url del producto/i })).toBeInTheDocument();
    // El campo del OTRO modo no está en el DOM: cada pestaña enseña lo suyo.
    expect(
      screen.queryByRole('textbox', { name: /descripción del producto/i }),
    ).not.toBeInTheDocument();
  });

  test('al cambiar a «Texto libre» se muestra el form de T1.6 y desaparece el de URL', async () => {
    const user = userEvent.setup();
    render(<IntakeTabs projectId={PROJECT_ID} />);

    await user.click(screen.getByRole('tab', { name: /texto libre/i }));

    expect(
      await screen.findByRole('textbox', { name: /descripción del producto/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /url del producto/i })).not.toBeInTheDocument();
  });
});
