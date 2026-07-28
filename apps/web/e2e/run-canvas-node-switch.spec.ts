// Regresión permanente de la CONMUTACIÓN nodo→nodo del inspector (T5.24, regla 10 —
// DoD BLOQUEANTE). El inspector genérico (`StepPanel`) guarda estado LOCAL por-step
// (el editor JSON `editing`/`editDraft`, la modal `viewer`, `busy`/`error`); sin
// REMONTAR al cambiar de nodo, la misma instancia se reúsa y ese estado del step viejo
// SOBREVIVE sobre el nuevo. El fix es `key={selectedStepId}` en el punto de uso
// (`run-shell.tsx`), espejo de lo que `qa-panel.tsx` ya hace con `VariantReview`.
//
// POR QUÉ ESTE ASSERT Y NO "el panel B es visible". Aserar solo que tras clicar B su
// panel aparece PASA sin el key la mayoría de las veces (el título/estado del panel son
// LECTURAS del store —`aria-label`, `data-step-status`— y se actualizan en re-render, sin
// remonte). El camino que falla 100% sin remonte es el ESTADO RANCIO: se abre el editor
// JSON en un nodo (`data-slot="output-editor"`, estado LOCAL de `StepPanel`) y se conmuta a
// OTRO nodo que NO es checkpoint. Sin el key, el editor a medias del primero se arrastra al
// panel del segundo (el bloque `{editing ? <section data-slot="output-editor">}` se pinta al
// margen de si el nuevo step es checkpoint). Con el key, la instancia nueva arranca limpia.
//
// CONTROL NEGATIVO (regla 5a): revertir el `key` de `run-shell.tsx` (volver
// `<SelectedStepPanel />` a `<StepPanel />`, o borrar el `key` del wrapper) deja el editor
// rancio pegado al segundo panel → el `not.toBeVisible()` de abajo se pone ROJO. Medido en
// la implementación de T5.24 (ver el informe de la tarea).
//
// Corre sobre el DAG de DEMO (executors sleep_ms/fail_rate, sin API externa, coste $0): N1
// es un checkpoint con botón "Editar" (abre el editor local), N0 es la raíz que llega a
// `succeeded` sin aprobación y NO es checkpoint (no tiene editor propio) — el par perfecto
// para probar que el estado del uno no contamina al otro.
import { test, expect, type Page } from '@playwright/test';
import { launchDemoCanvasRun } from './support/runs';
import { waitCanvasStatus, openCanvasPanel } from './support/canvas';

function nodeKeyOf(shortKey: string): string {
  return `demo.canvas.${shortKey}`;
}

async function waitStatus(page: Page, shortKey: string, status: string) {
  await waitCanvasStatus(page, nodeKeyOf(shortKey), status, 30_000);
}

async function openPanel(page: Page, shortKey: string) {
  return openCanvasPanel(page, nodeKeyOf(shortKey));
}

test.describe('inspector: conmutar de nodo remonta el panel (T5.24)', () => {
  test(
    'un editor JSON a medias en un nodo NO se arrastra al panel de otro',
    { tag: ['@f5'] },
    async ({ page, request }) => {
      const runId = await launchDemoCanvasRun(request, { sleepMs: 1000 });
      await page.goto(`/runs/${runId}`);

      // Gates de estado ESTABLES (no ventanas de tiempo): N1 pausa en el checkpoint y ahí se
      // queda; N0 (raíz, no checkpoint) llega a succeeded solo. Ambos quedan inspeccionables.
      await waitStatus(page, 'N1', 'waiting_approval');
      await waitStatus(page, 'N0', 'succeeded');

      // Abre N1 (checkpoint) y deja su editor JSON local ABIERTO con un texto sentinela — el
      // estado que NO debe sobrevivir al cambio de nodo.
      const n1Panel = await openPanel(page, 'N1');
      await n1Panel.getByRole('button', { name: /editar/i }).click();
      const editor = n1Panel.getByRole('textbox', { name: /editar output/i });
      const sentinel = '{"RANCIO_DE_N1":true}';
      await editor.fill(sentinel);
      await expect(n1Panel.locator('[data-slot="output-editor"]')).toBeVisible();

      // Conmuta a N0 (otro nodo, NO checkpoint): su panel debe MONTAR limpio.
      const n0Panel = await openPanel(page, 'N0');

      // El panel es el de N0 (su accessible name porta `demo.canvas.N0`)…
      await expect(n0Panel).toBeVisible();
      await expect(n0Panel).toHaveAttribute('data-step-status', 'succeeded');

      // …y NO arrastra el editor JSON a medias de N1 (sin el key, esta instancia reusada
      // seguiría en modo `editing` con el `editDraft` del step viejo). Ambos asserts son estado
      // LOCAL de `StepPanel` (no lecturas del store): solo un remonte los limpia, así que ambos
      // se ponen ROJOS al revertir el `key` (control negativo). Se asserta sobre el CONTROL REAL
      // —la sección `output-editor` y el `<textbox>` de dentro— y NO sobre el TEXTO del sentinela:
      // el draft vive en el `value` del `<textarea>`, que Playwright NO expone por `getByText`
      // (matchea `textContent`, no `value`) — un `getByText` del sentinela sería un assert vacuo.
      await expect(n0Panel.locator('[data-slot="output-editor"]')).toBeHidden();
      await expect(n0Panel.getByRole('textbox', { name: /editar output/i })).toHaveCount(0);
      // N0 no es checkpoint: no ofrece el botón "Editar" (prueba positiva de que el panel es
      // el suyo, con SUS acciones, no el de N1 reutilizado).
      await expect(n0Panel.getByRole('button', { name: /editar/i })).toHaveCount(0);

      // Y al volver a N1, su panel remonta también limpio: el editor NO sigue abierto (el
      // remonte lo reinició — un draft a medias no se preserva entre visitas al mismo nodo,
      // que es justo el estado efímero que este fix descarta a propósito).
      const n1Again = await openPanel(page, 'N1');
      await expect(n1Again).toHaveAttribute('data-step-status', 'waiting_approval');
      await expect(n1Again.locator('[data-slot="output-editor"]')).toBeHidden();
    },
  );
});
