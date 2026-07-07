import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node24',
  sourcemap: true,
  clean: true,
  tsconfig: 'tsconfig.build.json', // los tests nunca se publican en dist (tooling.md §4)
  // Los paquetes internos exportan TS fuente (JIT): Node no puede ejecutarlos,
  // se inlinean en el bundle (architecture.md §7). pino queda external (dep real).
  noExternal: [/^@ugc\//],
});
