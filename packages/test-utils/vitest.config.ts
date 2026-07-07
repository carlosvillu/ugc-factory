// packages/test-utils/vitest.config.ts — testing/references/stack-setup.md §3.2
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'test-utils:unit',
    include: ['src/**/*.test.ts'],
    // CRÍTICO: *.live.test.ts matchea *.test.ts — exclúyelo SIEMPRE
    // o un `vitest run` normal ejecutará tests que gastan dinero.
    exclude: ['**/*.live.test.ts', '**/node_modules/**'],
    environment: 'node',
    setupFiles: ['./src/setup-env.ts'],
  },
});
