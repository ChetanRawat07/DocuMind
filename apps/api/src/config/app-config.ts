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
});

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
  };
}
