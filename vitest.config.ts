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
          // globalSetup del guard de presupuesto (T1.8, external-apis.md §8): crea el ledger
          // que `spendBudget()` consulta antes de CADA llamada de pago. Sin él, los tests live
          // abortan fail-closed (no se gasta un céntimo sin techo declarado).
          globalSetup: ['@ugc/test-utils/live-budget'],
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
