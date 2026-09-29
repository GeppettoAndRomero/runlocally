import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import globals from 'globals';

export default [
  { ignores: ['dist/**', '.notice-build/**', '.astro/**', 'node_modules/**', 'coverage/**', 'test-results/**', 'playwright-report/**', '.wrangler/**', 'src/env.d.ts', 'vendor/libarchive-lean/**', 'public/vendor/libarchive/**', 'wasm/libarchive-lean/out/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    files: ['src/**/*.tsx', 'src/pages/**/*.astro', 'src/layouts/**/*.astro'],
    rules: {
      'no-restricted-syntax': ['error', { selector: 'Literal[value=/^(ja|en)$/]', message: 'Use a locale from src/i18n/locales.ts.' }],
    },
  },
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
