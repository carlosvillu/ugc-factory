// eslint.config.ts (raíz — el ÚNICO del monorepo; backend/references/tooling.md §2)
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import * as importX from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import unusedImports from 'eslint-plugin-unused-imports';
import drizzle from 'eslint-plugin-drizzle';
import vitest from '@vitest/eslint-plugin';
import playwright from 'eslint-plugin-playwright';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig(
  // ── 1. Ignores globales: lo generado no se lintea jamás ──────────────────
  globalIgnores([
    '**/dist/**',
    '**/.next/**',
    '**/coverage/**',
    'packages/db/drizzle/**', // SQL + snapshots generados por drizzle-kit
    '**/playwright-report/**',
    '**/test-results/**',
    '**/next-env.d.ts', // generado por next dev/build
  ]),

  // ── 2. Base typed para TODO el código TS ─────────────────────────────────
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Resuelve el tsconfig de CADA fichero solo; sin listas de project.
        // Los configs TS de la raíz pertenecen al tsconfig.json raíz (mínimo,
        // solo para ellos): typed lint y typecheck reales también ahí.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Innegociables — un await perdido en el worker = job "completado" antes
      // de que FFmpeg termine (tooling.md §2).
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  // ── 3. import-x: higiene y fronteras de imports ──────────────────────────
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    rules: {
      // Un ciclo core↔db (o entre módulos de core) funde dos módulos en uno
      // sin decirlo: rompe la dirección de dependencias de architecture.md §1.
      'import-x/no-cycle': 'error',
    },
    // El resolver TS es necesario para el alias '@/*' de apps/web (tsconfig paths
    // interno del paquete) — NUNCA para cruzar paquetes: '@ugc/*' resuelve por
    // exports map + workspace:* (tooling.md §4).
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
          noWarnOnMultipleProjects: true, // monorepo: N tsconfigs es lo esperado
        }),
      ],
    },
  },

  // ── 4. unused-imports: autofix de imports muertos ────────────────────────
  {
    plugins: { 'unused-imports': unusedImports },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off', // la sustituyen las dos siguientes
      'unused-imports/no-unused-imports': 'error', // autofixable en pre-commit (§7)
      'unused-imports/no-unused-vars': [
        'warn',
        { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ── 5. apps/web: Next + React Hooks (React Compiler) ─────────────────────
  // eslint-config-next ≥16 exporta flat config NATIVO: el FlatCompat del snippet
  // original de tooling.md §2 ya no aplica (con eslintrc revienta — sus plugins
  // son objetos). Se acota cada entrada a la zona web.
  ...nextCoreWebVitals.map((cfg) => ({
    ...cfg,
    files: ['apps/web/**/*.{ts,tsx}'],
    settings: { ...cfg.settings, next: { rootDir: 'apps/web/' } }, // monorepo: las reglas @next/next lo necesitan
  })),
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    // CUIDADO — doble registro: eslint-config-next YA registra los plugins
    // react/react-hooks. Volver a declarar `plugins: { 'react-hooks': reactHooks }`
    // revienta con "Cannot redefine plugin". Se toman SOLO las rules del preset
    // ('recommended-latest': rules-of-hooks + exhaustive-deps + las reglas nuevas
    // del React Compiler). UNA sola versión de eslint-plugin-react-hooks vía
    // root devDep alineada con la que arrastra eslint-config-next.
    rules: { ...reactHooks.configs['recommended-latest'].rules },
  },

  // ── 6. packages/db + apps/worker: los que tocan la BD ───────────────────
  {
    files: ['packages/db/**/*.ts', 'apps/worker/**/*.ts'],
    plugins: { drizzle },
    rules: {
      // Un db.delete(step_run) sin .where() en el worker borra la tabla entera.
      'drizzle/enforce-delete-with-where': ['error', { drizzleObjectName: ['db'] }],
      'drizzle/enforce-update-with-where': ['error', { drizzleObjectName: ['db'] }],
      // `return repo.insertStep(...)` dentro de try{} pierde el stack y el catch: exige el await.
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
    },
  },

  // ── 7. Tests: relajar lo unsafe, MANTENER las promesas ──────────────────
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.ts', 'apps/web/e2e/**/*.ts'],
    rules: {
      // Fixtures y asserts hacen malabares de tipos legítimos:
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // NUNCA se relaja: un expect(...) sin await = test en falso verde.
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.test.ts'],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      // expectGolden (test-utils/golden.ts) encapsula su expect: los tests de
      // golden files no siempre tienen un expect visible en el cuerpo.
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expectGolden'] }],
    },
  },
  {
    ...playwright.configs['flat/recommended'],
    files: ['apps/web/e2e/**/*.spec.ts'],
  },

  // ── 8. JS plano (configs, scripts .mjs): sin type-checking ───────────────
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // ── 8b. eslint.config.ts: ruido de import-x sobre el patrón canónico ─────
  // Con el tsconfig.json raíz los configs TS de la raíz tienen type info real:
  // las typed rules (incluidas las innegociables) aplican como en el resto.
  {
    files: ['eslint.config.ts'],
    rules: {
      // `import tseslint from 'typescript-eslint'` es el uso canónico documentado:
      // el aviso "also has a named export" aquí es solo ruido.
      'import-x/no-named-as-default-member': 'off',
    },
  },

  // ── 9. prettier SIEMPRE al final: apaga toda regla de formato ────────────
  prettier,
);
