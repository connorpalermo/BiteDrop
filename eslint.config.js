// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['**/.next/**', '**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { import: importPlugin },
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 4],
      complexity: ['error', 12],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'import/no-default-export': 'error',
    },
  },
  {
    // Config files sit outside every package's tsconfig `include` (no typed
    // linting target) and conventionally require a default export — Vitest,
    // PostCSS, and ESLint's own flat config all load via `export default`.
    files: ['**/*.config.{ts,mts,cts,js,mjs}'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'import/no-default-export': 'off',
    },
  },
  {
    // React hook correctness (rules-of-hooks, exhaustive-deps, and the newer
    // React Compiler-era purity/immutability checks) — apps/web only, since
    // packages/core has no React.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.flat.recommended.rules,
  },
  {
    // mock data is flat fixture data — 40 drops is ~800 lines and splitting buys nothing
    files: ['packages/core/src/mock/**'],
    rules: { 'max-lines': 'off' },
  },
  {
    // Next.js requires default exports from pages, layouts, and route files
    // (next.config.ts is covered by the *.config.* block above)
    files: [
      'apps/web/app/**/{page,layout,error,loading,not-found,route}.tsx',
      'apps/web/app/**/{page,layout,error,loading,not-found,route}.ts',
    ],
    rules: { 'import/no-default-export': 'off' },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },
);
