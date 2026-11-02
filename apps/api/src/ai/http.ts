import { AiProviderError, errorKindForStatus } from './ai-error.js';

export interface ProviderHttpResponse {
  readonly status: number;
  /** Parsed JSON body, or null when the body is not JSON. */
  readonly body: unknown;
  readonly retryAfterMs: number | undefined;
}

/**
 * POSTs JSON to a provider with a timeout covering the whole exchange,
 * including reading the body. Network failures and timeouts become
 * AiProviderError; HTTP statuses are returned for the provider to interpret.
 * A caller's own cancellation is rethrown as-is: it is not a provider fault.
 */
export async function postJson(
  provider: string,
  url: string,
  init: {
    readonly headers?: Record<string, string>;
    readonly body: unknown;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<ProviderHttpResponse> {
  const timeout = AbortSignal.timeout(init.timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers },
      body: JSON.stringify(init.body),
      signal,
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON (a proxy's HTML error page, for example); the status still classifies it.
    }
    return { status: response.status, body, retryAfterMs: retryAfterMs(response.headers) };
  } catch (error) {
    if (init.signal?.aborted) throw init.signal.reason;
    if (timeout.aborted) {
      throw new AiProviderError('timeout', provider, `No response within ${init.timeoutMs} ms`, {
        cause: error,
      });
    }
    throw new AiProviderError('unavailable', provider, 'Could not reach the provider', {
      cause: error,
    });
  }
}

/** An AiProviderError for a non-2xx response, with the provider's (short) error text. */
export function statusError(
  provider: string,
  response: ProviderHttpResponse,
  detail: string | undefined,
): AiProviderError {
  const suffix = detail ? `: ${detail.slice(0, 200)}` : '';
  return new AiProviderError(
    errorKindForStatus(response.status),
    provider,
    `HTTP ${response.status}${suffix}`,
    response.retryAfterMs === undefined ? {} : { retryAfterMs: response.retryAfterMs },
  );
}

/** Retry-After in seconds or as an HTTP date, converted to milliseconds. */
function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
