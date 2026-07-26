// VERIFIER T5.18 — config AISLADA (no toca apps/web/e2e). Levanta el MISMO stack e2e
// (e2e-stack.ts: Postgres testcontainer + web:3100 + worker + fake-fal $0) en un PROCESO
// FRESCO, y corre SOLO el spec de T5.18 → el «doom» global del fake (primer submit de
// IMAGEN del proceso) cae en el N7a de NUESTRO run, sin competir con la suite de fases.
//
// reuseExistingServer:false — un stack reusado podría haber quemado ya su doom.
// El webServer corre con cwd = apps/web (donde vive e2e-stack.ts y su node_modules).
import { defineConfig, devices } from '@playwright/test';

const APPS_WEB = '/Users/carlosvillu/Developer/__GARBAGE__/UGC_Ads/apps/web';

export default defineConfig({
  testDir: '/Users/carlosvillu/Developer/__GARBAGE__/UGC_Ads/docs/verifications/T5.18',
  testMatch: /t518-cancel-retry-compose\.spec\.ts/,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    testIdAttribute: 'data-testid',
  },
  webServer: {
    command: 'pnpm exec tsx scripts/e2e-stack.ts',
    cwd: APPS_WEB,
    port: 3100,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
