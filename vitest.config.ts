import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'worker/__tests__/**/*.test.ts',
      'web/src/__tests__/**/*.test.js',
    ],
  },
});
