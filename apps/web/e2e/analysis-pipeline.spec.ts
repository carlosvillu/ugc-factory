// Regresión permanente del PIPELINE DE ANÁLISIS (T1.10a, e2e.md §9, regla 10 — DoD
// BLOQUEANTE): ejercita el sistema COMPLETO (web + worker + orquestador + pg-boss + SSE +
// React Flow) con los nodos REALES N1 (ingesta) → N2 (visión) → N3 (síntesis+validación).
//
// SIN GASTAR UN CÉNTIMO: el stack E2E levanta un servidor HTTP local que finge
// Firecrawl/Jina/Anthropic (startFakeExternalApis) y apunta los clientes ahí vía
// *_BASE_URL. El fake emite lo que emiten los productores REALES (reutiliza los fixtures
// de Firecrawl v2 y las factories `makeBrief`/`makeVisualAnalysis`), no payloads cómodos
// — la lección de T1.8/T1.9.
//
// Cubre las dos observables de la Verificación:
//   1. Intake por URL → N1/N2/N3 progresan en el canvas EN VIVO y el brief aparece en CP1.
//   2. Texto libre SIN imágenes → N2 aparece `skipped` en el grafo (PRD §7.1/§7.2: el
//      nodo no aplicable), y el run avanza igualmente (N3 sigue: un nodo saltado
//      satisface la dependencia).
//
// ACTUALIZADO EN T1.10b — CAMBIO DE CONTRATO, no relajación del test: N3 pasó a ser el
// CHECKPOINT de CP1 (`isCheckpoint: true` en analysis-dag.ts). Ya NO termina en `succeeded`
// por su cuenta: PAUSA en `waiting_approval` con el brief en su `output_refs`, esperando al
// usuario. Los asserts que decían `N3 succeeded` ahora dicen `N3 waiting_approval` y siguen
// hasta la aprobación — que es lo que el sistema hace de verdad desde esta tarea. Afirmar
// `succeeded` sería afirmar algo que ya no es cierto.
import { test, expect } from '@playwright/test';
import { canvasNode as node, waitCanvasStatus as waitStatus } from './support/canvas';

// Los node_key del DAG de análisis son PLANOS (`N1`/`N2`/`N3`), a diferencia de los del DAG
// de demo (`demo.canvas.NX`) — los helpers del canvas toman el node_key completo.

test.describe('pipeline de análisis N1→N2→N3 (T1.10a)', () => {
  test(
    'intake por URL: los nodos progresan en vivo y el brief aparece como output de N3',
    { tag: ['@f1'] },
    async ({ page }) => {
      // El camino principal del producto: pegar una URL y darle a Analizar.
      await page.goto('/analyses/new');

      // «Desde URL» es la pestaña por DEFECTO (no hay que clicarla).
      await expect(page.getByRole('tab', { name: /desde url/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page
        .getByRole('textbox', { name: /url del producto/i })
        .fill('https://glow.example/products/serum');
      await page.getByRole('button', { name: /analizar/i }).click();

      // El submit arranca el run y navega al CANVAS en vivo.
      await page.waitForURL(/\/runs\/[^/]+$/, { timeout: 30_000 });

      // Los tres nodos del DAG aparecen y progresan por SSE, sin recargar.
      await expect(node(page, 'N1')).toBeVisible({ timeout: 30_000 });
      await waitStatus(page, 'N1', 'succeeded'); // ingesta (scrape del Firecrawl falso)
      await waitStatus(page, 'N2', 'succeeded'); // visión (hay imágenes → NO se salta)

      // T1.10b: N3 sintetiza y PAUSA (es el checkpoint de CP1). El editor de brief toma la
      // vista con el brief REAL cargado — no un editor vacío, que es lo que salía antes del
      // fix de `reach_checkpoint` (que no persistía `output_refs` al pausar).
      const editor = page.getByRole('form', { name: /editor de brief/i });
      await expect(editor).toBeVisible({ timeout: 30_000 });

      // El brief está cargado de verdad: sus campos editables traen contenido (no huecos).
      await expect(editor.getByLabel('Beneficio 1')).not.toHaveValue('');

      // Aprobar sin editar reanuda el run y N3 queda `succeeded`.
      await editor.getByRole('button', { name: /aprobar y continuar/i }).click();
      await waitStatus(page, 'N3', 'succeeded');
    },
  );

  test(
    'texto libre SIN imágenes: N2 aparece `skipped` en el grafo y el run completa',
    { tag: ['@f1'] },
    async ({ page }) => {
      // El caso canónico de `skipped` del PRD (§7.1: "nodo no aplicable, p. ej. N2 sin
      // imágenes"; §7.2, ficha de N2: "si no hay ninguna → skipped").
      await page.goto('/analyses/new');
      await page.getByRole('tab', { name: /texto libre/i }).click();

      await page
        .getByRole('textbox', { name: /descripción del producto/i })
        .fill(
          'Sérum hidratante con ácido hialurónico y niacinamida para piel sensible. ' +
            'Hidratación clínica durante 24 horas, sin fragancia ni alcohol.',
        );
      // NO se sube ninguna imagen: eso es lo que hace a N2 inaplicable.
      await page.getByRole('button', { name: /analizar/i }).click();

      // El texto libre también arranca el DAG (si no, no habría grafo donde ver el skip).
      await page.waitForURL(/\/runs\/[^/]+$/, { timeout: 30_000 });

      await expect(node(page, 'N1')).toBeVisible({ timeout: 30_000 });
      await waitStatus(page, 'N1', 'succeeded'); // N1 en modo manual: NO scrapea, carga

      // LA OBSERVABLE: N2 se autodeclara inaplicable → `skipped` en el grafo.
      await waitStatus(page, 'N2', 'skipped');

      // El grafo explica POR QUÉ se saltó (no un hueco): el motivo quedó en `output_refs` y el
      // nodo lo muestra. Se asserta sobre el NODO y no sobre el inspector porque mientras CP1
      // está abierto el inspector genérico se retira (el artefacto que importa es el brief) —
      // pero el CANVAS SIGUE MONTADO, así que el motivo del skip nunca deja de ser observable.
      await expect(node(page, 'N2').locator('[data-slot="node-output"]')).toContainText(
        /no_analyzable_visuals/,
        { timeout: 15_000 },
      );

      // Y el run NO se queda varado: `skipped` satisface la dep (T0.8) y N3 sintetiza igual,
      // solo con el texto. T1.10b: N3 no acaba en `succeeded` por su cuenta — es el checkpoint
      // de CP1, así que la prueba de que N3 CORRIÓ es que el editor de brief aparece con su
      // brief. Un `skipped` que bloqueara el pipeline dejaría el canvas parado y esto fallaría.
      const editor = page.getByRole('form', { name: /editor de brief/i });
      await expect(editor).toBeVisible({ timeout: 60_000 });

      // Y el canvas SIGUE AHÍ con CP1 abierto (el pipeline no se vuelve ciego en el checkpoint).
      await expect(node(page, 'N2')).toBeVisible();
    },
  );
});
