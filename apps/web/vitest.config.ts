// apps/web/vitest.config.ts — testing/references/frontend.md §2
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'web:unit',
    include: ['src/**/*.test.{ts,tsx}'],
    // CRÍTICO: *.live.test.ts matchea *.test.ts — exclúyelo SIEMPRE
    // o un `vitest run` normal ejecutará tests que gastan dinero.
    exclude: ['**/*.live.test.ts', '**/node_modules/**'],
    // jsdom (superset de node) para que React Flow y renderHook funcionen.
    environment: 'jsdom',
    // setup-env fija el env ANTES de cualquier test; vitest.setup.ts añade los
    // mocks de DOM que React Flow exige en jsdom (frontend.md §2).
    setupFiles: ['@ugc/test-utils/setup-env', './vitest.setup.ts'],
    // limpia vi.stubGlobal (EventSource fake, etc.) entre tests
    unstubGlobals: true,
    // El logger de web es lazy y se memoiza en la primera request: el nivel
    // debe estar en el env ANTES de cualquier test (un beforeAll por suite
    // sería un hazard de orden). .env.test (T0.2) lo fijará globalmente.
    env: { LOG_LEVEL: 'silent' },
  },
});
