import { resolve } from 'node:path';
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
      worker: { pollIntervalMs: 5000, inProcess: false },
      database: { url: DATABASE_URL, poolMax: 10, statementTimeoutMs: 30_000 },
      auth: {
        issuer: 'https://abcdefghijklmnopqrst.supabase.co/auth/v1',
        jwksUrl: new URL('https://abcdefghijklmnopqrst.supabase.co/auth/v1/.well-known/jwks.json'),
      },
      storage: { driver: 'filesystem', root: resolve('.data/storage') },
      ai: {
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        model: 'qwen2.5:3b',
        timeoutMs: 300_000,
      },
    });
  });

  it('coerces numeric variables and splits the CORS origin list', () => {
    const config = loadConfig({
      ...REQUIRED,
      NODE_ENV: 'test',
      PORT: '8080',
      CORS_ALLOWED_ORIGINS: ' https://documind.pages.dev , http://localhost:5173 ',
      WORKER_POLL_INTERVAL_MS: '250',
      WORKER_IN_PROCESS: 'true',
    });

    expect(config.http.port).toBe(8080);
    expect(config.http.corsAllowedOrigins).toEqual([
      'https://documind.pages.dev',
      'http://localhost:5173',
    ]);
    expect(config.worker).toEqual({ pollIntervalMs: 250, inProcess: true });
  });

  it.each([
    ['PORT', '0'],
    ['PORT', '65536'],
    ['PORT', 'abc'],
    ['NODE_ENV', 'staging'],
    ['WORKER_POLL_INTERVAL_MS', '10'],
    ['DATABASE_POOL_MAX', '0'],
    ['DATABASE_STATEMENT_TIMEOUT_MS', '500'],
    ['WORKER_IN_PROCESS', 'maybe'],
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

  describe('database TLS in production', () => {
    const PRODUCTION = {
      ...REQUIRED,
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'https://0123456789abcdef.r2.cloudflarestorage.com',
      S3_BUCKET: 'documind-documents',
      S3_ACCESS_KEY_ID: 'key-id',
      S3_SECRET_ACCESS_KEY: 'secret',
      AI_PROVIDER: 'ollama',
    };

    it.each(['', '?sslmode=require', '?sslmode=prefer', '?sslmode=no-verify', '?sslmode=disable'])(
      'refuses a DATABASE_URL ending in "%s", without echoing it',
      (suffix) => {
        try {
          loadConfig({ ...PRODUCTION, DATABASE_URL: `${DATABASE_URL}${suffix}` });
          expect.unreachable();
        } catch (error) {
          expect(error).toMatchObject({
            issues: [expect.stringMatching(/^DATABASE_URL: Must use sslmode=verify-full/)],
          });
          expect(String(error)).not.toContain('secret-password');
        }
      },
    );

    it('accepts verified TLS, with or without a private CA', () => {
      for (const suffix of [
        '?sslmode=verify-full',
        '?sslmode=verify-full&sslrootcert=/etc/secrets/ca.crt',
      ]) {
        const url = `${DATABASE_URL}${suffix}`;
        expect(loadConfig({ ...PRODUCTION, DATABASE_URL: url }).database.url).toBe(url);
      }
    });

    it('leaves development connections alone', () => {
      expect(loadConfig(REQUIRED).database.url).toBe(DATABASE_URL);
    });
  });

  describe('storage', () => {
    const S3 = {
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'https://0123456789abcdef.r2.cloudflarestorage.com',
      S3_BUCKET: 'documind-documents',
      S3_ACCESS_KEY_ID: 'access-key-id',
      S3_SECRET_ACCESS_KEY: 'very-secret-value',
    };

    it('resolves the filesystem root to an absolute path', () => {
      expect(loadConfig({ ...REQUIRED, STORAGE_FILESYSTEM_ROOT: 'tmp/objects' }).storage).toEqual({
        driver: 'filesystem',
        root: resolve('tmp/objects'),
      });
    });

    it('refuses filesystem storage in production', () => {
      expect(() => loadConfig({ ...REQUIRED, NODE_ENV: 'production' })).toThrow(
        /STORAGE_DRIVER: filesystem storage is for development/,
      );
    });

    it('reads the S3 settings, defaulting the region to auto (R2)', () => {
      expect(loadConfig({ ...REQUIRED, ...S3 }).storage).toEqual({
        driver: 's3',
        endpoint: S3.S3_ENDPOINT,
        region: 'auto',
        bucket: S3.S3_BUCKET,
        accessKeyId: S3.S3_ACCESS_KEY_ID,
        secretAccessKey: S3.S3_SECRET_ACCESS_KEY,
      });
    });

    it('names every missing S3 setting', () => {
      expect(() => loadConfig({ ...REQUIRED, STORAGE_DRIVER: 's3', S3_BUCKET: 'bucket' })).toThrow(
        expect.objectContaining({
          issues: [
            'S3_ENDPOINT: Required when STORAGE_DRIVER is s3',
            'S3_ACCESS_KEY_ID: Required when STORAGE_DRIVER is s3',
            'S3_SECRET_ACCESS_KEY: Required when STORAGE_DRIVER is s3',
          ],
        }),
      );
    });

    it.each([
      ['S3_ENDPOINT', 'https://r2.example.test/bucket'],
      ['S3_ENDPOINT', 'http://r2.example.test'],
      ['S3_BUCKET', 'Bad_Bucket'],
      ['S3_BUCKET', 'ab'],
    ])('rejects %s=%s', (name, value) => {
      expect(() => loadConfig({ ...REQUIRED, ...S3, [name]: value })).toThrow(
        ConfigValidationError,
      );
    });

    it('allows a plain-http endpoint on localhost outside production only', () => {
      const local = { ...REQUIRED, ...S3, S3_ENDPOINT: 'http://localhost:9000' };
      expect(loadConfig(local).storage).toMatchObject({ endpoint: 'http://localhost:9000' });
      expect(() => loadConfig({ ...local, NODE_ENV: 'production' })).toThrow(
        /S3_ENDPOINT: Must use https in production/,
      );
    });

    it('never echoes the secret access key in validation errors', () => {
      try {
        loadConfig({ ...REQUIRED, ...S3, S3_BUCKET: 'Bad_Bucket' });
        expect.unreachable();
      } catch (error) {
        expect(String(error)).not.toContain('very-secret-value');
      }
    });
  });

  describe('ai', () => {
    // Production settings that pass every other check, so only the AI rules are under test.
    const PRODUCTION = {
      ...REQUIRED,
      DATABASE_URL: `${DATABASE_URL}?sslmode=verify-full`,
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'https://0123456789abcdef.r2.cloudflarestorage.com',
      S3_BUCKET: 'documind-documents',
      S3_ACCESS_KEY_ID: 'key-id',
      S3_SECRET_ACCESS_KEY: 'secret',
    };
    const CLOUDFLARE = {
      AI_PROVIDER: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      CLOUDFLARE_AI_API_TOKEN: 'very-secret-token',
    };

    it('reads Cloudflare settings with the default model', () => {
      expect(loadConfig({ ...PRODUCTION, ...CLOUDFLARE, AI_TIMEOUT_MS: '30000' }).ai).toEqual({
        provider: 'cloudflare',
        accountId: CLOUDFLARE.CLOUDFLARE_ACCOUNT_ID,
        apiToken: CLOUDFLARE.CLOUDFLARE_AI_API_TOKEN,
        model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        timeoutMs: 30_000,
      });
    });

    it('requires an explicit provider in production', () => {
      expect(() => loadConfig(PRODUCTION)).toThrow(/AI_PROVIDER: Required in production/);
    });

    it('names every missing Cloudflare setting, without echoing the token', () => {
      try {
        loadConfig({
          ...REQUIRED,
          AI_PROVIDER: 'cloudflare',
          CLOUDFLARE_AI_API_TOKEN: 'very-secret-token',
        });
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({
          issues: ['CLOUDFLARE_ACCOUNT_ID: Required when AI_PROVIDER is cloudflare'],
        });
        expect(String(error)).not.toContain('very-secret-token');
      }
    });

    it('allows plain-http Ollama only on this machine in production', () => {
      const ollama = { ...PRODUCTION, AI_PROVIDER: 'ollama' };
      expect(loadConfig(ollama).ai).toMatchObject({
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
      });
      expect(() =>
        loadConfig({ ...ollama, OLLAMA_BASE_URL: 'http://gpu-box.internal:11434' }),
      ).toThrow(/OLLAMA_BASE_URL: Must use https in production/);
      expect(loadConfig({ ...REQUIRED, OLLAMA_BASE_URL: 'http://ollama:11434' }).ai).toMatchObject({
        baseUrl: 'http://ollama:11434',
      });
    });

    it.each([
      ['AI_PROVIDER', 'openai'],
      ['AI_TIMEOUT_MS', '10'],
      ['OLLAMA_BASE_URL', 'http://localhost:11434/api'],
      ['OLLAMA_MODEL', 'Qwen 2.5'],
      ['CLOUDFLARE_ACCOUNT_ID', 'not-an-account'],
      ['CLOUDFLARE_AI_MODEL', 'llama-3'],
    ])('rejects %s=%s', (name, value) => {
      expect(() => loadConfig({ ...REQUIRED, [name]: value })).toThrow(ConfigValidationError);
    });
  });
});
