// Regresión permanente del canvas del run (T0.11, e2e.md §9, regla 10 — DoD
// BLOQUEANTE): ejercita el sistema COMPLETO (web + worker + orquestador + pg-boss +
// SSE + React Flow) con el DAG de demo del canvas (executors sleep_ms/fail_rate, sin
// API externa). Cubre: cambios de estado por SSE SIN reload, visor de output/error,
// approve/edit/reject, retry, skip, cancel de otro run, y autopilot + candado
// alwaysPause. Los asserts miran ESTADOS OBSERVABLES (roles/aria/`data-status`),
// NUNCA colores CSS (el color es E2E/CUA visual, no una aserción estable aquí).
import { test, expect, type Page } from '@playwright/test';
import { launchDemoCanvasRun } from './support/runs';

// Un nodo del canvas por su clave corta (N0…N5). El node_key REAL del DAG de demo
// es `demo.canvas.NX` (prefijo para no colisionar en el singletonKey de la cola);
// el accessible name del nodo lo expone (`role=article`, aria-label = node_key +
// estado). El estado CRUDO va en `data-status`.
function nodeKeyOf(shortKey: string): string {
  return `demo.canvas.${shortKey}`;
}

function node(page: Page, shortKey: string) {
  return page.getByRole('article', { name: new RegExp(`${nodeKeyOf(shortKey)}\\b`) });
}

// Espera a que un nodo alcance un `data-status` concreto (el mecanismo del cambio en
// vivo por SSE — sin reload). Timeout holgado: el worker duerme sleep_ms por step.
async function waitStatus(page: Page, shortKey: string, status: string) {
  await expect(node(page, shortKey)).toHaveAttribute('data-status', status, { timeout: 30_000 });
}

// Abre el panel del nodo (click) y devuelve el aside del inspector.
async function openPanel(page: Page, shortKey: string) {
  await node(page, shortKey).click();
  return page.getByRole('complementary', { name: new RegExp(nodeKeyOf(shortKey)) });
}

test.describe('canvas del run (T0.11)', () => {
  test(
    'los nodos cambian de estado en vivo por SSE (sin reload)',
    { tag: ['@f0'] },
    async ({ page, request }) => {
      const runId = await launchDemoCanvasRun(request, { sleepMs: 1500 });
      await page.goto(`/runs/${runId}`);

      // El SSE conecta y puebla el grafo: aparecen los 6 nodos del DAG de demo.
      await expect(node(page, 'N0')).toBeVisible({ timeout: 30_000 });
      // N0 (root) arranca solo: pasa por running y llega a succeeded — SIN reload.
      await waitStatus(page, 'N0', 'succeeded');
      // N1 es el checkpoint: al alcanzarlo pausa en waiting_approval.
      await waitStatus(page, 'N1', 'waiting_approval');
      // La conexión SSE está viva (estado observable).
      await expect(page.getByRole('status', { name: /conexión/i })).toHaveText(/open/);
    },
  );

  test(
    'checkpoint: aprobar desde el panel avanza el run',
    { tag: ['@f0'] },
    async ({ page, request }) => {
      const runId = await launchDemoCanvasRun(request, { sleepMs: 1200 });
      await page.goto(`/runs/${runId}`);
      await waitStatus(page, 'N1', 'waiting_approval');

      const panel = await openPanel(page, 'N1');
      await panel.getByRole('button', { name: /^aprobar$/i }).click();

      // Aprobado → succeeded; el run continúa a N2 (por SSE, sin reload).
      await waitStatus(page, 'N1', 'succeeded');
      await waitStatus(page, 'N2', 'succeeded');
    },
  );

  test('checkpoint: rechazar desde el panel', { tag: ['@f0'] }, async ({ page, request }) => {
    const runId = await launchDemoCanvasRun(request, { sleepMs: 1000 });
    await page.goto(`/runs/${runId}`);
    await waitStatus(page, 'N1', 'waiting_approval');

    const panel = await openPanel(page, 'N1');
    await panel.getByRole('button', { name: /rechazar/i }).click();
    await waitStatus(page, 'N1', 'rejected');
  });

  test(
    'checkpoint: editar el output JSON y aprobar',
    { tag: ['@f0'] },
    async ({ page, request }) => {
      const runId = await launchDemoCanvasRun(request, { sleepMs: 1000 });
      await page.goto(`/runs/${runId}`);
      await waitStatus(page, 'N1', 'waiting_approval');

      const panel = await openPanel(page, 'N1');
      await panel.getByRole('button', { name: /editar/i }).click();
      const editor = panel.getByRole('textbox', { name: /editar output/i });
      await editor.fill('{"editado":true}');
      await panel.getByRole('button', { name: /guardar y aprobar/i }).click();

      // edit → approve_edited → succeeded (+ invalidación de sub-grafo).
      await waitStatus(page, 'N1', 'succeeded');
    },
  );

  test(
    'fallo: ver el error en el visor y reintentar con éxito',
    { tag: ['@f0'] },
    async ({ page, request }) => {
      const runId = await launchDemoCanvasRun(request, { sleepMs: 800 });
      await page.goto(`/runs/${runId}`);

      // Avanzar por los checkpoints hasta el nodo que falla (N4, failRate=1).
      await waitStatus(page, 'N1', 'waiting_approval');
      await (await openPanel(page, 'N1')).getByRole('button', { name: /^aprobar$/i }).click();
      await waitStatus(page, 'N3', 'waiting_approval'); // el candado alwaysPause
      await (await openPanel(page, 'N3')).getByRole('button', { name: /^aprobar$/i }).click();

      // N4 falla (retries automáticos agotados) → failed terminal.
      await waitStatus(page, 'N4', 'failed');

      // El visor de logs del panel muestra el error del executor.
      const panel = await openPanel(page, 'N4');
      const errorViewer = panel.locator('[data-slot="error-viewer"]');
      await expect(errorViewer).toBeVisible();
      await expect(errorViewer).toContainText(/fallo inyectado/i);

      // Reintentar (el panel patchea failRate=0) → el reintento completa.
      await panel.locator('[data-slot="retry-action"]').click();
      await waitStatus(page, 'N4', 'succeeded');
    },
  );

  test(
    'skip: saltar un nodo skippable desde el panel',
    { tag: ['@f0'] },
    async ({ page, request }) => {
      const runId = await launchDemoCanvasRun(request, { sleepMs: 800 });
      await page.goto(`/runs/${runId}`);

      await waitStatus(page, 'N1', 'waiting_approval');
      await (await openPanel(page, 'N1')).getByRole('button', { name: /^aprobar$/i }).click();
      await waitStatus(page, 'N3', 'waiting_approval');

      // N4 depende de N3 (aún sin aprobar) → N4 está en awaiting_deps: skippable.
      await waitStatus(page, 'N4', 'awaiting_deps');
      const panel = await openPanel(page, 'N4');
      await panel.locator('[data-slot="skip-action"]').click();
      await waitStatus(page, 'N4', 'skipped');
    },
  );

  test(
    'cancelar OTRO run en curso desde el botón del panel',
    { tag: ['@f0'] },
    async ({ page, request }) => {
      // Un run largo que sigue en curso mientras lo cancelamos.
      const otherRunId = await launchDemoCanvasRun(request, { sleepMs: 4000 });
      await page.goto(`/runs/${otherRunId}`);
      await expect(node(page, 'N0')).toBeVisible({ timeout: 30_000 });

      // Cancela el LOTE desde el panel (sin nodo seleccionado el botón sigue visible).
      await page.locator('[data-slot="cancel-action"]').click();
      // Los nodos no-terminales pasan a cancelled (barrido de cancel del run).
      await waitStatus(page, 'N0', 'cancelled');
    },
  );

  test(
    'autopilot: activar el toggle → el run completa sin pausas, respetando el candado',
    { tag: ['@f0'] },
    async ({ page, request }) => {
      // sleep largo en N0 para que dé tiempo a activar autopilot ANTES de que N1
      // alcance su checkpoint (la decisión de pausa se toma al llegar al step).
      const runId = await launchDemoCanvasRun(request, { sleepMs: 3000 });
      await page.goto(`/runs/${runId}`);
      await expect(node(page, 'N0')).toBeVisible({ timeout: 30_000 });

      // Activa autopilot desde la cabecera (PATCH → persiste en el run).
      const toggle = page.locator('[data-slot="autopilot-toggle"]');
      await toggle.click();
      await expect(page.locator('[data-slot="run-header"]')).toHaveAttribute(
        'data-run-autopilot',
        'true',
      );

      // N1 (checkpoint NORMAL) NO pausa con autopilot: pasa a succeeded sin approve.
      await waitStatus(page, 'N1', 'succeeded');
      // N3 (candado alwaysPause) SÍ pausa AUNQUE autopilot esté on: el candado gana.
      await waitStatus(page, 'N3', 'waiting_approval');
    },
  );
});
