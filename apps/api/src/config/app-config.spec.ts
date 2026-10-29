import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadConfig } from './app-config.js';

const DATABASE_URL = 'postgres://app:secret-password@db.example.test:5432/documind';
const SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const REQUIRED = { DATABASE_URL, SUPABASE_URL };

describe('loadConfig', () => {
  it('applies safe defaults when optional variables are absent', () => {
    expect(loadConfig(REQUIRED)).toEqual({
      nodeEnv: 'development',
      log: { level: 'log', format: 'json' },
      http: { port: 3000, corsAllowedOrigins: [] },
      worker: { pollIntervalMs: 5000 },
      database: { url: DATABASE_URL, poolMax: 10, statementTimeoutMs: 30_000 },
      auth: {
        issuer: 'https://abcdefghijklmnopqrst.supabase.co/auth/v1',
        jwksUrl: new URL('https://abcdefghijklmnopqrst.supabase.co/auth/v1/.well-known/jwks.json'),
      },
    });
  });

  it('coerces numeric variables and splits the CORS origin list', () => {
    const config = loadConfig({
      ...REQUIRED,
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
    ['DATABASE_POOL_MAX', '0'],
    ['DATABASE_STATEMENT_TIMEOUT_MS', '500'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => loadConfig({ ...REQUIRED, [name]: value })).toThrow(ConfigValidationError);
  });

  it.each(['*', 'https://documind.pages.dev/', 'https://documind.pages.dev/app', 'not a url'])(
    'rejects CORS origin %j that is not a bare origin',
    (origin) => {
      expect(() => loadConfig({ ...REQUIRED, CORS_ALLOWED_ORIGINS: origin })).toThrow(
        ConfigValidationError,
      );
    },
  );

  it('names the invalid variable without echoing its value', () => {
    const secretLookingValue = 'sk-live-should-never-appear-in-logs';

    let error: unknown;
    try {
      loadConfig({ ...REQUIRED, LOG_LEVEL: secretLookingValue });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigValidationError);
    const message = (error as ConfigValidationError).message;
    expect(message).toContain('LOG_LEVEL');
    expect(message).not.toContain(secretLookingValue);
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({ SUPABASE_URL })).toThrow(/DATABASE_URL/);
  });

  it.each([
    'mysql://app:pw@db.example.test/documind',
    'postgres://app:pw@db.example.test',
    'not a url',
  ])('rejects DATABASE_URL %j', (url) => {
    expect(() => loadConfig({ ...REQUIRED, DATABASE_URL: url })).toThrow(ConfigValidationError);
  });

  it('never echoes the database password in validation errors', () => {
    const url = 'mysql://app:hunter2-database-password@db.example.test/documind';

    let message = '';
    try {
      loadConfig({ ...REQUIRED, DATABASE_URL: url });
    } catch (error) {
      message = (error as ConfigValidationError).message;
    }

    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('hunter2');
  });

  it('requires SUPABASE_URL', () => {
    expect(() => loadConfig({ DATABASE_URL })).toThrow(/SUPABASE_URL/);
  });

  it.each([
    'http://abcdefghijklmnopqrst.supabase.co',
    'https://abcdefghijklmnopqrst.supabase.co/',
    'https://abcdefghijklmnopqrst.supabase.co/auth/v1',
    'ftp://localhost',
    'not a url',
  ])('rejects SUPABASE_URL %j', (url) => {
    expect(() => loadConfig({ ...REQUIRED, SUPABASE_URL: url })).toThrow(ConfigValidationError);
  });

  it('accepts a local Supabase CLI stack over http outside production', () => {
    const config = loadConfig({ ...REQUIRED, SUPABASE_URL: 'http://127.0.0.1:54321' });

    expect(config.auth.issuer).toBe('http://127.0.0.1:54321/auth/v1');
  });

  it('refuses a plain-http Supabase URL in production', () => {
    expect(() =>
      loadConfig({ ...REQUIRED, NODE_ENV: 'production', SUPABASE_URL: 'http://localhost:54321' }),
    ).toThrow(/SUPABASE_URL/);
  });
});
