import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'bundle/**', 'node_modules/**', 'coverage/**', 'archive/**', 'payloads/**'] },
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
    // `domain/` is pure. It decides and evolves; it never reaches for I/O, a database handle, a clock
    // or a web framework. That is what makes the unit tests the specification of the behaviour, and
    // what lets the same `evolve` rebuild a workspace from the archive (maestro ADR-0019 §4).
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db/**', '**/services/**', '**/http/**', '**/auth/**', '**/mcp/**'],
              message: 'domain/ must stay pure — no I/O layers.',
            },
            {
              group: ['fastify', 'fastify/*', 'jose', '@aws-sdk/*'],
              message: 'domain/ must stay pure — no framework or driver imports.',
            },
          ],
        },
      ],
    },
  },
  {
    // Isolation is a compile-time guarantee only while every store access goes through a handle.
    // A service that holds the table's client can build any key, and a key that names another
    // workspace is the door a forgotten filter walks through — so the DynamoDB client is reachable
    // from `db/` and nowhere else (maestro ADR-0018).
    files: ['src/services/**/*.ts', 'src/http/**/*.ts', 'src/mcp/**/*.ts', 'src/auth/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@aws-sdk/client-dynamodb',
              message:
                'Acquire a WorkspaceHandle from db/client.ts. No repository takes a raw client or a workspace id (maestro ADR-0018).',
            },
            {
              name: '@aws-sdk/lib-dynamodb',
              message:
                'Acquire a WorkspaceHandle from db/client.ts. No repository takes a raw client or a workspace id (maestro ADR-0018).',
            },
          ],
        },
      ],
    },
  },
);
