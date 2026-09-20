import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'bundle/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // `domain/` is pure: the envelope, canonicalisation, the chain and the verifier decide things
    // and never touch a store, a queue or the network. The verifier has to run from a laptop with
    // every service off; keeping the domain free of I/O is what makes that a property rather than
    // a hope (build-standards.md §1).
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/archive/**', '**/delivery/**', '**/relay/**', '**/cli/**'],
              message: 'domain/ must stay pure — no I/O layers.',
            },
            {
              group: ['@aws-sdk/*', 'node:fs', 'node:fs/*', 'fs', 'node:http', 'node:https'],
              message: 'domain/ must stay pure — no drivers, no filesystem, no network.',
            },
          ],
        },
      ],
    },
  },
);
