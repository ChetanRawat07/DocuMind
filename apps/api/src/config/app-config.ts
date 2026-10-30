import { resolve } from 'node:path';
import { z } from 'zod';

/** Nest log levels, ordered from most to least verbose. */
export const LOG_LEVELS = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const isPostgresUrl = (value: string): boolean => {
  try {
    const { protocol, hostname, pathname } = new URL(value);
    return (
      (protocol === 'postgres:' || protocol === 'postgresql:') &&
      hostname.length > 0 &&
      pathname.length > 1
    );
  } catch {
    return false;
  }
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** https everywhere; plain http only for a local Supabase CLI stack. */
const isSupabaseOrigin = (value: string): boolean => {
  if (!isBareOrigin(value)) return false;
  const { protocol, hostname } = new URL(value);
  return protocol === 'https:' || (protocol === 'http:' && LOOPBACK_HOSTS.has(hostname));
};

/** https everywhere; plain http only for a local S3-compatible server. */
const isStorageEndpoint = (value: string): boolean => {
  if (!isBareOrigin(value)) return false;
  const { protocol, hostname } = new URL(value);
  return protocol === 'https:' || (protocol === 'http:' && LOOPBACK_HOSTS.has(hostname));
};

const isBareOrigin = (value: string): boolean => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
};

/**
 * Environment contract for every DocuMind process. Parsed once at startup so a
 * misconfigured deployment fails immediately instead of at first use.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('log'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((raw) =>
      raw
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    )
    .pipe(
      z.array(
        z.string().refine(isBareOrigin, {
          message: 'Each origin must be scheme://host[:port] with no path or trailing slash',
        }),
      ),
    ),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
  DATABASE_URL: z.string().refine(isPostgresUrl, {
    message: 'Must be a postgres:// or postgresql:// URL including host and database name',
  }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
  SUPABASE_URL: z.string().refine(isSupabaseOrigin, {
    message: 'Must be https://<project>.supabase.co (http is allowed only for localhost)',
  }),
  STORAGE_DRIVER: z.enum(['filesystem', 's3']).default('filesystem'),
  STORAGE_FILESYSTEM_ROOT: z.string().min(1).default('.data/storage'),
  S3_ENDPOINT: z
    .string()
    .refine(isStorageEndpoint, {
      message: 'Must be https://<host> with no path (http is allowed only for localhost)',
    })
    .optional(),
  S3_REGION: z.string().min(1).default('auto'),
  // S3 bucket naming rules: 3-63 lowercase letters, digits, dots and hyphens.
  S3_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, { message: 'Must be a valid bucket name' })
    .optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
});

const S3_REQUIRED = [
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

export type StorageConfig =
  | {
      readonly driver: 'filesystem';
      /** Absolute directory holding the objects. */
      readonly root: string;
    }
  | {
      readonly driver: 's3';
      readonly endpoint: string;
      readonly region: string;
      readonly bucket: string;
      readonly accessKeyId: string;
      /** Secret: never log it. */
      readonly secretAccessKey: string;
    };

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly log: {
    readonly level: LogLevel;
    readonly format: 'json' | 'pretty';
  };
  readonly http: {
    readonly port: number;
    readonly corsAllowedOrigins: readonly string[];
  };
  readonly worker: {
    readonly pollIntervalMs: number;
  };
  readonly database: {
    /** Contains credentials: never log it. */
    readonly url: string;
    readonly poolMax: number;
    readonly statementTimeoutMs: number;
  };
  readonly auth: {
    /** Expected `iss` claim of Supabase access tokens. */
    readonly issuer: string;
    /** Public keys that sign access tokens. */
    readonly jwksUrl: URL;
  };
  readonly storage: StorageConfig;
}

export class ConfigValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Builds the typed configuration from raw environment variables.
 * Error messages name the offending variable but never echo its value,
 * because environment variables routinely hold secrets.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }

  const parsed = result.data;
  if (parsed.NODE_ENV === 'production' && !parsed.SUPABASE_URL.startsWith('https://')) {
    throw new ConfigValidationError(['SUPABASE_URL: Must use https in production']);
  }

  const storage = storageConfigFrom(parsed);

  const issuer = `${parsed.SUPABASE_URL}/auth/v1`;
  return {
    nodeEnv: parsed.NODE_ENV,
    log: { level: parsed.LOG_LEVEL, format: parsed.LOG_FORMAT },
    http: { port: parsed.PORT, corsAllowedOrigins: parsed.CORS_ALLOWED_ORIGINS },
    worker: { pollIntervalMs: parsed.WORKER_POLL_INTERVAL_MS },
    database: {
      url: parsed.DATABASE_URL,
      poolMax: parsed.DATABASE_POOL_MAX,
      statementTimeoutMs: parsed.DATABASE_STATEMENT_TIMEOUT_MS,
    },
    auth: { issuer, jwksUrl: new URL(`${issuer}/.well-known/jwks.json`) },
    storage,
  };
}

function storageConfigFrom(parsed: z.output<typeof envSchema>): StorageConfig {
  if (parsed.STORAGE_DRIVER === 'filesystem') {
    // Free hosts wipe their disk on restart, so production files would be lost.
    if (parsed.NODE_ENV === 'production') {
      throw new ConfigValidationError([
        'STORAGE_DRIVER: filesystem storage is for development and tests; use s3 in production',
      ]);
    }
    return { driver: 'filesystem', root: resolve(parsed.STORAGE_FILESYSTEM_ROOT) };
  }

  const missing = S3_REQUIRED.filter((name) => parsed[name] === undefined);
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = parsed;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new ConfigValidationError(
      missing.map((name) => `${name}: Required when STORAGE_DRIVER is s3`),
    );
  }
  if (parsed.NODE_ENV === 'production' && !S3_ENDPOINT.startsWith('https://')) {
    throw new ConfigValidationError(['S3_ENDPOINT: Must use https in production']);
  }
  return {
    driver: 's3',
    endpoint: S3_ENDPOINT,
    region: parsed.S3_REGION,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  };
}
