// packages/services/vitest.config.ts — testing/references/stack-setup.md §3.2
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'services:unit',
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.live.test.ts', '**/node_modules/**'],
    environment: 'node',
    setupFiles: ['@ugc/test-utils/setup-env'],
  },
});
