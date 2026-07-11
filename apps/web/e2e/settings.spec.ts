// Regresión permanente de T0.14 (e2e.md §10, DoD BLOQUEANTE). Cubre, contra el stack
// completo levantado, lo que el usuario hace con las manos en /settings:
//   · guardar/editar un SECRETO con clave DUMMY (no hay provider real en F0): la key se
//     enmascara (nunca en claro), el input vuelve a vacío, y la persistencia sobrevive a
//     un reload (está cifrada en app_setting — el cifrado at-rest lo cubre la integración
//     de BD, aquí solo el comportamiento de UI + persistencia).
//   · APARIENCIA: cambiar tema/acento/densidad estampa data-* en <html> EN VIVO y PERSISTE
//     tras un reload (cookie leída por el layout en el servidor — sin flash).
//
// El stack NO siembra FAL_KEY (e2e-stack.ts): /settings arranca sin credenciales, así que
// el spec posee el estado. Serial: un recorrido con estado acumulado.
import { test, expect } from '@playwright/test';

const DUMMY_FAL_KEY = 'dummy-fal-key-e2e-abcd1234';

test.describe.configure({ mode: 'serial' });

test.describe('/settings (T0.14)', () => {
  test(
    'guardar una API key la enmascara, limpia el input y persiste tras reload',
    {
      tag: ['@f0'],
    },
    async ({ page }) => {
      await page.goto('/settings');

      const falInput = page.getByLabel('fal.ai');
      await expect(falInput).toHaveValue(''); // write-only: arranca vacío
      await expect(falInput).toHaveAttribute('type', 'password');

      // Guardar una key dummy.
      await falInput.fill(DUMMY_FAL_KEY);
      await page.getByRole('button', { name: /guardar ajustes/i }).click();

      // Confirmación + el input vuelve a vacío (jamás eco del valor).
      await expect(page.getByRole('status')).toContainText(/guardad/i);
      await expect(falInput).toHaveValue('');

      // La key NUNCA aparece en claro en la página (assert de seguridad).
      await expect(page.getByText(DUMMY_FAL_KEY)).toHaveCount(0);

      // Reload: la key persiste (cifrada en BD) — el placeholder ahora muestra los últimos
      // 4 chars de la key guardada, y el valor en claro sigue sin aparecer.
      await page.reload();
      const falAfter = page.getByLabel('fal.ai');
      await expect(falAfter).toHaveValue('');
      await expect(falAfter).toHaveAttribute('placeholder', new RegExp(DUMMY_FAL_KEY.slice(-4)));
      await expect(page.getByText(DUMMY_FAL_KEY)).toHaveCount(0);
    },
  );

  test(
    'editar la key la reemplaza (nuevo last4 tras guardar)',
    { tag: ['@f0'] },
    async ({ page }) => {
      await page.goto('/settings');
      await page.getByLabel('fal.ai').fill('dummy-fal-key-rotated-wxyz');
      await page.getByRole('button', { name: /guardar ajustes/i }).click();
      await expect(page.getByRole('status')).toContainText(/guardad/i);

      await page.reload();
      await expect(page.getByLabel('fal.ai')).toHaveAttribute('placeholder', /wxyz/);
    },
  );

  test(
    'tema, acento y densidad se aplican en vivo y persisten tras reload',
    {
      tag: ['@f0'],
    },
    async ({ page }) => {
      await page.goto('/settings');
      const html = page.locator('html');

      // En vivo: cada switcher estampa el data-* correspondiente en <html>.
      await page
        .getByRole('group', { name: 'Tema' })
        .getByRole('button', { name: 'light' })
        .click();
      await expect(html).toHaveAttribute('data-theme', 'light');

      await page
        .getByRole('group', { name: 'Acento' })
        .getByRole('button', { name: 'emerald' })
        .click();
      await expect(html).toHaveAttribute('data-accent', 'emerald');

      await page
        .getByRole('group', { name: 'Densidad' })
        .getByRole('button', { name: 'compact' })
        .click();
      await expect(html).toHaveAttribute('data-density', 'compact');

      // Persistencia: reload → el layout lee la cookie en el servidor y re-estampa <html>
      // (sin flash). Los tres atributos siguen presentes tras la recarga.
      await page.reload();
      await expect(html).toHaveAttribute('data-theme', 'light');
      await expect(html).toHaveAttribute('data-accent', 'emerald');
      await expect(html).toHaveAttribute('data-density', 'compact');

      // Restaurar los defaults para no arrastrar la cookie a otros specs (el layout la lee
      // en TODA página): volver a dark/indigo/balanced limpia los data-*.
      await page.getByRole('group', { name: 'Tema' }).getByRole('button', { name: 'dark' }).click();
      await page
        .getByRole('group', { name: 'Acento' })
        .getByRole('button', { name: 'indigo' })
        .click();
      await page
        .getByRole('group', { name: 'Densidad' })
        .getByRole('button', { name: 'balanced' })
        .click();
      await expect(html).not.toHaveAttribute('data-theme', /.+/);
      await page.reload();
      await expect(html).not.toHaveAttribute('data-theme', /.+/);
    },
  );
});
