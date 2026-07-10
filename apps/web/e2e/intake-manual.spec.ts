// Regresión permanente de T1.6 (e2e.md §9/§10, DoD BLOQUEANTE): el intake por TEXTO
// LIBRE en navegador real contra el stack completo (Next + Postgres del testcontainer),
// SIN APIs externas (el modo manual hace short-circuit: texto → RawContent sintético →
// url_analysis en `done`, cero scraping). Cubre:
//  - envío de texto SIN imágenes → aterriza en el análisis creado (status done, source manual);
//  - envío de texto CON imágenes (fixtures locales) → las imágenes aparecen en el análisis;
//  - validación visible del formulario (texto demasiado corto → error, no navega);
//  - reutilización OBSERVABLE: un 2.º envío del MISMO texto aterriza en el MISMO id de
//    análisis (la señal de navegador de que la caché §7.4 se reutilizó).
//
// El proyecto lo resuelve la propia página (`ensureDefaultProject`): no hace falta seed.
// La sesión la hereda del storageState (auth.setup.ts).
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

// Fixtures de imagen locales (packages/test-utils/fixtures/media): PNGs válidos mínimos.
const REF_A = fileURLToPath(
  new URL('../../../packages/test-utils/fixtures/media/intake-ref-a.png', import.meta.url),
);
const REF_B = fileURLToPath(
  new URL('../../../packages/test-utils/fixtures/media/intake-ref-b.png', import.meta.url),
);

// Texto único por ejecución (evita colisión de caché entre reruns sobre la misma BD
// del stack). Suficientemente largo para pasar la validación (min 20 chars).
function uniqueText(tag: string): string {
  return `Sérum hidratante con ácido hialurónico para piel sensible — ${tag} ${String(Date.now())}-${String(Math.random()).slice(2)}`;
}

test.describe('intake manual por texto libre (T1.6)', () => {
  test(
    'validación visible: un texto demasiado corto muestra error y no navega',
    { tag: ['@f1'] },
    async ({ page }) => {
      await page.goto('/analyses/new');
      await page.getByRole('textbox', { name: /descripción del producto/i }).fill('corto');
      await page.getByRole('button', { name: /analizar/i }).click();

      // El error de campo es visible (se localiza por su texto, no por role="alert":
      // Next monta su propio announcer role="alert" vacío → getByRole sería ambiguo).
      await expect(page.getByText(/al menos 20 caracteres/i)).toBeVisible();
      await expect(page).toHaveURL(/\/analyses\/new$/); // no navegó al análisis
    },
  );

  test(
    'envío SÓLO texto (sin imágenes) crea el análisis manual en `done`',
    { tag: ['@f1'] },
    async ({ page }) => {
      const text = uniqueText('sin-imgs');
      await page.goto('/analyses/new');
      await page.getByRole('textbox', { name: /descripción del producto/i }).fill(text);
      await page.getByRole('button', { name: /analizar/i }).click();

      // Aterriza en /analyses/:id (el id es la señal observable). El análisis es manual y `done`.
      await expect(page).toHaveURL(/\/analyses\/[0-9A-HJKMNP-TV-Z]{26}$/);
      await expect(page.getByTestId('analysis-status')).toHaveText('done');
      await expect(page.getByText(text)).toBeVisible();
    },
  );

  test(
    'envío CON imágenes (fixtures locales) adjunta las referencias al análisis',
    { tag: ['@f1'] },
    async ({ page }) => {
      const text = uniqueText('con-imgs');
      await page.goto('/analyses/new');
      await page.getByRole('textbox', { name: /descripción del producto/i }).fill(text);

      // Sube 2 imágenes reales (fixtures locales); el input las manda a /api/assets.
      await page.getByLabel(/añadir imágenes/i).setInputFiles([REF_A, REF_B]);
      // Ambas quedan listadas (por su nombre de fichero) antes de enviar.
      await expect(page.getByRole('button', { name: /quitar intake-ref-a\.png/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /quitar intake-ref-b\.png/i })).toBeVisible();

      await page.getByRole('button', { name: /analizar/i }).click();

      await expect(page).toHaveURL(/\/analyses\/[0-9A-HJKMNP-TV-Z]{26}$/);
      // El análisis muestra las 2 imágenes de referencia (sus URLs de descarga).
      await expect(
        page.getByRole('heading', { name: /imágenes de referencia \(2\)/i }),
      ).toBeVisible();
    },
  );

  test(
    'reutilización observable: reenviar el MISMO texto aterriza en el MISMO análisis',
    { tag: ['@f1'] },
    async ({ page }) => {
      const text = uniqueText('reuse');

      // 1.er envío: se crea el análisis; capturamos su id de la URL.
      await page.goto('/analyses/new');
      await page.getByRole('textbox', { name: /descripción del producto/i }).fill(text);
      await page.getByRole('button', { name: /analizar/i }).click();
      await expect(page).toHaveURL(/\/analyses\/[0-9A-HJKMNP-TV-Z]{26}$/);
      const firstId = page.url().split('/').pop()!;

      // 2.º envío del MISMO texto: la caché §7.4 se reutiliza → MISMO id de destino.
      await page.goto('/analyses/new');
      await page.getByRole('textbox', { name: /descripción del producto/i }).fill(text);
      await page.getByRole('button', { name: /analizar/i }).click();
      await expect(page).toHaveURL(`/analyses/${firstId}`);
      // Y el id mostrado en la página coincide (señal doble).
      await expect(page.getByTestId('analysis-id')).toHaveText(firstId);
    },
  );
});
