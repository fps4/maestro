import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Integration tests drive DynamoDB Local, each file on its own table; serial so the local
    // store — and a developer's laptop — is not asked for everything at once. Unit tests are pure
    // and parallelise fine, but the cost of serialising them is a second.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
