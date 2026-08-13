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
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { server, useHttpMocks } from '@ugc/test-utils';
import {
  computeSceneTiming,
  estSecondsOf,
  fullTextOf,
  subtitlesFromScenes,
  totalWords,
} from '@ugc/core/scripting';
import type { AdScript, AdSegment, BatchScript, GuardrailFlag } from '@ugc/core/contracts';
import type { RunResponse } from '@/lib/api-client';
import { RunStoreProvider } from '@/stores/run-store';

import { ScriptsPanel } from './scripts-panel';
import { RunHeader } from '@/components/run-canvas/run-shell';

// CP3 navega al run de GENERACIÓN tras aprobar en un tier que genera (T5c.1): `scripts-panel` usa
// `useRouter().push`, igual que `matrix-panel` (CP2) y `qa-panel` (CP4). En jsdom no hay App Router
// montado, así que se mockea `next/navigation` (mismo patrón que los tests del intake y de CP2).
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

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

/** El handler de `GET /api/batches/:id/scripts`. `expectedCount` (T5.11) es cuántos guiones DEBERÍA
 *  traer el lote: por defecto, los que trae (lote completo). Pasarlo MAYOR simula el lote TRUNCADO
 *  que deja un `api_error` a mitad de N5 — el estado que la UI presentaba como éxito. */
function scriptsHandler(scripts: BatchScript[], expectedCount = scripts.length) {
  return http.get('*/api/batches/*/scripts', () =>
    HttpResponse.json({ batchId: BATCH_ID, scripts, expectedCount }),
  );
}

// `useHttpMocks` registra hooks de Vitest (beforeAll/beforeEach): va a nivel de MÓDULO, no dentro de
// un `test()` (ahí llegaría tarde). El handler por defecto sirve las dos variantes; los tests que
// necesitan otro conjunto lo sobrescriben con `server.use(...)`.
// eslint-disable-next-line react-hooks/rules-of-hooks -- `useHttpMocks` NO es un hook de React: registra hooks de Vitest (beforeAll/beforeEach), va a nivel de módulo.
useHttpMocks(scriptsHandler([CLEAN, BLOCKED]));

afterEach(cleanup);

/** El objeto run mínimo para sembrar el store. `ScriptsPanel` solo se monta DENTRO del run shell (que
 *  provee `RunStoreProvider`, `runs/[id]/page.tsx`): desde T5c.2 el panel lee `setGenerationSkipped`
 *  del store, así que el test tiene que envolverlo igual que producción. `steps: []` — el panel no los
 *  usa (pide sus guiones por REST). Los campos son los que `RunResponse` exige; ninguno importa aquí. */
function makeRun(): RunResponse {
  return {
    id: 'run_cp3',
    projectId: 'proj_01',
    kind: 'full',
    autopilot: false,
    status: 'running',
    startedAt: null,
    finishedAt: null,
    totalCostEstimated: null,
    totalCostActual: null,
    costActualCents: 0,
  };
}

/** Monta `ScriptsPanel` bajo `RunStoreProvider` (como producción). `withHeader` monta también
 *  `RunHeader` en el MISMO provider para poder afirmar, en un solo test, la cadena completa
 *  panel → store → UI (T5c.2): el aviso lo pinta la cabecera, que sobrevive al desmontaje del panel. */
function renderPanel(opts: { withHeader?: boolean } = {}) {
  const run = makeRun();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RunStoreProvider initial={{ run, steps: [] }}>
        {opts.withHeader ? <RunHeader runId={run.id} /> : null}
        {children}
      </RunStoreProvider>
    );
  }
  return render(<ScriptsPanel stepId={STEP_ID} batchId={BATCH_ID} />, { wrapper: Wrapper });
}

describe('ScriptsPanel (CP3)', () => {
  test('carga los guiones del lote y pinta una tarjeta por variante', async () => {
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('acme-hook01-es-12s')).toBeInTheDocument();
    });
    expect(screen.getByText('acme-hook02-es-12s')).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /Guion de/ })).toHaveLength(2);
  });

  test('el flag BLOQUEANTE se pinta y su aprobar está DESHABILITADO hasta editar', async () => {
    server.use(scriptsHandler([BLOCKED]));
    renderPanel();

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
    renderPanel();

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
    renderPanel();

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

  // ── T5.11 · LOTE TRUNCADO ────────────────────────────────────────────────────────────────────────
  // El defecto REAL (run de T5.9): con 5 de 12 guiones, el panel afirmaba «N5 escribió un guion por
  // variante» y dejaba «Confirmar guiones» HABILITADO ⇒ aprobar disparaba generación de PAGO sobre un
  // lote truncado. Ahora el recuento REAL es visible y no existe camino de UI para aprobarlo.
  test('T5.11: un lote truncado muestra el recuento REAL y NO deja aprobar', async () => {
    // 1 guion de 2 esperados: exactamente lo que deja un `api_error` a mitad de N5.
    server.use(scriptsHandler([CLEAN], 2));
    renderPanel();

    await screen.findByRole('region', { name: /acme-hook01-es-12s/ });

    // El recuento REAL (1/2), no «1/1»: sin la cuenta ESPERADA del servidor, el panel comparaba las
    // filas consigo mismas y el truncamiento era invisible.
    const partial = document.querySelector('[data-slot="scripts-partial"]');
    expect(partial).not.toBeNull();
    expect(partial?.textContent).toContain('1/2');
    // Y la afirmación falsa ya no está.
    expect(screen.queryByText(/N5 escribió un guion por variante/)).not.toBeInTheDocument();

    // LO QUE CUIDA EL DINERO: ningún camino de la UI dispara la aprobación.
    expect(screen.getByRole('button', { name: 'Confirmar guiones' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Aprobar todas las aptas' })).toBeDisabled();
  });

  test('T5.11: el lote COMPLETO sigue aprobándose (el guard no encierra el camino feliz)', async () => {
    renderPanel();

    await screen.findByRole('region', { name: /acme-hook01-es-12s/ });
    expect(document.querySelector('[data-slot="scripts-partial"]')).toBeNull();
    // Nada aprobado aún ⇒ el botón arranca INERTE (T5.14). El "camino feliz" de T5.11 se prueba tras
    // aprobar una variante (abajo, en el bloque de T5.14).
    expect(screen.getByRole('button', { name: 'Confirmar guiones' })).toBeDisabled();
  });

  // ── T5.14 · CONFIRMAR CON 0 APROBADAS ────────────────────────────────────────────────────────────
  // El BUG DE PRODUCCIÓN (la rama vecina a T5.11): confirmar sin aprobar ninguna variante consumía el
  // checkpoint y dejaba el lote varado con sus guiones YA PAGADOS. El panel mostraba «0/N aprobadas» —el
  // sistema lo sabía— pero el botón estaba HABILITADO. Ahora queda INERTE con 0 aprobadas (espejo del
  // lote truncado), con el motivo a la vista. El servidor lo rechaza igual (validation_error).
  test('T5.14: con 0 aprobadas el botón «Confirmar» está DESHABILITADO, con el motivo a la vista', async () => {
    renderPanel();

    await screen.findByRole('region', { name: /acme-hook01-es-12s/ });
    // Lote completo, ninguna aprobada de entrada.
    expect(document.querySelector('[data-slot="scripts-partial"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirmar guiones' })).toBeDisabled();
    // El MOTIVO está a la vista (el botón mudo era el misterio que dejaba varar el lote).
    expect(screen.getByText(/Aprueba al menos una variante para confirmar/)).toBeInTheDocument();
  });

  test('T5.14 control negativo: aprobar UNA variante re-habilita «Confirmar» y quita el aviso', async () => {
    const user = userEvent.setup();
    renderPanel();

    const cleanCard = await screen.findByRole('region', { name: /acme-hook01-es-12s/ });
    const confirm = screen.getByRole('button', { name: 'Confirmar guiones' });
    // Antes: inerte, con aviso.
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/Aprueba al menos una variante para confirmar/)).toBeInTheDocument();

    // Aprobar la variante limpia (sin flag bloqueante): 1/2 aprobadas.
    await user.click(within(cleanCard).getByRole('checkbox', { name: 'Aprobar esta variante' }));

    // Ahora hay una variante hacia delante: el botón se re-habilita y el aviso desaparece. (Si se
    // revirtiera el guard, el botón habría estado habilitado desde el inicio con 0 aprobadas — el bug.)
    await waitFor(() => {
      expect(confirm).not.toBeDisabled();
    });
    expect(
      screen.queryByText(/Aprueba al menos una variante para confirmar/),
    ).not.toBeInTheDocument();
  });

  // ── T5c.1 · NAVEGAR AL RUN DE GENERACIÓN AL APROBAR ──────────────────────────────────────────────
  // El defecto REAL (investigación 2026-08-13, Fallo 2/3): `onSubmit` descartaba el retorno de
  // `approve`, así que aprobar CP3 en un tier que genera dejaba al usuario mirando el run de N5 (ya
  // muerto) mientras la generación corría INVISIBLE en `/runs/<otra>`. CP2 y CP4 sí navegaban. Ahora
  // CP3 consume el `nextRunId` y navega igual — y sin él (tier no listo, T5c.2) NO navega.
  test('T5c.1: aprobar en un tier que GENERA navega al run de generación (nextRunId)', async () => {
    const user = userEvent.setup();
    push.mockClear();
    server.use(
      // La aprobación arranca el run de generación (N6→N7) y devuelve su id: la app debe navegar a
      // él. Sin esto, la generación correría en otra URL que el usuario nunca vería.
      http.post('*/api/steps/*/approve', () =>
        HttpResponse.json({ ok: true, nextRunId: '01J000000000000000GENRUN0' }),
      ),
    );
    const { container } = renderPanel({ withHeader: true });

    // Aprobar la variante limpia y confirmar (lote completo, 1 aprobada ⇒ camino feliz).
    const cleanCard = await screen.findByRole('region', { name: /acme-hook01-es-12s/ });
    await user.click(within(cleanCard).getByRole('checkbox', { name: 'Aprobar esta variante' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar guiones' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/runs/01J000000000000000GENRUN0');
    });
    // CONTROL de T5c.2 (planning:1108 «en un tier que SÍ genera, no aparece el aviso»): el camino con
    // `nextRunId` NO deposita `generationSkipped` en el store, así que la cabecera no pinta el aviso.
    // Guarda contra mover el `setGenerationSkipped` por encima del early-return del `nextRunId`.
    expect(container.querySelector('[data-slot="generation-skipped"]')).toBeNull();
  });

  test('T5c.1: aprobar en un tier que NO genera (sin nextRunId) NO navega — deja el desmontaje por SSE', async () => {
    const user = userEvent.setup();
    push.mockClear();
    let approveCalled = false;
    server.use(
      // Tier no listo para generar (T5c.2): la aprobación consume el checkpoint pero NO arranca run,
      // así que la respuesta no trae `nextRunId`. No hay run al que ir ⇒ no se navega.
      http.post('*/api/steps/*/approve', () => {
        approveCalled = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    renderPanel();

    const cleanCard = await screen.findByRole('region', { name: /acme-hook01-es-12s/ });
    await user.click(within(cleanCard).getByRole('checkbox', { name: 'Aprobar esta variante' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar guiones' }));

    // La aprobación se disparó, pero sin `nextRunId` en la respuesta NO hubo navegación: no hay run
    // al que ir. El desmontaje lo hace el SSE (que no existe en jsdom), como en el resto del panel.
    await waitFor(() => {
      expect(approveCalled).toBe(true);
    });
    expect(push).not.toHaveBeenCalled();
  });

  // ── T5c.2 · EL STOP DE TIER-NO-GENERA ES VISIBLE (antes: 200 mudo) ──────────────────────────────
  // El defecto (investigación 2026-08-13, Fallo 3): aprobar CP3 en un tier que aún no genera vídeo
  // commiteaba `scripted`, no arrancaba run y devolvía 200 SIN mensaje — el usuario aprobaba y «no
  // pasaba nada». Ahora la respuesta trae `generationSkipped`; el panel lo sube al RUN STORE y
  // `RunHeader` (que sobrevive al desmontaje del panel) pinta el aviso. Este test cubre la CADENA
  // panel → store → UI en un solo render (por eso monta también la cabecera): asertar solo «la acción
  // se llamó» pasaría aunque el campo del store estuviera mal nombrado.
  test('T5c.2: aprobar en un tier que NO genera pinta el aviso en la cabecera (nombra el tier)', async () => {
    const user = userEvent.setup();
    push.mockClear();
    server.use(
      http.post('*/api/steps/*/approve', () =>
        HttpResponse.json({
          ok: true,
          generationSkipped: { reason: 'tier_not_ready', tier: 'test' },
        }),
      ),
    );
    const { container } = renderPanel({ withHeader: true });
    const skippedAlert = () => container.querySelector('[data-slot="generation-skipped"]');

    // Al montar, la cabecera NO muestra el aviso (el store arranca en `null`).
    expect(skippedAlert()).toBeNull();

    const cleanCard = await screen.findByRole('region', { name: /acme-hook01-es-12s/ });
    await user.click(within(cleanCard).getByRole('checkbox', { name: 'Aprobar esta variante' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar guiones' }));

    // Tras aprobar, el aviso aparece en la cabecera nombrando el tier — no un 200 mudo. No se navega
    // (no hay run de generación) y `RunHeader` lo pinta porque el panel subió el aviso al store.
    await waitFor(() => {
      expect(skippedAlert()).not.toBeNull();
    });
    expect(skippedAlert()).toHaveTextContent(/no puede generar vídeo todavía/i);
    expect(skippedAlert()).toHaveTextContent('test');
    expect(push).not.toHaveBeenCalled();
  });
});
