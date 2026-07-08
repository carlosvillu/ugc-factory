// Proyecto de integración de @ugc/db (db-integration.md §2): tests contra
// Postgres 16 real vía Testcontainers. El globalSetup arranca UN contenedor por
// run (singleton con refcount compartido) y aplica las migraciones a la
// template; cada suite clona la template. `pnpm test` (raíz) lo arrastra vía el
// glob de vitest.config.ts. Precondición: Docker daemon vivo.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'db:integration',
    include: ['test/integration/**/*.test.ts'],
    exclude: ['**/*.live.test.ts', '**/node_modules/**'],
    environment: 'node',
    globalSetup: ['@ugc/test-utils/global-setup'],
    setupFiles: ['@ugc/test-utils/setup-env'],
    // El arranque del contenedor + clonaciones cuestan segundos; sin un timeout
    // holgado, el primer beforeAll del run puede exceder el default de 5s.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
