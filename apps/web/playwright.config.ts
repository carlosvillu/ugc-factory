// playwright.config.ts (e2e.md §3). Solo Chromium (herramienta mono-usuario). El
// webServer arranca el stack completo (Postgres testcontainer + web en :3100) vía
// tsx; Playwright espera al puerto 3100 antes de correr specs. Auth una sola vez
// en un setup project → storageState reutilizado (e2e.md §5).
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3100';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000, // arranque en frío del stack + navegación; el default de 30 s se queda corto
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI, // un .only olvidado no desactiva la suite en CI
  retries: process.env.CI ? 2 : 0, // en local, un test que necesita retry es un bug a arreglar
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    testIdAttribute: 'data-testid',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'], // todos los specs (salvo los que sobreescriben storageState) arrancan logueados
    },
  ],
  webServer: {
    command: 'pnpm exec tsx scripts/e2e-stack.ts', // tsx obligatorio: @ugc/test-utils es TS sin build (§2)
    port: 3100,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000, // pull de imagen pg16 + arranque en frío de next dev
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
