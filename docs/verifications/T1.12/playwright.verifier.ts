// T1.12 · config del VERIFIER. Reutiliza el webServer del stack E2E (fakes ⇒ $0) y el
// storageState de auth, pero apunta testDir a docs/verifications/T1.12/. No modifica
// apps/web/playwright.config.ts (el verifier no toca código de producto ni sus tests).
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    testIdAttribute: 'data-testid',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, testDir: '../../../apps/web/e2e' },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: '../../../apps/web/e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'pnpm exec tsx scripts/e2e-stack.ts',
    cwd: '../../../apps/web',
    port: 3100,
    reuseExistingServer: true,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
