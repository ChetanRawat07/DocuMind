export type AiErrorKind =
  | 'timeout'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_output'
  | 'authentication'
  | 'invalid_request';

/** Failures that may succeed if the same request is sent again later. */
const RETRYABLE: ReadonlySet<AiErrorKind> = new Set([
  'timeout',
  'rate_limited',
  'unavailable',
  // Models are nondeterministic: a malformed answer is often fine on the next attempt.
  'invalid_output',
]);

/**
 * Every provider failure, normalized: callers never see provider-specific
 * status codes or bodies. `retryable` drives the job runner's retries
 * (Phase 9); `retryAfterMs` is the provider's own hint, when it gives one.
 * Messages never contain prompt or response text, which may hold document
 * content.
 */
export class AiProviderError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(
    readonly kind: AiErrorKind,
    readonly provider: string,
    message: string,
    options: { cause?: unknown; retryAfterMs?: number } = {},
  ) {
    super(`${provider}: ${message}`, { cause: options.cause });
    this.name = 'AiProviderError';
    this.retryable = RETRYABLE.has(kind);
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** The error kind for an HTTP status from a provider. */
export function errorKindForStatus(status: number): AiErrorKind {
  if (status === 401 || status === 403) return 'authentication';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'invalid_request';
}
