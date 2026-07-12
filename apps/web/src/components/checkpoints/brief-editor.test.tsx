// Tests del editor de brief de CP1 (T1.10b, frontend.md §6): los badges de procedencia con su
// cita, la petición BLOQUEANTE de imágenes del modo manual y el payload que se envía al
// checkpoint. Interacción como el usuario (roles/texto + userEvent); asserts sobre lo renderizado
// o sobre el payload emitido.
//
// El brief de prueba sale de `makeBrief()` (la ÚNICA factory de un ProductBrief válido): un
// objeto inventado aquí podría no cumplir el contrato (5–10 ángulos, 2–3 hooks…) y el test
// pasaría por casualidad — la lección de T1.8/T1.9.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, test } from 'vitest';
import { makeBrief, server, useHttpMocks } from '@ugc/test-utils';
import type { BriefWarning, ProductBrief } from '@ugc/core/contracts';

import { BriefEditor } from './brief-editor';

// eslint-disable-next-line react-hooks/rules-of-hooks
useHttpMocks();

afterEach(() => {
  cleanup();
});

const STEP_ID = '01J000000000000000000STEP0';

/** Un brief con un pain point EXTRAÍDO (con cita) y otro INFERIDO (sin ella): el par que hace
 *  observables los dos badges y la evidencia. */
const brief: ProductBrief = makeBrief({
  pain_points: [
    {
      pain: 'La piel se ve apagada al despertar',
      severity: 'high',
      current_alternative: 'Cremas hidratantes genéricas',
      evidence: 'Nuestras clientas notan la piel más luminosa desde la primera semana',
    },
    {
      pain: 'Miedo a irritar la piel sensible',
      severity: 'medium',
      current_alternative: null,
      evidence: null,
    },
  ],
});

const needsImages: BriefWarning = {
  code: 'needs_user_decision',
  reason: 'missing_hero_image',
  message: 'No hay imagen de producto: sube al menos una foto o elige generar un packshot con IA.',
};

describe('BriefEditor (CP1)', () => {
  test('los campos extraídos muestran su badge y SU CITA; los inferidos, solo el badge', async () => {
    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[]} />);

    // El badge de procedencia (Apéndice A: extractivo ⇒ `evidence`; inferencial ⇒ sin cita).
    expect(screen.getAllByText(/✓ extraído/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^inferido$/).length).toBeGreaterThan(0);

    // LA CITA, VISIBLE (no un tooltip): la Verificación pide que el badge extraído «muestre su
    // evidence» en el editor, y un tooltip no es evidencia para quien no tiene ratón.
    expect(
      await screen.findByText(/Nuestras clientas notan la piel más luminosa/),
    ).toBeInTheDocument();
  });

  test('el rail de trazabilidad cuenta extraídos e inferidos', () => {
    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[]} />);
    const rail = screen.getByLabelText('Trazabilidad');
    // 1 pain point con cita + los features del brief canónico que la tengan.
    expect(within(rail).getByText('Extraído')).toBeInTheDocument();
    expect(within(rail).getByText('Inferido')).toBeInTheDocument();
    expect(within(rail).getByText('Editado por ti')).toBeInTheDocument();
  });

  test('editar un beneficio y guardar manda el brief EDITADO al checkpoint (no el de la IA)', async () => {
    const user = userEvent.setup();
    let payload: unknown;
    server.use(
      http.post(`*/api/steps/${STEP_ID}/edit`, async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );

    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[]} />);

    const primerBeneficio = screen.getByLabelText('Beneficio 1');
    await user.clear(primerBeneficio);
    await user.type(primerBeneficio, 'Piel luminosa en 7 días');

    await user.click(screen.getByRole('button', { name: /guardar cambios y continuar/i }));

    await waitFor(() => {
      expect(payload).toBeDefined();
    });
    // El servidor recibe el brief COMPLETO editado (de ahí sale la versión v2, con
    // `edited_by_user:true`): el linaje IA→humano vive en la fila, no en un diff.
    const body = payload as { brief: ProductBrief };
    expect(body.brief.benefits[0]?.benefit).toBe('Piel luminosa en 7 días');
    // Y el resto del brief viaja intacto (no se manda un patch parcial).
    expect(body.brief.product.name).toBe(brief.product.name);
  });

  test('editar un HOOK y guardar lo manda editado (la Verificación edita un hook en CP1)', async () => {
    const user = userEvent.setup();
    let payload: unknown;
    server.use(
      http.post(`*/api/steps/${STEP_ID}/edit`, async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );

    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[]} />);

    // El accessible name lleva el ÁNGULO: hay 5–10 ángulos y todos tienen un «Hook 1»; sin el
    // nombre del ángulo, ni un lector de pantalla ni este test podrían decir cuál es cuál.
    const hook = screen.getByLabelText(`Hook 1 de ${brief.angles[0]?.name ?? ''}`);
    await user.clear(hook);
    await user.type(hook, 'Tu piel al despertar');

    await user.click(screen.getByRole('button', { name: /guardar cambios y continuar/i }));

    await waitFor(() => {
      expect(payload).toBeDefined();
    });
    const body = payload as { brief: ProductBrief };
    expect(body.brief.angles[0]?.hook_examples[0]).toBe('Tu piel al despertar');
  });

  test('aprobar SIN editar llama a /approve (no crea versión: no hubo edición humana)', async () => {
    const user = userEvent.setup();
    let approved = false;
    server.use(
      http.post(`*/api/steps/${STEP_ID}/approve`, () => {
        approved = true;
        return HttpResponse.json({ ok: true });
      }),
    );

    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[]} />);
    await user.click(screen.getByRole('button', { name: /aprobar y continuar/i }));

    await waitFor(() => {
      expect(approved).toBe(true);
    });
  });

  test('modo manual sin imágenes: la petición BLOQUEANTE aparece y deshabilita Aprobar', async () => {
    const user = userEvent.setup();
    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[needsImages]} />);

    // LA CLÁUSULA DE LA VERIFICACIÓN: se ve la petición de imágenes CON su derivación a
    // packshot-IA (el mensaje accionable que escribe el validador de T1.9).
    expect(
      screen.getByText(/sube al menos una foto o elige generar un packshot con IA/i),
    ).toBeInTheDocument();

    // Y BLOQUEA de verdad: no se puede aprobar sin decidir.
    expect(screen.getByRole('button', { name: /aprobar y continuar/i })).toBeDisabled();

    // La derivación a packshot-IA es una de las dos salidas (la otra: subir fotos).
    await user.click(screen.getByRole('button', { name: /generar packshot con ia/i }));

    // Resuelta la decisión, se desbloquea.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /aprobar y continuar/i })).toBeEnabled();
    });
  });

  test('un hook demasiado largo se AVISA pero NO bloquea (los hooks reales de Sonnet se pasan)', () => {
    const hookTooLong: BriefWarning = {
      code: 'hook_too_long',
      angleIndex: 0,
      angleName: brief.angles[0]?.name ?? 'Ángulo',
      hookIndex: 0,
      hook: 'Llevo tres semanas usando este sérum cada mañana y mi piel ya no se apaga',
      wordCount: 14,
    };
    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[hookTooLong]} />);

    expect(screen.getByText(/hook demasiado largo/i)).toBeInTheDocument();
    // NO bloquea: si lo hiciera, CP1 estaría bloqueado en casi cualquier análisis real.
    expect(screen.getByRole('button', { name: /aprobar y continuar/i })).toBeEnabled();
  });
});
