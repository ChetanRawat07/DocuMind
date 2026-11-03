import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `npm run test:coverage`. Most of this package is schemas, exercised by the API and web tests.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: { lines: 75, statements: 75, branches: 80, functions: 85 },
    },
  },
});
