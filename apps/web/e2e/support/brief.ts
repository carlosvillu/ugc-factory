// Helpers de CP1 (el editor de brief), compartidos por los specs que lo miran (e2e.md §7).
//
// Existe por la misma razón que `support/canvas.ts` (léase su cabecera): el CONTRATO DE
// TESTABILIDAD del editor —su accessible name, el id de la fila del brief anclado en el DOM, la
// forma de la respuesta de `/api/briefs/:id`— estaba escrito TRES veces (brief-editor.spec.ts,
// phases/f1-brief.spec.ts, analysis-pipeline.spec.ts), y `getBrief`/`fetchBrief` eran la MISMA
// función con dos nombres y dos declaraciones del tipo. Duplicado, el día que cambie el contrato
// uno de los tres se queda atrás y el fallo sale como un timeout OPACO de Playwright, no como
// "cambió el contrato".
import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** El formulario de CP1. Su accessible name ES el contrato de testabilidad del editor. */
export function briefEditor(page: Page) {
  return page.getByRole('form', { name: /editor de brief/i });
}

/**
 * El id de la FILA `product_brief` que el editor está mostrando — anclado en el DOM del form
 * (`data-brief-id`) justo para que el test pueda direccionar el brief por la API y comprobar el
 * VERSIONADO, que es la mitad de lo que la Verificación exige ver.
 */
export async function briefIdOf(page: Page): Promise<string> {
  const id = await briefEditor(page).getAttribute('data-brief-id');
  expect(id, 'el editor de CP1 debe anclar el id de la fila del brief').toBeTruthy();
  return id ?? '';
}

/** La respuesta de `GET /api/briefs/:id` (Apéndice E). `brief` se tipa solo en lo que los specs
 *  miran: los campos que se editan en CP1. */
export interface BriefApiResponse {
  id: string;
  version: number;
  editedByUser: boolean;
  status: string;
  brief: {
    product: { name: string };
    benefits: { benefit: string }[];
    angles: { hook_examples: string[] }[];
  };
}

export async function fetchBrief(
  request: APIRequestContext,
  briefId: string,
): Promise<BriefApiResponse> {
  const res = await request.get(`/api/briefs/${briefId}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as BriefApiResponse;
}

/** Arranca un análisis por URL y espera a que CP1 tome la vista (N3 pausa en el checkpoint). */
export async function runUrlAnalysisToCp1(page: Page): Promise<void> {
  await page.goto('/analyses/new');
  await page
    .getByRole('textbox', { name: /url del producto/i })
    .fill('https://glow.example/products/serum');
  await page.getByRole('button', { name: /analizar/i }).click();
  await page.waitForURL(/\/runs\/[^/]+$/, { timeout: 30_000 });
  await expect(briefEditor(page)).toBeVisible({ timeout: 90_000 });
}

/** Arranca un análisis por TEXTO LIBRE sin imágenes (el camino que dispara la petición
 *  bloqueante de imágenes: sin fotos, el brief no tiene hero y el validador delega en CP1). */
export async function runManualAnalysisToCp1(page: Page): Promise<void> {
  await page.goto('/analyses/new');
  await page.getByRole('tab', { name: /texto libre/i }).click();
  await page
    .getByRole('textbox', { name: /descripción del producto/i })
    .fill(
      'Sérum hidratante con ácido hialurónico y niacinamida para piel sensible. ' +
        'Hidratación clínica durante 24 horas, sin fragancia ni alcohol.',
    );
  // NO se sube ninguna imagen: eso es lo que deja al brief sin hero.
  await page.getByRole('button', { name: /analizar/i }).click();
  await page.waitForURL(/\/runs\/[^/]+$/, { timeout: 30_000 });
  await expect(briefEditor(page)).toBeVisible({ timeout: 90_000 });
}
