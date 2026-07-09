// Backfill de FD (nota "Regresión Playwright posterior" del planning): /design-system
// abre y los switchers de tema/acento/densidad siguen operables. NO reabre TD.7:
// solo protege que la página cargue y los controles reaccionen. Corre bajo el
// storageState del setup (logueado): /design-system está protegida por el proxy.
//
// Selección por ROL, nunca por CSS (e2e.md §12): los switchers son
// `role="group"` con aria-label "Tema"/"Acento"/"Densidad" y botones cuyo texto
// es el valor. El efecto observable es el atributo data-* estampado en <html>.
import { test, expect } from '@playwright/test';

test.describe('design system (FD backfill)', () => {
  test('/design-system abre y muestra los tres switchers', { tag: ['@f0'] }, async ({ page }) => {
    await page.goto('/design-system');
    await expect(page.getByRole('group', { name: 'Tema' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Acento' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Densidad' })).toBeVisible();
  });

  test(
    'el switcher de tema estampa data-theme=light y vuelve a dark',
    { tag: ['@f0'] },
    async ({ page }) => {
      await page.goto('/design-system');
      const html = page.locator('html');
      const tema = page.getByRole('group', { name: 'Tema' });

      // dark es el default (sin atributo). Elegir light lo estampa; volver a dark lo limpia.
      await tema.getByRole('button', { name: 'light' }).click();
      await expect(html).toHaveAttribute('data-theme', 'light');
      await tema.getByRole('button', { name: 'dark' }).click();
      await expect(html).not.toHaveAttribute('data-theme', /.+/);
    },
  );

  test(
    'el switcher de acento estampa data-accent y vuelve a indigo',
    { tag: ['@f0'] },
    async ({ page }) => {
      await page.goto('/design-system');
      const html = page.locator('html');
      const acento = page.getByRole('group', { name: 'Acento' });

      await acento.getByRole('button', { name: 'emerald' }).click();
      await expect(html).toHaveAttribute('data-accent', 'emerald');
      await acento.getByRole('button', { name: 'indigo' }).click();
      await expect(html).not.toHaveAttribute('data-accent', /.+/);
    },
  );

  test(
    'el switcher de densidad estampa data-density y vuelve a balanced',
    { tag: ['@f0'] },
    async ({ page }) => {
      await page.goto('/design-system');
      const html = page.locator('html');
      const densidad = page.getByRole('group', { name: 'Densidad' });

      await densidad.getByRole('button', { name: 'compact' }).click();
      await expect(html).toHaveAttribute('data-density', 'compact');
      await densidad.getByRole('button', { name: 'balanced' }).click();
      await expect(html).not.toHaveAttribute('data-density', /.+/);
    },
  );
});
