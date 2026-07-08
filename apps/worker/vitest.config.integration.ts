// apps/worker/vitest.config.integration.ts — tests de integración del worker
// (db-integration.md §2): pg-boss contra Postgres 16 real vía Testcontainers. El
// globalSetup compartido arranca UN contenedor por run (singleton con refcount) y
// aplica las migraciones a la template; cada suite clona la template. La raíz lo
// arrastra con `--project '*:integration'` — el `name` es load-bearing.
// Precondición: Docker daemon vivo.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'worker:integration',
    include: ['test/integration/**/*.test.ts'],
    exclude: ['**/*.live.test.ts', '**/node_modules/**'],
    environment: 'node',
    globalSetup: ['@ugc/test-utils/global-setup'],
    setupFiles: ['@ugc/test-utils/setup-env'],
    // Arranque del contenedor + clonaciones + convergencia de retries de pg-boss:
    // sin timeouts holgados el primer beforeAll/it puede exceder el default de 5s.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
