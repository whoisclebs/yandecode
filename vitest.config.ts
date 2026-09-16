import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/test/slow/**'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
