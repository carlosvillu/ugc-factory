// E2E DE FASE — F1 · ANÁLISIS (T1.10b, criterio O1 del PRD; e2e.md §9, regla 10 — DoD
// BLOQUEANTE). El journey COMPLETO del producto, de punta a punta, con el sistema entero vivo:
//
//   intake (URL) → N1 (ingesta) → N2 (visión) → N3 (síntesis + validación) → CP1 (editar el
//   brief campo a campo) → aprobar → el brief queda VERSIONADO (v1 IA → v2 editado) y el run
//   AVANZA.
//
// Es el hermano de `brief-editor.spec.ts`: aquel diseca CP1 (badges, warnings, versionado
// standalone); ESTE prueba que las piezas encajan como PRODUCTO — que un usuario que pega una
// URL acaba con un brief suyo, aprobado y persistido, sin tocar nada más.
//
// SIN GASTAR UN CÉNTIMO: el stack E2E levanta un servidor local que finge Firecrawl/Jina/
// Anthropic (`startFakeExternalApis`) y apunta los clientes ahí. El fake emite lo que emiten los
// productores REALES (fixtures de Firecrawl v2 + las factories `makeBrief`/`makeVisualAnalysis`,
// con un hook que se pasa del techo como los de Sonnet 5 de verdad) — no payloads cómodos: la
// lección de T1.8/T1.9.
//
// El BOUND TEMPORAL de O1 (<180 s de pipeline) y el de coste (<$0,25) NO se afirman aquí: contra
// los fakes el pipeline tarda segundos y cuesta 0, así que un assert de tiempo/coste sobre este
// spec no probaría nada del sistema real. Los mide el verifier contra una URL REAL (es
// literalmente lo que dice la Verificación: "en el navegador — URL real"). Aquí se prueba la
// CADENA; allí, el presupuesto.
import { test, expect } from '@playwright/test';
import { waitCanvasStatus as waitStatus, canvasNode as node } from '../support/canvas';
import { briefEditor, fetchBrief } from '../support/brief';
import { apiCall } from '../support/http';

test.describe('F1 · journey de análisis: URL → N1/N2/N3 → CP1 → aprobar y avanzar', () => {
  test(
    'un usuario pega una URL, edita el brief en CP1 y lo aprueba: el brief se versiona y el run avanza',
    { tag: ['@f1', '@phase'] },
    async ({ page, request }) => {
      // ── 1. INTAKE: el usuario pega una URL de producto ────────────────────────────────
      await page.goto('/analyses/new');
      await expect(page.getByRole('tab', { name: /desde url/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page
        .getByRole('textbox', { name: /url del producto/i })
        .fill('https://glow.example/products/serum');
      await page.getByRole('button', { name: /analizar/i }).click();

      // El submit arranca el run y navega al canvas EN VIVO.
      await page.waitForURL(/\/runs\/[^/]+$/, { timeout: 30_000 });

      // ── 2. N1 → N2 → N3: los nodos progresan por SSE, sin recargar ────────────────────
      await expect(node(page, 'N1')).toBeVisible({ timeout: 30_000 });
      await waitStatus(page, 'N1', 'succeeded', 90_000); // ingesta (scrape)
      await waitStatus(page, 'N2', 'succeeded', 90_000); // visión (hay imágenes → no se salta)

      // ── 3. CP1: N3 sintetiza y PAUSA. El editor de brief toma la vista ────────────────
      const editor = briefEditor(page);
      await expect(editor).toBeVisible({ timeout: 90_000 });

      // El brief está CARGADO (no un editor vacío): el fix de `reach_checkpoint` es lo que hace
      // que el artefacto sobreviva a la pausa.
      const beneficio = editor.getByLabel('Beneficio 1');
      await expect(beneficio).not.toHaveValue('');

      // El `briefId` (la fila `product_brief` que escribió N3) y el `stepId` de CP1 están
      // anclados en el DOM del editor. Se capturan AHORA: tras aprobar, el editor desaparece
      // (el canvas vuelve) y ya no se pueden leer.
      await expect(editor).toHaveAttribute('data-brief-id', /.+/);
      await expect(editor).toHaveAttribute('data-step-id', /.+/);
      const briefId = (await editor.getAttribute('data-brief-id')) ?? '';
      const stepId = (await editor.getAttribute('data-step-id')) ?? '';

      // v1 = el brief de la IA: `draft`, NO editado por el usuario.
      const v1 = await fetchBrief(request, briefId);
      expect(v1.version).toBe(1);
      expect(v1.editedByUser).toBe(false);

      // ── 4. EDITAR un beneficio y un hook (lo que pide la Verificación) ────────────────
      await beneficio.fill('Piel visiblemente más luminosa en 7 días');
      await editor
        .getByLabel(/^Hook 1 de /)
        .first()
        .fill('Tu piel al despertar, sin filtros');

      // ── 5. APROBAR (guardando la edición) ────────────────────────────────────────────
      await editor.getByRole('button', { name: /guardar cambios y continuar/i }).click();

      // ── 6. EL RUN AVANZA: N3 deja el checkpoint y queda `succeeded` ──────────────────
      // (el canvas vuelve a la vista: la aprobación llega por SSE, sin recargar)
      await waitStatus(page, 'N3', 'succeeded', 30_000);

      // ── 7. EL BRIEF QUEDÓ VERSIONADO: v1 (IA) + v2 (editado) ─────────────────────────
      // El v1 de la IA SIGUE INTACTO: versionar no es sobrescribir. El linaje IA→humano es el
      // punto (§19.1 mide cuánto corrige el humano a la IA para mejorar los prompts).
      const v1DespuesDeEditar = await fetchBrief(request, briefId);
      expect(v1DespuesDeEditar.version).toBe(1);
      expect(v1DespuesDeEditar.editedByUser).toBe(false);
      expect(v1DespuesDeEditar.brief.benefits[0]?.benefit).not.toBe(
        'Piel visiblemente más luminosa en 7 días',
      );

      // Y el v2 es el del usuario: `edited_by_user:true`, `approved`, CON su edición dentro.
      // Se llega a él por el artefacto EDITADO del step (el `editStep` de T0.8 reemplazó el
      // `output_refs` de N3 para que apunte a la versión nueva).
      const stepRes = await apiCall(
        () => request.get(`/api/steps/${stepId}`),
        'GET /api/steps/:id',
      );
      expect(stepRes.ok()).toBe(true);
      const step = (await stepRes.json()) as { outputRefs: { briefId: string } };
      const v2Id = step.outputRefs.briefId;
      expect(v2Id).not.toBe(briefId); // fila NUEVA, no la misma sobrescrita

      const v2 = await fetchBrief(request, v2Id);
      expect(v2.version).toBe(2);
      expect(v2.editedByUser).toBe(true);
      expect(v2.status).toBe('approved');
      expect(v2.brief.benefits[0]?.benefit).toBe('Piel visiblemente más luminosa en 7 días');
      expect(v2.brief.angles[0]?.hook_examples[0]).toBe('Tu piel al despertar, sin filtros');
    },
  );
});
