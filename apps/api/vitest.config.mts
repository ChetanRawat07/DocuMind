import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Integration tests read TEST_DATABASE_URL from the repository's .env unless
// the environment (for example CI) already provides it.
const rootEnv = loadEnv('test', '../..', 'TEST_');
process.env.TEST_DATABASE_URL ??= rootEnv.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    environment: 'node',
    // `npm run test:coverage`. Thresholds sit just under the measured numbers, so a drop fails.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/database/generated/**'],
      reporter: ['text-summary', 'html'],
      thresholds: { lines: 88, statements: 88, branches: 83, functions: 91 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
          exclude: ['**/*.integration.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.integration.spec.ts', 'test/**/*.integration.spec.ts'],
          globalSetup: ['./test/support/integration-global-setup.ts'],
          // One shared test database: files run one at a time and each test starts from empty tables.
          fileParallelism: false,
        },
      },
    ],
  },
});
