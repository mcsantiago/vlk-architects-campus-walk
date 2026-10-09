import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Each test file spins up its own in-memory Postgres; WASM boot is the slow part.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
