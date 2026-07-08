// packages/db/vitest.config.ts — testing/references/stack-setup.md §3.2.
// Proyecto unit de @ugc/db. En T0.2 solo cubre el ping de conexión (health.ts):
// db:true con runner falso, db:false por ausencia de cadena y por endpoint
// muerto — todo hermético, sin Postgres. El proyecto integration
// (vitest.config.integration.ts + Testcontainers) es la pieza grande de T0.3.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'db:unit',
    include: ['src/**/*.test.ts'],
    // CRÍTICO: *.live.test.ts matchea *.test.ts — exclúyelo SIEMPRE.
    exclude: ['**/*.live.test.ts', '**/node_modules/**'],
    environment: 'node',
    setupFiles: ['@ugc/test-utils/setup-env'],
  },
});
