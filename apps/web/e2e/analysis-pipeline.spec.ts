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
//   1. Intake por URL → N1/N2/N3 progresan en el canvas EN VIVO y el brief JSON aparece
//      como output de N3 en el panel genérico.
//   2. Texto libre SIN imágenes → N2 aparece `skipped` en el grafo (PRD §7.1/§7.2: el
//      nodo no aplicable), y el run COMPLETA igualmente (N3 sigue: un nodo saltado
//      satisface la dependencia).
import { test, expect } from '@playwright/test';
import {
  canvasNode as node,
  waitCanvasStatus as waitStatus,
  openCanvasPanel as openPanel,
} from './support/canvas';

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
      await waitStatus(page, 'N3', 'succeeded'); // síntesis + validación determinista

      // El brief JSON está como OUTPUT de N3 en el panel genérico (§8.2). OJO: el panel
      // muestra un EXCERPT (recorte) del artefacto, no el jsonb entero — así que se
      // asserta sobre lo que el recorte SÍ contiene, y que además es reconocible del
      // brief y de ningún otro nodo: la clave `brief` y el bloque `meta` del Apéndice A
      // (con su `extraction_confidence`). Un output vacío, el de N1 (RawContent) o el de
      // N2 (VisualAnalysis) NO pasarían estos asserts.
      const panel = await openPanel(page, 'N3');
      const output = panel.getByLabel('Output del paso');
      await expect(output).toContainText('"brief"', { timeout: 15_000 });
      await expect(output).toContainText('extraction_confidence');
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

      // Y el run NO se queda varado: `skipped` satisface la dep (T0.8) y N3 sintetiza
      // igual, solo con el texto. Sin este assert, un `skipped` que bloqueara el
      // pipeline pasaría por bueno.
      await waitStatus(page, 'N3', 'succeeded');

      // El panel explica POR QUÉ se saltó (no un hueco): el motivo quedó en output_refs.
      const panel = await openPanel(page, 'N2');
      await expect(panel.getByLabel('Output del paso')).toContainText(/no_analyzable_visuals/, {
        timeout: 15_000,
      });
    },
  );
});
