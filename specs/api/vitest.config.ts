import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Integration tests drive a real MongoDB replica set and share databases by name, so they
    // must not race each other. Unit tests are pure and parallelise fine, but the cost of
    // serialising them is a second.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
