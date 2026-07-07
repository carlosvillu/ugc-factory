// apps/web/vitest.config.ts — testing/references/stack-setup.md §3.2
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'web:unit',
    include: ['src/**/*.test.{ts,tsx}'],
    // CRÍTICO: *.live.test.ts matchea *.test.ts — exclúyelo SIEMPRE
    // o un `vitest run` normal ejecutará tests que gastan dinero.
    exclude: ['**/*.live.test.ts', '**/node_modules/**'],
    environment: 'node',
    setupFiles: ['@ugc/test-utils/setup-env'],
    // El logger de web es lazy y se memoiza en la primera request: el nivel
    // debe estar en el env ANTES de cualquier test (un beforeAll por suite
    // sería un hazard de orden). .env.test (T0.2) lo fijará globalmente.
    env: { LOG_LEVEL: 'silent' },
  },
});
