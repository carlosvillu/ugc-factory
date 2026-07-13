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
      // `spend.spec.ts` NO corre aquí: tiene proyecto propio (ver abajo).
      testIgnore: /spend\.spec\.ts/,
    },
    // ── T1.19: el ledger de gasto es GLOBAL, así que su spec necesita EXCLUSIVIDAD ────────
    //
    // `/spend` suma `cost_entry` ENTERA (sin filtro de mes ni de project: ver
    // `getSpendSummary`), y `spend.spec.ts` asserta sumas EXACTAS. Desde T1.10a hay OTROS
    // specs que escriben coste de verdad mientras corren (los del pipeline de análisis:
    // N1/N2/N3 registran créditos de Firecrawl y tokens de Anthropic contra las APIs
    // falsas). Su `beforeAll` intentaba resolverlo con un `DELETE FROM cost_entry`, pero eso
    // NO es exclusividad: bajo `fullyParallel` los otros ficheros corren en OTROS workers y
    // siguen insertando DESPUÉS del DELETE. Medido en T1.19: 2 de 5 pasadas rojas con
    // «Anthropic … $1.17» donde el spec sembró $0.99 — los 18 céntimos de un run de análisis
    // concurrente. Segundo flaky del gate, mismo pecado que el de autopilot: una premisa
    // ("poseo el ledger") sostenida por suerte de ordenación.
    //
    // FIX sin rebajar un solo assert ni serializar la suite: proyecto PROPIO que DEPENDE de
    // `chromium` ⇒ arranca cuando los 53 tests que escriben coste YA han terminado, y su
    // DELETE+seed pasa a ser cierto por CONSTRUCCIÓN. Los demás specs conservan su
    // paralelismo completo; el coste es que 3 tests rápidos corren al final.
    {
      name: 'spend',
      testMatch: /spend\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['chromium'],
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
