import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: { import: importPlugin },
    languageOptions: { globals: { ...globals.browser } },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.json' } },
    },
    rules: {
      // docs/ARCHITECTURE.md §2 rule 1: domain/ imports only from domain/.
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/domain',
              from: './src',
              except: ['./domain'],
              message:
                'src/domain/** may only import from src/domain/** (see docs/ARCHITECTURE.md §2).',
            },
            {
              target: './src/ui',
              from: './src/worker',
              message:
                'src/ui/** talks to the sim worker only through protocol/ messages (docs/ARCHITECTURE.md §2).',
            },
            {
              target: './src/protocol',
              from: ['./src/ui', './src/worker'],
              message:
                'src/protocol/** may only import from src/domain/** (docs/ARCHITECTURE.md §2).',
            },
            {
              target: './src/nova',
              from: ['./src/domain', './src/ui', './src/worker'],
              message:
                'src/nova/** (the NovaLang worker) may only import src/protocol/**: scripts reach the sim through the bridge alone (docs/NOVALANG_ISOLATION.md).',
            },
            {
              target: './src/ui',
              from: './src/nova',
              message: 'src/ui/** talks to the nova worker only through protocol/ messages.',
            },
            {
              target: './src/worker',
              from: './src/ui',
              message: 'src/worker/** must not import src/ui/** (docs/ARCHITECTURE.md §2).',
            },
          ],
        },
      ],
    },
  },
  {
    // domain/ is pure: no DOM, no storage, no network, no timers.
    files: ['src/domain/**/*.ts'],
    languageOptions: { globals: { ...globals.es2022 } },
    rules: {
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'navigator',
          'localStorage',
          'sessionStorage',
          'indexedDB',
          'fetch',
          'XMLHttpRequest',
          'WebSocket',
          'setTimeout',
          'setInterval',
          'requestAnimationFrame',
        ].map((name) => ({
          name,
          message: 'src/domain/** must stay pure (docs/ARCHITECTURE.md §2).',
        })),
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
