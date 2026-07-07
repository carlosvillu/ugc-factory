// eslint-plugin-drizzle no publica tipos: declaración ambiental mínima para que
// el typecheck y el typed lint del eslint.config.ts raíz no degraden a `any`
// (único plugin del config sin types — el resto los publica).
declare module 'eslint-plugin-drizzle' {
  import type { ESLint } from 'eslint';
  const plugin: ESLint.Plugin;
  export default plugin;
}
