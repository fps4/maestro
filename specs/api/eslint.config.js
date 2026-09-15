import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // `domain/` is pure. It decides things; it never reaches for I/O, a database handle, or a web
    // framework. That is what makes the unit tests the real specification of the behaviour, and it
    // is enforced here rather than left to review.
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
              group: ['fastify', 'fastify/*', 'mongodb', 'jose', '@aws-sdk/*'],
              message: 'domain/ must stay pure — no framework or driver imports.',
            },
          ],
        },
      ],
    },
  },
  {
    // ADR-0006 is a compile-time guarantee only while every store access goes through a handle.
    // A repository that takes a raw Db or a workspace id has re-opened the door a forgotten filter
    // walks through, so the driver's client types are reachable from `db/` and nowhere else.
    files: ['src/services/**/*.ts', 'src/http/**/*.ts', 'src/mcp/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'mongodb',
              importNames: ['MongoClient', 'Db'],
              message:
                'Acquire a WorkspaceHandle or CatalogueHandle from db/handle.ts. No repository takes a raw client or a workspace id (ADR-0006).',
            },
          ],
        },
      ],
    },
  },
  {
    // ADR-0005: there is no decision surface on MCP. The guarantee is structural — nothing under
    // `mcp/`, and nothing `mcp/` imports from `services/`, imports the one module that can decide.
    // `packet.ts` reads the gate through `gate-view.ts` for exactly this reason.
    files: ['src/mcp/**/*.ts', 'src/services/packet.ts', 'src/services/gate-view.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/services/decisions', '**/services/decisions.js'],
              message:
                'MCP has no decision surface (ADR-0005). Read a gate through services/gate-view.ts; DecisionService is reachable only from http/.',
            },
          ],
        },
      ],
    },
  },
);
