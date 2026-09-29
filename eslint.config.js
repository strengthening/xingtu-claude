// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'public/data/', 'data/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['scripts/**/*.ts', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // astro/ must stay renderer-agnostic so it can be unit-tested headless.
    files: ['src/astro/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*'], message: 'astro/ must not depend on Three.js' },
            { group: ['../render/*', '../ui/*'], message: 'astro/ is a pure calculation layer' },
          ],
        },
      ],
    },
  },
  prettier,
);
