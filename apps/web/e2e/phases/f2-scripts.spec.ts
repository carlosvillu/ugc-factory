// E2E DE FASE — F2 · GUIONES (T2.6, criterio O2 del PRD; e2e.md §9, regla 10 — DoD BLOQUEANTE).
// El journey COMPLETO de la fase, con el sistema entero vivo (web + worker + orquestador + pg-boss +
// SSE + los nodos reales N1/N2/N3/N4/N5):
//
//   intake (URL) → N1/N2/N3 → CP1 (aprobar el brief) → N4 compone la matriz → CP2 (confirmar el
//   gasto) → se CREA el lote Y arranca el run de N5 (la app navega a él) → N5 escribe un guion por
//   variante → CP3 (editor de guiones) → aprobar TODAS → las variantes quedan `scripted`.
//
// Es el hermano de `script-editor.spec.ts`: aquel diseca CP3 (edición, re-lint bloqueante, aprobar
// por variante) sobre un checkpoint sembrado; ESTE prueba que las piezas encajan como PRODUCTO —
// que un usuario que pega una URL acaba con seis variantes guionizadas y aprobadas, atravesando los
// DOS runs (análisis y guiones) sin tocar nada fuera del camino.
//
// SIN GASTAR UN CÉNTIMO: el stack E2E finge Firecrawl/Jina/Anthropic (`startFakeExternalApis`); el
// fake del ScriptWriter emite guiones LIMPIOS (sin claims prohibidos), así que las seis variantes
// linten sin flags bloqueantes y «aprobar todas» las transiciona. Los bounds de tiempo/coste de O2
// los mide el verifier contra el modelo REAL — aquí se prueba la CADENA.
import { test, expect, type Page } from '@playwright/test';
import { createDb, upsertPersonaByName } from '@ugc/db';
import { waitCanvasStatus } from '../support/canvas';
import { briefEditor, runUrlAnalysisToCp1 } from '../support/brief';
import { queryStack, stackDatabaseUrl } from '../support/stack-db';

const stackDb = createDb(stackDatabaseUrl);

/** La MISMA persona compatible que siembra `batch-matrix.spec.ts` (mismo hallazgo de T2.3: las del
 *  seed puntúan 0 contra el `avatar_hint` del fake). Se siembra por el repo tipado (PK = ULID de
 *  app, no default de Postgres) e idempotente para poder re-correr la suite. */
const MATCHING_PERSONA = {
  name: 'Nora E2E F2',
  ageRange: '25-35',
  gender: 'female' as const,
  ethnicity: 'mediterránea',
  style: 'natural',
  descriptor: 'creadora de 30 años, estilo natural, baño luminoso',
  setting: 'baño luminoso',
  personality: 'cercana y directa',
};

test.beforeAll(async () => {
  await upsertPersonaByName(stackDb, MATCHING_PERSONA);
});

function cp2(page: Page) {
  return page.locator('[data-slot="matrix-panel"]');
}
function cp3(page: Page) {
  return page.locator('[data-slot="scripts-panel"]');
}

test.describe('F2 · journey de guiones: URL → CP1 → CP2 → CP3 → variantes scripted', () => {
  test(
    'un usuario aprueba la matriz, N5 guioniza el lote y CP3 deja todas las variantes scripted',
    { tag: ['@f2', '@phase'] },
    async ({ page }) => {
      // ── 1. URL → CP1 → aprobar el brief ────────────────────────────────────────────────
      await runUrlAnalysisToCp1(page);
      await briefEditor(page)
        .getByRole('button', { name: /aprobar y continuar/i })
        .click();

      // ── 2. N4 compone la matriz y CP2 abre ──────────────────────────────────────────────
      await waitCanvasStatus(page, 'N4', 'waiting_approval', 60_000);
      await expect(cp2(page)).toBeVisible({ timeout: 30_000 });
      // El primer estimado ya está (el coste deja de ser «—»): el botón de confirmar se habilita.
      await expect(page.getByRole('status', { name: /coste estimado/i })).not.toHaveText('—', {
        timeout: 30_000,
      });

      // Cuántas variantes se van a crear (lo que la UI enseña antes de pagar): es EXACTAMENTE lo que
      // debe acabar `scripted`. Con el brief del fake + la persona sembrada, son seis (3 ángulos × 2
      // hooks, hook_test, 1 idioma). Se lee de la UI, no se hardcodea, para no atarse al fixture.
      const variantCount = await page.locator('[data-slot="planned-matrix"] tbody tr').count();
      expect(variantCount).toBeGreaterThan(0);

      // ── 3. CONFIRMAR el gasto: crea el lote Y arranca N5 → la app navega al run de guiones ──
      const analysisPath = new URL(page.url()).pathname;
      await page.getByRole('button', { name: /confirmar y crear/i }).click();
      await page.waitForURL((u) => u.pathname.startsWith('/runs/') && u.pathname !== analysisPath, {
        timeout: 30_000,
      });

      // ── 4. N5 guioniza y CP3 (el editor de guiones) toma la vista ───────────────────────
      // El run de N5 tiene un solo nodo checkpoint (`alwaysPause`): en cuanto escribe los guiones,
      // pausa. El fake del ScriptWriter es determinista y $0, así que llega enseguida.
      await waitCanvasStatus(page, 'N5', 'waiting_approval', 90_000);
      await expect(cp3(page)).toBeVisible({ timeout: 30_000 });

      // El editor CARGÓ los guiones (una tarjeta por variante, con su narración editable): el
      // artefacto ligero de N5 + la lectura por REST que reconstruye cada AdScript.
      const cards = cp3(page).locator('[data-slot="variant-card"]');
      await expect(cards).toHaveCount(variantCount, { timeout: 30_000 });
      // Ninguna variante trae flag bloqueante (el fake escribe limpio): «aprobar todas» las cubre.
      await expect(
        cp3(page).locator('[data-slot="variant-card"][data-blocking="true"]'),
      ).toHaveCount(0);

      // EL LOTE DE ESTE RUN, leído del panel (`data-batch-id`) — NO un `SELECT ... ORDER BY id DESC
      // LIMIT 1` global: los specs de F2 corren en PARALELO contra el MISMO stack y varios crean
      // lotes de 6 variantes, así que «el último» no es determinista (un lote de `batch-matrix`, que
      // se queda en `planned`, colaría y rompería el assert de `scripted`). El batchId del panel es
      // el del run al que navegó ESTE `page`: race-free. Se lee AQUÍ (cargado) porque las ramas de
      // carga/error del panel no lo exponen, y ANTES de confirmar (que desmonta el panel).
      await expect(cp3(page)).toHaveAttribute('data-batch-id', /.+/);
      const batchId = await cp3(page).getAttribute('data-batch-id');

      // ── 5. APROBAR TODAS y confirmar ────────────────────────────────────────────────────
      await cp3(page)
        .getByRole('button', { name: /aprobar todas las aptas/i })
        .click();
      // El contador refleja que están todas aprobadas antes de confirmar (feedback de la acción).
      await expect(cp3(page).locator('[data-slot="approved-count"]')).toContainText(
        `${String(variantCount)} / ${String(variantCount)}`,
      );
      await cp3(page)
        .getByRole('button', { name: /confirmar guiones/i })
        .click();

      // ── 6. EL RUN AVANZA: N5 deja el checkpoint y queda `succeeded` (por SSE, sin recargar) ──
      await waitCanvasStatus(page, 'N5', 'succeeded', 30_000);

      // ── 7. LAS VARIANTES QUEDARON `scripted`, CONTRA LA BD ──────────────────────────────
      // Las variantes del lote de ESTE run: TODAS `scripted` (la Verificación pide ver las filas).
      const variants = await queryStack<{ status: string }>(
        `SELECT status FROM ad_variant WHERE batch_id = $1`,
        [batchId],
      );
      expect(variants).toHaveLength(variantCount);
      expect(variants.every((v) => v.status === 'scripted')).toBe(true);

      // Y existe UN guion vigente por variante (`ad_script` v1 de N5): el lote está guionizado.
      const scripts = await queryStack<{ n: number }>(
        `SELECT COUNT(DISTINCT variant_id)::int AS n
           FROM ad_script s JOIN ad_variant v ON v.id = s.variant_id
          WHERE v.batch_id = $1`,
        [batchId],
      );
      expect(scripts[0]?.n).toBe(variantCount);
    },
  );
});
