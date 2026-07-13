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
import { apiCall } from './http';

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
    /** T1.15: la Verificación observa que el hero del brief APROBADO es la imagen que el usuario
     *  promovió en CP1 — el artefacto, no solo la decisión. */
    assets: { hero_image_url: string | null; images: { url: string }[] };
  };
}

export async function fetchBrief(
  request: APIRequestContext,
  briefId: string,
): Promise<BriefApiResponse> {
  // `apiCall`: reintenta SOLO el corte de transporte del `next dev` local (T1.19, support/http.ts).
  const res = await apiCall(
    () => request.get(`/api/briefs/${briefId}`),
    `GET /api/briefs/${briefId}`,
  );
  expect(res.ok()).toBe(true);
  return (await res.json()) as BriefApiResponse;
}

/**
 * El id del STEP del checkpoint que el editor tiene delante (`data-step-id`) — el mismo ancla
 * que `briefIdOf`, y por la misma razón: la Verificación de T1.11 exige comprobar en la BD que la
 * DECISIÓN quedó «asociada al step del checkpoint», y sin este id el test tendría que adivinarlo
 * reconstruyendo el stream SSE.
 */
export async function stepIdOf(page: Page): Promise<string> {
  const id = await briefEditor(page).getAttribute('data-step-id');
  expect(id, 'el editor de CP1 debe anclar el id de su step').toBeTruthy();
  return id ?? '';
}

/**
 * Arranca un análisis por URL y espera a que CP1 tome la vista (N3 pausa en el checkpoint).
 *
 * La `url` PARAMETRIZA el fixture que el fake de síntesis devuelve (`fake-apis.ts` discrimina por
 * ella), no el flujo — que es el mismo siempre. Con `FAKE_URL_NO_HERO` es el caso de T1.15: una
 * web de SERVICIO con imágenes pero ninguna que sirva de hero (el caso `es.stayforlong.com`, donde
 * Haiku clasificó honestamente las 3 que había como `broll`/`unusable`). Hasta T1.15 ese run MORÍA
 * en N3 con la síntesis ya pagada; ahora llega a CP1 y el usuario decide.
 *
 * Un SEGUNDO helper con el mismo goto/fill/click/waitForURL y otra URL era justo la copia-con-
 * variación contra la que avisa la cabecera de este fichero: cambiar el intake (ruta, label del
 * campo, nombre del botón) obligaría a tocar los dos, y el que se olvide falla como un timeout
 * opaco de Playwright.
 *
 * OJO: el `toBeVisible` del editor es LA PRIMERA CLÁUSULA, implícita — si un run muriera en N3
 * (el bug que T1.15 arregla), es este assert el que falla, y falla por la razón correcta.
 */
export async function runUrlAnalysisToCp1(
  page: Page,
  url = 'https://glow.example/products/serum',
): Promise<void> {
  await page.goto('/analyses/new');
  await page.getByRole('textbox', { name: /url del producto/i }).fill(url);
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
