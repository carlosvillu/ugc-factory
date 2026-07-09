// Setup project (e2e.md §5): login UNA vez y persistir la sesión en storageState;
// el resto de specs la reutilizan (T0.4 limita el login por IP/ventana, loguear
// por test se bloquearía a sí mismo). El spec de auth negativa/rate-limit corre
// SIN este storageState (lo sobreescribe).
import { test as setup, expect } from '@playwright/test';

// Debe coincidir con AUTH_BOOTSTRAP_PASSWORD del stack (scripts/e2e-stack.ts).
const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password';

setup('login y persistir sesión', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/contraseña/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();

  // El login redirige a la home; el proxy la deja pasar con la cookie ya presente.
  await expect(page).toHaveURL('/');
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
