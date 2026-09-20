import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'cdk.out/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The heartbeat handler runs inside the Lambda runtime, as CommonJS, with the runtime's SDK.
    files: ['heartbeat/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', exports: 'writable', process: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
