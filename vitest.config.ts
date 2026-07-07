// vitest.config.ts (raíz del monorepo) — testing/references/stack-setup.md §3.1
// Cada paquete aporta un proyecto unit (vitest.config.ts) y, si toca Postgres,
// otro integration (vitest.config.integration.ts — llegan en T0.3).
// Los proyectos transversales live y worker:media quedan VACÍOS salvo opt-in por
// env: `vitest run` a secas nunca los arrastra.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      '{packages,apps}/*/vitest.config.ts',
      '{packages,apps}/*/vitest.config.integration.ts',
      {
        test: {
          name: 'live',
          include: process.env.RUN_LIVE ? ['**/*.live.test.ts'] : [],
          exclude: ['**/node_modules/**'],
          setupFiles: ['@ugc/test-utils/setup-env'],
          // globalSetup '@ugc/test-utils/live-budget' (ledger LIVE_BUDGET_USD)
          // llega con el tier live en T1.8 (external-apis.md).
          testTimeout: 300_000,
        },
      },
      {
        test: {
          name: 'worker:media',
          root: './apps/worker',
          include: process.env.RUN_MEDIA ? ['test/media/**/*.test.ts'] : [],
          setupFiles: ['@ugc/test-utils/setup-env'],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
