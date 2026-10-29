import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Integration tests read TEST_DATABASE_URL from the repository's .env unless
// the environment (for example CI) already provides it.
const rootEnv = loadEnv('test', '../..', 'TEST_');
process.env.TEST_DATABASE_URL ??= rootEnv.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    environment: 'node',
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
