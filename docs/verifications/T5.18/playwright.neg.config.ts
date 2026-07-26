// CONTROL NEGATIVO T5.18 — misma infra que playwright.t518.config.ts, otro spec.
import { defineConfig, devices } from '@playwright/test';

const APPS_WEB = '/Users/carlosvillu/Developer/__GARBAGE__/UGC_Ads/apps/web';

export default defineConfig({
  testDir: '/Users/carlosvillu/Developer/__GARBAGE__/UGC_Ads/docs/verifications/T5.18',
  testMatch: /t518-negative-control\.spec\.ts/,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'off',
    screenshot: 'off',
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
