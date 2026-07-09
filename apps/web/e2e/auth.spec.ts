// Regresión permanente de las TRES cláusulas de la Verificación de T0.4 (e2e.md
// §5). Estos specs arrancan DESLOGUEADOS (sobreescriben el storageState del setup)
// porque prueban el propio flujo de login.
//
// Aislamiento del rate limiter (in-memory por IP/ventana, e2e.md §12): cada test
// que toca /api/login usa un `x-forwarded-for` ÚNICO vía extraHTTPHeaders, así los
// buckets no se cruzan bajo fullyParallel; la ventana corta del stack
// (LOGIN_WINDOW_MS) es el backstop. Cero waitForTimeout: se espera por condición
// observable (web-first assertions).
import { test, expect } from '@playwright/test';

const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password';

test.describe('auth single-user (T0.4)', () => {
  // Sin sesión: el proxy protege las páginas.
  test.describe('sin sesión', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('acceder a / sin sesión redirige a /login', { tag: ['@f0'] }, async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible();
    });
  });

  // Rate limit: 3 passwords incorrectos → Alert visible. IP propia para no
  // contaminar otros tests.
  test.describe('rate limit', () => {
    test.use({
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.10' },
    });

    test(
      'password incorrecto 3 veces muestra el aviso de rate limit',
      { tag: ['@f0'] },
      async ({ page }) => {
        await page.goto('/login');
        const password = page.getByLabel(/contraseña/i);
        const entrar = page.getByRole('button', { name: /entrar/i });
        // El Alert del DS lleva data-slot="alert" (atributo de contrato existente
        // del componente, que testing/CUA ya consultan). Se filtra por él para no
        // colisionar con el route-announcer de Next (también role="alert").
        const alert = page.locator('[data-slot="alert"]');

        // Intentos 1 y 2 (max=2): 401 → "Contraseña incorrecta".
        for (let i = 0; i < 2; i++) {
          await password.fill('contraseña-incorrecta');
          await entrar.click();
          await expect(alert).toContainText(/contraseña incorrecta/i);
        }

        // 3.er intento: el rate limit ya bloquea → 429 → aviso de rate limit.
        await password.fill('contraseña-incorrecta');
        await entrar.click();
        await expect(alert).toContainText(/demasiados intentos/i);
      },
    );
  });

  // Login correcto + persistencia de sesión tras reload. IP propia.
  test.describe('login correcto', () => {
    test.use({
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.20' },
    });

    test(
      'password correcto entra a / y la sesión sobrevive a un reload',
      { tag: ['@f0'] },
      async ({ page }) => {
        await page.goto('/login');
        await page.getByLabel(/contraseña/i).fill(PASSWORD);
        await page.getByRole('button', { name: /entrar/i }).click();

        // Entra a la home (el heading de marca "UGC Factory" existe en ambos
        // paneles; en la home hay un h1 con ese texto).
        await expect(page).toHaveURL('/');
        await expect(page.getByRole('heading', { name: /ugc factory/i })).toBeVisible();

        // La cookie ugc_session sobrevive a un reload: recargar NO vuelve a login.
        await page.reload();
        await expect(page).toHaveURL('/');
        await expect(page.getByRole('heading', { name: /ugc factory/i })).toBeVisible();
      },
    );
  });
});
