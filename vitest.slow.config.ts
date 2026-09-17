import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/slow/**/*.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
