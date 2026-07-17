// Tests del panel de CP3 (T2.6, frontend.md §5): carga de los guiones del lote, el GUARD LOCAL de
// bloqueo (una variante con flag bloqueante no se aprueba hasta editarla), y el PAYLOAD de
// veredictos que se manda al confirmar (editedScript SOLO para las variantes tocadas).
//
// EL RE-LINT NO SE PRUEBA AQUÍ (vive en el servidor, cubierto por scripts-checkpoint.test.ts): el
// cliente no puede re-lintear (no tiene el brief). Lo que este nivel prueba es que el panel deja al
// SERVIDOR ser el guard —re-habilita el aprobar al editar— en vez de encerrar al usuario.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, test } from 'vitest';
import { server, useHttpMocks } from '@ugc/test-utils';
import {
  computeSceneTiming,
  estSecondsOf,
  fullTextOf,
  subtitlesFromScenes,
  totalWords,
} from '@ugc/core/scripting';
import type { AdScript, AdSegment, BatchScript, GuardrailFlag } from '@ugc/core/contracts';

import { ScriptsPanel } from './scripts-panel';

const STEP_ID = '01J000000000000000000STEP0';
const BATCH_ID = '01J00000000000000000BATCH0';

/** Arma un `AdScript` válido con las primitivas reales (mismo timing que N5). */
function makeScript(
  filenameCode: string,
  narrations: { hook: string; body: string; cta: string },
): AdScript {
  const draft = (narration: string, segment: AdSegment) => ({
    narration,
    visual: 'plano medio',
    camera: 'estática',
    emotion: 'cercana',
    segment,
  });
  const scenes = computeSceneTiming([
    draft(narrations.hook, 'hook'),
    draft(narrations.body, 'body'),
    draft(narrations.cta, 'cta'),
  ]);
  return {
    filenameCode,
    sharedBodyKey: `${filenameCode}-body`,
    tone: 'cercano',
    language: 'es',
    hook: narrations.hook,
    cta: narrations.cta,
    scenes,
    subtitles: subtitlesFromScenes(scenes),
    fullText: fullTextOf(scenes),
    wordCount: totalWords(scenes),
    estSeconds: estSecondsOf(scenes),
  };
}

const BLOCKING_FLAG: GuardrailFlag = {
  rule: 'banned_claim',
  blocking: true,
  excerpt: 'cura el acné',
  explanation: 'es un claim prohibido por la marca',
  suggestion: 'ayuda a cuidar tu piel',
};

/** Dos variantes: una LIMPIA (aprobable de entrada) y una con flag BLOQUEANTE (no aprobable hasta
 *  editarla). */
const CLEAN: BatchScript = {
  variantId: '01J0000000000000000CLEAN0',
  filenameCode: 'acme-hook01-es-12s',
  angleName: 'Ángulo limpio',
  personaName: 'Lucía',
  personaId: '01J0000000000000000LUCIA0',
  script: makeScript('acme-hook01-es-12s', {
    hook: 'esto lo cambia todo hoy',
    body: 'lo probé una semana entera y funciona',
    cta: 'link en la bio',
  }),
  guardrailFlags: [],
};

const BLOCKED: BatchScript = {
  variantId: '01J000000000000000BLOCK0',
  filenameCode: 'acme-hook02-es-12s',
  angleName: 'Ángulo bloqueante',
  personaName: null,
  personaId: null,
  script: makeScript('acme-hook02-es-12s', {
    hook: 'esta crema cura el acné seguro',
    body: 'lo probé una semana entera y funciona',
    cta: 'link en la bio',
  }),
  guardrailFlags: [BLOCKING_FLAG],
};

function scriptsHandler(scripts: BatchScript[]) {
  return http.get('*/api/batches/*/scripts', () =>
    HttpResponse.json({ batchId: BATCH_ID, scripts }),
  );
}

// `useHttpMocks` registra hooks de Vitest (beforeAll/beforeEach): va a nivel de MÓDULO, no dentro de
// un `test()` (ahí llegaría tarde). El handler por defecto sirve las dos variantes; los tests que
// necesitan otro conjunto lo sobrescriben con `server.use(...)`.
// eslint-disable-next-line react-hooks/rules-of-hooks -- `useHttpMocks` NO es un hook de React: registra hooks de Vitest (beforeAll/beforeEach), va a nivel de módulo.
useHttpMocks(scriptsHandler([CLEAN, BLOCKED]));

afterEach(cleanup);

describe('ScriptsPanel (CP3)', () => {
  test('carga los guiones del lote y pinta una tarjeta por variante', async () => {
    render(<ScriptsPanel stepId={STEP_ID} batchId={BATCH_ID} />);

    await waitFor(() => {
      expect(screen.getByText('acme-hook01-es-12s')).toBeInTheDocument();
    });
    expect(screen.getByText('acme-hook02-es-12s')).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /Guion de/ })).toHaveLength(2);
  });

  test('el flag BLOQUEANTE se pinta y su aprobar está DESHABILITADO hasta editar', async () => {
    server.use(scriptsHandler([BLOCKED]));
    render(<ScriptsPanel stepId={STEP_ID} batchId={BATCH_ID} />);

    const card = await screen.findByRole('region', { name: /acme-hook02-es-12s/ });
    // El flag es visible (Alert `danger`, no HTML crudo) con su fragmento y su sugerencia. Se mira el
    // Alert del flag por su `data-slot` (el fragmento «cura el acné» también aparece en la escena
    // editable, que es su sitio: el usuario tiene que ver DÓNDE corregir).
    const flag = within(card)
      .getByText(/Bloqueante · banned_claim/)
      .closest('[data-slot="flag-banned_claim"]');
    expect(flag).not.toBeNull();
    expect(flag?.textContent).toContain('cura el acné');
    expect(flag?.textContent).toContain('ayuda a cuidar tu piel');
    // Y es de tono BLOQUEANTE (danger), observable por su marca (no por su color).
    expect(flag?.getAttribute('data-blocking')).toBe('true');
    // El aprobar está deshabilitado — con el MOTIVO a la vista, no un botón mudo.
    const approve = within(card).getByRole('checkbox', { name: 'Aprobar esta variante' });
    expect(approve).toBeDisabled();
    expect(within(card).getByText(/edítala para poder aprobarla/)).toBeInTheDocument();
  });

  test('EDITAR una variante bloqueada re-habilita su aprobar (el servidor es el guard)', async () => {
    const user = userEvent.setup();
    server.use(scriptsHandler([BLOCKED]));
    render(<ScriptsPanel stepId={STEP_ID} batchId={BATCH_ID} />);

    const card = await screen.findByRole('region', { name: /acme-hook02-es-12s/ });
    const approve = within(card).getByRole('checkbox', { name: 'Aprobar esta variante' });
    expect(approve).toBeDisabled();

    // Editar la narración de la escena hook (resolver el claim): el guard local cede al servidor.
    const hookScene = within(card).getAllByRole('textbox')[0];
    if (hookScene === undefined) throw new Error('no hay escena que editar');
    await user.clear(hookScene);
    await user.type(hookScene, 'esta crema cuida tu piel a diario');

    await waitFor(() => {
      expect(approve).not.toBeDisabled();
    });
  });

  test('al confirmar, manda editedScript SOLO para las variantes editadas', async () => {
    const user = userEvent.setup();
    let approveBody: unknown;
    server.use(
      http.post('*/api/steps/*/approve', async ({ request }) => {
        approveBody = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    render(<ScriptsPanel stepId={STEP_ID} batchId={BATCH_ID} />);

    const blockedCard = await screen.findByRole('region', { name: /acme-hook02-es-12s/ });
    // Editar SOLO la bloqueada; la limpia se aprueba sin tocar.
    const hookScene = within(blockedCard).getAllByRole('textbox')[0];
    if (hookScene === undefined) throw new Error('no hay escena que editar');
    await user.clear(hookScene);
    await user.type(hookScene, 'esta crema cuida tu piel');
    await user.click(within(blockedCard).getByRole('checkbox', { name: 'Aprobar esta variante' }));

    const cleanCard = screen.getByRole('region', { name: /acme-hook01-es-12s/ });
    await user.click(within(cleanCard).getByRole('checkbox', { name: 'Aprobar esta variante' }));

    await user.click(screen.getByRole('button', { name: 'Confirmar guiones' }));

    await waitFor(() => {
      expect(approveBody).not.toBeUndefined();
    });
    const body = approveBody as {
      decision: {
        kind: string;
        verdicts: { variantId: string; approved: boolean; editedScript?: unknown }[];
      };
    };
    expect(body.decision.kind).toBe('scripts');
    const byId = new Map(body.decision.verdicts.map((v) => [v.variantId, v]));
    // La editada lleva editedScript; la limpia (aprobada sin tocar) NO.
    expect(byId.get(BLOCKED.variantId)?.editedScript).toBeDefined();
    expect(byId.get(BLOCKED.variantId)?.approved).toBe(true);
    expect(byId.get(CLEAN.variantId)?.editedScript).toBeUndefined();
    expect(byId.get(CLEAN.variantId)?.approved).toBe(true);
  });
});
