// packages/services/vitest.config.integration.ts — tests de integración de los
// servicios (testing/references/db-integration.md §2): las funciones `run*` que
// orquestan core + BD/storage real vía Testcontainers. Espeja
// apps/web/vitest.config.integration.ts (mismo patrón: globalSetup comparte UN
// contenedor por run, cada suite clona la template). La raíz lo arrastra con
// `--project '*:integration'` — el `name` es load-bearing.
// Precondición: Docker daemon vivo.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'services:integration',
    include: ['test/integration/**/*.test.ts'],
    exclude: ['**/*.live.test.ts', '**/node_modules/**'],
    environment: 'node',
    globalSetup: ['@ugc/test-utils/global-setup'],
    setupFiles: ['@ugc/test-utils/setup-env'],
    env: { LOG_LEVEL: 'silent' },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
