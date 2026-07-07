// apps/worker/vitest.config.ts — testing/references/stack-setup.md §3.2
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'worker:unit',
    include: ['src/**/*.test.ts'],
    // CRÍTICO: *.live.test.ts matchea *.test.ts — exclúyelo SIEMPRE
    // o un `vitest run` normal ejecutará tests que gastan dinero.
    exclude: ['**/*.live.test.ts', '**/node_modules/**'],
    environment: 'node',
    setupFiles: ['@ugc/test-utils/setup-env'],
  },
});
