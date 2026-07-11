// Helpers del CANVAS del run, compartidos por los specs que lo miran (e2e.md §7).
//
// El contrato de testabilidad del canvas —`role=article` con el `node_key` en el accessible
// name, el estado CRUDO en `data-status`, el panel como `role=complementary`— estaba escrito
// DOS veces (runs-canvas.spec.ts y analysis-pipeline.spec.ts), con la única diferencia del
// prefijo del node_key. Duplicado, el día que cambie un rol uno de los dos se queda atrás y
// el fallo sale como un timeout opaco de Playwright, no como "cambió el contrato".
//
// Los helpers toman el `node_key` COMPLETO (el DAG de demo usa `demo.canvas.NX`; el de
// análisis usa `N1`/`N2`/`N3` planos): el prefijo es de quien llama, no de aquí.
import { expect, type Page } from '@playwright/test';

/** Un nodo del canvas por su `node_key` completo. */
export function canvasNode(page: Page, nodeKey: string) {
  return page.getByRole('article', { name: new RegExp(`\\b${nodeKey}\\b`) });
}

/** Espera a que un nodo alcance un `data-status` concreto (el estado CRUDO de §7.1). Es el
 *  mecanismo del cambio EN VIVO por SSE: sin reload. Timeout holgado — hay trabajo real
 *  detrás (el worker duerme, scrapea o llama al modelo). */
export async function waitCanvasStatus(
  page: Page,
  nodeKey: string,
  status: string,
  timeout = 60_000,
): Promise<void> {
  await expect(canvasNode(page, nodeKey)).toHaveAttribute('data-status', status, { timeout });
}

/** Abre el panel de un nodo (click) y devuelve el aside del inspector. */
export async function openCanvasPanel(page: Page, nodeKey: string) {
  await canvasNode(page, nodeKey).click();
  return page.getByRole('complementary', { name: new RegExp(`\\b${nodeKey}\\b`) });
}
