import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const tsFiles = ['**/*.{ts,tsx,mts,cts}'];
const runtimeGlobals = {
  ...globals.browser,
  ...globals.node,
  ...globals.es2022,
};

const tsRecommended = tseslint.configs.recommended.map((config) => ({
  ...config,
  files: config.files ?? tsFiles,
}));

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/.wrangler/**',
      'apps/web/playwright-report/**',
      'apps/web/vite.config.ts.timestamp-*.mjs',
    ],
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: runtimeGlobals,
    },
  },
  ...tsRecommended,
  {
    files: tsFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: runtimeGlobals,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
