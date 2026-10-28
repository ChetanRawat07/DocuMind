import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadConfig } from './app-config.js';

describe('loadConfig', () => {
  it('applies safe defaults when optional variables are absent', () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: 'development',
      log: { level: 'log', format: 'json' },
      http: { port: 3000, corsAllowedOrigins: [] },
      worker: { pollIntervalMs: 5000 },
    });
  });

  it('coerces numeric variables and splits the CORS origin list', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      CORS_ALLOWED_ORIGINS: ' https://documind.pages.dev , http://localhost:5173 ',
      WORKER_POLL_INTERVAL_MS: '250',
    });

    expect(config.http.port).toBe(8080);
    expect(config.http.corsAllowedOrigins).toEqual([
      'https://documind.pages.dev',
      'http://localhost:5173',
    ]);
    expect(config.worker.pollIntervalMs).toBe(250);
  });

  it.each([
    ['PORT', '0'],
    ['PORT', '65536'],
    ['PORT', 'abc'],
    ['NODE_ENV', 'staging'],
    ['WORKER_POLL_INTERVAL_MS', '10'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(ConfigValidationError);
  });

  it.each(['*', 'https://documind.pages.dev/', 'https://documind.pages.dev/app', 'not a url'])(
    'rejects CORS origin %j that is not a bare origin',
    (origin) => {
      expect(() => loadConfig({ CORS_ALLOWED_ORIGINS: origin })).toThrow(ConfigValidationError);
    },
  );

  it('names the invalid variable without echoing its value', () => {
    const secretLookingValue = 'sk-live-should-never-appear-in-logs';

    let error: unknown;
    try {
      loadConfig({ LOG_LEVEL: secretLookingValue });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigValidationError);
    const message = (error as ConfigValidationError).message;
    expect(message).toContain('LOG_LEVEL');
    expect(message).not.toContain(secretLookingValue);
  });
});
