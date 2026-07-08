// apps/web/vitest.config.integration.ts — tests de integración handler-level de la
// API (testing/references/api.md §2, db-integration.md §2): los route handlers de
// apps/web invocados en proceso con `new Request()` contra Postgres 16 real vía
// Testcontainers + pg-boss real. El globalSetup compartido arranca UN contenedor
// por run y aplica migraciones a la template; cada suite clona. La raíz lo arrastra
// con `--project '*:integration'` — el `name` es load-bearing.
// Precondición: Docker daemon vivo.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'web:integration',
    include: ['test/integration/**/*.test.ts'],
    exclude: ['**/*.live.test.ts', '**/node_modules/**'],
    environment: 'node',
    globalSetup: ['@ugc/test-utils/global-setup'],
    setupFiles: ['@ugc/test-utils/setup-env'],
    env: { LOG_LEVEL: 'silent' },
    // Arranque del contenedor + clonaciones + convergencia de pg-boss: sin
    // timeouts holgados el primer beforeAll/it excede el default de 5s.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
