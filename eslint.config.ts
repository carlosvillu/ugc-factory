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
    'docs/design-system/**', // espejo verbatim del DS de Claude Design (solo lectura, no es código nuestro)
    'docs/verifications/**', // evidencia de cierre de tareas (incl. scripts .ts del verifier): artefactos, no código del proyecto ni en tsconfig
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

  // ── 5b. apps/web: adherencia al Design System (TD.6) ─────────────────────
  // El código nuestro usa SOLO clases de token del DS (bg-surface, text-text-2,
  // bg-accent…). Estas reglas bloquean las tres fugas que se saltan el DS y
  // rompen tema/acento/retheme (frontend/references/design-system.md §3). Adapta
  // las IDEAS de docs/design-system/_adherence.oxlintrc.json (pensado para
  // inline styles del espejo) a NUESTRO flujo Tailwind-en-className. Los valores
  // crudos SÍ son válidos en globals.css (es la fuente de tokens): esta regla no
  // aplica a CSS (glob .ts/.tsx) y no toca ese fichero.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      // (a) className: paleta cruda de Tailwind y (b) valores arbitrarios.
      // Se casan sobre string literals Y template literals (las clases viven en
      // className="…", `…${x}…`, cva(…) y cn(…)); esquery no ve TemplateElement
      // vía [value=…] (su value es un objeto) → hace falta el par de selectores.
      // TRADE-OFF DELIBERADO: el selector casa CUALQUIER string/template literal, no
      // solo el que es valor de className/cva/cn. Acotarlo a className reintroduciría
      // un hueco real: cva()/cn() reciben las clases como string/template planos sin
      // atributo JSX que anclar. Hoy 0 ocurrencias de estos patrones fuera de clases
      // en apps/web → no rompe nada; el regex es específico (escala numérica, prefijo
      // de utilidad, forma [prop:valor]) y no caza prosa normal.
      'no-restricted-syntax': [
        'error',
        // (a) Paleta cruda: bg-blue-500, text-gray-700, border-red-400… El sufijo
        // numérico \\d{2,3} es lo que salva los tokens semánticos del DS
        // (bg-violet-soft, text-accent no llevan escala numérica).
        {
          selector:
            'Literal[value=/\\b(bg|text|border|ring|from|to|via|fill|stroke|decoration|outline|shadow|accent|caret|divide|placeholder)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}\\b/]',
          message:
            'Paleta cruda de Tailwind prohibida en className — usa una clase de token del DS (bg-surface, text-text-2, bg-accent…). frontend/references/design-system.md §3.',
        },
        {
          selector:
            'TemplateElement[value.raw=/\\b(bg|text|border|ring|from|to|via|fill|stroke|decoration|outline|shadow|accent|caret|divide|placeholder)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}\\b/]',
          message:
            'Paleta cruda de Tailwind prohibida en className — usa una clase de token del DS (bg-surface, text-text-2, bg-accent…). frontend/references/design-system.md §3.',
        },
        // (b.1) Valor arbitrario en una UTILIDAD con prefijo: bg-[#fff],
        // rounded-[10px], w-[38px], text-[14px], content-[''], bg-[url(...)],
        // transition-[width]… Se ancla al prefijo de PROPIEDAD (w-, bg-, rounded-,
        // transition-…): así distingue el valor arbitrario del SELECTOR DE VARIANTE
        // (data-[checked]:, has-[…]:, aria-[…]:, group-[…]:, peer-[…]:,
        // supports-[…]:, in-data-[…]:) — cuyos prefijos NO son utilidades y por eso
        // no casan, incluso con corchetes anidados (has-[[data-slot=x]]:). El
        // spacing fraccionario (size-4.5, w-17.5) no lleva corchetes → tampoco casa.
        {
          selector:
            'Literal[value=/(?:^|[\\s"\'`:])-?(?:bg|text|border|ring|ring-offset|from|to|via|fill|stroke|decoration|outline|shadow|accent|caret|divide|placeholder|w|h|size|min-w|max-w|min-h|max-h|m|mx|my|mt|mb|ml|mr|p|px|py|pt|pb|pl|pr|gap|gap-x|gap-y|space-x|space-y|inset|top|bottom|left|right|translate-x|translate-y|rotate|scale|skew-x|skew-y|rounded|rounded-[a-z]+|leading|tracking|text-shadow|indent|basis|grid-cols|grid-rows|col-span|row-span|order|z|opacity|duration|delay|animate|content|aspect|columns|font|flex|grow|shrink|transition|will-change|bg-position)-\\[[^\\]]*\\]/]',
          message:
            'Valor arbitrario prohibido en className — usa un token/utilidad del DS o añádelo a globals.css. frontend/references/design-system.md §3.',
        },
        {
          selector:
            'TemplateElement[value.raw=/(?:^|[\\s"\'`:])-?(?:bg|text|border|ring|ring-offset|from|to|via|fill|stroke|decoration|outline|shadow|accent|caret|divide|placeholder|w|h|size|min-w|max-w|min-h|max-h|m|mx|my|mt|mb|ml|mr|p|px|py|pt|pb|pl|pr|gap|gap-x|gap-y|space-x|space-y|inset|top|bottom|left|right|translate-x|translate-y|rotate|scale|skew-x|skew-y|rounded|rounded-[a-z]+|leading|tracking|text-shadow|indent|basis|grid-cols|grid-rows|col-span|row-span|order|z|opacity|duration|delay|animate|content|aspect|columns|font|flex|grow|shrink|transition|will-change|bg-position)-\\[[^\\]]*\\]/]',
          message:
            'Valor arbitrario prohibido en className — usa un token/utilidad del DS o añádelo a globals.css. frontend/references/design-system.md §3.',
        },
        // (b.2) Propiedad arbitraria PURA sin prefijo de utilidad: [color:#fff],
        // [--gap:16px], [mask-image:url(x)] — Tailwind v4 válido que inyecta valores
        // crudos. Casa un token de clase que EMPIEZA por '[' con un ':' dentro. Dos
        // exclusiones deliberadas para no dar falsos positivos sobre código legítimo:
        //   • sin '&'/'@' dentro → NO caza la VARIANTE arbitraria [&_[data-slot=x]]:…
        //     ni [@media…]: (checkbox/dialog las usan; terminan en ]: + utilidad).
        //   • valor que NO es solo var(--token) → SÍ permite [--pulse-color:var(--…)]
        //     (foundation-specimens: el mecanismo pulse-ring del DS referencia un
        //     token, no un valor crudo). La regla bloquea el valor CRUDO, no el token.
        {
          selector:
            'Literal[value=/(?:^|[\\s"\'`])\\[(?![^\\]]*[&@])[a-z-][a-z-]*:(?!\\s*var\\(--[^)]+\\)\\s*\\])[^\\]]+\\]/]',
          message:
            'Valor arbitrario prohibido en className — usa un token/utilidad del DS o añádelo a globals.css. frontend/references/design-system.md §3.',
        },
        {
          selector:
            'TemplateElement[value.raw=/(?:^|[\\s"\'`])\\[(?![^\\]]*[&@])[a-z-][a-z-]*:(?!\\s*var\\(--[^)]+\\)\\s*\\])[^\\]]+\\]/]',
          message:
            'Valor arbitrario prohibido en className — usa un token/utilidad del DS o añádelo a globals.css. frontend/references/design-system.md §3.',
        },
      ],
      // (c) Librerías de iconos y primitivas crudas. Base UI
      // (@base-ui-components/react) es NUESTRA base y SÍ está permitida; se
      // prohíben Radix directo y toda icon font (el DS usa glifos Unicode, §3.7).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'lucide-react',
                'lucide-react/*',
                'react-icons',
                'react-icons/*',
                'react-feather',
                '@fortawesome/*',
                '@iconify/*',
              ],
              message:
                'Librería de iconos prohibida — el DS usa glifos Unicode (✓ ✕ ⚠ ◆ ↺ ▼ +). frontend/references/design-system.md §3.7.',
            },
            {
              group: ['@heroicons/*', '@tabler/icons*', '@phosphor-icons/*'],
              message:
                'Librería de iconos prohibida — el DS usa glifos Unicode (✓ ✕ ⚠ ◆ ↺ ▼ +). frontend/references/design-system.md §3.7.',
            },
            {
              group: ['@radix-ui/*'],
              message:
                'Radix directo prohibido — usa la primitiva de Base UI (@base-ui-components/react) sobre la que vive el DS. frontend/references/design-system.md §4.',
            },
          ],
        },
      ],
    },
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
  // Estos ficheros no pasan por typed-lint (que apaga `no-undef` porque TS ya
  // valida los símbolos), así que `no-undef` de js.recommended sigue activo:
  // hay que declararles los globals de Node/ESM a mano (no hay paquete
  // `globals` instalado). Los usa p.ej. apps/web/scripts/dev.mjs (wrapper de
  // `next dev` que corre en Node puro).
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        process: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        globalThis: 'readonly',
      },
    },
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
